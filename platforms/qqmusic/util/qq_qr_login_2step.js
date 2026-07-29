/*
  模块名：qqmusic-qr-two-step.js
  目标：仅两个后端 API 完成 QQ 扫码登录并拿到 QQ 音乐最终 Cookie
    1) startLogin()  -> 返回二维码（dataURL）与 token（会话句柄）
    2) pollLogin(token) -> 轮询：返回 waiting/confirming/done/expired/error
                           - done 时返回最终 cookie 与登录数据
                           - expired/error/done 均会立即销毁会话，避免堆积

  会话生命周期：
    - 硬过期：130 秒（接近官方 2 分钟 + 冗余）
    - 无轮询过期：15 秒（最后一次轮询距今 > 15s 即销毁）
    - 惰性 GC：每次 start/poll 先清理过期/空闲会话（可选附加周期 GC）

  依赖安装：
    npm i got@11 tough-cookie
*/

'use strict';

const https = require('https');
const crypto = require('crypto');
const got = require('got'); // v11
const { CookieJar } = require('tough-cookie');

// ===== 配置 =====
const APPID = 716027609;
const DAID = 383;
const PT_3RD_AID = 100497308; // QQ音乐 QQ 互联 appid
const S_URL = 'https://graph.qq.com/oauth2.0/login_jump';
const YQQ_REDIRECT_URI =
  'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=' +
  encodeURIComponent('https://y.qq.com/?ADTAG=myqq#type=index');

const XLOGIN_URL =
  `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=${APPID}&daid=${DAID}&style=33&login_text=%E7%99%BB%E5%BD%95&hide_title_bar=1&hide_border=1&target=self&s_url=${encodeURIComponent(S_URL)}&pt_3rd_aid=${PT_3RD_AID}&pt_feedback_link=${encodeURIComponent('https://support.qq.com/products/77942?customInfo=.appid' + PT_3RD_AID)}&theme=2&verify_theme=`;

const PTQRSHOW_URL = (t) =>
  `https://xui.ptlogin2.qq.com/ssl/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${t}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}&u1=${encodeURIComponent(S_URL)}`;

const PTQRLOGIN_URL = 'https://xui.ptlogin2.qq.com/ssl/ptqrlogin';

const GRAPH_SHOW_URL = (state) =>
  'https://graph.qq.com/oauth2.0/show?' +
  new URLSearchParams({
    which: 'Login',
    display: 'pc',
    response_type: 'code',
    client_id: String(PT_3RD_AID),
    redirect_uri: YQQ_REDIRECT_URI,
    state,
    scope: 'get_user_info,get_app_friends',
  }).toString();

const GRAPH_AUTHORIZE_URL = 'https://graph.qq.com/oauth2.0/authorize';
const YQQ_HOME = 'https://y.qq.com/';
const U_YQQ_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';

// ===== HTTP 与 Cookie 管理（手动 Jar）=====
const agent = new https.Agent({ keepAlive: true });
const http = got.extend({
  agent: { https: agent },
  decompress: true,
  throwHttpErrors: false,
  retry: 0,
  timeout: { request: 20000 },
});

async function saveCookiesFromResponse(jar, url, res) {
  const sc = res.headers['set-cookie'];
  if (!sc) return;
  const list = Array.isArray(sc) ? sc : [sc];
  for (const c of list) {
    if (!c) continue;
    await jar.setCookie(c, url, { ignoreError: true }).catch(() => {}); // 宽松
  }
}

async function fetchWithSession(session, url, opts = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(opts.headers || {}),
  };
  const cookieStr = await session.jar.getCookieString(url);
  if (cookieStr) headers.Cookie = cookieStr;

  let res = await http(url, { ...opts, headers, followRedirect: false });
  await saveCookiesFromResponse(session.jar, url, res);

  let redirects = typeof opts.maxRedirects === 'number' ? opts.maxRedirects : 5;
  let currentUrl = url;
  while (redirects > 0 && [301, 302, 303, 307, 308].includes(res.statusCode)) {
    const loc = res.headers.location;
    if (!loc) break;
    const nextUrl = new URL(loc, currentUrl).toString();

    let method = opts.method || 'GET';
    let body = opts.body;
    if (res.statusCode === 303 || res.statusCode === 302) {
      method = 'GET';
      body = undefined;
    }
    const nextHeaders = {
      ...headers,
      Cookie: await session.jar.getCookieString(nextUrl),
    };

    res = await http(nextUrl, { ...opts, method, body, headers: nextHeaders, followRedirect: false });
    await saveCookiesFromResponse(session.jar, nextUrl, res);
    currentUrl = nextUrl;
    redirects -= 1;
  }

  res.finalUrl = currentUrl;
  return res;
}

