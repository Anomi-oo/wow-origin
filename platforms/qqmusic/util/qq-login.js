'use strict';

// Protocol reference: https://l-1124.github.io/QQMusicApi/reference/modules/login/
const { randomUUID } = require('node:crypto');
const { loginFetch, loginCgi, responseCookies, cookieHeader, credentialCookies, loginError } = require('./login-http');
const REDIRECT_URI = 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/';
const LOGIN_JUMP = 'https://graph.qq.com/oauth2.0/login_jump';
const REFERER = 'https://xui.ptlogin2.qq.com/';
const sessions = new Map();
const TTL = 130000;

function hash33(value, seed = 0) {
  let hash = seed;
  for (const char of value) hash = (hash * 33 + char.charCodeAt(0)) & 0x7fffffff;
  return hash;
}

async function startLogin() {
  for (const [token, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(token);
  const url = new URL('https://ssl.ptlogin2.qq.com/ptqrshow');
  url.search = new URLSearchParams({ appid: '716027609', e: '2', l: 'M', s: '3', d: '72', v: '4', t: String(Math.random()), daid: '383', pt_3rd_aid: '100497308' });
  const response = await loginFetch(url, { headers: { Referer: REFERER } }, 'QQ 二维码');
  const qrsig = responseCookies(response.headers).qrsig;
  const image = Buffer.from(await response.arrayBuffer());
  if (!qrsig || !image.length) throw new Error('QQ 二维码响应缺少 qrsig 或图片');
  const token = randomUUID();
  sessions.set(token, { qrsig, expiresAt: Date.now() + TTL, pending: null });
  return { token, qrcode: `data:image/png;base64,${image.toString('base64')}`, expiresIn: 120 };
}

async function authorize(jumpUrl) {
  const jump = new URL(jumpUrl);
  const uin = jump.searchParams.get('uin');
  const sigx = jump.searchParams.get('ptsigx');
  if (!uin || !sigx) throw new Error('QQ 扫码响应缺少 uin 或 ptsigx');
  // Rebuild the graph endpoint from the returned fields.
  const url = new URL('https://ssl.ptlogin2.graph.qq.com/check_sig');
  url.search = new URLSearchParams({
    uin, ptsigx: sigx, pttype: '1', service: 'ptqrlogin', nodirect: '0', s_url: LOGIN_JUMP,
    ptlang: '2052', ptredirect: '100', aid: '716027609', daid: '383', j_later: '0',
    low_login_hour: '0', regmaster: '0', pt_login_type: '3', pt_aid: '0', pt_aaid: '16', pt_light: '0', pt_3rd_aid: '100497308',
  });
  const check = await loginFetch(url, { headers: { Referer: REFERER } }, 'QQ 会话校验');
  const cookies = responseCookies(check.headers);
  await check.arrayBuffer();
  if (!cookies.p_skey) throw new Error(`QQ 会话校验未返回 p_skey (HTTP ${check.status})`);
  const response = await loginFetch('https://graph.qq.com/oauth2.0/authorize', {
    method: 'POST',
    headers: { Referer: REFERER, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(cookies) },
    body: new URLSearchParams({
      response_type: 'code', client_id: '100497308', redirect_uri: REDIRECT_URI,
      scope: 'get_user_info,get_app_friends', state: 'state', switch: '', from_ptlogin: '1',
      src: '1', update_auth: '1', openapi: '1010_1030', g_tk: String(hash33(cookies.p_skey, 5381)),
      auth_time: String(Date.now()), ui: randomUUID(),
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
  const url = new URL('https://ssl.ptlogin2.qq.com/ptqrlogin');
  url.search = new URLSearchParams({
    u1: LOGIN_JUMP, ptqrtoken: String(hash33(session.qrsig)), ptredirect: '0', h: '1', t: '1', g: '1',
    from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: '20102616', js_type: '1',
    pt_uistyle: '40', aid: '716027609', daid: '383', pt_3rd_aid: '100497308', has_onekey: '1',
  });
  const response = await loginFetch(url, { headers: { Referer: REFERER, Cookie: cookieHeader({ qrsig: session.qrsig }) } }, 'QQ 扫码状态');
  const body = await response.text();
  const callback = /ptuiCB\((.*?)\)/s.exec(body);
  const args = callback ? [...callback[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => m[1]) : [];
  if (args[0] === '66') return { status: 'waiting' };
  if (args[0] === '67') return { status: 'confirming' };
  if (args[0] === '65' || args[0] === '68') return { status: 'expired' };
  if (args[0] !== '0') throw new Error('QQ 返回无法识别的扫码状态');
  return authorize(args[2]);
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
