import type { Track, TrackUrl } from 'aduoer-wow-sdk';
import { UnplayableError } from './errors';
import { getQualityCandidates, getRequestedQuality } from './quality';
import type { MusicPlatform } from './types';

export function hasValidAudioUrl(trackUrl: TrackUrl | undefined): trackUrl is TrackUrl {
  if (!trackUrl || typeof trackUrl.url !== 'string' || !trackUrl.url.trim()) return false;
  try {
    const url = new URL(trackUrl.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 先请求指定音质；失败后只查询一次详情，再按歌曲音质表逐档向下降级。 */
export async function resolveTrackUrlWithFallback(
  platform: MusicPlatform,
  quality: string | undefined,
  getTrackDetail: () => Promise<Track>,
  getTrackUrl: (quality: string) => Promise<TrackUrl>
): Promise<TrackUrl> {
  const requestedQuality = getRequestedQuality(platform, quality);
  const resolve = async (candidate: string): Promise<TrackUrl> => {
    const result = await getTrackUrl(candidate);
    if (!hasValidAudioUrl(result)) throw new UnplayableError('Song has no playable audio URL');
    return result;
  };
  let originalError: unknown;
  try {
    return await resolve(requestedQuality);
  } catch (error) {
    originalError = error;
  }

  let track: Track;
  try {
    track = await getTrackDetail();
  } catch {
    throw originalError;
  }
  for (const candidate of getQualityCandidates(platform, requestedQuality, track.qualities || [])) {
    try {
      return await resolve(candidate);
    } catch {
      // 音质表表示文件存在，不保证账号有权限；失败时继续尝试更低的档位。
    }
  }
  throw originalError;
}
