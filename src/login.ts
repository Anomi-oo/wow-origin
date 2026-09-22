import path from 'node:path';
import express, { NextFunction, Request, Response, Router } from 'express';
import {
  AccountSessionRegistry,
  type AccountStoreInput,
  createAccountWithCookie,
  generateAccountAccessKey,
  MusicAccountSession,
  updateAccountConfigByAccessKey,
  updateAccountCookieByAccessKey
} from './accounts';
import type { MusicPlatform } from './types';
import { BadRequestError, UpstreamError } from './errors';
import { qrCodeDataUrl } from './qr';

type ResourcePlatform = 'netease' | 'qqmusic';
type LoginMode = 'create' | 'update';

interface PendingLogin {
  mode: LoginMode;
  apiAccessKey: string;
  platform: MusicPlatform;
  createdAt: number;
}

interface PendingPhone extends PendingLogin {
  captchaUrl?: string;
}

interface PlatformFactoryLike {
  getPlatform(name: ResourcePlatform): {
    callModule(route: string, request: any): Promise<any>;
  };
}

interface LoginRouterOptions {
  registry: AccountSessionRegistry;
  platformFactory: PlatformFactoryLike;
  workDir?: string;
  accountStore?: AccountStoreInput;
  allowAccountLxSources?: boolean;
  onAccountsChanged?: () => void;
}

function normalizeLoginPlatform(value: unknown): MusicPlatform {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'qq' || platform === 'qqmusic') return 'qq';
  if (platform === 'netease') return 'netease';
  throw new BadRequestError('不支持的平台');
}

function toResourcePlatform(platform: MusicPlatform): ResourcePlatform {
  return platform === 'qq' ? 'qqmusic' : 'netease';
}

function serializeCookie(cookie: unknown): string {
  if (typeof cookie === 'string') return cookie.trim();
  if (Array.isArray(cookie)) {
    return cookie
      .map((item) => String(item || '').split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }
  if (cookie && typeof cookie === 'object') {
    return Object.entries(cookie as Record<string, unknown>)
      .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim())
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('; ');
  }
  return '';
}

async function callLoginModule(
  platformFactory: PlatformFactoryLike,
  platform: MusicPlatform,
  route: string,
  query: Record<string, unknown> = {}
): Promise<any> {
  const resourcePlatform = toResourcePlatform(platform);
  const source = platformFactory.getPlatform(resourcePlatform);
  const result = await source.callModule(route, {
    query: { ...query, platform: resourcePlatform, timestamp: Date.now() },
    body: {},
    ip: 'login-page',
    connection: { remoteAddress: 'login-page' }
  });
  if (!result || result.code !== 200) {
    throw new UpstreamError(result?.message || '登录接口调用失败');
  }
  return result;
}

function getQrPayload(platform: MusicPlatform, result: any): { token: string; qrImage: string; qrText: string } {
  const body = result?.body || {};
  const data = body?.data || {};
  const token = String(data.unikey || data.key || body.unikey || result.unikey || '').trim();
  const qrImage = String(data.qrImg || data.qrimg || result.qrImg || '').trim();
  const qrText = platform === 'netease' && token
    ? `https://music.163.com/login?codekey=${encodeURIComponent(token)}`
    : '';
  if (!token) throw new UpstreamError('二维码获取失败：未返回登录 token');
  return { token, qrImage, qrText };
}

function requireAccount(registry: AccountSessionRegistry, apiAccessKey: unknown): MusicAccountSession {
  const token = String(apiAccessKey || '').trim();
  if (!token) throw new BadRequestError('api_access_key 是必填参数');
  const session = registry.byAccessKey.get(token);
  if (!session) throw new BadRequestError('api_access_key 无效或账号不存在');
  return session;
}

function normalizeLoginMode(value: unknown): LoginMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'create' || mode === 'add' || mode === 'new') return 'create';
  if (mode === 'update') return 'update';
  throw new BadRequestError('登录模式无效');
}

function accountData(session: MusicAccountSession, allowAccountLxSources: boolean = true) {
  return {
    apiAccessKey: session.apiAccessKey,
    platform: session.platform,
    name: session.name,
    stateless: session.stateless,
    useLuoxue: session.useLuoxue,
    lxSource: allowAccountLxSources ? session.lxSource : []
  };
}

