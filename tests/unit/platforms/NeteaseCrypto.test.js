const crypto = require('node:crypto')
const { eapiResDecryptBuffer } = require('../../../platforms/netease/util/crypto')

describe('NetEase EAPI crypto', () => {
  test('AES-ECB 解密使用 Workerd 兼容的零长度 IV', () => {
    const key = Buffer.from('e82ckenh8dichen8', 'utf8')
    const cipher = crypto.createCipheriv('aes-128-ecb', key, Buffer.alloc(0))
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify({ code: 200, unikey: 'qr-token' }), 'utf8')),
      cipher.final()
    ])
    const createDecipheriv = crypto.createDecipheriv.bind(crypto)
    jest.spyOn(crypto, 'createDecipheriv').mockImplementation((algorithm, cipherKey, iv, options) => {
      if (algorithm === 'aes-128-ecb' && (!Buffer.isBuffer(iv) || iv.length !== 0)) {
        throw new TypeError('Workerd requires an empty Buffer IV for AES-ECB')
      }
      return createDecipheriv(algorithm, cipherKey, iv, options)
    })

    expect(eapiResDecryptBuffer(encrypted)).toEqual({ code: 200, unikey: 'qr-token' })
  })
})
