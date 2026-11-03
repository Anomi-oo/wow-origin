jest.mock('../../../platforms/qqmusic/util/android-login', () => ({ getAndroidLoginContext: jest.fn() }))
const { getAndroidLoginContext } = require('../../../platforms/qqmusic/util/android-login')
const logout = require('../../../platforms/qqmusic/module/login_logout')

let androidLoginCgi
beforeEach(() => {
  androidLoginCgi = jest.fn()
  getAndroidLoginContext.mockReturnValue({ androidLoginCgi })
})

test('logout sends normalized credentials using the stored Android context', async () => {
  androidLoginCgi.mockResolvedValue({ code: 0 })
  expect(await logout({ uin: 'o123', qm_keyst: 'key', loginType: '6', qq_android_identity: 'device' })).toEqual({ body: { code: 200 } })
  expect(getAndroidLoginContext).toHaveBeenCalledWith('123', 'device')
  expect(androidLoginCgi).toHaveBeenCalledWith('music.login.LoginServer', 'Logout', {}, { musicid: '123', musickey: 'key', loginType: 6 })
})

test('logout reports upstream errors and rejects incomplete credentials', async () => {
  androidLoginCgi.mockResolvedValue({ code: 1000 })
  await expect(logout({ musicid: '123', musickey: 'key' })).rejects.toThrow('登录凭证已过期')
  expect(androidLoginCgi).toHaveBeenCalledTimes(1)
  await expect(logout({ uin: '123' })).rejects.toThrow('QQ 登录凭证不完整')
  expect(androidLoginCgi).toHaveBeenCalledTimes(1)
})
