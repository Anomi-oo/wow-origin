const BasePlatform = require('../base/BasePlatform')
const request = require('./util/request')
const crypto = require('crypto')
const path = require('path')
const neteaseConfig = require('./config')

/**
 * 网易云音乐平台适配器
 * 封装网易云API到统一接口
 */
class NeteasePlatform extends BasePlatform {
  constructor(config = {}) {
    super({
      name: 'netease',
      ...neteaseConfig.getCacheConfig(), // 使用平台特定的缓存配置
      ...config
    })
    // 平台级静态标识 - 初始化时生成，全生命周期复用
    this.staticDeviceId = this.generateDeviceId()
    this.staticCnIP = this.generateRandomChineseIP()

    this.logger.debug('Generated static platform identifiers', {
      deviceId: this.staticDeviceId,
      cnIP: this.staticCnIP
    })
  }

  /**
   * 初始化平台
   */
  async doInitialize() {
    const modulePath = path.join(__dirname, 'module')

    // 异步动态加载模块
    await this.loadModules(modulePath)

    this.logger.debug(`NetEase platform initialized with ${this.modules.size} modules`)
  }

  /**
   * 模块调用前的验证
   * 如果传入了 MUSIC_U 参数，验证其有效性并将 uid 注入到 query
   */
  async beforeModuleCall(query, route) {
    if (query.MUSIC_U) {
      const getUid = require('./util/getUid')
      const uid = await getUid(query.MUSIC_U)
      query.uid = uid
      this.logger.debug(`MUSIC_U validation passed for route: ${route}, uid: ${uid}`)
    }
  }

  /**
   * 创建请求函数
   */
  createRequestFunction() {
    return (uri, data, options = {}) => {
      // 注入平台静态标识
      const requestOptions = {
        ...options,
        ip: this.staticCnIP,
        deviceId: this.staticDeviceId
      }

      return request(uri, data, requestOptions)
    }
  }



  /**
   * 生成 52 位大写十六进制 DeviceId（26 字节随机）
   */
  generateDeviceId() {
    return crypto.randomBytes(26).toString('hex').toUpperCase()
  }

  /**
   * 生成随机中国IP地址
   * 用于网易云API请求
   */
  generateRandomChineseIP() {
    const chinaIPPrefixes = [
      '116.25', '116.76', '116.77', '116.78',
      '123.125', '180.149', '202.108', '211.136'
    ]

    const randomPrefix = chinaIPPrefixes[Math.floor(Math.random() * chinaIPPrefixes.length)]
    return `${randomPrefix}.${this.generateIPSegment()}.${this.generateIPSegment()}`
  }

  /**
   * 生成IP地址段 (1-255)
   */
  generateIPSegment() {
    return Math.floor(Math.random() * 255) + 1
  }

}

module.exports = NeteasePlatform