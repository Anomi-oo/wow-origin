const { zzcSign, encryptRequest, decryptResponse } = require('./crypto')
const { default: axios } = require('axios')
const http = require('http')
const https = require('https')
const Logger = require('../../../core/Logger')

const logger = new Logger({ component: 'qqmusic-request' })

const DEFAULT_HEADERS = {
  'Content-Type': 'text/plain',
  'Accept': 'application/octet-stream',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Referer': 'https://y.qq.com/'
}

// 创建全局HTTP/HTTPS连接池
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000
})

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000
})

logger.compact('info', 'QQMusic HTTP connection pool initialized (maxSockets: 50, keepAlive: true)', 'debug')

/**
 * 创建QQ音乐API请求
 * @param {string} module - API模块名
 * @param {string} method - API方法名
 * @param {Object} data - 请求数据
 * @param {Object} options - 请求选项
 * @returns {Promise} 请求响应
 */
const createRequest = (module, method, data, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      // 构建请求数据结构
      const requestData = {
        comm: {
          cv: 4747474,
          ct: 24,
          format: 'json',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 1,
          uin: Number(options.uin) || 0,
          g_tk_new_20200303: options.g_tk || 1083888122,
          g_tk: options.g_tk || 1083888122
        },
        req_0: {
          module: module,
          method: method,
          param: data
        }
      }

      // 序列化请求数据
      const jsonData = JSON.stringify(requestData)

      const encryptData = encryptRequest(requestData)

      // 生成签名
      const signature = zzcSign(jsonData)

      // 构建请求URL
      const url = `https://u6.y.qq.com/cgi-bin/musics.fcg?_=${Date.now()}&encoding=ag-1&sign=${signature}`

      // 构建请求头
      const headers = { ...DEFAULT_HEADERS }

      // 添加Cookie（如果有登录信息）
      if (options.uin && options.qm_keyst) {
        headers['Cookie'] = `qm_keyst=${options.qm_keyst}; uin=${options.uin}`
      }

      // 添加自定义IP（如果需要）
      if (options.ip) {
        headers['X-Real-IP'] = options.ip
        headers['X-Forwarded-For'] = options.ip
      }

      // axios请求配置
      const axiosConfig = {
        method: 'POST',
        url: url,
        headers: headers,
        data: encryptData,
        timeout: options.timeout || 30000,
        httpAgent: httpAgent,
        httpsAgent: httpsAgent,
        responseType: 'arraybuffer'
      }

      // 记录请求日志
      logger.debug('QQMusic API request', {
        requestData,
        url: url,
        hasAuth: !!(options.uin && options.qm_keyst)
      })

      // 发送请求
      axios(axiosConfig)
        .then((response) => {
          let result = JSON.parse(decryptResponse(response.data))

          // 检查响应状态
          const answer = {
            status: 200,
            body: result
          }

          // 检查API响应中的错误代码
          if (result.code && result.code !== 0) {
            answer.status = 400
            logger.warn('QQMusic API returned error code', {
              code: result.code,
              message: result.message || 'Unknown error'
            })
          }

          // 提取实际数据（通常在req_0.data中）
          if (result.req_0 && result.req_0.data) {
            answer.body = result.req_0.data
          }

          if (answer.status === 200) {
            resolve(answer)
          } else {
            reject(answer)
          }
        })
        .catch((error) => {
          const answer = {
            status: 502,
            body: {
              code: 502,
              message: error.message || 'Network error'
            }
          }
          reject(answer)
        })

    } catch (error) {
      logger.error('QQMusic request creation failed', {
        error: error.message,
        module,
        method
      })

      const answer = {
        status: 500,
        body: {
          code: 500,
          message: error.message || 'Internal error'
        }
      }
      reject(answer)
    }
  })
}


module.exports = {
  createRequest
}