describe('NetEase phone login', () => {
  let login, http, encrypt
  beforeEach(() => {
    jest.resetModules()
    encrypt = jest.spyOn(require('../../../platforms/netease/util/crypto'), 'weapi')
    login = require('../../../platforms/netease/util/phone-login')
    http = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unmocked request'))
  })
  afterEach(() => jest.restoreAllMocks())
  async function send() {
    http.mockResolvedValueOnce(Response.json({ code: 200, data: true }, { headers: { 'set-cookie': '__csrf=csrf-value; Path=/' } }))
    return login.sendPhoneCode('13800000000', '86')
  }

  test('sends encrypted SMS request and logs in using the bound phone/country', async () => {
    const sent = await send()
    expect(sent).toMatchObject({ status: 'sent', retryAfter: 60 })
    expect(encrypt).toHaveBeenNthCalledWith(1, expect.objectContaining({ cellphone: '13800000000', ctcode: '86', secrete: 'music_middleuser_pclogin' }))
    expect(http.mock.calls[0][0]).toBe('https://music.163.com/weapi/sms/captcha/sent')
    expect(http.mock.calls[0][1].body).not.toContain('13800000000')
    http.mockResolvedValueOnce(Response.json({ code: 200, profile: { nickname: '网易用户' } }, { headers: {
      'set-cookie': 'other=value; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, MUSIC_U=login-key; Path=/',
    } }))
    expect(await login.phoneLogin(sent.token, '123456')).toMatchObject({ cookie: { MUSIC_U: 'login-key', __csrf: 'csrf-value' }, body: { nickname: '网易用户' } })
    expect(http.mock.calls[1][0]).toBe('https://music.163.com/weapi/w/login/cellphone')
    expect(http.mock.calls[1][1].headers.Cookie).toContain('__csrf=csrf-value')
    expect(encrypt).toHaveBeenNthCalledWith(2, expect.objectContaining({ phone: '13800000000', countrycode: '86', captcha: '123456', type: '1', https: 'true', remember: 'true', secureCaptcha: '', csrf_token: 'csrf-value' }))
    expect(encrypt.mock.calls[1][0]).not.toHaveProperty('password')
    await expect(login.phoneLogin(sent.token, '123456')).rejects.toThrow('会话已失效')
  })

  test('wrong captcha is retryable, missing MUSIC_U is never accepted', async () => {
    const sent = await send()
    http.mockResolvedValueOnce(Response.json({ code: 503, message: '验证码错误' }))
    await expect(login.phoneLogin(sent.token, '123456')).rejects.toThrow('验证码')
    http.mockResolvedValueOnce(Response.json({ code: 200 }))
    await expect(login.phoneLogin(sent.token, '654321')).rejects.toThrow('登录凭证')
    http.mockResolvedValueOnce(Response.json({ code: 200 }, { headers: { 'set-cookie': 'MUSIC_U=valid; Path=/' } }))
    await expect(login.phoneLogin(sent.token, '654321')).resolves.toMatchObject({ cookie: { MUSIC_U: 'valid' } })
  })

  test('cooldown, changed phone and session expiry prevent upstream calls', async () => {
    const sent = await send()
    expect(await login.sendPhoneCode('13800000000', '86', sent.token)).toMatchObject({ status: 'frequency', token: sent.token })
    await expect(login.sendPhoneCode('13900000000', '86', sent.token)).rejects.toThrow('手机号已改变')
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
    await expect(login.phoneLogin(sent.token, '123456')).rejects.toThrow('会话已失效')
    expect(http).toHaveBeenCalledTimes(1)
  })

  test('successful resend retains the session, country code and cookies', async () => {
    http.mockResolvedValueOnce(Response.json({ code: 200, data: true }, { headers: { 'set-cookie': '__csrf=csrf-value' } }))
    const sent = await login.sendPhoneCode('2025550123', '1')
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000)
    http.mockResolvedValueOnce(Response.json({ code: 200, data: true }))
    expect(await login.sendPhoneCode('2025550123', '1', sent.token)).toMatchObject({ token: sent.token })
    expect(encrypt.mock.calls[1][0]).toMatchObject({ ctcode: '1', cellphone: '2025550123', csrf_token: 'csrf-value' })
  })

  test('simultaneous sends cannot send two SMS messages', async () => {
    let finish
    http.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = login.sendPhoneCode('13800000000')
    expect(await login.sendPhoneCode('13800000000')).toMatchObject({ status: 'frequency' })
    finish(Response.json({ code: 200, data: true }))
    await expect(first).resolves.toMatchObject({ status: 'sent' })
    expect(http).toHaveBeenCalledTimes(1)
  })

  test('network errors do not leak phone or captcha into errors', async () => {
    http.mockRejectedValueOnce(new Error('private request body phone=13800000000 captcha=123456'))
    await expect(login.sendPhoneCode('13800000000')).rejects.toThrow('请求失败，请稍后重试')
  })
})
