import axios from 'axios';
import { proxyAccounts, type ProxyAccount } from './account-store';
import { captureCookie, isCookieCaptureRequest } from './cookie-capture';
import { initializeRewritePlatforms } from './platform';
import { dispatchWowRoute } from './routes';
import { continueRequest, finish, json, runtimeRequest, type RuntimeRequest, type RuntimeResponse } from './runtime';

declare const __REWRITE_HOST__: string;
declare const __REWRITE_UI_URL__: string;

function accountData(account: ProxyAccount): Record<string, unknown> {
  return {
    apiAccessKey: account.apiAccessKey,
    platform: account.platform,
    name: account.name,
    accountName: account.name,
    stateless: account.stateless
  };
}

async function frontend(): Promise<RuntimeResponse> {
  try {
    const response = await axios.get(__REWRITE_UI_URL__, {
      responseType: 'text',
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300
    });
    if (typeof response.data !== 'string' || !response.data.trim()) {
      throw new Error('管理页面响应为空');
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      body: response.data
    };
  } catch (error) {
    return {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      body: `<!doctype html><meta charset="utf-8"><title>Wow Origin</title><h1>账号页面加载失败</h1><p>${String((error as Error)?.message || error)}</p><p>Wow API 仍可通过 /v1/* 使用。</p>`
    };
  }
}

async function dispatch(request: RuntimeRequest): Promise<RuntimeResponse> {
  const path = request.path;
  if ((path === '/' || path === '/login') && request.method === 'GET') return frontend();

  if (path === '/app/api/accounts' && request.method === 'GET') {
    return json(200, {
      code: 200,
      data: proxyAccounts.list().map((account) => accountData(account))
    });
  }

  if (path === '/login/api/captured-cookie' && request.method === 'GET') {
    return json(200, { code: 200, data: proxyAccounts.latestCapturedCookie() || null });
  }

  if (path === '/login/api/account/import' && request.method === 'POST') {
    try {
      const account = proxyAccounts.create({
        platform: request.body.platform,
        name: request.body.name,
        cookie: request.body.cookie,
        apiAccessKey: request.body.api_access_key,
        stateless: request.body.stateless,
        useCapturedCookie: request.body.use_captured_cookie
      });
      return json(200, { code: 200, data: accountData(account) });
    } catch (error) {
      return json(400, { code: 400, message: (error as Error).message, data: null });
    }
  }

  if (path === '/login/api/verify-key' && request.method === 'POST') {
    const account = proxyAccounts.find(String(request.body.api_access_key || '').trim());
    return account
      ? json(200, { code: 200, data: { ...accountData(account), message: '验证成功' } })
      : json(401, { code: 401, message: 'api_access_key 无效', data: null });
  }

  if (path === '/login/api/account/config' && request.method === 'PUT') {
    try {
      const token = String(request.body.api_access_key || '').trim();
      const current = proxyAccounts.find(token);
      const suppliedCookie = String(request.body.cookie || '').trim();
      const useCapturedCookie = request.body.use_captured_cookie === true && Boolean(current);
      const capturedCookie = useCapturedCookie && current ? proxyAccounts.capturedCookie(current.platform) : '';
      if (!suppliedCookie && useCapturedCookie && !capturedCookie) {
        throw new Error(`尚未捕获${current?.platform === 'qq' ? ' QQ 音乐' : '网易云音乐'} Cookie，请先触发 Cookie 捕获脚本或取消该选项`);
      }
      const cookie = suppliedCookie || capturedCookie;
      const account = proxyAccounts.update(token, {
        name: String(request.body.name || '').trim(),
        stateless: request.body.stateless,
        ...(cookie ? { cookie } : {})
      });
      return json(200, { code: 200, data: { ...accountData(account), message: '配置已保存' } });
    } catch (error) {
      return json(400, { code: 400, message: (error as Error).message, data: null });
    }
  }

  if (path.startsWith('/v1/')) return dispatchWowRoute(request, path, '');
  return json(404, { code: 404, message: 'API endpoint not found', data: null });
}

async function main(): Promise<void> {
  try {
    const request = runtimeRequest();
    if (isCookieCaptureRequest(request.url.toString())) {
      captureCookie(request.url.toString(), request.headers);
      continueRequest();
      return;
    }
    if (request.url.hostname.toLowerCase() !== __REWRITE_HOST__.toLowerCase()) {
      continueRequest();
      return;
    }
    initializeRewritePlatforms();
    finish(await dispatch(request));
  } catch (error) {
    console.log(`[wow-origin] fatal: ${(error as Error)?.stack || error}`);
    finish(json(500, { code: 500, message: (error as Error)?.message || 'Internal server error', data: null }));
  }
}

void main();
