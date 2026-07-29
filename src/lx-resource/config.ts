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
  const seen = new Set<string>();
  const configs: LxSourceConfig[] = [];

  LX_SOURCE_ENV_KEYS.forEach((key, order) => {
    const url = env[key]?.trim();
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

export function selectLxQuality(requestedQuality: string | undefined, supported: readonly LxQuality[]): LxQuality | undefined {
  if (supported.length === 0) return undefined;
  if (requestedQuality === 'max') {
    return [...LX_QUALITIES].reverse().find((quality) => supported.includes(quality));
  }
  if (requestedQuality === 'min') {
    return LX_QUALITIES.find((quality) => supported.includes(quality));
  }

  const target: LxQuality = requestedQuality === 'standard'
    ? '128k'
    : requestedQuality === 'lossless'
      ? 'flac'
      : '320k';
  const targetIndex = LX_QUALITIES.indexOf(target);

  for (let index = targetIndex; index >= 0; index -= 1) {
    const quality = LX_QUALITIES[index];
    if (supported.includes(quality)) return quality;
  }
  return undefined;
}

export function mapLxQualityToTrackUrl(url: string, quality: LxQuality) {
  if (quality === '128k') {
    return { url, quality: 'standard', format: '', bitrate: 128_000, size: 0 };
  }
  if (quality === '320k') {
    return { url, quality: 'exhigh', format: '', bitrate: 320_000, size: 0 };
  }
  return { url, quality: 'lossless', format: '', bitrate: null, size: 0 };
}
