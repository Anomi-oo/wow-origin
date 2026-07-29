const search = require('./search')

module.exports = (query, request) => {
  return search(query, request)
}