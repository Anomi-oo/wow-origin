const encrypt = require('./crypto')
const { default: axios } = require('axios')
const http = require('http')
const https = require('https')
const { URLSearchParams } = require('url')
const { getAppConf } = require('../config')
const genCheckToken = require('./checkToken')
const Logger = require('../../../core/Logger')
const { createUpstreamError } = require('../../../core/UpstreamDiagnostics')

const logger = new Logger({ component: 'netease-request' })

const APP_CONF = getAppConf()

const toResponseBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  const valueType = Object.prototype.toString.call(value)
  if (valueType === '[object ArrayBuffer]' || valueType === '[object SharedArrayBuffer]') {
    return Buffer.from(new Uint8Array(value))
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

const DEFAULT_HEADER = {
  "os": "pc",
  "appver": "3.1.19.204510",
  "requestId": 0,
  "osver": "Microsoft-Windows-11-Home-China-build-22631-64bit"
}
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.19.204510'
const ANDROID_UA = 'NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)'
const XEAPI_DOMAIN = 'https://interface3.music.163.com'
let xeapiPublicKeyPromise
let xeapiPublicKeyState
let xeapiPublicKeyExpiresAt = 0
let xeapiSessionId = ''
let xeapiSessionKey = ''

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

const loadXeapiPublicKey = async (deviceId) => {
  if (xeapiPublicKeyPromise && Date.now() < xeapiPublicKeyExpiresAt) return xeapiPublicKeyPromise
  const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('')
  const timestamp = String(Date.now())
  const data = {
    appVersion: '9.5.61', currentKeyVersion: xeapiPublicKeyState?.version || '', deviceId, nonce,
    os: 'android', requestType: 'active',
    signature: encrypt.xeapiSign(timestamp, nonce),
    t1: '', t2: '', timestamp, uid: ''
  }
  xeapiPublicKeyPromise = axios({
    method: 'POST',
    url: `${APP_CONF.apiDomain}/api/bsr/sk/get`,
    headers: {
      'User-Agent': ANDROID_UA,
      Cookie: `deviceId=${encodeURIComponent(deviceId)}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
    },
    data: new URLSearchParams(data).toString(),
    httpAgent, httpsAgent
  }).then(({ data: response }) => {
    if (response?.code !== 200 || !response.data?.encryptedData) {
      throw new Error('XEAPI public key request failed')
    }
    if (!response.data.signature || encrypt.xeapiSign(response.data.timestamp, nonce) !== response.data.signature) {
      throw new Error('XEAPI public key signature mismatch')
    }
    const key = encrypt.xeapiDecryptPublicKey(response.data.encryptedData)
    if (!key.sk && xeapiPublicKeyState?.sk) key.sk = xeapiPublicKeyState.sk
    if (!key.publicKey || !key.sk || !key.version) throw new Error('XEAPI public key incomplete')
    xeapiPublicKeyState = key
    return key
  }).catch(error => {
    xeapiPublicKeyPromise = undefined
    throw error
  })
  xeapiPublicKeyExpiresAt = Date.now() + 60 * 60 * 1000
  xeapiSessionId = ''
  xeapiSessionKey = ''
  return xeapiPublicKeyPromise
}

const createXeapiRequest = async (uri, data, options) => {
  const deviceId = options.deviceId || ''
  const key = await loadXeapiPublicKey(deviceId)
  const cookie = {
    os: 'android', osver: '16', appver: options.appver || '9.1.65',
    buildver: String(Math.floor(Date.now() / 1000)),
    deviceId, sDeviceId: deviceId
  }
  if (options.MUSIC_U) cookie.MUSIC_U = options.MUSIC_U
  const headers = {
    'User-Agent': ANDROID_UA,
    'X-Client-Enc-State': 'ENCRYPTED',
    'x-aeapi': 'true',
    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    'x-deviceid': deviceId,
    'x-sdeviceid': deviceId,
    'x-os': 'android',
    'x-osver': '16',
    'x-appver': cookie.appver,
    'x-buildver': cookie.buildver,
    Cookie: Object.entries(cookie).map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('; ')
  }
  if (options.MUSIC_U) headers['x-music-u'] = options.MUSIC_U
  if (options.ip) {
    headers['X-Real-IP'] = options.ip
    headers['X-Forwarded-For'] = options.ip
  }
  const response = await axios({
    method: 'POST',
    url: `${XEAPI_DOMAIN}/xeapi/${uri.substring(5)}`,
    headers,
    data: new URLSearchParams(encrypt.xeapi(uri, data, {
      publicKeyState: key,
      sessionId: xeapiSessionId,
      sessionKey: xeapiSessionKey,
      os: 'android'
    })).toString(),
    responseType: 'arraybuffer',
    httpAgent, httpsAgent
  })
  const sessionId = response.headers?.['x-encr-ssid'] || response.headers?.get?.('x-encr-ssid')
  const sessionKey = response.headers?.['x-encr-sskey'] || response.headers?.get?.('x-encr-sskey')
  if (sessionId && sessionKey) {
    xeapiSessionId = sessionId
    xeapiSessionKey = sessionKey
  }
  const body = encrypt.xeapiResDecrypt(toResponseBuffer(response.data))
  const result = { status: Number(body.code || response.status), body, cookie: {} }
  if (result.status !== 200) throw result
  return result
}

const createRequest = (uri, data, options) => {
  if (options.crypto === 'xeapi') return createXeapiRequest(uri, data, options)
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
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
    const context = { platform: 'netease', stage: uri, url, method: 'POST', startedAt }
    const attachDiagnostics = (error) => {
      answer.message = error.message
      Object.defineProperty(answer, 'diagnostics', { value: error.diagnostics })
      return answer
    }

    //LOG_LEVEL=debug可查看详细请求内容
    logger.debug('NetEase EAPI request data', { dataReq })
    logger.debug('NetEase EAPI request headers', { headers })

    axios(settings)
      .then((res) => {
        const body = res.data
        // 将 Set-Cookie 数组转换为 JSON 对象
        const setCookieHeader = res.headers['set-cookie']
        const setCookieValues = Array.isArray(setCookieHeader)
          ? setCookieHeader
          : typeof setCookieHeader === 'string' ? [setCookieHeader] : []
        const cookieArray = setCookieValues.map((x) =>
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
            const responseBuffer = toResponseBuffer(body)
            if (responseBuffer && typeof encrypt.eapiResDecryptBuffer === 'function') {
              answer.body = encrypt.eapiResDecryptBuffer(responseBuffer)
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
          if (uri.startsWith('/api/login/')) {
            reject(attachDiagnostics(createUpstreamError('网易云登录返回无效响应', e, {
              ...context, httpStatus: res.status, code: 'UPSTREAM_INVALID_RESPONSE',
            })))
            return
          }
          answer.body = body
          answer.status = res.status
        }
        logger.debug('NetEase EAPI request Response', answer.body )
        if (answer.status === 200) resolve(answer)
        else reject(attachDiagnostics(createUpstreamError(`网易云接口返回错误 (${answer.status})`, null, {
          ...context, httpStatus: res.status, upstreamCode: answer.status, code: `NETEASE_${answer.status}`,
        })))
      })
      .catch((err) => {
        answer.status = 502
        const httpStatus = Number(err?.response?.status) || undefined
        const error = createUpstreamError(`网易云请求失败${httpStatus ? ` (HTTP ${httpStatus})` : '，请稍后重试'}`, err, {
          ...context, httpStatus, ...(httpStatus ? { code: `HTTP_${httpStatus}` } : {}),
        })
        answer.body = { code: 502, msg: error.message }
        reject(attachDiagnostics(error))
      })
  })
}

module.exports = createRequest
