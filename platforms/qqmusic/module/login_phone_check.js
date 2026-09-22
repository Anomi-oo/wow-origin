const { phoneLogin } = require('../util/phone-login')
module.exports = async (query) => ({ cookie: await phoneLogin(query.token, query.code) })
