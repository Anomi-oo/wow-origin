import type { Quality, QualityOption } from 'aduoer-wow-sdk';
import type { MusicPlatform } from './types';

export type { QualityOption } from 'aduoer-wow-sdk';

export type PlatformQuality = QualityOption & {
  rank: number;
  bitrate?: number | null;
  format?: string;
  sourceField?: string;
};

type PlatformQualityConfig = {
  qualities: readonly PlatformQuality[];
};

const PLATFORM_QUALITY_CONFIGS: Record<MusicPlatform, PlatformQualityConfig> = {
  qq: {
    qualities: [
      { key: 'standard', label: '标准', rank: 10, bitrate: 128000, format: 'mp3' },
      { key: 'higher', label: '高品质', rank: 20, bitrate: 192000, format: 'm4a' },
      { key: 'exhigh', label: 'HQ 高品质', rank: 30, bitrate: 320000, format: 'mp3' },
      { key: 'lossless', label: 'SQ 无损品质', rank: 40, bitrate: null, format: 'flac' }
    ]
  },
  netease: {
    qualities: [
      { key: 'standard', label: '标准', rank: 10, bitrate: 128000, sourceField: 'l' },
      { key: 'higher', label: '高品质', rank: 20, bitrate: 192000, sourceField: 'm' },
      { key: 'exhigh', label: '极高 HQ', rank: 30, bitrate: 320000, sourceField: 'h' },
      { key: 'lossless', label: '无损 SQ', rank: 40, sourceField: 'sq' }
    ]
  }
};

export function getPlatformQualities(platform: MusicPlatform): PlatformQuality[] {
  return [...PLATFORM_QUALITY_CONFIGS[platform].qualities].sort((lhs, rhs) => lhs.rank - rhs.rank);
}

export function getQualityOptions(platform: MusicPlatform): QualityOption[] {
  return getPlatformQualities(platform).map(({ key, label }) => ({ key, label }));
}

export function isQualitySupported(platform: MusicPlatform, quality: string): boolean {
  return getQualityOptions(platform).some((option) => option.key === quality);
}

export function getQualityCandidates(platform: MusicPlatform, quality: string): string[] {
  const qualities = getPlatformQualities(platform);
  const index = qualities.findIndex((item) => item.key === quality);
  if (index === -1) return [quality];
  return qualities.slice(0, index + 1).reverse().map((item) => item.key);
}

export function mapTrackQualities(platform: MusicPlatform, track: any = {}): Quality[] {
  return getPlatformQualities(platform).flatMap((definition) => {
    const source = definition.sourceField ? track[definition.sourceField] : undefined;
    if (!source || Number(source.size) <= 0) {
      return [];
    }
    return [{
      key: definition.key,
      label: definition.label,
      bitrate: Number(source.br) > 0 ? Number(source.br) : definition.bitrate,
      format: definition.format,
      size: Number(source.size) || 0
    }];
  });
}
