import path from 'node:path';
import express, { NextFunction, Request, Response, Router } from 'express';
import QRCode from 'qrcode';
import {
  AccountSessionRegistry,
  createAccountWithCookie,
  generateAccountAccessKey,
  MusicAccountSession,
  updateAccountConfigByAccessKey,
  updateAccountCookieByAccessKey
} from './accounts';
import type { MusicPlatform } from './types';
import { createMusicClient } from './adapter';
import { BadRequestError, UpstreamError } from './errors';

type ResourcePlatform = 'netease' | 'qqmusic';
type LoginMode = 'create' | 'update';

interface PendingLogin {
  mode: LoginMode;
  apiAccessKey: string;
  platform: MusicPlatform;
  createdAt: number;
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
  route: 'login/qr/key' | 'login/qr/check',
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
    throw new UpstreamError(result?.message || '扫码登录接口调用失败');
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
  if (!session) throw new BadRequestError('api_access_key 无效或未注册到 accounts.json');
  return session;
}

function normalizeLoginMode(value: unknown): LoginMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'create' || mode === 'add' || mode === 'new') return 'create';
  if (mode === 'update') return 'update';
  throw new BadRequestError('登录模式无效');
}

function accountData(session: MusicAccountSession) {
  return {
    apiAccessKey: session.apiAccessKey,
    platform: session.platform,
    name: session.name,
    stateless: session.stateless,
    useLuoxue: session.useLuoxue,
    lxSource: session.lxSource
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
  const globalScope = globalThis as any;
  const previousFactory = globalScope.__musicPlatformFactory__;
  globalScope.__musicPlatformFactory__ = platformFactory;
  try {
    try {
      const profile = await createMusicClient(platform, cookie).getUserMe();
      return String(profile.nickname || '').trim();
    } catch (error) {
      throw new UpstreamError(`登录成功但获取用户昵称失败: ${(error as Error).message}`);
    }
  } finally {
    if (previousFactory === undefined) delete globalScope.__musicPlatformFactory__;
    else globalScope.__musicPlatformFactory__ = previousFactory;
  }
}

export function createLoginRouter({
  registry,
  platformFactory,
  workDir,
  onAccountsChanged
}: LoginRouterOptions): Router {
  const router = express.Router();
  const pendingLogins = new Map<string, PendingLogin>();

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
      res.json({ code: 200, data: { ...accountData(session), accountName: session.name, message: '验证成功' } });
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
        lxSource: req.body?.lxSource
      }, registry, workDir);
      onAccountsChanged?.();
      res.json({ code: 200, data: { ...accountData(result.session), message: '配置已保存' } });
    } catch (error) {
      next(error instanceof BadRequestError ? error : new BadRequestError((error as Error).message));
    }
  });

  router.post('/api/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mode = normalizeLoginMode(req.body?.mode);
      let platform: MusicPlatform;
      let apiAccessKey: string;
      if (mode === 'update') {
        const session = requireAccount(registry, req.body?.api_access_key);
        if (req.body?.platform !== undefined && normalizeLoginPlatform(req.body.platform) !== session.platform) {
          throw new BadRequestError('更新已有账号时不能修改平台');
        }
        platform = session.platform;
        apiAccessKey = session.apiAccessKey;
      } else {
        platform = normalizeLoginPlatform(req.body?.platform);
        apiAccessKey = generateAccountAccessKey(registry, workDir);
      }

      const result = await callLoginModule(platformFactory, platform, 'login/qr/key');
      const qr = getQrPayload(platform, result);
      const qrImage = qr.qrImage || (qr.qrText
        ? await QRCode.toDataURL(qr.qrText, { width: 320, margin: 1, errorCorrectionLevel: 'H' })
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
    try {
      const { token, pending } = getPendingLogin(req.body?.token);
      const { mode, apiAccessKey, platform } = pending;
      const result = await callLoginModule(platformFactory, platform, 'login/qr/check', { key: token });
      const body = result?.body || {};
      const code = Number(body.code || 0);
      const message = String(body.message || body.msg || '');

      if (code === 803) {
        pendingLogins.delete(token);
        const cookie = serializeCookie(result.cookie);
        if (!cookie) throw new UpstreamError('登录成功但未获取到有效 cookie');
        const writeResult = mode === 'update'
          ? updateAccountCookieByAccessKey(apiAccessKey, platform, cookie, registry, workDir)
          : createAccountWithCookie(
            apiAccessKey,
            platform,
            cookie,
            registry,
            workDir,
            await resolveLoggedInAccountName(platform, cookie, platformFactory)
          );
        onAccountsChanged?.();
        res.json({
          code: 200,
          data: {
            status: 'success',
            mode,
            ...accountData(writeResult.session),
            accountName: writeResult.session.name,
            message: '登录成功'
          }
        });
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
    }
  });

  return router;
}
