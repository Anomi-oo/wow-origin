/**
 * 高性能LRU缓存实现
 * 优化: 使用双向链表维护LRU顺序,避免Map的delete+set开销
 */

/**
 * 双向链表节点
 */
class CacheNode {
  constructor(key, value, expires) {
    this.key = key
    this.value = value
    this.expires = expires
    this.prev = null
    this.next = null
  }
}

/**
 * 高性能LRU缓存
 */
class PlatformCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 5000      
    this.defaultTTL = options.defaultTTL || 900000 // 15分钟 
    this.stats = { hits: 0, misses: 0 }

    // 使用Map存储键到节点的映射 (O(1)查找)
    this.cache = new Map()

    // 双向链表维护LRU顺序
    // head <- ... <- tail (最新)
    this.head = new CacheNode(null, null, 0)  // 哨兵头节点
    this.tail = new CacheNode(null, null, 0)  // 哨兵尾节点
    this.head.next = this.tail
    this.tail.prev = this.head

    // 系统参数列表(缓存键生成时过滤)
    this.systemParams = new Set(['ip', 'requestId', '_route', 'cookie', 'platform', 'deviceId', 'timestamp', 'uin', 'qm_keyst', 'MUSIC_U'])
  }

  /**
   * 生成缓存键 (优化: 使用Set过滤,减少数组操作)
   */
  _generateKey(platform, route, params) {
    const keys = []
    for (const key in params) {
      if (!this.systemParams.has(key)) {
        keys.push(key)
      }
    }

    // 排序后拼接
    keys.sort()
    const userParams = keys.map(key => `${key}=${params[key]}`).join('&')
    return `${platform}:${route}:${userParams}`
  }

  /**
   * 将节点移到链表尾部 (最新位置)
   */
  _moveToTail(node) {
    // 从当前位置移除
    node.prev.next = node.next
    node.next.prev = node.prev

    // 插入到tail前
    node.prev = this.tail.prev
    node.next = this.tail
    this.tail.prev.next = node
    this.tail.prev = node
  }

  /**
   * 移除节点
   */
  _removeNode(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
  }

  /**
   * 添加节点到尾部
   */
  _addToTail(node) {
    node.prev = this.tail.prev
    node.next = this.tail
    this.tail.prev.next = node
    this.tail.prev = node
  }

  /**
   * 移除头部节点 (最老的)
   */
  _removeHead() {
    const oldestNode = this.head.next
    this._removeNode(oldestNode)
    return oldestNode
  }

  /**
   * 获取缓存 (O(1)性能)
   */
  get(platform, route, params) {
    const key = this._generateKey(platform, route, params)
    const node = this.cache.get(key)

    // 缓存未命中或已过期
    if (!node || Date.now() > node.expires) {
      if (node) {
        this._removeNode(node)
        this.cache.delete(key)
      }
      this.stats.misses++
      return null
    }

    // LRU: 移到尾部 (O(1)操作,不需要delete+set!)
    this._moveToTail(node)
    this.stats.hits++
    return node.value
  }

  /**
   * 设置缓存 (O(1)性能)
   */
  set(platform, route, params, value, ttl = this.defaultTTL) {
    const key = this._generateKey(platform, route, params)
    const existingNode = this.cache.get(key)

    // 如果键已存在,更新值并移到尾部
    if (existingNode) {
      existingNode.value = value
      existingNode.expires = Date.now() + ttl
      this._moveToTail(existingNode)
      return
    }

    // 新增节点
    const newNode = new CacheNode(key, value, Date.now() + ttl)
    this.cache.set(key, newNode)
    this._addToTail(newNode)

    // 如果超过容量,移除最老的节点
    if (this.cache.size > this.maxSize) {
      const oldest = this._removeHead()
      this.cache.delete(oldest.key)
    }
  }

  /**
   * 删除特定路由的所有缓存
   */
  clearRoute(platform, route) {
    const prefix = `${platform}:${route}:`
    let deletedCount = 0

    for (const [key, node] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        this._removeNode(node)
        this.cache.delete(key)
        deletedCount++
      }
    }

    return deletedCount
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear()
    this.head.next = this.tail
    this.tail.prev = this.head
    this.stats = { hits: 0, misses: 0 }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) / 100 : 0,
      size: this.cache.size,
      maxSize: this.maxSize
    }
  }

  /**
   * 清理过期项 (优化: 使用定时清理,避免遍历所有项)
   */
  cleanup() {
    const now = Date.now()
    let cleanedCount = 0

    // 从头部开始清理(最老的项)
    let current = this.head.next
    while (current !== this.tail) {
      const next = current.next
      if (now > current.expires) {
        this._removeNode(current)
        this.cache.delete(current.key)
        cleanedCount++
      }
      current = next
    }

    return cleanedCount
  }

  /**
   * 启动自动清理定时器
   */
  startAutoCleanup(intervalMs = 300000) {  // 优化: 默认5分钟
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
    }

    this._cleanupTimer = setInterval(() => {
      const cleaned = this.cleanup()
      if (cleaned > 0) {
        console.log(`[Cache] Auto cleanup: removed ${cleaned} expired items`)
      }
    }, intervalMs)

    // 确保进程退出时清理定时器
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref()
    }
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
      this._cleanupTimer = null
    }
  }
}

// 全局单例
const globalCache = new PlatformCache()

// 启动自动清理 (优化: 每5分钟清理一次过期缓存)
globalCache.startAutoCleanup(300000)

module.exports = {
  PlatformCache,
  globalCache
}