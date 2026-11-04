const BasePlatform = require('../base/BasePlatform');
const { createRequest } = require('./util/request');
const { cryptoMd5, calculateMid, randomString } = require('./util');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { getEditionConfig } = require('./util/edition');

function cookies(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  return Object.fromEntries((Array.isArray(value) ? value : String(value || '').split(';')).flatMap(part => {
    const item = String(part).split(';')[0].trim();
    const at = item.indexOf('=');
    return at > 0 ? [[item.slice(0, at), item.slice(at + 1)]] : [];
  }));
}

/** Reuse upstream modules without its HTTP server, global login state or URL cache. */
class KugouPlatform extends BasePlatform {
  constructor(config = {}) { super({ ...config, name: 'kugou', enableCache: false }); }
  async doInitialize() {
    await this.loadModules(globalThis.__wowPlatformModules__ ? '' : path.join(__dirname, 'module'));
    for (const name of ['login/phone/send', 'login/phone/check', 'login/refresh', 'login/cookie']) this.modules.set(name, () => {});
  }
  createRequestFunction() { return createRequest; }
  async invoke(route, params) {
    try {
      const fn = this.modules.get(route);
      if (!fn) throw new Error(`Unsupported Kugou module: ${route}`);
      const result = await fn(params, createRequest);
      if (!result) throw new Error('酷狗接口未返回响应');
      const body = result.body || {};
      if (Number(result.status || 200) >= 400 || (body.status !== undefined && Number(body.status) !== 1 && Number(body.status) !== 200) || Number(body.error_code || 0) !== 0) throw result;
      return result;
    } catch (error) {
      // The request wrapper nests Axios errors in body.msg. Extract safe fields only;
      // Axios config/request and raw messages may contain phone numbers and tokens.
      const body = error?.body || {};
      const transport = body.msg && typeof body.msg === 'object' ? body.msg : error;
      const response = transport?.response;
      const upstream = response?.data && typeof response.data === 'object' ? response.data : body;
      const upstreamCode = Number(upstream.error_code);
      const networkCode = typeof transport?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(transport.code) ? transport.code : undefined;
      const httpStatus = Number(response?.status);
      const details = { route };
      if (Number.isFinite(upstreamCode) && upstreamCode !== 0) details.upstreamCode = upstreamCode;
      if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) details.httpStatus = httpStatus;
      const businessMessage = [upstream.error, upstream.errmsg, upstream.message, upstream.msg].find(value => typeof value === 'string' && value.trim());
      const isTransport = networkCode || transport?.config || transport?.request || response;
      const message = businessMessage || (networkCode ? `网络请求失败（${networkCode}）` : details.httpStatus ? `上游 HTTP ${details.httpStatus}` : isTransport ? '网络请求失败' : error instanceof Error ? error.message : '酷狗接口请求失败');
      const failure = new Error(`${route}：${message}${details.upstreamCode ? `（上游错误码 ${details.upstreamCode}）` : ''}`);
      failure.upstreamCode = details.upstreamCode;
      failure.diagnostics = { code: networkCode || 'KUGOU_UPSTREAM_ERROR', details };
      throw failure;
    }
  }
  async device(cookie) {
    const result = { ...cookie };
    if (!result.KUGOU_API_GUID) result.KUGOU_API_GUID = cryptoMd5(randomUUID());
    result.KUGOU_API_MID ||= calculateMid(result.KUGOU_API_GUID);
    result.KUGOU_API_DEV ||= randomString(10).toUpperCase();
    result.KUGOU_API_MAC ||= '02:00:00:00:00:00';
    result.KUGOU_API_PLATFORM = getEditionConfig(result).edition;
    if (!result.dfid || result.dfid === '-') {
      const registered = await this.invoke('register/dev', { cookie: result });
      Object.assign(result, cookies(registered.cookie));
      if (!result.dfid) throw new Error('酷狗设备注册未返回 dfid');
    }
    return result;
  }
  async callModule(route, req) {
    try {
      const input = { ...req.query, ...req.body };
      delete input.platform; // Wow platform is not the upstream device platform (ios/android).
      let cookie = cookies(input.cookie);
      // A phone session token belongs to Wow, never to the upstream account.
      if (route.startsWith('login/phone/')) delete input.token;
      for (const key of ['token', 'userid', 'dfid', 't1', 'vip_type', 'vip_token', 'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC', 'KUGOU_API_WEBGL']) if (input[key]) cookie[key] = String(input[key]);
      if (input.KUGOU_API_PLATFORM !== undefined) cookie.KUGOU_API_PLATFORM = input.KUGOU_API_PLATFORM;
      cookie.KUGOU_API_PLATFORM = getEditionConfig(cookie).edition;
      if (['login/qr/key', 'login/phone/send', 'login/cookie'].includes(route)) cookie = await this.device(cookie);
      const params = { ...input, cookie };
      let result;
      if (route === 'login/qr/key') {
        result = await this.invoke(route, params);
        const key = String(result.body?.data?.qrcode || result.body?.data?.key || '');
        if (!key) throw new Error('酷狗未返回二维码 key');
        const qr = await this.invoke('login/qr/create', { ...params, key, qrimg: true });
        return { code: 200, body: { data: { key, qrImg: qr.body?.data?.base64 } }, cookie };
      }
      if (route === 'login/qr/check') {
        result = await this.invoke(route, params);
        const status = Number(result.body?.data?.status);
        const code = ({ 0: 800, 1: 801, 2: 802, 4: 803 })[status] || 500;
        const merged = { ...cookie, ...cookies(result.cookie) };
        if (code === 803 && (!merged.token || ['undefined', 'null'].includes(merged.token) || !/^[1-9]\d*$/.test(String(merged.userid)))) throw new Error('酷狗扫码成功但未返回登录凭据');
        return { code: 200, body: { code }, cookie: merged };
      }
      if (route === 'login/phone/send') {
        await this.invoke('captcha/sent', { ...params, mobile: input.phone });
        return { code: 200, body: { status: 'sent', token: randomUUID(), message: '验证码已发送' }, cookie };
      }
      if (route === 'login/phone/check') {
        result = await this.invoke('login/cellphone', { ...params, mobile: input.phone });
      } else if (route === 'login/refresh') {
        result = await this.invoke('login/token', params);
      } else if (route === 'login/cookie') {
        result = await this.invoke('user/detail', params);
      } else if (route !== 'login/phone/check') {
        result = await this.invoke(route, params);
      }
      const merged = { ...cookie, ...cookies(result.cookie) };
      if (['login/phone/check', 'login/refresh'].includes(route) && (!merged.token || ['undefined', 'null'].includes(merged.token) || !/^[1-9]\d*$/.test(String(merged.userid)))) throw new Error('酷狗登录未返回有效凭据，可能需要选择手机号关联账号');
      const body = result.body || {};
      const data = body.data || body;
      const profile = data.userinfo || data.user_info || data;
      if (route === 'user/detail' || route === 'login/cookie') {
        return { code: 200, body: { ...body, userId: profile.userid || cookie.userid, nickname: profile.nickname || profile.username || '' }, cookie: merged };
      }
      if (route === 'login/phone/check') return { code: 200, body: { ...body, nickname: profile.nickname || profile.username }, cookie: merged };
      return { code: 200, body, cookie: merged };
    } catch (error) {
      // Do not log upstream HTTP errors: their config contains account credentials.
      const body = error?.body || {};
      const code = error?.upstreamCode ?? body.error_code;
      const message = typeof body.error === 'string' ? body.error : typeof body.msg === 'string' ? body.msg : error instanceof Error ? error.message : '酷狗请求失败';
      return { code: 502, message: `酷狗：${message}`, data: null, upstreamCode: code, diagnostics: error?.diagnostics, stalePlaylist: /歌单不存在|歌单已删除|playlist (?:does not exist|not found)/i.test(message) };
    }
  }
}
module.exports = KugouPlatform;
