'use strict';

// Protocol reference: NeteaseCloudMusicApiEnhanced captcha_sent / login_cellphone.
const { randomUUID } = require('node:crypto');
const { weapi } = require('./crypto');
const sessions = new Map();
const cooldowns = new Map();
const TTL = 10 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function readCookies(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  const cookies = Object.create(null);
  for (const value of values) {
    // Workerd may combine Set-Cookie; an Expires date also contains a comma.
    for (const part of value.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)) {
      const pair = part.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    }
  }
  return cookies;
}

async function loginRequest(path, data, cookies, stage) {
  let response;
  try {
    response = await fetch(`https://music.163.com/weapi/${path}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA, Referer: 'https://music.163.com/',
        Cookie: Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; '),
      },
      body: new URLSearchParams(weapi({ ...data, csrf_token: cookies.__csrf || '' })).toString(),
    });
  } catch {
    // Never include the phone, OTP, request body or Cookie in errors/logs.
    throw new Error(`网易云${stage}请求失败，请稍后重试`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`网易云${stage}请求失败 (HTTP ${response.status})`);
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body.code !== 'number') throw new Error(`网易云${stage}返回无效响应`);
  const received = readCookies(response.headers);
  Object.assign(cookies, received);
  if (body.code !== 200) {
    const messages = {
      400: '手机号或验证码无效', 501: '手机号尚未注册', 502: '登录凭证校验失败',
      503: '验证码错误或已过期', 405: '操作过于频繁，请稍后重试',
    };
    throw new Error(`网易云${messages[body.code] || `${stage}失败，请尝试扫码或 Cookie 登录`} (${body.code})`);
  }
  return { body, cookie: received };
}

async function sendPhoneCode(phone, countryCode = '86', token = '') {
  phone = String(phone || '').trim();
  countryCode = String(countryCode || '').trim();
  if (!/^\d{6,15}$/.test(phone) || !/^[1-9]\d{0,3}$/.test(countryCode)) throw new Error('请输入有效的手机号和区号');
  const now = Date.now();
  for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
  for (const [key, value] of cooldowns) if (value <= now) cooldowns.delete(key);
  const key = `${countryCode}:${phone}`;
  let session = sessions.get(token);
  if (token && !session) throw new Error('手机登录会话已失效，请重新获取验证码');
  if (session && session.key !== key) throw new Error('手机号已改变，请重新获取验证码');
  if (session?.busy) throw new Error('正在处理登录，请稍候');
  if (cooldowns.has(key)) return { status: 'frequency', ...(session ? { token } : {}), retryAfter: Math.ceil((cooldowns.get(key) - now) / 1000) };
  cooldowns.set(key, now + 60000);
  if (!session) {
    token = randomUUID();
    session = { key, phone, countryCode, expiresAt: now + TTL, busy: false, cookies: { os: 'pc', appver: '3.1.19.204510' } };
  }
  session.busy = true;
  try {
    const { body } = await loginRequest('sms/captcha/sent', {
      ctcode: countryCode, cellphone: phone, secrete: 'music_middleuser_pclogin',
    }, session.cookies, '发送验证码');
    if (body.data !== true) throw new Error('网易云未确认发送验证码，请稍后重试');
    session.expiresAt = Date.now() + TTL;
    sessions.set(token, session);
    return { status: 'sent', token, retryAfter: 60 };
  } finally { session.busy = false; }
}

async function phoneLogin(token, code) {
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    throw new Error('手机登录会话已失效，请重新获取验证码');
  }
  if (!/^\d{4,8}$/.test(String(code))) throw new Error('请输入有效的短信验证码');
  if (session.busy) throw new Error('正在登录，请稍候');
  session.busy = true;
  try {
    const result = await loginRequest('w/login/cellphone', {
      type: '1', https: 'true', phone: session.phone, countrycode: session.countryCode,
      captcha: String(code), remember: 'true', secureCaptcha: '',
    }, session.cookies, '手机号登录');
    if (!result.cookie.MUSIC_U) throw new Error('网易云未返回有效登录凭证');
    sessions.delete(token);
    return { cookie: { ...session.cookies }, body: { nickname: String(result.body.profile?.nickname || '') } };
  } finally { session.busy = false; }
}

module.exports = { sendPhoneCode, phoneLogin };
