/**
 * 平台配置管理
 */

/**
 * 通用参数验证配置
 */
const COMMON_VALIDATION = {
  limit: {
    type: 'integer',
    min: 1,
    max: 10000,
    default: 30
  },
  offset: {
    type: 'integer',
    min: 0,
    default: 0
  }
}

/**
 * 默认特定路由参数验证规则，有需要再补充
 */
const DEFAULT_ROUTE_VALIDATION_RULES = {
  'search': {
    keywords: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 100,
      message: 'keywords is required and must be 1-100 characters'
    },
  }
}

/**
 * 默认缓存配置
 * 作为所有平台的基础配置，可被平台特定配置覆盖
 */
const DEFAULT_CACHE_CONFIGS = {
  // 默认配置
  'aidj/content/rcmd': {
    enabled: false
  },

  // 默认配置
  'album': {
    enabled: true,
    ttlMinutes: 30  // 10分钟
  },

  // 详情数据
  'album/detail': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  // 详情数据
  'album/new': {
    enabled: true,
    ttlMinutes: 30  // 30分钟
  },

  
  'album/sub': {
    enabled: false
  },

  
  'album/sublist': {
    enabled: false
  },

  // 详情数据
  'artist/album': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  // 详情数据
  'artist/detail': {
    enabled: true,
    ttlMinutes: 120  // 30分钟
  },

  // 详情数据
  'artist/list': {
    enabled: true,
    ttlMinutes: 120  // 30分钟
  },

  // 详情数据
  'artist/mv': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  // 详情数据
  'artist/tracks': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  
  'artist/sub': {
    enabled: false
  },

  'artist/sublist': {
    enabled: false
  },

  'cloud/import': {
    enabled: false
  },

  'cloud/match': {
    enabled: false
  },

  // 搜索结果
  'cloudsearch': {
    enabled: true,
    ttlMinutes: 30  // 10分钟
  },

  // 默认配置
  'comment/hot': {
    enabled: true,
    ttlMinutes: 30  // 30分钟
  },

  // 默认配置
  'comment/new': {
    enabled: true,
    ttlMinutes: 10  // 10分钟
  },

  // 个性化内容
  'dj/category/recommend': {
    enabled: false
  },

  // 默认配置
  'dj/catelist': {
    enabled: true,
    ttlMinutes: 60  // 10分钟
  },

  // 详情数据
  'dj/detail': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  // 个性化内容
  'dj/personalize/recommend': {
    enabled: false
  },

  // 默认配置
  'dj/program': {
    enabled: true,
    ttlMinutes: 60  // 10分钟
  },

  // 详情数据
  'dj/program/detail': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  // 默认配置
  'dj/radio/hot': {
    enabled: true,
    ttlMinutes: 60  // 10分钟
  },

  // 个性化内容
  'dj/recommend': {
    enabled: false
  },

  // 个性化内容
  'dj/recommend/type': {
    enabled: false
  },

  // 操作类接口
  'dj/sub': {
    enabled: false
  },

  // 操作类接口
  'dj/sublist': {
    enabled: false
  },

  // 默认配置
  'dj/toplist': {
    enabled: true,
    ttlMinutes: 60  // 10分钟
  },

  // 个性化内容
  'fm/trash': {
    enabled: false
  },

  // 操作类接口
  'like': {
    enabled: false
  },

  // 操作类接口
  'likelist': {
    enabled: false
  },

  // 用户数据
  'login/qr/check': {
    enabled: false
  },

  // 用户数据
  'login/qr/key': {
    enabled: false
  },

  // 歌词数据
  'lyric': {
    enabled: true,
    ttlMinutes: 120  // 120分钟
  },

  // 歌词数据
  'lyric/new': {
    enabled: true,
    ttlMinutes: 120  // 60分钟
  },

  // 默认配置
  'mv/all': {
    enabled: true,
    ttlMinutes: 30  // 30分钟
  },

  // 详情数据
  'mv/detail': {
    enabled: true,
    ttlMinutes: 30  // 30分钟
  },

  // 详情数据
  'mv/detail/info': {
    enabled: true,
    ttlMinutes: 30  // 30分钟
  },

  // 操作类接口
  'mv/sublist': {
    enabled: false
  },

  // URL可能变化
  'mv/url': {
    enabled: false
  },

  // 个性化内容
  'personal/fm': {
    enabled: false
  },

  // 个性化内容
  'personalized': {
    enabled: false
  },

  // 歌单数据
  'playlist/catlist': {
    enabled: true,
    ttlUntilMidnight: true
  },

  // 歌单数据
  'playlist/create': {
    enabled: false
  },

  // 歌单数据
  'playlist/delete': {
    enabled: false
  },

  // 详情数据
  'playlist/detail': {
    enabled: true,
    enabledWhenParams: ['toplistTrackCache'],
    ttlUntilMidnight: true
  },

  // 歌单数据
  'playlist/highquality/tags': {
    enabled: true,
    ttlMinutes: 60  // 10分钟
  },

  // 歌单数据
  'playlist/subscribe': {
    enabled: false
  },

  // 歌单数据
  'playlist/track/all': {
    enabled: false
  },

  // 歌单操作
  'playlist/tracks': {
    enabled: false
  },

  // 歌单数据
  'playlist/unsubscribe': {
    enabled: false
  },

  // 歌单
  'playlist/update': {
    enabled: false
  },

  // 默认配置
  'playmode/intelligence/list': {
    enabled: false
  },

  // 个性化内容
  'recommend/resource': {
    enabled: false
  },

  // 个性化内容
  'recommend/songs': {
    enabled: false
  },

  // 操作类接口
  'resource/like': {
    enabled: false
  },

  // 搜索结果
  'search': {
    enabled: true,
    ttlMinutes: 15  // 15分钟
  },

  // 搜索默认
  'search/default': {
    enabled: false
  },

  // 搜索结果
  'search/hot/detail': {
    enabled: true,
    ttlMinutes: 10  // 10分钟
  },

  // 搜索建议
  'search/suggest': {
    enabled: true,
    ttlMinutes: 10  // 10分钟
  },

  // 详情数据
  'song/chorus': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  // 详情数据
  'song/detail': {
    enabled: true,
    ttlMinutes: 60  // 60分钟
  },

  
  'song/download/url/v1': {
    enabled: false
  },

  // 详情数据
  'song/dynamic/cover': {
    enabled: true,
    ttlMinutes: 60  // 30分钟
  },

  'song/like': {
    enabled: false
  },

  // 详情数据
  'song/music/detail': {
    enabled: false
  },

  // 详情数据
  'song/url': {
    enabled: false
  },

  // 详情数据
  'song/url/v1': {
    enabled: false
  },

  // 榜单数据
  'top/artists': {
    enabled: true,
    ttlUntilMidnight: true
  },

  // 榜单数据
  'top/playlist': {
    enabled: true,
    ttlMinutes: 60,
    ttlUntilMidnightParams: ['category', 'cat']
  },

  // 榜单数据
  'top/playlist/highquality': {
    enabled: true,
    ttlMinutes: 60  // 60分钟
  },

  // 榜单数据
  'top/song': {
    enabled: true,
    ttlUntilMidnight: true
  },

  // 榜单数据
  'toplist': {
    enabled: true,
    ttlMinutes: 1440
  },

  // 榜单数据
  'toplist/artist': {
    enabled: true,
    ttlMinutes: 60  // 60分钟
  },

  // 详情数据
  'toplist/detail': {
    enabled: true,
    ttlMinutes: 60  // 60分钟
  },

  // 详情数据
  'toplist/detail/v2': {
    enabled: true,
    ttlMinutes: 1440
  },

  // 详情数据
  'toplist/songs/v2': {
    enabled: true,
    ttlUntilMidnight: true
  },

  // 用户数据
  'user/account': {
    enabled: false
  },

  // 用户数据
  'user/cloud': {
    enabled: false
  },

  // 用户数据
  'user/cloud/del': {
    enabled: false
  },

  // 用户数据
  'user/detail': {
    enabled: false
  },

  // 用户数据
  'user/playlist': {
    enabled: false
  },

  // 用户数据
  'user/subcount': {
    enabled: false
  },

}

