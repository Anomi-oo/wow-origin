import { Value } from '@sinclair/typebox/value';
// The SDK currently keeps route definitions internal to its Express adapter.
// The rewrite runtime reuses transport-independent definitions without loading Express.
// @ts-ignore
import { wowRedirects, wowRoutes } from '../node_modules/aduoer-wow-sdk/dist/routes.js';
import { NeteaseClient } from '../src/clients/NeteaseClient';
import { QQClient } from '../src/clients/QQClient';
import { getQualityOptions } from '../src/quality';
import { collectionStatusNeeded } from '../src/collectionStatus';
import { proxyAccounts, type ProxyAccount } from './account-store';
import { authorizationToken, json, type RuntimeRequest, type RuntimeResponse } from './runtime';

const log = require('../core/Logger').createConsole({ component: 'rewrite' });

function clientFor(account: ProxyAccount): QQClient | NeteaseClient {
  const tracks = new Set(account.favoriteTrackIds);
  const playlists = new Set(account.userPlaylistIds || []);
  const artists = new Set(account.favoriteArtistIds || []);
  const albums = new Set(account.favoriteAlbumIds || []);
  return account.platform === 'qq'
    ? new QQClient(account.cookie, tracks, artists, albums, playlists)
    : new NeteaseClient(account.cookie, tracks, artists, albums, playlists);
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
  log.error(`request failed (${status})`, error);
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
    const needed = collectionStatusNeeded(relativePath);
    const initialized: Partial<ProxyAccount> = {};
    if (needed.artists && account.favoriteArtistIds === null) {
      try {
        await adapter.userArtists();
        initialized.favoriteArtistIds = [...((adapter as any).favoriteArtistSet as Set<string>)];
      } catch {
        log.warn('failed to load favorite artists');
      }
    }
    if (needed.albums && account.favoriteAlbumIds === null) {
      try {
        await adapter.userAlbums();
        initialized.favoriteAlbumIds = [...((adapter as any).favoriteAlbumSet as Set<string>)];
      } catch {
        log.warn('failed to load favorite albums');
      }
    }
    if (Object.keys(initialized).length) proxyAccounts.update(account.apiAccessKey, initialized);
    const data = await definition.run({
      adapter,
      qualityMap: getQualityOptions(account.platform),
      accountName: account.name,
      stateless: account.stateless
    }, requestLike(request));

    const favoriteChanges: Partial<ProxyAccount> = {};
    if (relativePath === '/track/favorite' || relativePath === '/user/favorite/tracks') {
      favoriteChanges.favoriteTrackIds = [...((adapter as any).favoriteTrackSet as Set<string>)];
    }
    if (relativePath === '/user/playlist/list' || relativePath === '/user/favorite/tracks' ||
        (relativePath === '/playlist/favorite' && account.userPlaylistIds !== null)) {
      favoriteChanges.userPlaylistIds = [...((adapter as any).userPlaylistSet as Set<string>)];
    }
    if ((relativePath === '/artist/favorite' && account.favoriteArtistIds !== null) || relativePath === '/user/artist/list') {
      favoriteChanges.favoriteArtistIds = [...((adapter as any).favoriteArtistSet as Set<string>)];
    }
    if ((relativePath === '/album/favorite' && account.favoriteAlbumIds !== null) || relativePath === '/user/album/list') {
      favoriteChanges.favoriteAlbumIds = [...((adapter as any).favoriteAlbumSet as Set<string>)];
    }
    if (Object.keys(favoriteChanges).length) proxyAccounts.update(account.apiAccessKey, favoriteChanges);
    return json(200, { code: 200, data });
  } catch (error) {
    return errorResponse(error);
  }
}
