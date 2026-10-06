'use strict';

const { randomUUID } = require('node:crypto');
const { credentialCookies, loginError } = require('./login-http');
const { createAndroidLoginContextFromIdentity, bindAndroidLoginContext } = require('./android-login');
const sessions = new Map();
const cooldowns = new Map();
const sending = new Set();
const TTL = 10 * 60 * 1000;

function normalizePhone(phone, countryCode = '86') {
  phone = String(phone || '').trim();
  countryCode = String(countryCode || '').trim();
  if (!/^\d{6,15}$/.test(phone) || !/^[1-9]\d{0,3}$/.test(countryCode)) throw new Error('请输入有效的手机号和区号');
  return { phone, countryCode };
}

async function sendPhoneCode(phone, countryCode = '86', token = '', identityValue) {
  const normalized = normalizePhone(phone, countryCode);
  const now = Date.now();
  for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
  for (const [key, value] of cooldowns) if (value <= now) cooldowns.delete(key);
  const key = `${normalized.countryCode}:${normalized.phone}`;
  let session = sessions.get(token);
  if (token && !session) throw new Error('手机登录会话已失效，请重新获取验证码');
  if (session && session.key !== key) throw new Error('手机号已改变，请重新获取验证码');
  if (sending.has(key) || session?.busy) throw new Error('正在处理登录，请稍候');
  if (cooldowns.has(key)) return { status: 'frequency', ...(session ? { token } : {}), retryAfter: Math.ceil((cooldowns.get(key) - now) / 1000) };
  sending.add(key);
  try {
    if (!session) {
      const android = createAndroidLoginContextFromIdentity(identityValue);
      await android.ensureSession();
      token = randomUUID();
      session = { key, phone: normalized.phone, android, expiresAt: now + TTL, busy: false, sent: false };
      sessions.set(token, session);
    }
    session.busy = true;
    const result = await session.android.androidLoginCgi('music.login.LoginServer', 'SendPhoneAuthCode', {
      tmeAppid: 'qqmusic', areaCode: normalized.countryCode, phoneNo: normalized.phone,
    }, {}, { tmeLoginMethod: 3 });
    if (result.code === 20276) {
      const securityUrl = String(result.data?.securityURL || '');
      if (!/^https:\/\//i.test(securityUrl)) throw new Error('QQ 音乐要求安全验证，但未返回验证地址');
      session.sent = false;
      // No SMS was sent: keep the device session and allow retry immediately after verification.
      return { status: 'captcha', token, securityUrl, retryAfter: 0 };
    }
    if (result.code === 100001) {
      cooldowns.set(key, Date.now() + 60000);
      return { status: 'frequency', token, retryAfter: 60 };
    }
    if (result.code !== 0) throw loginError(result.code);
    session.sent = true;
    cooldowns.set(key, Date.now() + 60000);
    return { status: 'sent', token, retryAfter: 60 };
  } finally {
    sending.delete(key);
    if (session) session.busy = false;
  }
}

async function phoneLogin(token, code) {
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now() || !session.sent) throw new Error('手机登录会话已失效，请重新获取验证码');
  if (!/^\d{4,8}$/.test(String(code))) throw new Error('请输入有效的短信验证码');
  if (session.busy) throw new Error('正在登录，请稍候');
  session.busy = true;
  try {
    const result = await session.android.androidLoginCgi('music.login.LoginServer', 'Login', {
      phoneNo: session.phone, code: String(code), loginMode: 1,
    }, {}, { tmeLoginMethod: 3, tmeLoginType: 0 });
    if (result.code !== 0) throw loginError(result.code);
    const cookie = credentialCookies({ loginType: 0, ...result.data });
    if (session.cancelled) throw new Error('登录会话已取消');
    bindAndroidLoginContext(cookie.musicid, session.android);
    sessions.delete(token);
    return cookie;
  } finally { session.busy = false; }
}

function cancelPhoneLogin(token) {
  const session = sessions.get(token);
  if (session) { session.cancelled = true; cooldowns.delete(session.key); sending.delete(session.key); }
  sessions.delete(token);
}

module.exports = { cancelPhoneLogin, sendPhoneCode, phoneLogin };
