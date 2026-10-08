module.exports = async (query, request) => {
  const data = {
    key: query.key,
    type: 3,
  }
  const result = await request(
    `/api/login/qrcode/client/login`,
    data,
    { crypto: 'eapi', useCheckToken: false, MUSIC_U: '' },
  )
  return {
    status: 200,
    body: {
      ...result.body
    },
    cookie: result.cookie,
  }
}
