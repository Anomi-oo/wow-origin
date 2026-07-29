// 登录刷新
module.exports = async (query, request) => {
  const result = await request(
    '/api/login/token/refresh',
    {},
    {
      MUSIC_U: query.MUSIC_U || '',
      useCheckToken: false
    }
  )

  return {
    status: result.status,
    body: {
      ...result.body
    },
    cookie: result.cookie
  }
}
