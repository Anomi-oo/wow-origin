import { KugouClient } from './clients/KugouClient';
import type { ResolveWowContext, TrackUrl } from 'aduoer-wow-sdk';
import { type AccountSessionRegistry, type MusicAccountSession, extractAuthorizationToken } from './accounts';
import { NeteaseClient } from './clients/NeteaseClient';
import { QQClient } from './clients/QQClient';
import { YTMusicClient } from './clients/YTMusicClient';
import { getQualityOptions } from './quality';
import { collectionStatusNeeded } from './collectionStatus';
import type { MusicPlatform } from './types';
import type { LxTrackUrlResolver } from './lx-resource';
import { createStreamUrl } from './ytmusic/stream';
import { hasValidAudioUrl } from './trackUrl';
import { MissingCookieError } from './errors';

/** 根据私有平台账号创建符合公开 SDK 契约的 Adapter。 */
export function createMusicClient(
  platform: MusicPlatform,
  cookie: string,
  favoriteTrackIds?: Set<string>,
  favoriteArtistIds?: Set<string>,
  favoriteAlbumIds?: Set<string>,
  userPlaylistIds?: Set<string>,
  deviceState?: string,
  kugouContext?: import('./kugouState').KugouAccountContext
): QQClient | NeteaseClient | YTMusicClient | KugouClient {
  return platform === 'kugou'
    ? new KugouClient(cookie, favoriteTrackIds, favoriteArtistIds, favoriteAlbumIds, userPlaylistIds, kugouContext)
    : platform === 'ytmusic'
    ? new YTMusicClient(cookie, favoriteTrackIds, favoriteArtistIds, favoriteAlbumIds, userPlaylistIds)
    : platform === 'qq'
    ? new QQClient(cookie, favoriteTrackIds, favoriteArtistIds, favoriteAlbumIds, userPlaylistIds, deviceState)
    : new NeteaseClient(cookie, favoriteTrackIds, favoriteArtistIds, favoriteAlbumIds, userPlaylistIds);
}

export function createAdapter(
  account: MusicAccountSession,
  lxTrackUrlResolver?: LxTrackUrlResolver,
  streamOrigin?: string
): QQClient | NeteaseClient | YTMusicClient | KugouClient {
  const client = createMusicClient(account.platform, account.cookie, account.favoriteTrackIds, account.favoriteArtistIds, account.favoriteAlbumIds, account.userPlaylistIds, account.deviceState, account);
  if (!account.cookie.trim()) {
    // 统一覆盖所有平台，避免游客账号请求个性化推荐上游。
    client.getDailyTracks = async () => { throw new MissingCookieError(); };
    client.getRoamTracks = async () => { throw new MissingCookieError(); };
  }
  client.playlistFavorites = account.playlistFavorites;
  const createPlaylist = client.createPlaylist.bind(client);
  client.createPlaylist = async (name) => {
    const playlist = await createPlaylist(name);
    account.playlistFavorites.set(playlist.id, false);
    return { ...playlist, favorite: false };
  };
  const deletePlaylist = client.deletePlaylist.bind(client);
  client.deletePlaylist = async (id) => {
    const result = await deletePlaylist(id);
    if (result.success) { account.playlistFavorites.remove(id); account.userPlaylistIds.delete(id); }
    return result;
  };
  if (client instanceof YTMusicClient && streamOrigin) {
    client.setStreamUrl((id, quality) => createStreamUrl(streamOrigin, account, id, quality));
  }
  const userArtists = client.userArtists.bind(client);
  client.userArtists = async () => {
    const artists = await userArtists();
    account.favoriteArtistsLoaded = true;
    return artists;
  };
  const userAlbums = client.userAlbums.bind(client);
  client.userAlbums = async () => {
    const albums = await userAlbums();
    account.favoriteAlbumsLoaded = true;
    return albums;
  };
  if (client instanceof YTMusicClient || account.useLuoxue === false || !lxTrackUrlResolver) return client;

  const defaultGetTrackUrl = client.getTrackUrlForQuality.bind(client);
  const getLxTrackUrl = async (id: string, quality?: string): Promise<TrackUrl | undefined> => {
    if (account.platform === 'netease' && quality === 'jyeffect') return undefined;
    if (account.platform === 'qq' && ['atmos2', 'atmos51', 'dolby'].includes(quality || '')) return undefined;
    try {
      const lxTrackUrl = await lxTrackUrlResolver.resolveTrackUrl(account.platform, id, quality, account.lxSource || [], { allowFallback: false });
      if (hasValidAudioUrl(lxTrackUrl)) return lxTrackUrl;
      if (lxTrackUrl) {
        console.warn('[lx-source] resolver returned an invalid audio URL, using official track URL flow');
      }
    } catch {
      console.warn('[lx-source] unexpected resolver failure, using official track URL flow');
    }
    return undefined;
  };

  // 每个档位按账号的音频获取策略决定洛雪与官方的先后；降级统一由 client 按歌曲详情决定。
  client.getTrackUrlForQuality = async (id: string, quality: string) => {
    if (account.audioSourcePriority === 'account') {
      // 账号优先：官方失败或拿到无效地址时再试洛雪；洛雪也拿不到时交回官方的结果或错误。
      let official: TrackUrl | undefined;
      let failure: unknown;
      try {
        official = await defaultGetTrackUrl(id, quality);
        if (hasValidAudioUrl(official)) return official;
      } catch (error) {
        failure = error;
      }
      const lxTrackUrl = await getLxTrackUrl(id, quality);
      if (lxTrackUrl) return lxTrackUrl;
      if (official) return official;
      throw failure;
    }
    const lxTrackUrl = await getLxTrackUrl(id, quality);
    if (lxTrackUrl) return lxTrackUrl;
    return defaultGetTrackUrl(id, quality);
  };
  return client;
}

/** 将账号鉴权和 Adapter 选择接入 SDK；协议路由及响应校验由 SDK 负责。 */
export function createWowContextResolver(
  registry: AccountSessionRegistry,
  lxTrackUrlResolver?: LxTrackUrlResolver
): ResolveWowContext {
  return async ({ authorization, request }) => {
    const token = extractAuthorizationToken(authorization);
    const account = token ? registry.byAccessKey.get(token) : undefined;
    if (!account) return null;

    const header = (name: string): string | undefined =>
      typeof request?.header === 'function' ? request.header(name) : undefined;
    const forwardedProtocol = String(header('x-forwarded-proto') || '').split(',')[0];
    const protocol = forwardedProtocol === 'https' ? 'https' : request?.protocol === 'https' ? 'https' : 'http';
    const host = header('host');
    const origin = host && /^[a-zA-Z0-9.:-]+$/.test(host) ? `${protocol}://${host}` : undefined;
    const adapter = createAdapter(account, lxTrackUrlResolver, origin);
    const needed = collectionStatusNeeded(request?.path || '');
    if (needed.artists && !account.favoriteArtistsLoaded) {
      try {
        await adapter.userArtists();
        account.favoriteArtistsLoaded = true;
      } catch {
        // 保留已有集合；下一次需要状态时重试。
      }
    }
    if (needed.albums && !account.favoriteAlbumsLoaded) {
      try {
        await adapter.userAlbums();
        account.favoriteAlbumsLoaded = true;
      } catch {
        // 保留已有集合；下一次需要状态时重试。
      }
    }
    return {
      adapter,
      qualityMap: getQualityOptions(account.platform),
      accountName: account.name,
      stateless: account.stateless
    };
  };
}
