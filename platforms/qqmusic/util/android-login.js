'use strict';

// QQMusicApi's default CGI identity is an Android device with a daily QIMEI
// and anonymous GetSession. Keep that identity shared by QR, phone and refresh.
const {
  createCipheriv, createHash, publicEncrypt, randomBytes, randomUUID, constants,
} = require('node:crypto');
const { loginCgi, loginError } = require('./login-http');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKpqLQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y6B9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----`;
const QIMEI_SECRET = 'ZdJqM15EeO2zWc08';
const QIMEI_APP_KEY = '0AND0HD6FE4HY80F';
const QIMEI_EXTRA = JSON.stringify({ appKey: QIMEI_APP_KEY });
const QIMEI_SIGN_KEY = 'qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH';
const UA = 'QQMusic 14090008(android 15)';
const QIMEI_URL = 'https://api.tencentmusic.com/tme/trpc/proxy';
const DAY_MS = 24 * 60 * 60 * 1000;

function randomHex(length) {
  return Array.from(randomBytes(length), byte => (byte & 15).toString(16)).join('');
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function md5(...values) {
  const hash = createHash('md5');
  values.forEach(value => hash.update(String(value)));
  return hash.digest('hex');
}

function aesBase64(key, value, iv = key) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(Buffer.from(String(value), 'utf8')), cipher.final()]).toString('base64');
}

function randomImei() {
  const digits = Array.from({ length: 14 }, () => randomInt(10));
  const sum = digits.reduce((total, digit, index) => {
    const doubled = index % 2 ? digit * 2 : digit;
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return `${digits.join('')}${(10 - sum % 10) % 10}`;
}

function createDevice() {
  // One internally consistent profile, following QQMusicApi's vivo profile.
  return {
    board: 'sun', brand: 'vivo', device: 'PD2408', product: 'PD2408',
    model: 'V2408A', manufacturer: 'vivo', host: 'comdg01150014',
    procVersion: 'Linux localhost 6.6.89-android15-8-g1f71897ac249-abogki467805059-4k #1 SMP PREEMPT Thu Dec 11 01:56:00 UTC 2025 aarch64',
    firstApiLevel: 35, release: '15', sdk: 35,
    androidId: randomBytes(8).toString('hex'), imei: randomImei(),
    openUdid: randomUUID().replace(/-/g, ''), openUdid2: randomUUID().replace(/-/g, ''),
  };
}

function beaconId() {
  const month = new Date().toISOString().slice(0, 8) + '01';
  const suffix = `${100000 + randomInt(900000)}.${100000000 + randomInt(900000000)}`;
  const dated = new Set([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38]);
  let value = '';
  for (let index = 1; index <= 40; index += 1) {
    const part = dated.has(index) ? `${month}${suffix}` : index === 3 ? '0000000000000000'
      : index === 4 ? randomHex(16).replace(/0/g, 'a') : String(randomInt(10000));
    value += `k${index}:${part};`;
  }
  return value;
}

function qimeiPayload(device) {
  const now = new Date(Date.now() - randomInt(14401) * 1000);
  const uptime = now.toISOString().slice(0, 19).replace('T', ' ');
  const ipHash = Buffer.from(md5(device.androidId), 'hex');
  const reserved = {
    harmony: '0', clone: '0', containe: '',
    oz: aesBase64('lvcwmSYVr2Axv1gn', device.androidId, 'Zs0ntDqG2jyhKN0c'),
    oo: aesBase64('lvcwmSYVr2Axv1gn', device.model, 'Zs0ntDqG2jyhKN0c'),
    kelong: '0', ip: `192.168.${ipHash[0]}.${ipHash[1] % 253 + 2}`,
    uptimes: uptime, multiUser: '0', bod: device.board, brd: device.brand,
    dv: device.device, firstLevel: String(device.firstApiLevel),
    manufact: device.manufacturer, name: device.product, host: device.host,
    kernel: device.procVersion, pre: '0', av: '14.9.0.8', ch: '',
  };
  return {
    androidId: device.androidId, platformId: 1, appKey: QIMEI_APP_KEY,
    appVersion: '14.9.0.8', beaconIdSrc: beaconId(), brand: device.brand,
    channelId: '10003505', cid: '', imei: device.imei, imsi: '', mac: '',
    model: device.model, networkType: 'wifi', oaid: '',
    osVersion: `Android ${device.release},level ${device.sdk}`,
    qimei: '', qimei36: '', sdkVersion: '1.2.13.6', targetSdkVersion: '30',
    audit: '', userId: '{}', packageId: 'com.tencent.qqmusic',
    deviceType: 'Phone', sdkName: '', reserved: JSON.stringify(reserved),
  };
}

async function requestQimei(device) {
  const cryptKey = randomHex(16);
  const nonce = randomHex(16);
  const seconds = Math.floor(Date.now() / 1000);
  const key = publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(cryptKey)).toString('base64');
  const params = aesBase64(cryptKey, JSON.stringify(qimeiPayload(device)));
  const response = await fetch(QIMEI_URL, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/json', method: 'GetQimei',
      service: 'trpc.tme_datasvr.qimeiproxy.QimeiProxy', appid: 'qimei_qq_android',
      sign: md5(QIMEI_SIGN_KEY, seconds), 'User-Agent': 'QQMusic', timestamp: String(seconds),
    },
    body: JSON.stringify({ app: 0, os: 1, qimeiParams: {
      key, params, time: String(seconds), nonce,
      sign: md5(key, params, seconds * 1000, nonce, QIMEI_SECRET, QIMEI_EXTRA),
      extra: QIMEI_EXTRA,
    } }),
  });
  if (!response.ok) throw new Error(`QQ 设备标识请求失败 (HTTP ${response.status})`);
  const outer = await response.json();
  const result = typeof outer?.data === 'string' ? JSON.parse(outer.data) : outer?.data;
  const qimei = result?.data;
  if (!qimei?.q16 || !qimei?.q36) throw new Error('QQ 设备标识响应缺少 QIMEI');
  return { q16: String(qimei.q16), q36: String(qimei.q36) };
}

function sameLocalDay(timestamp) {
  return new Date(timestamp).toDateString() === new Date().toDateString();
}

function androidComm(device, credential = {}, qimei, session, additions = {}) {
  const musicid = String(credential.musicid || credential.uin || '').replace(/^o/, '');
  const musickey = credential.musickey || credential.qm_keyst || '';
  const loginType = Number(credential.loginType || 0);
  return {
    ct: 11, cv: 14090008, v: 14090008, chid: '10003505',
    ...(musicid ? { qq: musicid } : {}),
    ...(musickey ? { authst: musickey } : {}),
    tmeAppID: 'qqmusic',
    ...(loginType ? { tmeLoginType: loginType } : {}),
    QIMEI36: qimei.q36,
    OpenUDID: device.openUdid, udid: device.openUdid,
    ...(session ? { uid: session.uid } : {}),
    OpenUDID2: device.openUdid2,
    ...(session ? { sid: session.sid } : {}),
    aid: device.androidId, os_ver: device.release,
    phonetype: device.model,
    ...additions,
  };
}

function createAndroidLoginContext(options = {}) {
  const device = options.device || createDevice();
  let qimeiCache = options.qimei;
  let qimeiPending;
  let sessionCache = options.session;
  let sessionPending;

  async function ensureQimei() {
    if (qimeiCache && Date.now() - qimeiCache.savedAt < DAY_MS) return qimeiCache.value;
    if (!qimeiPending) {
      qimeiPending = requestQimei(device).then(value => {
        qimeiCache = { value, savedAt: Date.now() };
        return value;
      }).finally(() => { qimeiPending = undefined; });
    }
    return qimeiPending;
  }

  async function ensureSession() {
    if (sessionCache && sameLocalDay(sessionCache.savedAt)) return sessionCache;
    if (!sessionPending) {
      sessionPending = (async () => {
        const qimei = await ensureQimei();
        const stale = sessionCache;
        const result = await loginCgi('music.getSession.session', 'GetSession', {
          uid: stale?.uid || '', vkey: 0, caller: stale ? 1 : 2,
        }, androidComm(device, {}, qimei), UA);
        if (result.code !== 0) throw loginError(result.code);
        const session = result.data?.session;
        if (!session?.uid || !session?.sid) throw new Error('QQ 音乐未返回 Android 会话');
        sessionCache = { uid: String(session.uid), sid: String(session.sid), savedAt: Date.now() };
        return sessionCache;
      })().finally(() => { sessionPending = undefined; });
    }
    return sessionPending;
  }

  async function androidLoginCgi(module, method, param, credential = {}, additions = {}) {
    const session = await ensureSession();
    const qimei = await ensureQimei();
    return loginCgi(module, method, param, androidComm(device, credential, qimei, session, additions), UA);
  }

  function snapshot() {
    return { device, qimei: qimeiCache, session: sessionCache };
  }

  return { androidLoginCgi, ensureQimei, ensureSession, snapshot };
}

const accountContexts = new Map();

function decodeIdentity(value) {
  if (!value) return null;
  try {
    const identity = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const device = identity?.device;
    if (!device || !['androidId', 'imei', 'openUdid', 'openUdid2', 'model', 'release', 'sdk']
      .every(key => device[key])) return null;
    return identity;
  } catch { return null; }
}

function createAndroidLoginContextFromIdentity(value) {
  if (!value) return createAndroidLoginContext();
  const identity = decodeIdentity(value);
  if (!identity) throw new Error('已保存的 QQ 设备状态无效，无法复用 deviceId');
  return createAndroidLoginContext(identity);
}

function encodeIdentity(context) {
  return Buffer.from(JSON.stringify(context.snapshot())).toString('base64url');
}

function deviceIdFromIdentity(value) {
  return decodeIdentity(value)?.device.androidId || '';
}

function getAndroidLoginContext(musicid, identityValue, options = {}) {
  const key = String(musicid || '').replace(/^o/, '');
  if (!key) throw new Error('QQ 音乐账号 ID 缺失');
  if (!accountContexts.has(key)) {
    const identity = decodeIdentity(identityValue);
    if (!identity && options.requireExisting) throw new Error('QQ 账号缺少 deviceId，请重新扫码登录');
    accountContexts.set(key, createAndroidLoginContext(identity || {}));
  }
  return accountContexts.get(key);
}

function bindAndroidLoginContext(musicid, context) {
  const key = String(musicid || '').replace(/^o/, '');
  if (key) accountContexts.set(key, context);
}

function peekAndroidLoginContext(musicid) {
  return accountContexts.get(String(musicid || '').replace(/^o/, ''));
}

module.exports = { createAndroidLoginContext, createAndroidLoginContextFromIdentity, getAndroidLoginContext, bindAndroidLoginContext, peekAndroidLoginContext, encodeIdentity, decodeIdentity, deviceIdFromIdentity, createDevice, qimeiPayload };