// ===== 工具函数 =====
function hash33(str) { let e = 0; for (let i = 0; i < str.length; i++) { e += (e << 5) + str.charCodeAt(i); e &= 0x7fffffff; } return e; }
function calcGTK(pskey) { let hash = 5381; for (let i = 0; i < pskey.length; i++) { hash += (hash << 5) + pskey.charCodeAt(i); } return hash & 0x7fffffff; }
function parsePtuiCB(body) {
  const m = [...String(body).matchAll(/'([^']*)'/g)].map((x) => x[1]);
  if (!m.length) throw new Error('无法解析 ptuiCB 返回: ' + String(body).slice(0, 200));
  return { code: m[0], url: m[2] || '', msg: m[4] || '', nickname: m[5] || '' };
}
function uuidUpper() {
  const v = crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
      });
  return v.toUpperCase();
}

// ===== 会话管理（两步策略，130s 硬过期 + 15s 无轮询过期）=====
const store = new Map();
const QR_HARD_TTL = 130_000;  // 130s 硬过期
const IDLE_TTL = 15_000;      // 15s 无轮询过期
const GC_INTERVAL_MS = 30_000;

let lastGc = 0;
function gcSessions() {
  const now = Date.now();
  if (now - lastGc < GC_INTERVAL_MS) return;
  lastGc = now;

  for (const [k, s] of store) {
    const hardExpired = now > s.hardExpireAt;
    const idleExpired = now - (s.lastPollAt || s.createdAt) > IDLE_TTL;
    const terminal = s.status === 'done' || s.status === 'expired' || s.status === 'error';

    if (hardExpired || idleExpired || terminal) {
      store.delete(k);
    }
  }
}

function safeDelete(token) {
  if (store.has(token)) store.delete(token);
}

async function getCookieMapFor(session, url) {
  const list = await session.jar.getCookies(url);
  const map = {}; for (const c of list) map[c.key] = c.value;
  return map;
}

async function ensureUiCookie(session) {
  const list = await session.jar.getCookies('https://graph.qq.com/');
  const existed = list.find((c) => c.key === 'ui');
  if (existed) return existed.value;
  const val = uuidUpper();
  await session.jar.setCookie(`ui=${val}; Path=/; Domain=graph.qq.com;`, 'https://graph.qq.com/', { ignoreError: true }).catch(() => {});
  return val;
}

