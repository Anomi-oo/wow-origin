'use strict';

// Native fetch keeps Set-Cookie separate in both Node and Workers.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function responseSetCookies(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie') || ''];
  return values.flatMap((header) => header
    ? header.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)
    : []);
}

function responseCookies(headers) {
  const cookies = Object.create(null);
  for (const part of responseSetCookies(headers)) {
    const pair = part.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
}

async function loginFetch(url, options = {}, stage = '登录请求') {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://y.qq.com/', ...options.headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (response.status >= 400) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } catch (error) {
    // Fetch exceptions can contain credential-bearing URLs; only expose the stage.
    throw new Error(`${stage}失败${/^HTTP \d+$/.test(error.message) ? ` (${error.message})` : '，请稍后重试'}`);
  }
}

async function loginCgi(module, method, param, comm, userAgent) {
  const response = await loginFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
    body: JSON.stringify({
      comm: Object.fromEntries(Object.entries(comm).map(([key, value]) => [key, String(value)])),
      req_0: { module, method, param },
    }),
  }, method);
  const json = await response.json().catch(() => null);
  if (!json || json.code !== 0 || !json.req_0 || typeof json.req_0.code !== 'number') {
    throw new Error(`${method} 返回无效响应${Number.isFinite(json?.code) ? ` (${json.code})` : ''}`);
  }
  return json.req_0;
}

function loginError(code) {
  const messages = {
    1000: '登录凭证已过期', 104401: '登录凭证已过期', 104400: '登录凭证无效',
    20261: '登录参数错误', 20271: '验证码错误', 20272: '账号绑定异常', 20274: '账号尚未绑定',
    20277: '账号受限', 20278: '账号受限', 20279: '登录设备数量超限', 20450: '账号已被封禁',
    104604: '操作过于频繁，请稍后重试', 100001: '验证码发送过于频繁，请稍后重试',
  };
  return new Error(`${messages[code] || 'QQ 音乐登录失败'} (${code})`);
}

function credentialCookies(data) {
  const musicid = String(data?.str_musicid || data?.musicid || '');
  if (!/^[1-9]\d*$/.test(musicid) || !data?.musickey) throw new Error('QQ 音乐未返回有效登录凭证');
  const cookies = { uin: musicid, qm_keyst: data.musickey, musicid, musickey: data.musickey };
  for (const key of ['openid', 'unionid', 'access_token', 'refresh_token', 'refresh_key', 'expired_at', 'musickeyCreateTime', 'keyExpiresIn', 'loginType']) {
    if (data[key] !== undefined) cookies[key] = String(data[key]);
  }
  return cookies;
}

module.exports = { loginFetch, loginCgi, responseSetCookies, responseCookies, cookieHeader, credentialCookies, loginError };
