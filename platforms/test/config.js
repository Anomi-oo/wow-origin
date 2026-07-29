/**
 * 测试平台配置
 * 用于单元测试
 */

/**
 * 获取平台特定的缓存配置
 */
function getCacheConfig() {
  return {
    enableCache: true,
    defaultTTL: 300000
  }
}

/**
 * 获取平台特定的验证规则
 */
function getPlatformValidationRules() {
  return {}
}

/**
 * 获取路由缓存配置
 */
function getRouteCacheConfigs() {
  return {
    'status': {
      enabled: true,
      ttlMinutes: 10
    },
    'detail': {
      enabled: true,
      ttlMinutes: 30
    }
  }
}

module.exports = {
  getCacheConfig,
  getPlatformValidationRules,
  getRouteCacheConfigs
}
