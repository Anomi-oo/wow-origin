export type KugouEdition = 'standard' | 'lite';

export function kugouEdition(cookie: string): KugouEdition {
  const value = String(cookie).split(';').map(p => p.trim()).find(p => p.startsWith('KUGOU_API_PLATFORM='))?.slice('KUGOU_API_PLATFORM='.length);
  if (value !== undefined && value !== 'standard' && value !== 'lite') throw new Error('酷狗版本必须是 standard 或 lite');
  return value || 'standard';
}

/** Account-scoped cache; rediscovered after a process or session restart. */
export interface KugouAccountState {
  userId: string;
  likedPlaylistId?: string;
}
export interface KugouAccountContext {
  cookie?: string;
  kugouState?: KugouAccountState;
  kugouPlaylists?: any[];
  kugouPlaylistsLoading?: Promise<any[]>;
}
export function kugouUserId(cookie: string): string {
  return String(cookie).split(';').map(p => p.trim()).find(p => p.startsWith('userid='))?.slice(7) || '';
}
