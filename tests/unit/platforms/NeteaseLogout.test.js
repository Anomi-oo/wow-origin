const logout = require('../../../platforms/netease/module/login_logout')

test('NetEase logout calls upstream with the current account credential', async () => {
  const result = { status: 200, body: { code: 200 }, cookie: {} }
  const request = jest.fn().mockResolvedValue(result)
  await expect(logout({ MUSIC_U: 'account-cookie' }, request)).resolves.toBe(result)
  expect(request).toHaveBeenCalledWith('/api/logout', {}, expect.objectContaining({ MUSIC_U: 'account-cookie', useCheckToken: false, signal: expect.any(AbortSignal) }))
})

test('NetEase logout propagates upstream failure and rejects missing credentials', async () => {
  const request = jest.fn().mockRejectedValue({ status: 502, body: { code: 502 } })
  await expect(logout({ MUSIC_U: 'account-cookie' }, request)).rejects.toMatchObject({ status: 502 })
  await expect(logout({}, request)).rejects.toThrow('网易云登录凭证不完整')
  expect(request).toHaveBeenCalledTimes(1)
})