function sendLoginPage(_req: Request, res: Response): void {
  res.type('html').set('Cache-Control', 'no-store').sendFile(
    path.join(__dirname, '..', 'public', 'index.html')
  );
}

async function resolveLoggedInAccountName(
  platform: MusicPlatform,
  cookie: string,
  platformFactory: PlatformFactoryLike
): Promise<string> {
  try {
    const result = await callLoginModule(platformFactory, platform, 'user/detail', parseLoginCookie(cookie));
    const profile = result.body || result;
    return String(profile.nickname || '').trim();
  } catch (error) {
    throw new UpstreamError(`登录成功但获取用户昵称失败: ${(error as Error).message}`);
  }
}

function parseLoginCookie(value: string): Record<string, string> {
  return Object.fromEntries(value.split(';').flatMap((part) => {
    const index = part.indexOf('=');
    return index > 0 ? [[part.slice(0, index).trim(), part.slice(index + 1).trim()]] : [];
  }));
}

function normalizeManualCookie(platform: MusicPlatform, value: unknown): Record<string, string> {
  if (typeof value !== 'string' || !value.trim() || value.length > 16384 || /[\r\n\0]/.test(value)) {
    throw new BadRequestError('请粘贴有效的 Cookie');
  }
  const cookies = parseLoginCookie(value.trim().replace(/^cookie:\s*/i, ''));
  if (platform === 'qq') {
    cookies.uin = (cookies.qqmusic_uin || cookies.musicid || cookies.uin || '').replace(/^o0*/, '');
    cookies.qm_keyst = cookies.qqmusic_key || cookies.musickey || cookies.qm_keyst || '';
    if (!/^[1-9]\d*$/.test(cookies.uin) || !cookies.qm_keyst) throw new BadRequestError('QQ Cookie 缺少账号 ID 或登录凭证');
  } else if (!cookies.MUSIC_U) throw new BadRequestError('网易云 Cookie 缺少 MUSIC_U');
  return cookies;
}

const QQ_CAPTCHA_HOSTS = new Set(['c.y.qq.com', 'y.qq.com']);
const MAX_CAPTCHA_HTML_BYTES = 512 * 1024;
const MAX_QQ_BOOTSTRAP_BYTES = 384 * 1024;

function normalizeQqCaptchaUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new UpstreamError('QQ 安全验证地址无效');
  }
  if (url.protocol !== 'https:' || !QQ_CAPTCHA_HOSTS.has(url.hostname) || (url.port && url.port !== '443') || url.username || url.password) {
    throw new UpstreamError('QQ 安全验证地址无效');
  }
  return url.href;
}

