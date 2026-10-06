const { responseCookies } = require('../../../platforms/qqmusic/util/login-http')

describe('shared QQ QR login', () => {
  let qr, http, androidLoginCgi, bindAndroidLoginContext, errorLog
  beforeEach(() => {
    jest.resetModules()
    androidLoginCgi = jest.fn()
    bindAndroidLoginContext = jest.fn()
    jest.doMock('../../../platforms/qqmusic/util/android-login', () => ({
      createAndroidLoginContextFromIdentity: () => ({ androidLoginCgi }), bindAndroidLoginContext
    }))
    qr = require('../../../platforms/qqmusic/util/qq-login')
    http = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unmocked request'))
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
    jest.dontMock('../../../platforms/qqmusic/util/android-login')
  })
  function start() {
    http.mockResolvedValueOnce(new Response('', { headers: { 'set-cookie': 'pt_login_sig=login-session; Path=/' } }))
      .mockResolvedValueOnce(new Response('image', { headers: { 'set-cookie': 'qrsig=qr-session; Path=/' } }))
    return qr.startLogin()
  }
  function callback(code = '0', headers = {}) {
    return new Response(`ptuiCB('${code}','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=123&service=ptqrlogin&ptsigx=sig&s_url=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump&pt_3rd_aid=100497308','0','message','QQ');`, { headers })
  }

  test.each(['query', 'fragment'])('exchanges %s code using graph cookies and normalized music credentials', async (kind) => {
    const started = await start()
    http.mockResolvedValueOnce(callback('0', {
      'set-cookie': 'uin=o00123; Path=/; Domain=.qq.com, skey=pt-session; Path=/; Domain=.qq.com',
    }))
      .mockResolvedValueOnce(new Response('', { status: 302, headers: {
        'set-cookie': 'pt_oauth_token=oauth; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, p_skey=graph-secret; Path=/',
      } }))
      .mockResolvedValueOnce(new Response('', { status: 302, headers: {
        location: `https://y.qq.com/callback${kind === 'query' ? '?' : '#'}code=abc%2F123&state=state`,
      } }))
    androidLoginCgi.mockResolvedValueOnce({ code: 0, data: { str_musicid: '999', musickey: 'music-key' } })
    expect(await qr.pollLogin(started.token)).toMatchObject({ status: 'done', cookie: { uin: '999', qm_keyst: 'music-key' } })
    const [checkUrl, checkOptions] = http.mock.calls[3]
    expect(checkUrl.origin).toBe('https://ssl.ptlogin2.graph.qq.com')
    expect(checkUrl.searchParams.get('pt_3rd_aid')).toBe('100497308')
    expect(checkOptions.redirect).toBe('manual')
    expect(checkOptions.headers.Cookie).toContain('uin=o00123')
    expect(checkOptions.headers.Cookie).toContain('skey=pt-session')
    expect(checkOptions.headers.Cookie).toContain('pt_login_sig=login-session')
    const oauth = http.mock.calls[4][1]
    expect(oauth.headers.Cookie).toContain('p_skey=graph-secret')
    expect(oauth.headers.Cookie).toContain('pt_oauth_token=oauth')
    const form = new URLSearchParams(oauth.body)
    expect(form.get('g_tk')).toBe(String(qr.hash33('graph-secret', 5381)))
    expect(form.get('redirect_uri')).toBe('https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/')
    expect(androidLoginCgi).toHaveBeenCalledWith('QQConnectLogin.LoginServer', 'QQLogin', { code: 'abc/123' }, {}, { tmeLoginType: 2 })
    expect(bindAndroidLoginContext).toHaveBeenCalledWith('999', expect.objectContaining({ androidLoginCgi }))
    expect(await qr.pollLogin(started.token)).toEqual({ status: 'expired' })
  })
  test.each([['66', 'waiting'], ['67', 'confirming'], ['65', 'expired'], ['68', 'expired']])('maps status %s', async (code, status) => {
    const { token } = await start()
    http.mockResolvedValueOnce(callback(code))
    expect(await qr.pollLogin(token)).toEqual({ status })
  })
  test('does not expire after a short idle period and coalesces concurrent polls', async () => {
    const now = Date.now()
    const { token } = await start()
    jest.spyOn(Date, 'now').mockReturnValue(now + 20000)
    let resolve
    http.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const first = qr.pollLogin(token)
    expect(await qr.pollLogin(token)).toEqual({ status: 'confirming' })
    await new Promise(setImmediate)
    resolve(callback('66'))
    expect(await first).toEqual({ status: 'waiting' })
  })
  test('expires old tokens without network requests', async () => {
    const { token } = await start()
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 131000)
    expect(await qr.pollLogin(token)).toEqual({ status: 'expired' })
    expect(http).toHaveBeenCalledTimes(2)
  })
  test('missing p_skey is a terminal stage-specific error', async () => {
    const { token } = await start()
    http.mockResolvedValueOnce(callback()).mockResolvedValueOnce(new Response('', { status: 302 }))
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'error', msg: expect.stringContaining('p_skey') })
    expect(await qr.pollLogin(token)).toEqual({ status: 'expired' })
  })
  test('logs the Android login stage when credential exchange fails', async () => {
    const { token } = await start()
    http.mockResolvedValueOnce(callback())
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { 'set-cookie': 'p_skey=graph-secret; Path=/' } }))
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://y.qq.com/callback?code=abc' } }))
    androidLoginCgi.mockRejectedValueOnce(new TypeError('Workers cipher input must be a Buffer'))

    expect(await qr.pollLogin(token)).toMatchObject({ status: 'error', msg: 'Workers cipher input must be a Buffer' })
    expect(errorLog).toHaveBeenCalledWith('[qq-login] QR login failed', expect.objectContaining({
      stage: 'android_login', name: 'TypeError', frames: expect.stringContaining('QQMusicQrLogin.test.js')
    }))
  })
  test('network failure does not expose credential-bearing URL', async () => {
    const { token } = await start()
    http.mockRejectedValueOnce(new Error('https://example.com/?secret=private-value'))
    const result = await qr.pollLogin(token)
    expect(result.status).toBe('error')
    expect(result.msg).not.toContain('private-value')
    expect(errorLog).toHaveBeenCalledWith('[qq-login] QR login failed', expect.objectContaining({
      stage: 'ptqrlogin', name: 'Error'
    }))
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-value')
  })
  test('parses combined and separate Set-Cookie without breaking Expires', () => {
    const combined = 'one=1; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, p_skey=a=b; Path=/'
    expect(responseCookies({ get: () => combined })).toEqual({ one: '1', p_skey: 'a=b' })
    expect(responseCookies({ getSetCookie: () => ['one=1; Path=/', 'p_skey=a=b; Path=/'] })).toEqual({ one: '1', p_skey: 'a=b' })
  })
})
