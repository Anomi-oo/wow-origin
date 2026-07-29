const getNewMv = require('./mv_new');

module.exports = (query, request) => {
  return getNewMv(query, request);
}
