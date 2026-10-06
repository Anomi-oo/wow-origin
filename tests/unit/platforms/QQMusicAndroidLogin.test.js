describe('QQ Android login identity', () => {
  let http
  const envelope = (data) => Response.json({ code: 0, req_0: { code: 0, data } })

  beforeEach(() => {
    jest.resetModules()
    http = jest.spyOn(global, 'fetch')
  })
  afterEach(() => jest.restoreAllMocks())

  test('uses QIMEI and one Android session across credential requests', async () => {
    http.mockResolvedValueOnce(Response.json({ data: JSON.stringify({ data: { q16: 'q16', q36: 'q36' } }) }))
      .mockResolvedValueOnce(envelope({ session: { uid: 'device-uid', sid: 'device-sid' } }))
      .mockResolvedValueOnce(envelope({ musicid: 123, musickey: 'new-key' }))
      .mockResolvedValueOnce(envelope({ musicid: 123, musickey: 'later-key' }))
    const { createAndroidLoginContext } = require('../../../platforms/qqmusic/util/android-login')
    const { androidLoginCgi } = createAndroidLoginContext()

    const first = await androidLoginCgi('music.login.LoginServer', 'Login', { loginMode: 2 }, {
      musicid: '123', musickey: 'old-key', loginType: 2
    })
    await androidLoginCgi('music.login.LoginServer', 'Login', { loginMode: 2 }, {
      musicid: '123', musickey: 'new-key', loginType: 2
    })

    expect(first.data.musickey).toBe('new-key')
    expect(http).toHaveBeenCalledTimes(4)
    expect(http.mock.calls[0][0]).toBe('https://api.tencentmusic.com/tme/trpc/proxy')
    const qimeiBody = JSON.parse(http.mock.calls[0][1].body)
    expect(qimeiBody.qimeiParams).toMatchObject({
      extra: '{"appKey":"0AND0HD6FE4HY80F"}',
      key: expect.any(String), params: expect.any(String), sign: expect.any(String)
    })
    const sessionBody = JSON.parse(http.mock.calls[1][1].body)
    expect(sessionBody.comm).toMatchObject({ ct: '11', cv: '14090008', QIMEI36: 'q36' })
    expect(sessionBody.comm).not.toHaveProperty('uid')
    expect(sessionBody.req_0).toEqual({
      module: 'music.getSession.session', method: 'GetSession',
      param: { uid: '', vkey: 0, caller: 2 }
    })
    const loginBody = JSON.parse(http.mock.calls[2][1].body)
    expect(loginBody.comm).toMatchObject({
      ct: '11', cv: '14090008', qq: '123', authst: 'old-key',
      tmeAppID: 'qqmusic', tmeLoginType: '2', QIMEI36: 'q36',
      uid: 'device-uid', sid: 'device-sid'
    })
    expect(http.mock.calls[2][1].headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'QQMusic 14090008(android 15)'
    })
    expect(JSON.parse(http.mock.calls[3][1].body).comm.authst).toBe('new-key')
  })

  test('passes Buffer input to QIMEI AES encryption for Workers crypto', () => {
    const crypto = require('node:crypto')
    const createCipheriv = crypto.createCipheriv
    jest.spyOn(crypto, 'createCipheriv').mockImplementation((...args) => {
      const cipher = createCipheriv(...args)
      const update = cipher.update.bind(cipher)
      cipher.update = (data, ...rest) => {
        if (!Buffer.isBuffer(data)) throw new TypeError('Workers Cipheriv.update requires a Buffer')
        return update(data, ...rest)
      }
      return cipher
    })
    const { createDevice, qimeiPayload } = require('../../../platforms/qqmusic/util/android-login')
    expect(qimeiPayload(createDevice()).reserved).toContain('"oz"')
    expect(crypto.createCipheriv).toHaveBeenCalledTimes(2)
  })

  test('does not send a login request when QIMEI cannot be acquired', async () => {
    http.mockResolvedValueOnce(Response.json({ data: '{}' }))
    const { createAndroidLoginContext } = require('../../../platforms/qqmusic/util/android-login')
    const { androidLoginCgi } = createAndroidLoginContext()
    await expect(androidLoginCgi('music.login.LoginServer', 'Login', {})).rejects.toThrow('QIMEI')
    expect(http).toHaveBeenCalledTimes(1)
  })

  test('keeps separate device contexts for separate accounts', () => {
    const { createAndroidLoginContext, getAndroidLoginContext, bindAndroidLoginContext } = require('../../../platforms/qqmusic/util/android-login')
    const first = createAndroidLoginContext()
    bindAndroidLoginContext('123', first)
    expect(getAndroidLoginContext('123')).toBe(first)
    expect(getAndroidLoginContext('456')).not.toBe(first)
    expect(getAndroidLoginContext('456')).toBe(getAndroidLoginContext('456'))
  })

  test('restores one account device from persisted state', () => {
    const { createAndroidLoginContext, createAndroidLoginContextFromIdentity, getAndroidLoginContext, encodeIdentity } = require('../../../platforms/qqmusic/util/android-login')
    const first = createAndroidLoginContext()
    const identity = encodeIdentity(first)
    const repeatedLogin = createAndroidLoginContextFromIdentity(identity)
    const restored = getAndroidLoginContext('restarted-account', identity)
    expect(repeatedLogin.snapshot().device.androidId).toBe(first.snapshot().device.androidId)
    expect(restored.snapshot().device).toEqual(first.snapshot().device)
    expect(() => createAndroidLoginContextFromIdentity('invalid-state')).toThrow('无法复用 deviceId')
  })

  test('does not create a new device while refreshing a legacy account', () => {
    const { getAndroidLoginContext } = require('../../../platforms/qqmusic/util/android-login')
    expect(() => getAndroidLoginContext('legacy-without-device', undefined, { requireExisting: true }))
      .toThrow('缺少 deviceId')
  })
})

