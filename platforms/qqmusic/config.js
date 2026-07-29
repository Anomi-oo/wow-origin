/**
 * QQ音乐平台特定配置
 */


// 音质映射
const QUALITY_CONFIG = {
  "standard": { prefix: "M500", suffix: ".mp3", name: "标准", bitrate: 128000, format: "mp3", sizeField: "size_128mp3"},
  "higher": { prefix: "C600", suffix: ".m4a", name: "高品质", bitrate: 192000, format: "m4a", sizeField: "size_192aac"},
  "exhigh": { prefix: "M800", suffix: ".mp3", name: "HQ 高品质", bitrate: 320000, format: "mp3", sizeField: "size_320mp3"},
  "lossless": { prefix: "F000", suffix: ".flac", name: "SQ 无损品质", bitrate: null, format: "flac", sizeField: "size_flac"},
  // "dolby": { prefix: "Q000", suffix: ".flac", name: "Dolby Atmos", bitrate: null, format: "flac", sizeField: "size_dolby"},
  // "jymaster": { prefix: "AI00", suffix: ".flac", name: "Hi-Res (24-bit)", bitrate: null, format: "flac", sizeField: "size_flac"},
  // "jyeffect": { prefix: "AI00", suffix: ".flac", name: "Hi-Res (24-bit)", bitrate: null, format: "flac", sizeField: "size_flac"},
}

// 歌单分类映射 (name -> categoryId)
// 总计: 78个分类
const PLAYLIST_CATEGORY_MAP = {
  // ===== 热门 (group_id=1, 3个) =====
  "官方歌单": 3317,
  "AI歌单": 9527,
  "私藏": 3417,

  // ===== 主题 (group_id=2, 23个) =====
  "音乐人在听": 1069,
  "KTV金曲": 64,
  "Chill Vibes": 3902,
  "网络歌曲": 3056,
  "现场音乐": 95,
  "背景音乐": 107,
  "经典老歌": 59,
  "情歌": 71,
  "儿歌": 3200,
  "ACG": 3202,
  "影视": 3201,
  "综艺": 3256,
  "游戏": 73,
  "乐器": 3204,
  "城市": 93,
  "戏曲": 3361,
  "DJ神曲": 3357,
  "MC喊麦": 60,
  "佛教音乐": 3401,
  "厂牌专区": 3320,
  "人气音乐节": 136,
  "精品": 3819,
  "互动歌单": 3903,

  // ===== 场景 (group_id=3, 12个) =====
  "夜店": 32,
  "学习工作": 3248,
  "咖啡馆": 3215,
  "运动": 132,
  "睡前": 27,
  "旅行": 36,
  "跳舞": 3216,
  "派对": 33,
  "婚礼": 3214,
  "约会": 35,
  "校园": 39,
  "驾驶": 3901,

  // ===== 心情 (group_id=4, 9个) =====
  "伤感": 74,
  "快乐": 3142,
  "安静": 13,
  "励志": 16,
  "治愈": 7,
  "思念": 10,
  "甜蜜": 20,
  "寂寞": 9,
  "宣泄": 17,

  // ===== 流派 (group_id=5, 18个) =====
  "流行": 3152,
  "电子": 45,
  "轻音乐": 49,
  "民谣": 48,
  "说唱": 42,
  "摇滚": 41,
  "爵士": 46,
  "R&B": 43,
  "布鲁斯": 51,
  "古典": 47,
  "后摇": 3217,
  "古风": 61,
  "中国风": 68,
  "乡村": 44,
  "金属": 3065,
  "新世纪": 53,
  "世界音乐": 3066,
  "中国传统": 3176,

  // ===== 语种 (group_id=6, 9个) =====
  "英语": 3,
  "粤语": 146,
  "韩语": 4,
  "日语": 5,
  "国语": 1,
  "闽南语": 113,
  "小语种": 6,
  "法语": 149,
  "拉丁语": 3205,

  // ===== 年代 (group_id=9, 4个) =====
  "00年代": 144,
  "90年代": 142,
  "80年代": 141,
  "70年代": 140,
}

/**
 * 应用核心配置
 */
const QQ_CONF = {
  apiDomain: "https://u6.y.qq.com",
  domain: "https://y.qq.com",
  streamDomain: "https://isure.stream.qqmusic.qq.com/"
}

/**
 * 缓存配置
 */
const CACHE_CONFIG = {
  enableCache: true,
  defaultTTL: 600000, // 10分钟
}

/**
 * QQ音乐平台特定验证规则
 */
const PLATFORM_VALIDATION_RULES = {

}

/**
 * QQ音乐平台路由特定缓存配置
 * 覆盖默认缓存配置
 * 使用 ttlMinutes（分钟）更易于配置，会自动转换为毫秒
 */
const ROUTE_CACHE_CONFIGS = {
  'mv/collection': {
    enabled: true,
    ttlMinutes: 30
  },
  'mv/focus': {
    enabled: true,
    ttlMinutes: 15  
  },
  'mv/hot': {
    enabled: true,
    ttlMinutes: 60  
  },
  'mv/list': {
    enabled: true,
    ttlMinutes: 60  
  },
  'mv/new': {
    enabled: true,
    ttlMinutes: 30  
  },
  'mv/rank': {
    enabled: true,
    ttlMinutes: 60  
  },
  // 会返回播放链接，与账号权益相关
  'mv/detail': {
    enabled: false
  },
}

/**
 * 获取音质映射
 */
function getQualityMap() {
  return { ...QUALITY_CONFIG }
}

/**
 * 获取缓存配置
 */
function getCacheConfig() {
  return { ...CACHE_CONFIG }
}

/**
 * 获取平台验证规则
 */
function getPlatformValidationRules() {
  return { ...PLATFORM_VALIDATION_RULES }
}


/**
 * 获取应用核心配置
 */
function getQQConf() {
  return { ...QQ_CONF }
}

/**
 * 获取路由特定缓存配置
 */
function getRouteCacheConfigs() {
  return { ...ROUTE_CACHE_CONFIGS }
}

/**
 * 获取歌单分类映射表
 */
function getPlaylistCategoryMap() {
  return { ...PLAYLIST_CATEGORY_MAP }
}

module.exports = {
  getQQConf,
  getQualityMap,
  getCacheConfig,
  getPlatformValidationRules,
  getRouteCacheConfigs,
  getPlaylistCategoryMap
}
