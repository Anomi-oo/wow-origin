jest.mock('got', () => ({
  extend: jest.fn(() => jest.fn())
}))

const qrLogin = require('../../../platforms/qqmusic/util/qq_qr_login_2step')

describe('QQ Music QR login OAuth', () => {
  test('使用当前 QQ 音乐允许的回跳地址', () => {
    expect(qrLogin._testing.redirectUri).toBe(
      'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/'
    )
  })

  test.each([
    ['query', 'https://y.qq.com/callback?code=abc%2F123&state=ok'],
    ['fragment', 'https://y.qq.com/callback#code=abc%2F123&state=ok'],
    ['encoded redirect', 'https://graph.qq.com/jump?url=https%3A%2F%2Fy.qq.com%2Fcallback%3Fcode%3Dabc%252F123%26state%3Dok']
  ])('从 %s 回跳中提取授权 code', (_name, location) => {
    expect(qrLogin._testing.extractAuthorizationCode(location)).toBe('abc/123')
  })
})
