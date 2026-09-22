const mockHttp = jest.fn()

jest.mock('got', () => ({
  extend: jest.fn(() => mockHttp)
}))

const qrLogin = require('../../../platforms/qqmusic/util/qq_qr_login_2step')

describe('QQ Music QR login OAuth', () => {
  afterEach(() => {
    mockHttp.mockReset()
  })

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

  test('跨 QQ 登录域名携带二维码会话 Cookie 并取得授权 code', async () => {
    let checkSigCookie = ''

    mockHttp.mockImplementation(async (url, options = {}) => {
      const href = String(url)
      if (href.includes('/cgi-bin/xlogin')) {
        return { statusCode: 200, headers: {}, body: '' }
      }
      if (href.includes('/ssl/ptqrshow')) {
        return {
          statusCode: 200,
          headers: { 'set-cookie': ['qrsig=qr-session; Domain=.ptlogin2.qq.com; Path=/'] },
          body: Buffer.from('qr')
        }
      }
      if (href.includes('/ssl/ptqrlogin')) {
        return {
          statusCode: 200,
          headers: { 'set-cookie': ['pt_login_sig=login-session; Domain=.ptlogin2.qq.com; Path=/'] },
          body: "ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=1&ptsigx=sig','0','登录成功','QQ');"
        }
      }
      if (href.includes('/check_sig')) {
        checkSigCookie = String(options.headers?.Cookie || '')
        const hasQrSession = checkSigCookie.includes('qrsig=qr-session')
        return {
          statusCode: 302,
          headers: {
            location: 'https://graph.qq.com/oauth2.0/login_jump',
            ...(hasQrSession
              ? { 'set-cookie': ['p_skey=graph-secret; Path=/'] }
              : {})
          },
          body: ''
        }
      }
      if (href.includes('/oauth2.0/login_jump') || href.includes('/oauth2.0/show')) {
        return { statusCode: 200, headers: {}, body: '' }
      }
      if (href.includes('/oauth2.0/authorize')) {
        const hasGraphSession = String(options.headers?.Cookie || '').includes('p_skey=graph-secret')
        return {
          statusCode: 302,
          headers: {
            location: hasGraphSession
              ? 'https://y.qq.com/callback?code=oauth-code&state=state'
              : 'https://graph.qq.com/oauth2.0/error?error=invalid_session'
          },
          body: ''
        }
      }
      if (href.includes('u.y.qq.com/cgi-bin/musicu.fcg')) {
        return {
          statusCode: 200,
          headers: {},
          body: JSON.stringify({ code: 0, req: { code: 0, data: { musickey: 'music-key' } } })
        }
      }
      if (href.startsWith('https://y.qq.com/')) {
        return { statusCode: 200, headers: {}, body: '' }
      }
      throw new Error(`Unexpected request: ${href}`)
    })

    const started = await qrLogin.startLogin()
    const result = await qrLogin.pollLogin(started.token)

    expect(checkSigCookie).toContain('qrsig=qr-session')
    expect(checkSigCookie).toContain('pt_login_sig=login-session')
    expect(result.status).toBe('done')
  })
})