/**
 * 平台显示名称映射
 */
const PLATFORM_DISPLAY_NAMES = {
  'netease': 'Netease Platform',
  'qqmusic': 'QQ Music Platform',
  'spotify': 'Spotify Platform'
}

class PlatformConfig {
  // 配置缓存 - 避免每次请求都require(),提升性能 (O(1)查找)
  static _configCache = new Map()

  /**
   * 获取平台配置对象（带缓存）
   * @private
   */
  static _getPlatformConfig(platformName) {
    if (!this._configCache.has(platformName)) {
      const config = require(`../platforms/${platformName}/config`)
      this._configCache.set(platformName, config)
    }
    return this._configCache.get(platformName)
  }

  /**
   * 提取用户核心参数（排除系统参数）
   */
  static extractUserParams(query) {
    return Object.fromEntries(
      Object.entries(query).filter(([key]) => !this.isSystemParam(key))
    )
  }

  /**
   * 获取通用验证配置
   */
  static getCommonValidation() {
    return { ...COMMON_VALIDATION }
  }

  /**
   * 获取路由参数验证规则
   */
  static getRouteValidation(route, platformName = null) {
    const defaultRules = DEFAULT_ROUTE_VALIDATION_RULES[route] ? DEFAULT_ROUTE_VALIDATION_RULES[route] : {}
    if (!platformName) {
      return defaultRules
    }

    const platformConfig = this._getPlatformConfig(platformName)
    const platformValidationRules = platformConfig.getPlatformValidationRules()

    return Object.assign({}, defaultRules, platformValidationRules[route])
  }

