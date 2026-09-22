'use strict';

// Protocol reference: https://l-1124.github.io/QQMusicApi/reference/modules/login/
const { randomUUID } = require('node:crypto');
const { CookieJar } = require('tough-cookie');
const { loginFetch, loginCgi, responseSetCookies, cookieHeader, credentialCookies, loginError } = require('./login-http');
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

async function startLogin() {
  for (const [token, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(token);
  const session = { jar: new CookieJar(undefined, { looseMode: true }), expiresAt: Date.now() + TTL, pending: null };
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
  const token = randomUUID();
  session.qrsig = qrsig;
  sessions.set(token, session);
  return { token, qrcode: `data:image/png;base64,${image.toString('base64')}`, expiresIn: 120 };
}

async function authorize(jumpUrl, session) {
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
  const result = await loginCgi('QQConnectLogin.LoginServer', 'QQLogin', { code }, { ct: 24, cv: 4747474, platform: 'yqq.json', tmeLoginType: 2 });
  if (result.code !== 0) throw loginError(result.code);
  return { status: 'done', cookie: credentialCookies({ loginType: 2, ...result.data }) };
}

async function pollSession(session) {
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
    sessions.delete(token);
    return { status: 'expired' };
  }
  if (session.pending) return { status: 'confirming' };
  session.pending = pollSession(session);
  try {
    const result = await session.pending;
    if (['done', 'expired'].includes(result.status)) sessions.delete(token);
    return result;
  } catch (error) {
    sessions.delete(token);
    return { status: 'error', msg: error.message };
  } finally { session.pending = null; }
}

module.exports = { startLogin, pollLogin, hash33 };
