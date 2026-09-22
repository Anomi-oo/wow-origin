describe('shared QQ phone login', () => {
  let phone, http
  const envelope = (code, data = {}) => Response.json({ code: 0, req_0: { code, data } })
  beforeEach(() => {
    jest.resetModules()
    phone = require('../../../platforms/qqmusic/util/phone-login')
    http = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unmocked request'))
  })
  afterEach(() => jest.restoreAllMocks())
  async function send(code = 0, data) {
    http.mockResolvedValueOnce(envelope(0, { session: { uid: 'device-uid', sid: 'device-sid' } }))
      .mockResolvedValueOnce(envelope(code, data))
    return phone.sendPhoneCode('13800000000')
  }
  test('keeps one device session across SMS, retry and login', async () => {
    const sent = await send()
    expect(sent).toMatchObject({ status: 'sent', retryAfter: 60 })
    http.mockResolvedValueOnce(envelope(20271))
    await expect(phone.phoneLogin(sent.token, '123456')).rejects.toThrow('验证码错误')
    http.mockResolvedValueOnce(envelope(0, { musicid: 123, musickey: 'phone-key' }))
    expect(await phone.phoneLogin(sent.token, '654321')).toMatchObject({ uin: '123', qm_keyst: 'phone-key', loginType: '0' })
    const sendBody = JSON.parse(http.mock.calls[1][1].body)
    const checkBody = JSON.parse(http.mock.calls[3][1].body)
    expect(sendBody.req_0.param).toEqual({ tmeAppid: 'qqmusic', areaCode: '86', phoneNo: '13800000000' })
    expect(checkBody.comm).toMatchObject({ ...sendBody.comm, tmeLoginType: '0' })
    expect(checkBody.req_0.param).toEqual({ phoneNo: '13800000000', code: '654321', loginMode: 1 })
    await expect(phone.phoneLogin(sent.token, '654321')).rejects.toThrow('会话已失效')
  })
  test('prevents duplicate sends during cooldown and retains token', async () => {
    const sent = await send()
    expect(await phone.sendPhoneCode('13800000000', '86', sent.token)).toMatchObject({ status: 'frequency', token: sent.token })
    expect(http).toHaveBeenCalledTimes(2)
  })
  test('CAPTCHA requires verification and resend with the same session', async () => {
    const sent = await send(20276, { securityURL: 'https://example.com/verify' })
    expect(sent).toMatchObject({ status: 'captcha', retryAfter: 0 })
    await expect(phone.phoneLogin(sent.token, '123456')).rejects.toThrow('会话已失效')
    http.mockResolvedValueOnce(envelope(0))
    const resent = await phone.sendPhoneCode('13800000000', '86', sent.token)
    expect(resent).toMatchObject({ token: sent.token, status: 'sent' })
    expect(JSON.parse(http.mock.calls[2][1].body).comm.sid).toBe('device-sid')
    expect(JSON.parse(http.mock.calls[2][1].body).comm).toEqual(JSON.parse(http.mock.calls[1][1].body).comm)
  })

  test('an expired resend token must not silently create a different device session', async () => {
    await expect(phone.sendPhoneCode('13800000000', '86', 'expired-token')).rejects.toThrow('会话已失效')
    expect(http).not.toHaveBeenCalled()
  })
  test('rejects changed phone and expired session without login request', async () => {
    const sent = await send()
    await expect(phone.sendPhoneCode('13900000000', '86', sent.token)).rejects.toThrow('手机号已改变')
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
    await expect(phone.phoneLogin(sent.token, '123456')).rejects.toThrow('会话已失效')
    expect(http).toHaveBeenCalledTimes(2)
  })
  test.each(['', '+1234', 'abc', '123'])('rejects malformed phone %s', async number => {
    await expect(phone.sendPhoneCode(number)).rejects.toThrow('有效的手机号')
    expect(http).not.toHaveBeenCalled()
  })
})
