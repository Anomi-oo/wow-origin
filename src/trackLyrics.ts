import type { TrackLyrics } from 'aduoer-wow-sdk';

export function makeTrackLyrics(lyric: unknown, wordLyric: unknown): TrackLyrics {
  return {
    lyric: typeof lyric === 'string' ? lyric : '',
    wordLyric: typeof wordLyric === 'string' ? wordLyric : '',
    translateLyric: '',
    translateWordLyric: ''
  };
}

/**
 * 网易逐字歌词会把创作人员等元数据编码成逐行 JSON 对象。
 * 这里只删除能够完整解析为普通对象的行，避免误删以 `{` 开头的真实歌词。
 */
export function stripNeteaseWordLyricMetadata(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return true;

      try {
        const parsed = JSON.parse(trimmed);
        return parsed === null || Array.isArray(parsed) || typeof parsed !== 'object';
      } catch {
        return true;
      }
    })
    .join('\n')
    .trim();
}