describe('QQ credential refresh request', () => {
  let androidLoginCgi, getAndroidLoginContext
  beforeEach(() => {
    jest.resetModules()
    androidLoginCgi = jest.fn()
    getAndroidLoginContext = jest.fn(() => ({ androidLoginCgi }))
    jest.doMock('../../../platforms/qqmusic/util/android-login', () => ({ getAndroidLoginContext, encodeIdentity: () => 'device-state' }))
  })
  afterEach(() => jest.dontMock('../../../platforms/qqmusic/util/android-login'))

  test('passes the Python loginType=2 fields under the Android identity', async () => {
    androidLoginCgi.mockResolvedValueOnce({
      code: 0, data: { musicid: 123, musickey: 'new-key', musickeyCreateTime: 456 }
    })
    const refresh = require('../../../platforms/qqmusic/module/login_refresh')
    const result = await refresh({
      musicid: '123', musickey: 'old-key', openid: 'openid', access_token: 'access',
      refresh_token: 'refresh', refresh_key: 'refresh-key', expired_at: '789', loginType: '2'
    })
    expect(androidLoginCgi).toHaveBeenCalledWith(
      'music.login.LoginServer', 'Login',
      {
        openid: 'openid', refresh_token: 'refresh', refresh_key: 'refresh-key',
        musickey: 'old-key', loginMode: 2, access_token: 'access',
        expired_in: 789, musicid: 123
      },
      { musicid: '123', musickey: 'old-key', loginType: 2 },
      { tmeLoginType: 2 }
    )
    expect(getAndroidLoginContext).toHaveBeenCalledWith('123', undefined, { requireExisting: true })
    expect(result).toMatchObject({
      refreshed: true, cookie: { qm_keyst: 'new-key', musickey: 'new-key', musickeyCreateTime: '456' }
    })
  })
})

describe('QQ Android song favorite', () => {
  afterEach(() => jest.dontMock('../../../platforms/qqmusic/util/android-login'))

  test('uses Python songlist parameters and checks retCode', async () => {
    jest.resetModules()
    const androidLoginCgi = jest.fn()
      .mockResolvedValueOnce({ code: 0, data: { retCode: 0, result: { tid: 0 } } })
      .mockResolvedValueOnce({ code: 80105, data: { retCode: 0, result: { tid: 0 } } })
    jest.doMock('../../../platforms/qqmusic/util/android-login', () => ({
      getAndroidLoginContext: () => ({ androidLoginCgi })
    }))
    const like = require('../../../platforms/qqmusic/module/like')
    expect((await like({ uin: '123', qm_keyst: 'key', id: '449205', like: true })).success).toBe(true)
    expect((await like({ uin: '123', qm_keyst: 'key', id: '449205', like: 'false' })).success).toBe(false)
    expect(androidLoginCgi).toHaveBeenNthCalledWith(1,
      'music.musicasset.PlaylistDetailWrite', 'AddSonglist',
      { dirId: 201, tid: 0, bFmtUtf8: true, v_songInfo: [{ songId: 449205, songType: 0 }] },
      { musicid: '123', musickey: 'key', loginType: 2 }
    )
    expect(androidLoginCgi.mock.calls[1][1]).toBe('DelSonglist')
  })
})
