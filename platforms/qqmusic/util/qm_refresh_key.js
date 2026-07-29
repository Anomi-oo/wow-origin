// qqmusic-refresh.js
'use strict';

const https = require('https');
const got = require('got'); // ^11
const crypto = require('crypto');
const { CookieJar } = require('tough-cookie');

const U_YQQ_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const UA_PC = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)'; // 伪装 PC UA
const REFRESH_NOT_NEEDED_CODE = 20279;

function randHex(n) { return crypto.randomBytes(n).toString('hex').toUpperCase(); }
function genGUID() { return randHex(16); } // 32 hex
function genWID() {
  // 生成 64bit 十进制字符串
  const buf = crypto.randomBytes(8);
  const bi = BigInt('0x' + buf.toString('hex'));
  return bi.toString(10);
}

function createRefreshPayload({
  openid,
  unionid,
  uin,
  musicid,
  access_token,
  refresh_token,
  musickey,
  refresh_key,
  expired_at,
  deviceName,
  deviceType,
  guid,
  wid,
}) {
  return {
    QQRefreshKey: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: {
        access_token,
        appid: 100497308,
        deviceName,
        deviceType,
        expired_in: 0,
        forceRefreshToken: 0,
        loginMode: 2,
        musicid: Number(musicid),
        musickey,
        onlyNeedAccessToken: 0,
        openid,
        refresh_key,
        refresh_token,
      },
    },
    comm: {
      _channelid: '0',
      _os_version: '6.2.9200-2',
      authst: musickey,
      ct: '19',
      cv: '2192',
      guid,
      patch: '118',
      psrf_access_token_expiresAt: Number(expired_at) || 0,
      psrf_qqaccess_token: access_token,
      psrf_qqopenid: openid,
      psrf_qqunionid: unionid || '',
      tmeAppID: 'qqmusic',
      tmeLoginType: 2,
      uin: String(uin || musicid),
      wid,
    },
  };
}

function hasUsableTokenData(data, fallback) {
  const tokens = { ...fallback, ...(data || {}) };
  const required = ['openid', 'musicid', 'access_token', 'refresh_token', 'musickey'];
  const expiresAt = Number(tokens.expired_at);

  return required.every(key => String(tokens[key] || '').trim())
    && Number.isFinite(expiresAt)
    && expiresAt > Math.floor(Date.now() / 1000);
}

function parseRefreshResponse(body, fallback) {
  const responseBody = String(body || '').replace(/^\uFEFF/, '').trim();
  let data;

  try {
    data = JSON.parse(responseBody);
  } catch {
    throw new Error(`QQ 音乐刷新响应 JSON 解析失败(length=${responseBody.length})`);
  }

  const outerCode = Number(data?.code);
  const refreshResult = data?.QQRefreshKey;
  const refreshCode = Number(refreshResult?.code);
  const refreshData = refreshResult?.data || {};

  if (outerCode === 0 && refreshCode === 0) {
    return { data, refreshData, refreshed: true };
  }

  if (
    outerCode === 0
    && refreshCode === REFRESH_NOT_NEEDED_CODE
    && hasUsableTokenData(refreshData, fallback)
  ) {
    return { data, refreshData, refreshed: false };
  }

  const code = Number.isFinite(refreshCode) ? refreshCode : outerCode;
  throw new Error(`QQ 音乐刷新失败(code=${Number.isFinite(code) ? code : 'unknown'})`);
}

// opts: {
//   openid, unionid, uin, musicid,
//   access_token, refresh_token,
//   musickey, refresh_key, expired_at, // 秒级时间戳
//   deviceName?, deviceType?, guid?, wid?,
//   jar?: CookieJar                 // 可传入已有的 Jar，用于接住 Set-Cookie
// }
async function refreshQQMusicCookies(opts) {
  const {
    openid, unionid = '', uin, musicid,
    access_token, refresh_token,
    musickey, refresh_key = '',
    expired_at = 0,
    deviceName = 'DESKTOP-' + randHex(6),
    deviceType = 'Windows',
    guid = genGUID(),
    wid = genWID(),
    jar = new CookieJar(undefined, { looseMode: true }),
  } = opts || {};

  // 基本校验
  for (const k of ['openid', 'musicid', 'access_token', 'refresh_token', 'musickey']) {
    if (!opts || !opts[k]) throw new Error(`missing field: ${k}`);
  }

  const agent = new https.Agent({ keepAlive: true });
  const http = got.extend({
    agent: { https: agent },
    cookieJar: jar,
    throwHttpErrors: false,
    retry: 0,
    timeout: { request: 20000 },
    headers: {
      'User-Agent': UA_PC,
      'Accept': '*/*',
      'Origin': 'https://y.qq.com',
      'Referer': 'https://y.qq.com/',
    },
  });

  const tokenFallback = {
    openid,
    unionid,
    uin,
    musicid,
    access_token,
    refresh_token,
    musickey,
    refresh_key,
    expired_at,
  };
  const payload = createRefreshPayload({
    ...tokenFallback,
    deviceName,
    deviceType,
    guid,
    wid,
  });

  const body = JSON.stringify(payload);
  const res = await http.post(U_YQQ_MUSICU, {
    body,
    responseType: 'text',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (res.statusCode !== 200) {
    throw new Error(`u.y.qq.com HTTP ${res.statusCode}`);
  }

  const parsed = parseRefreshResponse(res.body, tokenFallback);
  const data = parsed.data;
  const d = parsed.refreshData;
  // 从 CookieJar 读取最新 cookies
  const cookiesQQ = await jar.getCookies('https://qq.com/');
  const cookiesY = await jar.getCookies('https://y.qq.com/');
  const map = (arr) => Object.fromEntries(arr.map(c => [c.key, c.value]));

  return {
    ok: true,
    refreshed: parsed.refreshed,
    tokens: {
      openid: d.openid || openid,
      access_token: d.access_token || access_token,
      refresh_token: d.refresh_token || refresh_token,
      expired_at: d.expired_at || expired_at,
      musickey: d.musickey || musickey,
      keyExpiresIn: d.keyExpiresIn,
      refresh_key: d.refresh_key || refresh_key,
      musicid: d.musicid || musicid,
      unionid: d.unionid || unionid,
      encryptUin: d.encryptUin,
      musickeyCreateTime: d.musickeyCreateTime,
      qm_keyst: d.musickey,
      uin: d.musicid || uin,
    },
    qqComCookies: map(cookiesQQ),
    yqqCookies: map(cookiesY),
    raw: data,
  };
}

module.exports = {
  refreshQQMusicCookies,
  _private: {
    REFRESH_NOT_NEEDED_CODE,
    createRefreshPayload,
    parseRefreshResponse,
  },
};
