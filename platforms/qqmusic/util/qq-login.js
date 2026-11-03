'use strict';

// Protocol reference: https://l-1124.github.io/QQMusicApi/reference/modules/login/
const { randomUUID } = require('node:crypto');
const { CookieJar } = require('tough-cookie');
const { loginFetch, responseSetCookies, cookieHeader, credentialCookies, loginError } = require('./login-http');
const { createAndroidLoginContextFromIdentity, bindAndroidLoginContext } = require('./android-login');
const { watchMobileQr } = require('./mobile-qr');
const REDIRECT_URI = 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/';
const LOGIN_JUMP = 'https://graph.qq.com/oauth2.0/login_jump';
const PTLOGIN_ORIGIN = 'https://xui.ptlogin2.qq.com';
const REFERER = `${PTLOGIN_ORIGIN}/`;
const sessions = new Map();
const TTL = 130000;

function xloginUrl() {
  const url = new URL('/cgi-bin/xlogin', PTLOGIN_ORIGIN);
  url.search = new URLSearchParams({
    appid: '716027609', daid: '383', style: '33', login_text: '登录', hide_title_bar: '1',
    hide_border: '1', target: 'self', s_url: LOGIN_JUMP, pt_3rd_aid: '100497308',
    pt_feedback_link: 'https://support.qq.com/products/77942?customInfo=.appid100497308',
    theme: '2', verify_theme: '',
  });
  return url;
}

function hash33(value, seed = 0) {
  let hash = seed;
  for (const char of value) hash = (hash * 33 + char.charCodeAt(0)) & 0x7fffffff;
  return hash;
}

function mergeCookieHeaders(...headers) {
  const cookies = new Map();
  for (const header of headers) {
    for (const item of String(header || '').split(';')) {
      const index = item.indexOf('=');
      if (index <= 0) continue;
      const key = item.slice(0, index).trim();
      if (key) cookies.set(key, item.slice(index + 1).trim());
    }
  }
  return cookieHeader(Object.fromEntries(cookies));
}

async function sessionFetch(session, url, options = {}, stage) {
  const requestUrl = url instanceof URL ? url.toString() : String(url);
  const headers = { ...(options.headers || {}) };
  const explicitCookie = headers.Cookie || headers.cookie || '';
  delete headers.cookie;
  const cookies = mergeCookieHeaders(await session.jar.getCookieString(requestUrl), explicitCookie);
  if (cookies) headers.Cookie = cookies;
  const response = await loginFetch(url, { ...options, headers }, stage);
  for (const value of responseSetCookies(response.headers)) {
    await session.jar.setCookie(value, requestUrl, { ignoreError: true });
  }
  return response;
}

async function cookieMap(session, url) {
  return Object.fromEntries((await session.jar.getCookies(url)).map((cookie) => [cookie.key, cookie.value]));
}

