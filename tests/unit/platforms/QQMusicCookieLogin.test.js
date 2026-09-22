const login = require('../../../platforms/qqmusic/module/login_cookie')
const refresh = require('../../../platforms/qqmusic/module/login_refresh')

describe('QQ Cookie validation and credential refresh', () => {
  let http
  beforeEach(() => { http = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unmocked request')) })
  afterEach(() => jest.restoreAllMocks())

  test('validates Cookie with the authenticated profile endpoint', async () => {
    http.mockResolvedValueOnce(Response.json({ code: 0, data: { creator: { nick: '音乐用户' } } }))
    expect(await login({ uin: '123', qm_keyst: 'secret' })).toMatchObject({ body: { nickname: '音乐用户' } })
    const [url, options] = http.mock.calls[0]
    expect(url.searchParams.get('hostUin')).toBe('0')
    expect(options.headers.Cookie).toContain('qm_keyst=secret')
  })
  test('rejects expired cookies', async () => {
    http.mockResolvedValueOnce(Response.json({ code: 1000 }))
    await expect(login({ uin: '123', qm_keyst: 'expired' })).rejects.toThrow('Cookie 无效或已过期')
  })
  test('a valid Cookie need not include a profile nickname', async () => {
    http.mockResolvedValueOnce(Response.json({ code: 0 }))
    expect(await login({ uin: '123', qm_keyst: 'secret' })).toEqual({ body: { nickname: '' } })
  })
  test('refreshes a phone credential without QQ OAuth tokens', async () => {
    http.mockResolvedValueOnce(Response.json({ code: 0, req_0: { code: 0, data: { musicid: 123, musickey: 'new' } } }))
    expect(await refresh({ uin: '123', qm_keyst: 'old', loginType: '0', refresh_key: 'refresh' })).toMatchObject({ cookie: { uin: '123', qm_keyst: 'new', loginType: '0' } })
    const body = JSON.parse(http.mock.calls[0][1].body)
    expect(body.comm.tmeLoginType).toBe('0')
    expect(body.req_0.param).toMatchObject({ loginMode: 2, musickey: 'old', refresh_key: 'refresh' })
  })
  test('a manually pasted cookie without refresh fields is validated, not discarded', async () => {
    http.mockResolvedValueOnce(Response.json({ code: 0, data: { creator: { nick: '用户' } } }))
    expect(await refresh({ uin: '123', qm_keyst: 'manual' })).toMatchObject({ refreshed: false })
    expect(http).toHaveBeenCalledTimes(1)
  })
})
