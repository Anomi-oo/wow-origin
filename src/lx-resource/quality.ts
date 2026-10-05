import type { MusicPlatform } from '../types';
import type { LxQuality } from './types';

/** 只映射相同档位；源不支持时由外层根据歌曲音质表决定降级。 */
export function getExactLxQuality(platform: MusicPlatform, quality: string | undefined, supported: readonly LxQuality[]): LxQuality | undefined {
  const mapping: Record<string, LxQuality> = {
    standard: '128k',
    exhigh: '320k',
    lossless: 'flac',
    ...(platform === 'netease' ? { hires: 'hires' as const, sky: 'atmos' as const, master: 'master' as const } : {})
  };
  const mapped = quality ? mapping[quality] : undefined;
  return mapped && supported.includes(mapped) ? mapped : undefined;
}
