import { QQClient } from './clients/QQClient';
import { NeteaseClient } from './clients/NeteaseClient';
import { AccountSessionRegistry } from './accounts';
import type { LxSourceLifecycle } from './lx-resource';

export async function preloadData(
  _platformFactory: any,
  registry?: AccountSessionRegistry,
  lxSourceLifecycle?: LxSourceLifecycle
): Promise<void> {
  // 洛雪源必须后台加载，不能延迟 HTTP 服务启动。
  lxSourceLifecycle?.start();

  try {
    const sessions = (registry?.sessions || []).filter((session) => session.cookie.trim());
    if (sessions.length === 0) {
      return;
    }

    for (const session of sessions) {
      // console.log(`[onload] preloading ${session.platform} favorite tracks for ${session.name}...`);
      const client = session.platform === 'netease'
        ? new NeteaseClient(session.cookie, session.favoriteTrackIds)
        : new QQClient(session.cookie, session.favoriteTrackIds);
      const tracks = await client.userFavoriteTracks().catch((error: any) => {
        console.warn(`[onload] failed to preload ${session.platform} favorite tracks for ${session.name}`, error);
        return [];
      });
      console.log(`[onload] preloaded ${tracks.length} ${session.platform} favorite tracks for ${session.name}`);
    }
  } catch (error) {
    console.warn('[onload] favorite tracks preload failed', error);
  }
}
