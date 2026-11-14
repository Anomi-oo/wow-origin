const log = require('../core/Logger').createConsole({ component: 'onload' });

import { createAdapter } from './adapter';
import type { AccountSessionRegistry, MusicAccountSession } from './accounts';
import type { LxSourceLifecycle } from './lx-resource';
import { runWithAccountContext } from '../core/RequestContext';

export async function preloadSessionFavorites(session: MusicAccountSession): Promise<void> {
  return runWithAccountContext(session, () => loadSessionFavorites(session));
}

async function loadSessionFavorites(session: MusicAccountSession): Promise<void> {
  if (!session.cookie.trim()) return;
  const client = createAdapter(session);

  for (const [label, load, markLoaded] of [
    ['tracks', () => client.userFavoriteTracks(), () => {}],
    ['playlists', () => client.getUserPlaylist(), () => {}],
    ['artists', () => client.userArtists(), () => { session.favoriteArtistsLoaded = true; }],
    ['albums', () => client.userAlbums(), () => { session.favoriteAlbumsLoaded = true; }]
  ] as const) {
    try {
      const items = await load();
      if (!session.cookie) return;
      markLoaded();
      log.info(`[onload] preloaded ${items.length} ${session.platform} favorite ${label} for ${session.name}`);
    } catch (error) {
      log.warn(`[onload] failed to preload ${session.platform} favorite ${label} for ${session.name}: ${(error as Error).message}`);
    }
  }
}

export async function preloadData(
  _platformFactory: any,
  registry?: AccountSessionRegistry,
  lxSourceLifecycle?: LxSourceLifecycle
): Promise<void> {
  // 洛雪源必须后台加载，不能延迟 HTTP 服务启动。
  lxSourceLifecycle?.start();

  await Promise.all((registry?.sessions || []).map((session) => preloadSessionFavorites(session)));
}