async function qqCode(session) {
  const loginUrl = xloginUrl();
  const loginPage = await sessionFetch(session, loginUrl, {
    headers: { Referer: REFERER, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8' },
  }, 'QQ 登录页');
  await loginPage.arrayBuffer();

  const url = new URL('/ssl/ptqrshow', PTLOGIN_ORIGIN);
  url.search = new URLSearchParams({
    appid: '716027609', e: '2', l: 'M', s: '3', d: '72', v: '4', t: String(Math.random()),
    daid: '383', pt_3rd_aid: '100497308', u1: LOGIN_JUMP,
  });
  const response = await sessionFetch(session, url, {
    headers: {
      Referer: loginUrl.toString(),
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  }, 'QQ 二维码');
  const qrsig = (await cookieMap(session, url.toString())).qrsig;
  const image = Buffer.from(await response.arrayBuffer());
  if (!qrsig || !image.length) throw new Error('QQ 二维码响应缺少 qrsig 或图片');
  session.qrsig = qrsig;
  return `data:image/png;base64,${image.toString('base64')}`;
}

async function wxCode(session) {
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
  url.search = new URLSearchParams({
    appid: 'wx48db31d50e334801',
    redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/',
    response_type: 'code', scope: 'snsapi_login', state: 'STATE',
    href: 'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect',
  });
  const page = await loginFetch(url, {}, '微信登录页');
  const uuid = /(?:\/connect\/qrcode\/|[?&]uuid=)([A-Za-z0-9_-]+)/.exec(await page.text())?.[1];
  if (!uuid) throw new Error('微信登录页未返回二维码标识');
  session.wxUuid = uuid;
  const response = await loginFetch(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
    headers: { Referer: url.toString() },
  }, '微信二维码');
  const image = Buffer.from(await response.arrayBuffer());
  if (!image.length) throw new Error('微信未返回二维码图片');
  return `data:image/jpeg;base64,${image.toString('base64')}`;
}

/** 复用账号 Android 设备状态；三种扫码共用 token 生命周期，手机客户端额外订阅推送。 */
async function startLogin(identityValue, qrType = 'qq') {
  if (!['qq', 'wx', 'mobile'].includes(qrType)) throw new Error('不支持的 QQ 音乐扫码方式');
  for (const [token, session] of sessions) if (session.expiresAt <= Date.now()) cancelLogin(token);
  const session = { qrType, jar: new CookieJar(undefined, { looseMode: true }), android: createAndroidLoginContextFromIdentity(identityValue), expiresAt: Date.now() + TTL, pending: null };
  let qrcode;
  if (qrType === 'mobile') {
    const result = await session.android.androidLoginCgi('music.login.LoginServer', 'CreateQRCode', {
      tmeAppID: 'qqmusic', ct: 11, cv: 14090008,
    }, {}, { ct: 23, cv: 0 });
    if (result.code !== 0) throw loginError(result.code);
    const { qrcode: image, qrcodeID } = result.data || {};
    if (!image || !qrcodeID || !/^[A-Za-z0-9_-]+$/.test(String(qrcodeID))) throw new Error('QQ 音乐未返回有效二维码');
    session.qrcodeId = String(qrcodeID);
    qrcode = `data:image/png;base64,${String(image).split(',').pop()}`;
    session.mobile = await watchMobileQr(session.qrcodeId, session.expiresAt);
  } else qrcode = qrType === 'wx' ? await wxCode(session) : await qqCode(session);
  const token = randomUUID();
  sessions.set(token, session);
  return { token, qrcode, expiresIn: 120 };
}

function finishLogin(session, result, loginType) {
  if (result.code !== 0) throw loginError(result.code);
  const cookie = credentialCookies({ loginType, ...result.data });
  if (session.cancelled) throw new Error('登录会话已取消');
  bindAndroidLoginContext(cookie.musicid, session.android);
  return { status: 'done', cookie };
}

async function authorize(jumpUrl, session) {
  session.stage = 'check_sig';
  const jump = new URL(jumpUrl);
  if (jump.origin !== 'https://ssl.ptlogin2.graph.qq.com') throw new Error('QQ 扫码响应包含无效的会话校验地址');
  const uin = jump.searchParams.get('uin');
  const sigx = jump.searchParams.get('ptsigx');
  if (!uin || !sigx) throw new Error('QQ 扫码响应缺少 uin 或 ptsigx');
  const ptloginCookies = {
    ...await cookieMap(session, `${PTLOGIN_ORIGIN}/`),
    ...await cookieMap(session, 'https://ptlogin2.qq.com/'),
  };
  const check = await sessionFetch(session, jump, {
    headers: {
      Referer: REFERER, Cookie: cookieHeader(ptloginCookies),
      'Upgrade-Insecure-Requests': '1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
    },
  }, 'QQ 会话校验');
  await check.arrayBuffer();
  const graphCookies = {
    ...await cookieMap(session, jump.toString()),
    ...await cookieMap(session, 'https://graph.qq.com/'),
  };
  const pSkey = graphCookies.p_skey || graphCookies.p_sKey || graphCookies.skey || graphCookies.pskey;
  if (!pSkey) {
    const location = check.headers.get('location');
    let redirectHost = 'none';
    try { if (location) redirectHost = new URL(location, jump).host; } catch (_) {}
    const cookieNames = Object.keys(graphCookies).sort().join(',') || 'none';
    throw new Error(`QQ 会话校验未返回 p_skey (HTTP ${check.status}; cookies=${cookieNames}; redirect=${redirectHost})`);
  }
  const ui = randomUUID().toUpperCase();
  await session.jar.setCookie(`ui=${ui}; Path=/; Domain=graph.qq.com`, 'https://graph.qq.com/', { ignoreError: true });
  session.stage = 'graph_authorize';
  const response = await sessionFetch(session, 'https://graph.qq.com/oauth2.0/authorize', {
    method: 'POST',
    headers: {
      Origin: 'https://graph.qq.com', Referer: REFERER,
      'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(graphCookies),
      'Upgrade-Insecure-Requests': '1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
    },
    body: new URLSearchParams({
      response_type: 'code', client_id: '100497308', redirect_uri: REDIRECT_URI,
      scope: 'get_user_info,get_app_friends', state: Math.random().toString(36).slice(2), switch: '', from_ptlogin: '1',
      src: '1', update_auth: '1', openapi: '1010_1030', g_tk: String(hash33(pSkey, 5381)),
      auth_time: String(Date.now()), ui,
    }).toString(),
  }, 'QQ 授权');
  const location = response.headers.get('location');
  await response.arrayBuffer();
  const redirect = location ? new URL(location, 'https://graph.qq.com/') : null;
  const code = redirect?.searchParams.get('code') || new URLSearchParams(redirect?.hash.slice(1)).get('code');
  if (!code) throw new Error(`QQ 授权未返回 code (HTTP ${response.status})`);
  session.stage = 'android_login';
  const result = await session.android.androidLoginCgi('QQConnectLogin.LoginServer', 'QQLogin', { code }, {}, { tmeLoginType: 2 });
  return finishLogin(session, result, 2);
}

async function pollWx(session) {
  session.stage = 'wx_poll';
  const url = new URL('https://lp.open.weixin.qq.com/connect/l/qrconnect');
  url.search = new URLSearchParams({ uuid: session.wxUuid, _: String(Date.now()) });
  let response;
  try { response = await loginFetch(url, { headers: { Referer: 'https://open.weixin.qq.com/' } }, '微信扫码状态'); }
  catch (error) {
    // 微信长轮询无新状态时正常超时，继续等待；其他网络错误仍按失败处理。
    if (error.code === 'UPSTREAM_TIMEOUT' || error.details?.errors?.some(item => item.name === 'TimeoutError')) return { status: 'waiting' };
    throw error;
  }
  const body = await response.text();
  const code = /window\.wx_errcode\s*=\s*(\d+)/.exec(body)?.[1];
  if (code === '408') return { status: 'waiting' };
  if (code === '404') return { status: 'confirming' };
  if (code === '402') return { status: 'expired' };
  if (code === '403') return { status: 'error', msg: '已取消微信登录' };
  const authorization = /window\.wx_code\s*=\s*['"]([^'"]*)/.exec(body)?.[1];
  if (code !== '405' || !authorization) throw new Error('微信返回无效的扫码状态');
  session.stage = 'wx_login';
  return finishLogin(session, await session.android.androidLoginCgi('music.login.LoginServer', 'Login', {
    code: authorization, strAppid: 'wx48db31d50e334801',
  }, {}, { tmeLoginType: 1 }), 1);
}

async function pollMobile(session) {
  const { type, payload, message } = session.mobile.event;
  if (type === 'waiting') return { status: 'waiting' };
  if (type === 'scanned') return { status: 'confirming' };
  if (type === 'timeout') return { status: 'expired' };
  if (type !== 'cookies') return { status: 'error', msg: message || (type === 'canceled' ? '已取消 QQ 音乐登录' : 'QQ 音乐登录失败') };
  const uin = String(payload?.cookies?.qqmusic_uin?.value || '');
  const key = payload?.cookies?.qqmusic_key?.value;
  if (!/^[1-9]\d*$/.test(uin) || typeof key !== 'string' || !key) throw new Error('QQ 音乐扫码消息缺少登录凭证');
  session.stage = 'mobile_login';
  return finishLogin(session, await session.android.androidLoginCgi('music.login.LoginServer', 'Login', {
    musicid: Number(uin), qrCodeID: session.qrcodeId, token: key,
  }, {}, { tmeLoginType: 6 }), 6);
}

async function pollSession(session) {
  session.stage = 'ptqrlogin';
  const loginCookies = await cookieMap(session, `${PTLOGIN_ORIGIN}/`);
  const url = new URL('/ssl/ptqrlogin', PTLOGIN_ORIGIN);
  url.search = new URLSearchParams({
    u1: LOGIN_JUMP, ptqrtoken: String(hash33(session.qrsig)), ptredirect: '0', h: '1', t: '1', g: '1',
    from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: '25100115', js_type: '1',
    login_sig: loginCookies.pt_login_sig || '', pt_uistyle: '40', aid: '716027609', daid: '383',
    pt_3rd_aid: '100497308', pt_js_version: '28d22679',
  });
  const response = await sessionFetch(session, url, {
    headers: { Referer: xloginUrl().toString(), Accept: '*/*' },
  }, 'QQ 扫码状态');
  const body = await response.text();
  const callback = /ptuiCB\((.*?)\)/s.exec(body);
  const args = callback ? [...callback[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => m[1]) : [];
  if (args[0] === '66') return { status: 'waiting' };
  if (args[0] === '67') return { status: 'confirming' };
  if (args[0] === '65' || args[0] === '68') return { status: 'expired' };
  if (args[0] !== '0') throw new Error('QQ 返回无法识别的扫码状态');
  return authorize(args[2], session);
}

async function pollLogin(token) {
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    cancelLogin(token);
    return { status: 'expired' };
  }
  if (session.pending) return { status: 'confirming' };
  session.pending = session.qrType === 'wx' ? pollWx(session)
    : session.qrType === 'mobile' ? pollMobile(session) : pollSession(session);
  try {
    const result = await session.pending;
    if (['done', 'expired', 'error'].includes(result.status)) cancelLogin(token);
    return session.qrType === 'qq' ? result : { ...result, qrType: session.qrType };
  } catch (error) {
    cancelLogin(token);
    // A raw exception can contain the redirect URL or login credentials. Log only
    // the stage and stack frames so Workers Events can locate the failing call.
    console.error('[qq-login] QR login failed', {
      stage: session.stage || 'unknown',
      name: error?.name || 'Error',
      code: error?.diagnostics?.code,
      details: error?.diagnostics?.details,
      frames: String(error?.stack || '').split('\n').slice(1, 7).join('\n'),
    });
    return { status: 'error', msg: error.message };
  } finally { session.pending = null; }
}

function cancelLogin(token) {
  const session = sessions.get(token);
  if (session) { session.cancelled = true; session.mobile?.close(); }
  sessions.delete(token);
}

module.exports = { cancelLogin, startLogin, pollLogin, hash33 };
