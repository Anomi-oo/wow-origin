const { sendPhoneCode } = require('../util/phone-login')
module.exports = async (query) => ({ body: await sendPhoneCode(query.phone, query.countryCode, query.token) })
