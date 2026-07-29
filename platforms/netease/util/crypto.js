/**
 * 加解密工具（网易云音乐协议）
 *
 * 说明：
 * - weapi：Web 端接口的双层 AES-CBC + RSA 加密方案
 * - eapi：客户端接口的 AES-ECB（HEX 输出），带特定 message 串拼接/MD5 摘要
 * - eapiResDecrypt / eapiReqDecrypt：eapi 返回值/请求体解析辅助
 */
const crypto = require('crypto')

const iv = '0102030405060708'

// weapi 第一层 AES-CBC 使用的固定密钥
const presetKey = '0CoJUm6Qyw8W8jud'

//生成 weapi 第二层随机密钥所用的 62 进制字符表
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

//weapi 所用 RSA 公钥（PEM）
const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

//eapi AES-ECB 使用的固定密钥

const eapiKey = 'e82ckenh8dichen8'

/**
 * 通用 AES 加密
 * @param {string} text 明文字符串（UTF-8）
 * @param {('cbc'|'ecb')} mode 加密模式（不区分大小写）
 * @param {string} key 密钥字符串（UTF-8）
 * @param {string} iv 向量（CBC 模式使用，长度 16；ECB 可传空串）
 * @param {('base64'|'hex')} [format='base64'] 输出格式：base64 或 hex（大写）
 * @returns {string} 加密结果字符串（base64 或 hex）
 */
const aesEncrypt = (text, mode, key, iv, format = 'base64') => {
  const textBuffer = Buffer.from(text, 'utf8')
  const keyBuffer = Buffer.from(key, 'utf8')
  const ivBuffer = Buffer.from(iv, 'utf8')
  const algorithm = mode === 'cbc' ? 'aes-128-cbc' : `aes-128-${mode}`
  const cipher = crypto.createCipheriv(algorithm, keyBuffer, ivBuffer)
  let encrypted = cipher.update(textBuffer)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  if (format === 'base64') {
    return encrypted.toString('base64')
  }
  return encrypted.toString('hex').toUpperCase()
}

/**
 * 通用 AES 解密
 * @param {string} ciphertext 密文（当 format='base64' 时为 base64；当 format='hex' 时为 HEX）
 * @param {string} key 密钥字符串（UTF-8）
 * @param {string} iv 向量（CBC 模式使用；ECB 可传空串）
 * @param {('base64'|'hex')} [format='base64'] 密文格式
 * @returns {string} 解密得到的明文（UTF-8）
 */
const aesDecrypt = (ciphertext, key, iv, format = 'base64') => {
  const input = format === 'base64' ? Buffer.from(ciphertext, 'base64') : Buffer.from(ciphertext, 'hex')
  const algo = 'aes-128-ecb'
  const keyBuf = Buffer.from(key, 'utf8')
  const decipher = crypto.createDecipheriv(algo, keyBuf, null)
  const out = Buffer.concat([decipher.update(input), decipher.final()])
  return out.toString('utf8')
}
/**
 * RSA 加密（用于 weapi encSecKey）
 * @param {string} str 明文字符串
 * @param {string} key PEM 格式公钥
 * @returns {string} HEX 格式密文
 */
const rsaEncrypt = (str, key) => {
  const buffer = Buffer.from(str, 'utf8')
  const keySize = 128
  const paddedBuffer = Buffer.alloc(keySize)
  buffer.copy(paddedBuffer, keySize - buffer.length)
  const encrypted = crypto.publicEncrypt({
    key: key,
    padding: crypto.constants.RSA_NO_PADDING
  }, paddedBuffer)
  return encrypted.toString('hex')
}

/**
 * 生成 weapi 加密参数
 * - 第 1 层：固定密钥 presetKey + AES-CBC
 * - 第 2 层：随机 16 位 base62 密钥 + AES-CBC
 * - encSecKey：随机密钥倒序后 RSA 加密，HEX 输出
 * @param {object} object 业务数据对象（会 JSON.stringify）
 * @returns {{params:string, encSecKey:string}} params 为 base64 字符串；encSecKey 为 HEX 字符串
 */
const weapi = (object) => {
  const text = JSON.stringify(object)
  let secretKey = ''
  for (let i = 0; i < 16; i++) {
    secretKey += base62.charAt(Math.floor(Math.random() * 62))
  }
  const firstEncrypted = aesEncrypt(text, 'cbc', presetKey, iv)
  const secondEncrypted = aesEncrypt(firstEncrypted, 'cbc', secretKey, iv)
  const reversedKey = secretKey.split('').reverse().join('')
  const encryptedSecretKey = rsaEncrypt(reversedKey, publicKey) 
  return {
    params: secondEncrypted,
    encSecKey: encryptedSecretKey
  }
}

/**
 * 生成 eapi 加密参数
 * - 将 url 和数据 text 拼接为特定 message，取 MD5 摘要，形成 data
 * - 用固定密钥 eapiKey + AES-ECB 加密
 * - 输出 HEX（大写）
 * @param {string} url（如 "/api/v6/playlist/detail" ）
 * @param {object|string} object 数据对象或已序列化字符串
 * @returns {{params:string}} params 为 HEX 字符串
 */
const eapi = (url, object) => {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = crypto.createHash('md5').update(message).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncrypt(data, 'ecb', eapiKey, '', 'hex'),
  }
}

/**
 * eapi 接口返回值解密（HEX 输入）
 * @param {string} encryptedParams HEX 格式密文（可以大写/小写）
 * @returns {any} 解析后的 JSON 对象
 */
const eapiResDecrypt = (encryptedParams) => {
  const hex = typeof encryptedParams === 'string' ? encryptedParams : String(encryptedParams)
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(eapiKey, 'utf8'), null)
  const out = Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()])
  return JSON.parse(out.toString('utf8'))
}

/**
 * eapi 接口返回值解密（Buffer 直解）
 * @param {Buffer|Uint8Array} buf 原始二进制加密数据
 * @returns {any} 解析后的 JSON 对象
 */
const eapiResDecryptBuffer = (buf) => {
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(eapiKey, 'utf8'), null)
  const out = Buffer.concat([decipher.update(input), decipher.final()])
  return JSON.parse(out.toString('utf8'))
}

/**
 * eapi 请求参数解密（调试用）
 * - 解析出其中的 url 和 data
 * @param {string} encryptedParams HEX 格式密文
 * @returns {{url:string, data:any}|null} 成功返回 url 与数据对象，失败返回 null
 */
const eapiReqDecrypt = (encryptedParams) => {
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(eapiKey, 'utf8'), null)
  const out = Buffer.concat([decipher.update(Buffer.from(encryptedParams, 'hex')), decipher.final()])
  const decryptedData = out.toString('utf8')
  const match = decryptedData.match(/(.*?)-36cd479b6b5-(.*?)-36cd479b6b5-(.*)/)
  if (match) {
    const url = match[1]
    const data = JSON.parse(match[2])
    return { url, data }
  }
  return null
}

module.exports = {
  weapi,
  eapi,
  aesEncrypt,
  aesDecrypt,
  eapiReqDecrypt,
  eapiResDecrypt,
  eapiResDecryptBuffer,
}