  /**
   * 获取平台显示名称
   */
  static getPlatformDisplayName(platformName) {
    return PLATFORM_DISPLAY_NAMES[platformName] || `${platformName} Platform`
  }

  /**
   * 获取缓存配置（支持平台特定配置）
   * @param {string} platformName - 平台名称
   * @returns {Object} 合并后的缓存配置
   */
  static getCacheConfigs(platformName = null) {
    if (!platformName) {
      return { ...DEFAULT_CACHE_CONFIGS }
    }

    const platformConfig = this._getPlatformConfig(platformName)
    const platformCacheConfigs = platformConfig.getRouteCacheConfigs()

    return Object.assign({}, DEFAULT_CACHE_CONFIGS, platformCacheConfigs)
  }

  /**
   * 验证参数值
   */
  static validateParam(paramName, value, rule) {
    const errors = []

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(rule.message || `${paramName} is required`)
      return errors
    }

    if (value === undefined || value === null || value === '') {
      return errors // 非必需参数可以为空
    }

    // 类型验证
    if (rule.type) {
      switch (rule.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`${paramName} must be a string-` + typeof(value) + String(value))
          } else {
            if (rule.minLength && value.length < rule.minLength) {
              errors.push(`${paramName} must be at least ${rule.minLength} characters`)
            }
            if (rule.maxLength && value.length > rule.maxLength) {
              errors.push(`${paramName} must be at most ${rule.maxLength} characters`)
            }
            if (rule.pattern && !rule.pattern.test(value)) {
              errors.push(rule.message || `${paramName} format is invalid`)
            }
            if (rule.enum && !rule.enum.includes(value)) {
              errors.push(rule.message || `${paramName} must be one of: ${rule.enum.join(', ')}`)
            }
          }
          break

        case 'integer':
          const numValue = parseInt(value)
          if (isNaN(numValue)) {
            errors.push(`${paramName} must be a valid integer`)
          } else {
            if (rule.min !== undefined && numValue < rule.min) {
              errors.push(`${paramName} must be at least ${rule.min}`)
            }
            if (rule.max !== undefined && numValue > rule.max) {
              errors.push(`${paramName} must be at most ${rule.max}`)
            }
            if (rule.enum && !rule.enum.includes(numValue)) {
              errors.push(rule.message || `${paramName} must be one of: ${rule.enum.join(', ')}`)
            }
          }
          break
      }
    }

    return errors
  }

}

module.exports = PlatformConfig
