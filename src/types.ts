import { UnsupportedFeatureError } from './errors';

/** wow-origin 私有的平台标识，不属于公开 Wow 协议。 */
export type MusicPlatform = 'qq' | 'netease';

/** 上游歌词映射时使用的内部结构，不作为 Wow API 响应。 */
export interface Lyrics {
  original: string;
  translation: string;
  romanized: string;
  wordLyrics?: string;
}

export function notSupported(platform: MusicPlatform, feature: string): never {
  throw new UnsupportedFeatureError(`${platform} 不支持此功能: ${feature}`);
}
