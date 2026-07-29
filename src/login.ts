import express, { NextFunction, Request, Response, Router } from 'express';
import {
  AccountSessionRegistry,
  createAccountWithCookie,
  generateAccountAccessKey,
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
    query: {
      ...query,
      platform: resourcePlatform,
      timestamp: Date.now()
    },
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

  if (!token) {
    throw new UpstreamError('二维码获取失败：未返回登录 token');
  }

  return { token, qrImage, qrText };
}

function requireAccount(registry: AccountSessionRegistry, apiAccessKey: unknown): string {
  const token = String(apiAccessKey || '').trim();
  if (!token) {
    throw new BadRequestError('api_access_key 是必填参数');
  }
  if (!registry.byAccessKey.has(token)) {
    throw new BadRequestError('api_access_key 无效或未注册到 accounts.json');
  }
  return token;
}

function normalizeLoginMode(value: unknown): LoginMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'create' || mode === 'add' || mode === 'new') return 'create';
  if (mode === 'update') return 'update';
  throw new BadRequestError('登录模式无效');
}

function sendLoginPage(_req: Request, res: Response): void {
  res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>音乐源扫码登录</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
</head>
<body class="min-h-screen bg-neutral-950 text-neutral-100">
  <main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-8" x-data="loginPage()" x-init="init()">
    <section class="space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-normal">扫码登录</h1>
        <p class="mt-2 text-sm text-neutral-400">选择新增账号或更新已有账号，然后用对应客户端扫码登录。</p>
      </div>

      <template x-if="step === 'choose'">
        <div class="space-y-3">
          <button type="button"
            class="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400"
            @click="chooseCreate()">以新账号添加</button>
          <button type="button"
            class="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800"
            @click="chooseUpdate()">更新已存在账号</button>
        </div>
      </template>

      <template x-if="step === 'verify'">
        <div class="space-y-4">
          <label class="block space-y-2">
            <span class="text-sm text-neutral-300">api_access_key</span>
            <input type="text" x-model.trim="apiKey"
              class="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-emerald-400"
              placeholder="请输入已存在账号的 key"
              @keydown.enter.prevent="verifyKey()">
          </label>
          <div class="grid grid-cols-[auto_1fr] gap-2">
            <button type="button"
              class="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800"
              @click="backToChoose()">返回</button>
            <button type="button"
              class="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
              :disabled="loading || !apiKey"
              @click="verifyKey()">
              <span x-text="loading ? '正在验证...' : '验证'"></span>
            </button>
          </div>
          <p class="min-h-5 text-center text-sm" :class="status === 'error' ? 'text-red-300' : 'text-neutral-400'" x-text="message"></p>
        </div>
      </template>

      <template x-if="step === 'scan'">
        <div class="space-y-6">
          <div class="grid grid-cols-2 gap-2 rounded-lg bg-neutral-900 p-1">
            <button type="button" class="rounded-md px-3 py-2 text-sm font-medium transition"
              :class="platform === 'qq' ? 'bg-white text-neutral-950' : 'text-neutral-300 hover:bg-neutral-800'"
              @click="setPlatform('qq')">QQ 音乐</button>
            <button type="button" class="rounded-md px-3 py-2 text-sm font-medium transition"
              :class="platform === 'netease' ? 'bg-white text-neutral-950' : 'text-neutral-300 hover:bg-neutral-800'"
              @click="setPlatform('netease')">网易云音乐</button>
          </div>

          <div class="relative mx-auto flex h-[200px] w-[200px] items-center justify-center overflow-hidden rounded-lg border border-neutral-800 bg-white p-3">
            <template x-if="qrImage">
              <img :src="qrImage" alt="登录二维码" class="h-full w-full object-contain">
            </template>
            <canvas x-show="!qrImage && qrText && !qrFallback" x-ref="qrCanvas" class="h-full w-full"></canvas>
            <img x-show="!qrImage && qrFallback" :src="qrFallback" alt="登录二维码" class="h-full w-full object-contain">
            <div x-show="!qrImage && !qrText && !qrFallback" class="text-sm text-neutral-500">等待生成二维码</div>
            <div x-show="status === 'success'" x-transition.opacity
              class="absolute inset-0 flex items-center justify-center bg-neutral-950/75 text-base font-semibold text-white backdrop-blur-sm">
              登录成功
            </div>
          </div>

          <div class="space-y-3">
            <button type="button"
              class="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
              :disabled="loading || status === 'success'"
              @click="startLogin()">
              <span x-text="loading ? '正在生成二维码...' : status === 'success' ? '登录成功' : '生成二维码'"></span>
            </button>
            <p x-show="status !== 'success'" class="min-h-5 text-center text-sm" :class="status === 'error' ? 'text-red-300' : 'text-neutral-400'" x-text="message"></p>
            <div x-show="status === 'success' && mode === 'create' && apiKey" class="grid grid-cols-[1fr_auto] gap-2">
              <input type="text" readonly :value="apiKey" x-ref="apiKeyInput"
                class="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100 outline-none"
                @focus="$event.target.select()">
              <button type="button"
                class="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800"
                @click="copyApiKey()">复制</button>
            </div>
            <button type="button"
              class="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
              @click="backToChoose()">返回选择</button>
          </div>
        </div>
      </template>
    </section>
  </main>

  <script>
    function loginPage() {
      return {
        step: 'choose',
        mode: '',
        apiKey: '',
        platform: 'qq',
        loading: false,
        status: 'idle',
        message: '',
        token: '',
        qrImage: '',
        qrText: '',
        qrFallback: '',
        timer: null,
        init() {
          this.apiKey = new URLSearchParams(window.location.search).get('api_access_key') || '';
        },
        chooseCreate() {
          this.resetLoginState();
          this.mode = 'create';
          this.apiKey = '';
          this.step = 'scan';
          this.startLogin();
        },
        chooseUpdate() {
          this.resetLoginState();
          this.mode = 'update';
          this.step = 'verify';
          this.message = '请输入已存在账号的 key';
        },
        backToChoose() {
          this.stopPolling();
          this.resetLoginState();
          this.step = 'choose';
          this.mode = '';
        },
        async verifyKey() {
          if (!this.apiKey) return;
          this.loading = true;
          this.status = 'loading';
          this.message = '正在验证...';
          try {
            await this.postJson('/login/api/verify-key', {
              api_access_key: this.apiKey
            });
            this.status = 'idle';
            this.message = '';
            this.step = 'scan';
            await this.startLogin();
          } catch (error) {
            this.status = 'error';
            this.message = error.message || '验证失败';
          } finally {
            this.loading = false;
          }
        },
        setPlatform(next) {
          if (this.platform === next) return;
          this.stopPolling();
          this.platform = next;
          this.status = 'idle';
          this.message = '请选择平台并生成二维码';
          this.token = '';
          this.qrImage = '';
          this.qrText = '';
          this.qrFallback = '';
          this.startLogin();
        },
        async startLogin() {
          this.stopPolling();
          this.loading = true;
          this.status = 'loading';
          this.message = '正在生成二维码...';
          this.token = '';
          this.qrImage = '';
          this.qrText = '';
          this.qrFallback = '';
          try {
            const payload = await this.postJson('/login/api/start', {
              mode: this.mode,
              api_access_key: this.apiKey,
              platform: this.platform
            });
            this.apiKey = payload.data.apiAccessKey || this.apiKey;
            this.token = payload.data.token;
            this.qrImage = payload.data.qrImage || '';
            this.qrText = payload.data.qrText || '';
            this.status = 'waiting';
            this.message = this.platform === 'qq' ? '请使用手机 QQ 扫码' : '请使用网易云音乐扫码';
            this.renderQr();
            this.timer = window.setInterval(() => this.checkLogin(), 1000);
          } catch (error) {
            this.status = 'error';
            this.message = error.message || '二维码生成失败';
          } finally {
            this.loading = false;
          }
        },
        async checkLogin() {
          if (!this.token || this.status === 'success') return;
          try {
            const payload = await this.postJson('/login/api/check', {
              token: this.token
            });
            this.status = payload.data.status;
            this.message = payload.data.message;
            if (payload.data.status === 'success') {
              this.stopPolling();
              this.apiKey = payload.data.apiAccessKey || this.apiKey;
              this.message = '登录成功';
            }
            if (payload.data.status === 'expired' || payload.data.status === 'error') {
              this.stopPolling();
            }
          } catch (error) {
            this.status = 'error';
            this.message = error.message || '登录状态检查失败';
            this.stopPolling();
          }
        },
        async postJson(url, body) {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const payload = await response.json();
          if (!response.ok || payload.code !== 200) {
            throw new Error(payload.message || '请求失败');
          }
          return payload;
        },
        renderQr() {
          this.$nextTick(() => {
            if (!this.qrText || this.qrImage) return;
            if (window.QRCode && this.$refs.qrCanvas) {
              window.QRCode.toCanvas(this.$refs.qrCanvas, this.qrText, {
                width: 200,
                margin: 1,
                errorCorrectionLevel: 'H'
              });
              return;
            }
            this.qrFallback = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=' + encodeURIComponent(this.qrText);
          });
        },
        resetLoginState() {
          this.loading = false;
          this.status = 'idle';
          this.message = '';
          this.token = '';
          this.qrImage = '';
          this.qrText = '';
          this.qrFallback = '';
        },
        async copyApiKey() {
          if (!this.apiKey) return;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(this.apiKey);
            return;
          }
          if (this.$refs.apiKeyInput) {
            this.$refs.apiKeyInput.select();
            document.execCommand('copy');
          }
        },
        stopPolling() {
          if (this.timer) {
            window.clearInterval(this.timer);
            this.timer = null;
          }
        }
      };
    }
  </script>
