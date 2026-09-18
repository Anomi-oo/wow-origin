import { Value } from '@sinclair/typebox/value';
// The SDK currently keeps route definitions internal to its Express adapter.
// The rewrite runtime reuses transport-independent definitions without loading Express.
// @ts-ignore
import { wowRedirects, wowRoutes } from '../node_modules/aduoer-wow-sdk/dist/routes.js';
import { NeteaseClient } from '../src/clients/NeteaseClient';
import { QQClient } from '../src/clients/QQClient';
import { getQualityOptions } from '../src/quality';
import { proxyAccounts, type ProxyAccount } from './account-store';
import { authorizationToken, json, type RuntimeRequest, type RuntimeResponse } from './runtime';

function clientFor(account: ProxyAccount): QQClient | NeteaseClient {
  const favorites = new Set(account.favoriteTrackIds);
  return account.platform === 'qq'
    ? new QQClient(account.cookie, favorites)
    : new NeteaseClient(account.cookie, favorites);
}

function requestLike(request: RuntimeRequest): any {
  return {
    method: request.method,
    query: request.query,
    body: request.body,
    originalUrl: `${request.url.pathname}${request.url.search}`,
    headers: request.headers,
    get(name: string): string | undefined {
      return request.headers[name.toLowerCase()];
    }
  };
}

function errorResponse(error: any): RuntimeResponse {
  const status = Number(error?.status) || 500;
  const code = Number(error?.code) || status;
  const message = status >= 500 && !error?.status
    ? 'Internal server error'
    : error?.message || 'Internal server error';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.log(`[wow-origin] ${status}: ${errorMessage}${stack ? `\n${stack}` : ''}`);
  return json(status, { code, message, data: null });
}

export async function dispatchWowRoute(
  request: RuntimeRequest,
  routePath: string,
  publicPrefix: string
): Promise<RuntimeResponse> {
  const token = authorizationToken(request.headers);
  const account = token ? proxyAccounts.find(token) : undefined;
  if (!account) return json(401, { code: 401, message: 'Authorization token 无效或未提供', data: null });

  const relativePath = routePath.slice('/v1'.length) || '/';
  const redirect = wowRedirects.find((item: any) => item.method.toUpperCase() === request.method && item.path === relativePath);
  if (redirect) {
    return {
      status: 308,
      headers: { Location: `${publicPrefix}/v1${redirect.target}${request.url.search}` },
      body: ''
    };
  }

  const definition = wowRoutes.find((item: any) => item.method.toUpperCase() === request.method && item.path === relativePath);
  if (!definition) return json(404, { code: 404, message: 'API endpoint not found', data: null });

  try {
    if (definition.bodySchema && !Value.Check(definition.bodySchema as any, request.body)) {
      const error: any = new Error('Invalid request body');
      error.status = 400;
      error.code = 400;
      throw error;
    }
    if (definition.requiresStateful && account.stateless) {
      const error: any = new Error('当前源不支持此功能: statefulUserData');
      error.status = 501;
      error.code = 501;
      throw error;
    }

    const adapter = clientFor(account);
    const data = await definition.run({
      adapter,
      qualityMap: getQualityOptions(account.platform),
      accountName: account.name,
      stateless: account.stateless
    }, requestLike(request));

    if (relativePath === '/track/favorite') {
      const favoriteTrackIds = [...((adapter as any).favoriteTrackSet as Set<string>)];
      proxyAccounts.update(account.apiAccessKey, { favoriteTrackIds });
    }
    return json(200, { code: 200, data });
  } catch (error) {
    return errorResponse(error);
  }
}
