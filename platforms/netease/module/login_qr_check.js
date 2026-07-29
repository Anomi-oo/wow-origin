module.exports = async (query, request) => {
  const data = {
    key: query.key,
    type: 3,
  }
  try {
    let result = await request(
      `/api/login/qrcode/client/login`,
      data,
      { crypto: 'eapi', useCheckToken: false, MUSIC_U: '' },
    )
    result = {
      status: 200,
      body: {
        ...result.body
      },
      cookie: result.cookie,
    }
    return result
  } catch (error) {
    return {
      status: 200,
      body: {},
      cookie: {},
    }
  }
}
