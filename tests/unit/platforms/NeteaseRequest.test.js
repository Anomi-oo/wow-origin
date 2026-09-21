jest.mock('axios', () => ({
  default: jest.fn()
}))

jest.mock('../../../platforms/netease/util/crypto', () => ({
  eapi: jest.fn(() => ({ params: 'encrypted-request' })),
  eapiResDecrypt: jest.fn(() => {
    throw new Error('ArrayBuffer must not use the hex-string fallback')
  }),
  eapiResDecryptBuffer: jest.fn(() => ({
    code: 200,
    unikey: 'cloudflare-qr-token'
  }))
}))

const { default: axios } = require('axios')
const vm = require('node:vm')
const encrypt = require('../../../platforms/netease/util/crypto')
const createRequest = require('../../../platforms/netease/util/request')

describe('NetEase request transport', () => {
  beforeEach(() => {
    encrypt.eapi.mockReturnValue({ params: 'encrypted-request' })
    encrypt.eapiResDecrypt.mockImplementation(() => {
      throw new Error('ArrayBuffer must not use the hex-string fallback')
    })
    encrypt.eapiResDecryptBuffer.mockReturnValue({
      code: 200,
      unikey: 'cloudflare-qr-token'
    })
  })

  test('Cloudflare ArrayBuffer EAPI 响应会先转换为 Buffer 再解密', async () => {
    const encryptedResponse = vm.runInNewContext('Uint8Array.from([1, 2, 3, 4]).buffer')
    axios.mockResolvedValue({
      status: 200,
      data: encryptedResponse,
      headers: {}
    })

    const result = await createRequest('/api/login/qrcode/unikey', { type: 3 }, {
      crypto: 'eapi',
      useCheckToken: false,
      MUSIC_U: ''
    })

    expect(result.body).toEqual({ code: 200, unikey: 'cloudflare-qr-token' })
    expect(encrypt.eapiResDecryptBuffer).toHaveBeenCalledTimes(1)
    expect(Buffer.isBuffer(encrypt.eapiResDecryptBuffer.mock.calls[0][0])).toBe(true)
    expect([...encrypt.eapiResDecryptBuffer.mock.calls[0][0]]).toEqual([1, 2, 3, 4])
  })
})