async function ensureYqqContextCookies(session) {
  const qqCom = await getCookieMapFor(session, 'https://qq.com/');
  const yqq = await getCookieMapFor(session, 'https://y.qq.com/');
  const rnd = () => String(Math.floor(Math.random() * 9e9 + 1e9));
  if (!qqCom['pgv_pvid']) await session.jar.setCookie(`pgv_pvid=${rnd()}; Path=/; Domain=qq.com;`, 'https://qq.com/', { ignoreError: true }).catch(() => {});
  if (!qqCom['pgv_info']) await session.jar.setCookie(`pgv_info=ssid=s${rnd()}; Path=/; Domain=qq.com;`, 'https://qq.com/', { ignoreError: true }).catch(() => {});
  if (!yqq['ts_uid']) await session.jar.setCookie(`ts_uid=${rnd()}; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/', { ignoreError: true }).catch(() => {});
  if (!yqq['ts_last']) await session.jar.setCookie(`ts_last=y.qq.com/; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/', { ignoreError: true }).catch(() => {});
  if (!yqq['ts_refer']) await session.jar.setCookie(`ts_refer=i.y.qq.com/; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/', { ignoreError: true }).catch(() => {});
  await session.jar.setCookie(`login_type=1; Path=/; Domain=qq.com;`, 'https://qq.com/', { ignoreError: true }).catch(() => {});
  await session.jar.setCookie(`login_type=1; Path=/; Domain=y.qq.com;`, 'https://y.qq.com/', { ignoreError: true }).catch(() => {});
}

// ===== Step 1：获取二维码 =====
async function startLogin() {
  gcSessions();

  const token = uuidUpper();
  const now = Date.now();
  const session = {
    token,
    jar: new CookieJar(undefined, { looseMode: true }),
    createdAt: now,
    lastPollAt: now,
    hardExpireAt: now + QR_HARD_TTL,
    status: 'init', // init | waiting | confirming | authed | done | expired | error
    lock: false,
    qrsig: null,
    ptqrtoken: null,
    checkSigUrl: null,
    msg: '',
  };
  store.set(token, session);

  // 打开登录页，拿前置 Cookie
  await fetchWithSession(session, XLOGIN_URL, {
    headers: {
      Referer: 'https://xui.ptlogin2.qq.com/',
      'Upgrade-Insecure-Requests': '1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
    },
  });

  // 获取二维码
  const t = Math.random();
  const res = await fetchWithSession(session, PTQRSHOW_URL(t), {
    responseType: 'buffer',
    headers: {
      Referer: XLOGIN_URL,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });
  if (res.statusCode !== 200) {
    safeDelete(token);
    throw new Error(`获取二维码失败，HTTP ${res.statusCode}`);
  }

  // 拿 qrsig
  const ptCookies = await getCookieMapFor(session, 'https://ptlogin2.qq.com/');
  const qrsig = ptCookies['qrsig'];
  if (!qrsig) {
    safeDelete(token);
    throw new Error('未获取到 qrsig');
  }
  session.qrsig = qrsig;
  session.ptqrtoken = hash33(qrsig);
  session.status = 'waiting';

  const dataURL = `data:image/png;base64,${Buffer.from(res.body).toString('base64')}`;

  return {
    token,
    qrcode: dataURL,
    // 硬过期 130s
    expiresIn: 120,
  };
}

// ===== Step 2：轮询（直到拿到最终 Cookie）=====
async function pollLogin(token) {
  gcSessions();
  const session = store.get(token);
  if (!session) return { status: 'error', msg: 'invalid token' };

  const now = Date.now();

  // 硬过期判定
  if (now > session.hardExpireAt) {
    session.status = 'expired';
    session.msg = '二维码已超时';
    safeDelete(token);
    return { status: 'expired', msg: session.msg };
  }

  // 无轮询过期（最后一次轮询距今 > 15s）
  if (now - (session.lastPollAt || session.createdAt) > IDLE_TTL) {
    session.status = 'expired';
    session.msg = '会话已空闲过久';
    safeDelete(token);
    return { status: 'expired', msg: session.msg };
  }

  // 通过过期检查，刷新 lastPollAt
  session.lastPollAt = now;

  if (!session.ptqrtoken) {
    safeDelete(token);
    return { status: 'error', msg: '请先获取二维码' };
  }

  // 还未拿到 checkSigUrl：先轮询 ptqrlogin
  if (!session.checkSigUrl) {
    const cookiesXui = await session.jar.getCookies('https://xui.ptlogin2.qq.com/');
    const loginSig = (cookiesXui.find((c) => c.key === 'pt_login_sig') || {}).value || '';

    const makeAction = () => `0-0-${Date.now()}`;
    const params = {
      u1: S_URL,
      ptqrtoken: String(session.ptqrtoken),
      ptredirect: '0',
      h: '1',
      t: '1',
      g: '1',
      from_ui: '1',
      ptlang: '2052',
      js_ver: '25100115',
      js_type: '1',
      login_sig: loginSig,
      pt_uistyle: '40',
      aid: String(APPID),
      daid: String(DAID),
      pt_3rd_aid: String(PT_3RD_AID),
      pt_js_version: '28d22679',
      action: makeAction(),
    };

    const res = await fetchWithSession(session, PTQRLOGIN_URL, {
      searchParams: params,
      headers: { Referer: XLOGIN_URL, Accept: '*/*' },
    });

    if (res.statusCode !== 200) {
      // 不立刻删除，让前端可重试
      return { status: 'error', msg: `轮询失败 HTTP ${res.statusCode}` };
    }

    let parsed;
    try { parsed = parsePtuiCB(res.body); }
    catch (e) { return { status: 'error', msg: '解析轮询失败: ' + e.message }; }

    if (parsed.code === '66') {
      session.status = 'waiting';
      return { status: 'waiting', msg: parsed.msg || '二维码未失效' };
    }
    if (parsed.code === '67') {
      session.status = 'confirming';
      return { status: 'confirming', msg: parsed.msg || '二维码认证中' };
    }
    if (parsed.code !== '0') {
      session.status = 'expired';
      session.msg = parsed.msg || '二维码已失效或被取消';
      safeDelete(token);
      return { status: 'expired', msg: session.msg };
    }

    // 登录成功，拿到 check_sig
    session.status = 'authed';
    session.checkSigUrl = parsed.url;
    // 继续向下 finalize（同一个请求内完成）
  }

  // 防止并发 finalize（同一 token 并发调用）
  if (session.lock) {
    return { status: 'confirming', msg: '登录确认中，请稍后重试' };
  }
  session.lock = true;

  try {
    // 完成 graph 落 cookie
    await fetchWithSession(session, session.checkSigUrl, {
      headers: {
        Referer: 'https://xui.ptlogin2.qq.com/',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
      maxRedirects: 8,
    });

    // 授权获取 code
    const graphCookies = await getCookieMapFor(session, 'https://graph.qq.com/');
    const p_skey = graphCookies['p_skey'] || '';
    const g_tk = p_skey ? calcGTK(p_skey) : 5381;
    const uiVal = await ensureUiCookie(session);
    const state = Math.random().toString(36).slice(2);
    const showUrl = GRAPH_SHOW_URL(state);

    await fetchWithSession(session, showUrl, {
      headers: {
        Referer: 'https://graph.qq.com/',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
    });

    const form = new URLSearchParams({
      response_type: 'code',
      client_id: String(PT_3RD_AID),
      redirect_uri: YQQ_REDIRECT_URI,
      scope: 'get_user_info,get_app_friends',
      state,
      switch: '',
      from_ptlogin: '1',
      src: '1',
      update_auth: '1',
      openapi: '1010_1030',
      g_tk: String(g_tk),
      auth_time: String(Date.now()),
      ui: uiVal,
    }).toString();

    const authRes = await fetchWithSession(session, GRAPH_AUTHORIZE_URL, {
      method: 'POST',
      body: form,
      headers: {
        Origin: 'https://graph.qq.com',
        Referer: showUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
      maxRedirects: 0,
    });

    if (![301, 302].includes(authRes.statusCode)) {
      session.status = 'error';
      session.msg = `authorize 非302: ${authRes.statusCode}`;
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }
    const loc = authRes.headers.location || '';
    const redirectUrl = new URL(loc, 'https://graph.qq.com').toString();
    const u = new URL(redirectUrl);
    const code = u.searchParams.get('code');
    if (!code) {
      session.status = 'error';
      session.msg = '未获取到 code';
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    // 访问 y.qq.com 回跳，建立站点上下文
    await ensureYqqContextCookies(session);
    await fetchWithSession(session, redirectUrl, {
      headers: {
        Referer: 'https://graph.qq.com/',
        'Upgrade-Insecure-Requests': '1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
      },
      maxRedirects: 5,
    });

    // 用 code 登录 QQ音乐，获取最终 Cookie
    await ensureYqqContextCookies(session);
    const payload = {
      comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
    };
    const resMusic = await fetchWithSession(session, U_YQQ_MUSICU, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Origin: YQQ_HOME,
        Referer: YQQ_HOME,
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      maxRedirects: 0,
    });

    if (resMusic.statusCode !== 200) {
      session.status = 'error';
      session.msg = `u.y.qq.com HTTP ${resMusic.statusCode}`;
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    let musicJson;
    try { musicJson = JSON.parse(resMusic.body); }
    catch (e) {
      session.status = 'error';
      session.msg = '解析音乐登录返回失败';
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    if (!(musicJson && musicJson.code === 0 && musicJson.req && musicJson.req.code === 0)) {
      session.status = 'error';
      session.msg = 'QQ音乐登录返回非0';
      safeDelete(token);
      return { status: 'error', msg: session.msg };
    }

    // 汇总最终 Cookie
    const graph = await getCookieMapFor(session, 'https://graph.qq.com/');
    const qqCom = await getCookieMapFor(session, 'https://qq.com/');
    const yqq = await getCookieMapFor(session, 'https://y.qq.com/');
    if (graph['p_skey']) graph['g_tk'] = calcGTK(graph['p_skey']);

    const final = {
      graphCookies: graph,
      musicData: musicJson.req?.data || {},
      qqComCookies: qqCom,
      yqqCookies: yqq,
    };

    session.status = 'done';
    // 两步策略：终态立即清理，避免会话堆积
    safeDelete(token);
    return { status: 'done', ...final };
  } catch (e) {
    session.status = 'error';
    session.msg = e.message || 'unknown';
    safeDelete(token);
    return { status: 'error', msg: session.msg };
  } finally {
    if (store.has(token)) {
      // 若未被 safeDelete（比如等待下次轮询），才释放锁
      const s = store.get(token);
      if (s) s.lock = false;
    }
  }
}

module.exports = { startLogin, pollLogin };