function qqBootstrapScript(html: string): { tag: string; url: string } {
  const match = html.match(/<script\b[^>]*\bsrc=(['"])([^'"]*\/lib\/commercial\/h5\/music-[^'"]+\.min\.js[^'"]*)\1[^>]*>\s*<\/script>/i);
  if (!match) throw new UpstreamError('QQ 安全验证页面缺少启动脚本');
  const url = new URL(match[2], 'https://y.qq.com');
  if (url.protocol !== 'https:' || url.hostname !== 'y.qq.com' || url.port || !/^\/lib\/commercial\/h5\/music-[^/]+\.min\.js$/.test(url.pathname)) {
    throw new UpstreamError('QQ 安全验证启动脚本地址无效');
  }
  return { tag: match[0], url: url.href };
}

function patchQqBootstrapScript(script: string): string {
  const patched = script.replace(
    /location\.href\s*=\s*location\.protocol\s*\+\s*(['"])\/\/m\.y\.qq\.com\/\?ADTAG=hostname_err\1/g,
    'void 0'
  );
  if (patched.includes('ADTAG=hostname_err')) throw new UpstreamError('QQ 安全验证启动脚本格式已变化');
  return patched.replace(/<\/script/gi, '<\\/script');
}

function rewriteQqCaptchaHtml(html: string, captchaUrl: string, bootstrapTag: string, bootstrapScript: string): string {
  const bootstrap = '<script>window.allowIframe=true</script>';
  const head = /<head(?:\s[^>]*)?>/i;
  const injected = head.test(html)
    ? html.replace(head, (value) => `${value}${bootstrap}`)
    : `${bootstrap}${html}`;
  return injected.replace(bootstrapTag, `<script>${patchQqBootstrapScript(bootstrapScript)}</script>`).replace(
    /verifyUrl\s*:\s*window\.location\.href/g,
    `verifyUrl: ${JSON.stringify(captchaUrl)}`
  );
}

export function createLoginRouter({
  registry,
  platformFactory,
  workDir,
  accountStore,
  allowAccountLxSources = true,
  onAccountsChanged
}: LoginRouterOptions): Router {
  const router = express.Router();
  const pendingLogins = new Map<string, PendingLogin>();
  const pendingPhones = new Map<string, PendingPhone>();
  const checking = new Set<string>();
  const storage = accountStore ?? workDir;

  function loginTarget(body: any): PendingLogin {
    const mode = normalizeLoginMode(body?.mode);
    if (mode === 'update') {
      const session = requireAccount(registry, body?.api_access_key);
      if (body?.platform !== undefined && normalizeLoginPlatform(body.platform) !== session.platform) {
        throw new BadRequestError('更新已有账号时不能修改平台');
      }
      return { mode, platform: session.platform, apiAccessKey: session.apiAccessKey, createdAt: Date.now() };
    }
    return { mode, platform: normalizeLoginPlatform(body?.platform), apiAccessKey: generateAccountAccessKey(registry, storage), createdAt: Date.now() };
  }

  async function saveLogin(target: PendingLogin, cookie: string, verifiedName?: string) {
    if (!cookie) throw new UpstreamError('登录成功但未获取到有效 cookie');
    const { mode, platform, apiAccessKey } = target;
    const result = mode === 'update'
      ? updateAccountCookieByAccessKey(apiAccessKey, platform, cookie, registry, storage)
      : createAccountWithCookie(apiAccessKey, platform, cookie, registry, storage,
        verifiedName ?? await resolveLoggedInAccountName(platform, cookie, platformFactory));
    onAccountsChanged?.();
    return { status: 'success', mode, ...accountData(result.session, allowAccountLxSources), accountName: result.session.name, message: '登录成功' };
  }

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [token, pending] of pendingLogins) if (now - pending.createdAt > 180000) pendingLogins.delete(token);
    for (const [token, pending] of pendingPhones) if (now - pending.createdAt > 600000) pendingPhones.delete(token);
    next();
  });

  function getPendingLogin(token: unknown): { token: string; pending: PendingLogin } {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) throw new BadRequestError('token 是必填参数');
    const pending = pendingLogins.get(normalizedToken);
    if (!pending) throw new BadRequestError('登录二维码不存在或已失效');
    return { token: normalizedToken, pending };
  }

  router.get('/', sendLoginPage);

  router.post('/api/verify-key', (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = requireAccount(registry, req.body?.api_access_key);
      res.json({ code: 200, data: { ...accountData(session, allowAccountLxSources), accountName: session.name, message: '验证成功' } });
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/account/config', (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = requireAccount(registry, req.body?.api_access_key);
      const result = updateAccountConfigByAccessKey(session.apiAccessKey, {
        name: req.body?.name,
        stateless: req.body?.stateless,
        useLuoxue: req.body?.useLuoxue,
        lxSource: allowAccountLxSources ? req.body?.lxSource : []
      }, registry, storage);
      onAccountsChanged?.();
      res.json({ code: 200, data: { ...accountData(result.session, allowAccountLxSources), message: '配置已保存' } });
    } catch (error) {
      next(error instanceof BadRequestError ? error : new BadRequestError((error as Error).message));
    }
  });

  router.post('/api/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { mode, platform, apiAccessKey } = loginTarget(req.body);

      const result = await callLoginModule(platformFactory, platform, 'login/qr/key');
      const qr = getQrPayload(platform, result);
      const qrImage = qr.qrImage || (qr.qrText
        ? qrCodeDataUrl(qr.qrText)
        : '');
      pendingLogins.set(qr.token, { mode, apiAccessKey, platform, createdAt: Date.now() });
      res.json({
        code: 200,
        data: { mode, platform, apiAccessKey, token: qr.token, qrImage, qrText: qr.qrText }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/check', async (req: Request, res: Response, next: NextFunction) => {
    let activeToken = '';
    try {
      const { token, pending } = getPendingLogin(req.body?.token);
      if (checking.has(token)) {
        res.json({ code: 200, data: { status: 'confirming', message: '登录确认中' } });
        return;
      }
      checking.add(token);
      activeToken = token;
      const { mode, apiAccessKey, platform } = pending;
      const result = await callLoginModule(platformFactory, platform, 'login/qr/check', { key: token });
      const body = result?.body || {};
      const code = Number(body.code || 0);
      const message = String(body.message || body.msg || '');

      if (code === 803) {
        const cookie = serializeCookie(result.cookie);
        const data = await saveLogin(pending, cookie);
        pendingLogins.delete(token);
        res.json({ code: 200, data });
        return;
      }

      const status = code === 800 ? 'expired' : code === 802 ? 'confirming' : code === 801 ? 'waiting' : 'error';
      if (status === 'expired' || status === 'error') pendingLogins.delete(token);
      res.json({
        code: 200,
        data: {
          status,
          mode,
          platform,
          apiAccessKey,
          message: message || (status === 'waiting' ? '等待扫码' : '请在客户端确认登录')
        }
      });
    } catch (error) {
      next(error);
    } finally {
      if (activeToken) checking.delete(activeToken);
    }
  });

  router.post('/api/cookie', async (req, res, next) => {
    try {
      const target = loginTarget(req.body);
      const values = normalizeManualCookie(target.platform, req.body?.cookie);
      const result = await callLoginModule(platformFactory, target.platform,
        target.platform === 'qq' ? 'login/cookie' : 'user/detail', values);
      const profile = result.body || result;
      if (target.platform === 'netease' && !profile.userId) throw new BadRequestError('网易云 Cookie 无效或已过期');
      res.json({ code: 200, data: await saveLogin(target, serializeCookie(values), String(profile.nickname || '')) });
    } catch (error) { next(error); }
  });

  router.post('/api/phone/send', async (req, res, next) => {
    try {
      let target = loginTarget(req.body);
      const phone = String(req.body?.phone || '').trim();
      const countryCode = String(req.body?.countryCode || '86').trim();
      if (!/^\d{6,15}$/.test(phone) || !/^[1-9]\d{0,3}$/.test(countryCode)) throw new BadRequestError('请输入有效的手机号和区号');
      const token = String(req.body?.token || '');
      if (token) {
        const previous = pendingPhones.get(token);
        if (!previous || previous.platform !== target.platform || previous.mode !== target.mode || (target.mode === 'update' && previous.apiAccessKey !== target.apiAccessKey)) {
          throw new BadRequestError('手机登录会话已失效，请重新获取验证码');
        }
        target = previous;
      }
      const result = await callLoginModule(platformFactory, target.platform, 'login/phone/send', { phone, countryCode, token });
      const data = result.body;
      if (!data || !['sent', 'captcha', 'frequency'].includes(data.status)) throw new UpstreamError('验证码发送返回无效状态');
      const sessionToken = String(data.token || token || '').trim();
      const captchaUrl = data.status === 'captcha' ? normalizeQqCaptchaUrl(data.securityUrl) : undefined;
      if (data.status === 'captcha' && (target.platform !== 'qq' || !sessionToken)) {
        throw new UpstreamError('QQ 安全验证会话无效');
      }
      if (sessionToken) pendingPhones.set(sessionToken, { ...target, captchaUrl });
      const responseData = { ...data, token: sessionToken || data.token };
      delete responseData.securityUrl;
      if (captchaUrl) responseData.securityPath = `/login/api/phone/captcha?token=${encodeURIComponent(sessionToken)}`;
      res.json({ code: 200, data: responseData });
    } catch (error) { next(error); }
  });

  router.get('/api/phone/captcha', async (req, res, next) => {
    try {
      const token = String(req.query?.token || '').trim();
      const pending = pendingPhones.get(token);
      if (!token || !pending?.captchaUrl || pending.platform !== 'qq') {
        throw new BadRequestError('QQ 安全验证会话不存在或已失效');
      }
      const captchaUrl = normalizeQqCaptchaUrl(pending.captchaUrl);
      const upstream = await fetch(captchaUrl, {
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36'
        }
      });
      if (!upstream.ok) throw new UpstreamError(`QQ 安全验证页面加载失败 (${upstream.status})`);
      if (upstream.url) normalizeQqCaptchaUrl(upstream.url);
      const declaredLength = Number(upstream.headers?.get?.('content-length') || 0);
      if (declaredLength > MAX_CAPTCHA_HTML_BYTES) throw new UpstreamError('QQ 安全验证页面过大');
      const html = await upstream.text();
      if (Buffer.byteLength(html, 'utf8') > MAX_CAPTCHA_HTML_BYTES) throw new UpstreamError('QQ 安全验证页面过大');
      const bootstrap = qqBootstrapScript(html);
      const scriptResponse = await fetch(bootstrap.url, {
        redirect: 'follow',
        headers: {
          Accept: 'application/javascript,text/javascript,*/*;q=0.1',
          'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36'
        }
      });
      if (!scriptResponse.ok) throw new UpstreamError(`QQ 安全验证启动脚本加载失败 (${scriptResponse.status})`);
      if (scriptResponse.url && scriptResponse.url !== bootstrap.url) {
        const redirected = new URL(scriptResponse.url);
        if (redirected.protocol !== 'https:' || redirected.hostname !== 'y.qq.com' || redirected.pathname !== new URL(bootstrap.url).pathname) {
          throw new UpstreamError('QQ 安全验证启动脚本重定向地址无效');
        }
      }
      const scriptLength = Number(scriptResponse.headers?.get?.('content-length') || 0);
      if (scriptLength > MAX_QQ_BOOTSTRAP_BYTES) throw new UpstreamError('QQ 安全验证启动脚本过大');
      const bootstrapScript = await scriptResponse.text();
      if (Buffer.byteLength(bootstrapScript, 'utf8') > MAX_QQ_BOOTSTRAP_BYTES) throw new UpstreamError('QQ 安全验证启动脚本过大');
      res.status(200).type('html').set({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src https: 'unsafe-inline' 'unsafe-eval' blob:; style-src https: 'unsafe-inline'; img-src https: data: blob:; connect-src https:; font-src https: data:; worker-src https: blob:; frame-src https:; form-action https:; base-uri 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
      }).send(rewriteQqCaptchaHtml(html, captchaUrl, bootstrap.tag, bootstrapScript));
    } catch (error) { next(error); }
  });

  router.post('/api/phone/check', async (req, res, next) => {
    const token = String(req.body?.token || '');
    let active = false;
    try {
      const pending = pendingPhones.get(token);
      if (!pending) throw new BadRequestError('手机登录会话已失效，请重新获取验证码');
      if (req.body?.platform !== undefined && normalizeLoginPlatform(req.body.platform) !== pending.platform) {
        throw new BadRequestError('平台与手机登录会话不匹配');
      }
      if (pending.mode === 'update') {
        const session = requireAccount(registry, req.body?.api_access_key);
        if (session.apiAccessKey !== pending.apiAccessKey) throw new BadRequestError('账号与手机登录会话不匹配');
      }
      const code = String(req.body?.code || '').trim();
      if (!/^\d{4,8}$/.test(code)) throw new BadRequestError('请输入有效的短信验证码');
      if (checking.has(token)) throw new BadRequestError('正在登录，请稍候');
      checking.add(token);
      active = true;
      const result = await callLoginModule(platformFactory, pending.platform, 'login/phone/check', { token, code });
      const data = await saveLogin(pending, serializeCookie(result.cookie), result.body?.nickname);
      pendingPhones.delete(token);
      res.json({ code: 200, data });
    } catch (error) { next(error); }
    finally { if (active) checking.delete(token); }
  });

  return router;
}
