const encrypt = require('./crypto')
const { default: axios } = require('axios')
const http = require('http')
const https = require('https')
const { URLSearchParams } = require('url')
const { getAppConf } = require('../config')
const genCheckToken = require('./checkToken')
const Logger = require('../../../core/Logger')

const logger = new Logger({ component: 'netease-request' })

const APP_CONF = getAppConf()

const DEFAULT_HEADER = {
  "os": "pc",
  "appver": "3.1.19.204510",
  "requestId": 0,
  "osver": "Microsoft-Windows-11-Home-China-build-22631-64bit"
}
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.19.204510'

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

logger.compact('info', 'Netease HTTP connection pool initialized (maxSockets: 50, keepAlive: true)', 'debug')

const createRequest = (uri, data, options) => {
  return new Promise((resolve, reject) => {
    const dataReq = { ...data }
    const headers = {
      'User-Agent': DEFAULT_UA
    }

    if (options.ip) {
      headers['X-Real-IP'] = options.ip
      headers['X-Forwarded-For'] = options.ip
    }

    const cookieOptions = options.MUSIC_U
        ? {MUSIC_U: options.MUSIC_U, deviceId: options.deviceId}
        : {deviceId: options.deviceId}

    const requestHeader = { ...DEFAULT_HEADER, ...cookieOptions }
    const cookieHeader = Object.entries(requestHeader)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('; ')

    headers['Cookie'] = cookieHeader

    const crypto = options.crypto || (APP_CONF.encrypt ? 'eapi' : 'api')

    let url, encryptData
    if (crypto === 'weapi') {
      headers['Referer'] = APP_CONF.domain
      headers['User-Agent'] = WEB_UA
      data.csrf_token = ''
      encryptData = encrypt.weapi(data)
      url = APP_CONF.domain + '/weapi/' + uri.substr(5)
    } 
    else if (crypto === 'eapi') {
      dataReq.header = { ...requestHeader }
      dataReq.e_r = true
      if (options.useCheckToken) {
        const checkToken = genCheckToken('eapi')
        headers['x-anticheattoken'] = checkToken
        dataReq.header['X-anticheattoken'] = checkToken
      }
      encryptData = encrypt.eapi(uri, dataReq)
      url = APP_CONF.apiDomain + '/eapi/' + uri.substr(5)
    } 
    else {
      url = APP_CONF.apiDomain + uri
      encryptData = dataReq
    }

    const answer = { status: 500, body: {}, cookie: {}  }
    const settings = {
      method: 'POST',
      url: url,
      headers: headers,
      data: new URLSearchParams(encryptData).toString(),
      httpAgent: httpAgent,
      httpsAgent: httpsAgent,
      ...(dataReq.e_r && {
        encoding: null,
        responseType: 'arraybuffer'
      })
    }

    //LOG_LEVEL=debug可查看详细请求内容
    logger.debug('NetEase EAPI request data', { dataReq })
    logger.debug('NetEase EAPI request headers', { headers })

    axios(settings)
      .then((res) => {
        const body = res.data
        // 将 Set-Cookie 数组转换为 JSON 对象
        const cookieArray = (res.headers['set-cookie'] || []).map((x) =>
          x.replace(/\s*Domain=[^(;|$)]+;*/, ''),
        )
        answer.cookie = {}
        cookieArray.forEach(cookieStr => {
          const parts = cookieStr.split(';')[0].split('=')
          const name = parts[0].trim()
          const value = parts.slice(1).join('=').trim()
          if (name) {
            answer.cookie[name] = value
          }
        })
        try {
          if (dataReq.e_r) {
            // eapi接口返回值被加密，需要解密
            if (Buffer.isBuffer(body) && typeof encrypt.eapiResDecryptBuffer === 'function') {
              answer.body = encrypt.eapiResDecryptBuffer(body)
            } else {
              answer.body = encrypt.eapiResDecrypt(
                body.toString('hex').toUpperCase(),
              )
            }
          } else {
            answer.body =
              typeof body == 'object' ? body : JSON.parse(body.toString())
          }

          if (answer.body.code) {
            answer.body.code = Number(answer.body.code)
          }

          answer.status = Number(answer.body.code || res.status)
          if (
            [201, 302, 400, 502, 800, 801, 802, 803].indexOf(answer.body.code) >
            -1
          ) {
            answer.status = 200
          }
        } catch (e) {
          answer.body = body
          answer.status = res.status
        }
        logger.debug('NetEase EAPI request Response', answer.body )
        if (answer.status === 200) resolve(answer)
        else reject(answer)
      })
      .catch((err) => {
        answer.status = 502
        answer.body = { code: 502, msg: err }
        reject(answer)
      })
  })
}

module.exports = createRequest
