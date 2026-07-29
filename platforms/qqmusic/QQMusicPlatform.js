const BasePlatform = require('../base/BasePlatform')
const request = require('./util/request')
const path = require('path')
const qqmusicConfig = require('./config')

/**
 * QQ音乐平台适配器
 * 封装QQ音乐API到统一接口
 */
class QQMusicPlatform extends BasePlatform {
  constructor(config = {}) {
    super({
      name: 'qqmusic',
      ...qqmusicConfig.getCacheConfig(), // 使用平台特定的缓存配置
      ...config
    })
  }

  /**
   * 初始化平台
   */
  async doInitialize() {
    const modulePath = path.join(__dirname, 'module')

    // 异步动态加载模块
    await this.loadModules(modulePath)

    this.logger.debug(`QQMusic platform initialized with ${this.modules.size} modules`)
  }

  /**
   * 创建请求函数
   */
  createRequestFunction() {
    return (module, method, data, options = {}) => {
      return request.createRequest(module, method, data, options)
    }
  }
}

module.exports = QQMusicPlatform