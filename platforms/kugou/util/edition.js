const config = require('./config.json');

/** An unmarked legacy account belongs to standard edition, independent of process env. */
function getEditionConfig(cookie = {}) {
  const edition = cookie?.KUGOU_API_PLATFORM ?? 'standard';
  if (edition !== 'standard' && edition !== 'lite') throw new Error('酷狗版本必须是 standard 或 lite');
  const isLite = edition === 'lite';
  return {
    edition,
    isLite,
    appid: isLite ? config.liteAppid : config.appid,
    clientver: isLite ? config.liteClientver : config.clientver,
  };
}

module.exports = { getEditionConfig };
