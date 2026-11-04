export type KugouEdition = 'standard' | 'lite';

export function kugouEdition(cookie: string): KugouEdition {
  const value = String(cookie).split(';').map(p => p.trim()).find(p => p.startsWith('KUGOU_API_PLATFORM='))?.slice('KUGOU_API_PLATFORM='.length);
  if (value !== undefined && value !== 'standard' && value !== 'lite') throw new Error('酷狗版本必须是 standard 或 lite');
  return value || 'standard';
}

/** Only stable account-scoped identifiers are persisted, never a playlist's song contents. */
export interface KugouAccountState {
  userId: string;
  likedPlaylistId?: string;
}
export interface KugouAccountContext {
  cookie?: string;
  kugouState?: KugouAccountState;
  saveKugouState?: (state: KugouAccountState) => Promise<void>;
  kugouPlaylists?: any[];
  kugouPlaylistsLoading?: Promise<any[]>;
}
export function kugouUserId(cookie: string): string {
  return String(cookie).split(';').map(p => p.trim()).find(p => p.startsWith('userid='))?.slice(7) || '';
}
export function normalizeKugouState(value: unknown, cookie: string): KugouAccountState | undefined {
  const userId = kugouUserId(cookie);
  if (!userId || !value || typeof value !== 'object') return undefined;
  const state = value as Partial<KugouAccountState>;
  if (state.userId !== userId) return undefined;
  return { userId, ...(/^\d+$/.test(state.likedPlaylistId || '') && Number(state.likedPlaylistId) > 0 ? { likedPlaylistId: state.likedPlaylistId } : {}) };
}
