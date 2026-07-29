import type { ResolveWowContext, TrackUrl, WowAdapter } from 'aduoer-wow-sdk';
import { type AccountSessionRegistry, type MusicAccountSession, extractAuthorizationToken } from './accounts';
import { NeteaseClient } from './clients/NeteaseClient';
import { QQClient } from './clients/QQClient';
import { getQualityOptions } from './quality';
import type { MusicPlatform } from './types';
import type { LxTrackUrlResolver } from './lx-resource';

/** 根据私有平台账号创建符合公开 SDK 契约的 Adapter。 */
export function createMusicClient(
  platform: MusicPlatform,
  cookie: string,
  favoriteTrackIds?: Set<string>
): QQClient | NeteaseClient {
  return platform === 'qq'
    ? new QQClient(cookie, favoriteTrackIds)
    : new NeteaseClient(cookie, favoriteTrackIds);
}

function hasValidAudioUrl(trackUrl: TrackUrl | undefined): trackUrl is TrackUrl {
  if (!trackUrl || typeof trackUrl.url !== 'string' || !trackUrl.url.trim()) return false;
  try {
    const url = new URL(trackUrl.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createAdapter(
  account: MusicAccountSession,
  lxTrackUrlResolver?: LxTrackUrlResolver
): WowAdapter {
  const client = createMusicClient(account.platform, account.cookie, account.favoriteTrackIds);
  if (account.needUnlock === false || !lxTrackUrlResolver) return client;

  const defaultGetTrackUrl = client.getTrackUrl.bind(client);
  const getLxTrackUrl = async (id: string, quality?: string): Promise<TrackUrl | undefined> => {
    try {
      const lxTrackUrl = await lxTrackUrlResolver.resolveTrackUrl(account.platform, id, quality);
      if (hasValidAudioUrl(lxTrackUrl)) return lxTrackUrl;
      if (lxTrackUrl) {
        console.warn('[lx-source] resolver returned an invalid audio URL, using official track URL flow');
      }
    } catch {
      console.warn('[lx-source] unexpected resolver failure, using official track URL flow');
    }
    return undefined;
  };

  if (!account.cookie.trim()) {
    client.getTrackUrl = async (id: string, quality?: string) => {
      const lxTrackUrl = await getLxTrackUrl(id, quality);
      if (lxTrackUrl) return lxTrackUrl;
      return defaultGetTrackUrl(id, quality);
    };
    return client;
  }

  client.getTrackUrl = async (id: string, quality?: string) => {
    let officialError: unknown;
    try {
      const officialTrackUrl = await defaultGetTrackUrl(id, quality);
      if (hasValidAudioUrl(officialTrackUrl)) return officialTrackUrl;
      throw new Error('Official platform returned an invalid audio URL');
    } catch (error) {
      officialError = error;
    }

    const lxTrackUrl = await getLxTrackUrl(id, quality);
    if (lxTrackUrl) return lxTrackUrl;
    throw officialError;
  };
  return client;
}

/** 将账号鉴权和 Adapter 选择接入 SDK；协议路由及响应校验由 SDK 负责。 */
export function createWowContextResolver(
  registry: AccountSessionRegistry,
  lxTrackUrlResolver?: LxTrackUrlResolver
): ResolveWowContext {
  return ({ authorization }) => {
    const token = extractAuthorizationToken(authorization);
    const account = token ? registry.byAccessKey.get(token) : undefined;
    if (!account) return null;

    return {
      adapter: createAdapter(account, lxTrackUrlResolver),
      qualityMap: getQualityOptions(account.platform),
      accountName: account.name,
      stateless: account.stateless
    };
  };
}