</body>
</html>`);
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
      const nickname = String(profile.nickname || '').trim();
      return nickname;
    } catch (error) {
      throw new UpstreamError(`登录成功但获取用户昵称失败: ${(error as Error).message}`);
    }
  } finally {
    if (previousFactory === undefined) {
      delete globalScope.__musicPlatformFactory__;
    } else {
      globalScope.__musicPlatformFactory__ = previousFactory;
    }
  }
}

export function createLoginRouter({ registry, platformFactory, workDir }: LoginRouterOptions): Router {
  const router = express.Router();
  const pendingLogins = new Map<string, PendingLogin>();

  function getPendingLogin(token: unknown): { token: string; pending: PendingLogin } {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
      throw new BadRequestError('token 是必填参数');
    }

    const pending = pendingLogins.get(normalizedToken);
    if (!pending) {
      throw new BadRequestError('登录二维码不存在或已失效');
    }

    return { token: normalizedToken, pending };
  }

  router.get('/', sendLoginPage);

  router.post('/api/verify-key', (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiAccessKey = requireAccount(registry, req.body?.api_access_key);
      const session = registry.byAccessKey.get(apiAccessKey);
      res.json({
        code: 200,
        data: {
          apiAccessKey,
          platform: session?.platform,
          accountName: session?.name,
          message: '验证成功'
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mode = normalizeLoginMode(req.body?.mode);
      const platform = normalizeLoginPlatform(req.body?.platform);
      const apiAccessKey = mode === 'update'
        ? requireAccount(registry, req.body?.api_access_key)
        : generateAccountAccessKey(registry, workDir);
      const result = await callLoginModule(platformFactory, platform, 'login/qr/key');
      const qr = getQrPayload(platform, result);
      pendingLogins.set(qr.token, {
        mode,
        apiAccessKey,
        platform,
        createdAt: Date.now()
      });

      res.json({
        code: 200,
        data: {
          mode,
          platform,
          apiAccessKey,
          token: qr.token,
          qrImage: qr.qrImage,
          qrText: qr.qrText
        }
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
        if (!cookie) {
          throw new UpstreamError('登录成功但未获取到有效 cookie');
        }
        const accountName = await resolveLoggedInAccountName(platform, cookie, platformFactory);
        const writeResult = mode === 'update'
          ? updateAccountCookieByAccessKey(apiAccessKey, platform, cookie, registry, workDir, accountName)
          : createAccountWithCookie(apiAccessKey, platform, cookie, registry, workDir, accountName);
        res.json({
          code: 200,
          data: {
            status: 'success',
            mode,
            platform,
            apiAccessKey,
            accountName: writeResult.session.name,
            message: '登录成功'
          }
        });
        return;
      }

      const status = code === 800
        ? 'expired'
        : code === 802
          ? 'confirming'
          : code === 801
            ? 'waiting'
            : 'error';

      if (status === 'expired' || status === 'error') {
        pendingLogins.delete(token);
      }

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
