const { randomString } = require('../util/util');
const songAuth = require('./song_auth');
const songAuthURL = require('./song_url_auth');

// Keep the authorization and URL requests on the same device; failures must reject normally.
module.exports = async (params, useAxios) => {
  const hash = (params.hash || '').toLowerCase();
  const album_audio_id = Number(params.album_audio_id ?? 0);
  const cookie = { dfid: randomString(24), ...params.cookie };
  const authorization = params.auth || cookie.auth || '';
  const result = await songAuth({ hash, album_audio_id, auth: authorization, cookie }, useAxios);
  const { auth, open_time } = result.body?.data || {};
  if (!auth || !open_time) throw { status: 502, body: { error: '获取歌曲播放授权失败', status: 0 } };
  return songAuthURL({ ...params, auth, open_time, hash, album_audio_id, cookie }, useAxios);
};
