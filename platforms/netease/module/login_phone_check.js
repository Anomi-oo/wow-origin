const { phoneLogin } = require('../util/phone-login')
module.exports = async (query) => phoneLogin(query.token, query.code)
