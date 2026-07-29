const songUrl = require('./song_url_v1')

module.exports = (query, request) => {
  return songUrl(query, request)
}