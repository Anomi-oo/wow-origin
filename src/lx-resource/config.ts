import crypto from 'node:crypto';
import path from 'node:path';
import type { MusicPlatform } from '../types';
import {
  LX_QUALITIES,
  LX_SOURCE_ENV_KEYS,
  type LxPlatform,
  type LxQuality,
  type LxScriptInfo,
  type LxSourceConfig
} from './types';

const SCRIPT_INFO_FIELDS = ['name', 'description', 'version', 'author', 'homepage'] as const;

export function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

export function loadLxSourceConfigs(env: NodeJS.ProcessEnv = process.env): LxSourceConfig[] {
  return createLxSourceConfigs(LX_SOURCE_ENV_KEYS.map((key) => env[key] ?? ''));
}

export function createLxSourceConfigs(urls: readonly string[]): LxSourceConfig[] {
  const seen = new Set<string>();
  const configs: LxSourceConfig[] = [];

  urls.forEach((value, order) => {
    const url = value.trim();
    if (!url || seen.has(url)) return;

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    } catch {
      return;
    }

    seen.add(url);
    configs.push({ url, hash: md5(url), order });
  });

  return configs;
}

export function getLxSourceCacheDirectory(workDir: string = process.cwd()): string {
  return path.join(workDir, 'data', 'lx-sources');
}

export function getLxSourceCachePath(cacheDirectory: string, hash: string): string {
  return path.join(cacheDirectory, `${hash}.js`);
}

function sanitizeScriptInfoValue(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength);
}

export function parseLxScriptInfo(script: string): LxScriptInfo {
  const header = script.replace(/^\uFEFF/, '').match(/^\s*\/\*[\s\S]*?\*\//)?.[0] ?? '';
  const result: LxScriptInfo = {
    name: '',
    description: '',
    version: '',
    author: '',
    homepage: ''
  };

  for (const field of SCRIPT_INFO_FIELDS) {
    const value = header.match(new RegExp(`^\\s*\\*\\s*@${field}\\s+(.+?)\\s*$`, 'mi'))?.[1] ?? '';
    result[field] = sanitizeScriptInfoValue(value, field === 'name' ? 64 : 256);
  }

  return result;
}

export function sourceLabel(name: string, hash: string): string {
  return `${name || 'unknown'}#${hash.slice(0, 6)}`;
}

export function mapMusicPlatformToLx(platform: MusicPlatform): LxPlatform {
  return platform === 'qq' ? 'tx' : 'wy';
}

export function getLxQualityCandidates(requestedQuality: string | undefined, supported: readonly LxQuality[], platform: MusicPlatform = 'netease'): LxQuality[] {
  const available = platform === 'qq'
    ? supported.filter((quality) => ['128k', '320k', 'flac', 'flac24bit', 'master'].includes(quality))
    : supported;
  if (available.length === 0 || requestedQuality === 'jyeffect') return [];
  const fallback: LxQuality[] = ['flac', '320k', '128k'];
  const candidates: LxQuality[] = [];
  if (requestedQuality === 'max') {
    const highest = [...LX_QUALITIES].reverse().find((quality) => available.includes(quality));
    if (highest) candidates.push(highest);
  } else if (requestedQuality === 'min') {
    const lowest = LX_QUALITIES.find((quality) => available.includes(quality));
    if (lowest) candidates.push(lowest);
  } else if (requestedQuality === 'master') {
    candidates.push('master');
  } else if (requestedQuality === 'hires') {
    candidates.push('hires');
  } else if (requestedQuality === 'sky') {
    candidates.push('atmos');
  } else if (requestedQuality === 'standard') {
    candidates.push('128k');
  } else if (requestedQuality === 'exhigh' || requestedQuality === 'higher' || !requestedQuality) {
    candidates.push('320k');
  } else if (requestedQuality === 'lossless') {
    candidates.push('flac');
  } else {
    candidates.push('320k');
  }

  const baseIndex = fallback.indexOf(candidates[0]);
  const lower = baseIndex >= 0 ? fallback.slice(baseIndex + 1) : fallback;
  return [...new Set([...candidates, ...lower])].filter((quality) => available.includes(quality));
}

export function selectLxQuality(requestedQuality: string | undefined, supported: readonly LxQuality[], platform: MusicPlatform = 'netease'): LxQuality | undefined {
  return getLxQualityCandidates(requestedQuality, supported, platform)[0];
}

export function mapLxQualityToTrackUrl(url: string, quality: LxQuality) {
  if (quality === 'master') {
    return { url, quality: 'master', format: '', bitrate: null, size: 0 };
  }
  if (quality === 'hires') {
    return { url, quality: 'hires', format: '', bitrate: null, size: 0 };
  }
  if (quality === 'atmos') {
    return { url, quality: 'sky', format: '', bitrate: null, size: 0 };
  }
  if (quality === '128k') {
    return { url, quality: 'standard', format: '', bitrate: 128_000, size: 0 };
  }
  if (quality === '320k') {
    return { url, quality: 'exhigh', format: '', bitrate: 320_000, size: 0 };
  }
  return { url, quality: 'lossless', format: '', bitrate: null, size: 0 };
}
