import type { TrackUrl } from 'aduoer-wow-sdk';
import type { MusicPlatform } from '../types';

export const LX_SOURCE_ENV_KEYS = [
  'LX_SOURCE_URL',
  'LX_SOURCE_URL0',
  'LX_SOURCE_URL1',
  'LX_SOURCE_URL2',
  'LX_SOURCE_URL3',
  'LX_SOURCE_URL4',
  'LX_SOURCE_URL5',
  'LX_SOURCE_URL6',
  'LX_SOURCE_URL7',
  'LX_SOURCE_URL8',
  'LX_SOURCE_URL9'
] as const;

export const LX_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const;

export type LxQuality = typeof LX_QUALITIES[number];
export type LxPlatform = 'tx' | 'wy';
export type LxLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LxSourceConfig {
  url: string;
  hash: string;
  order: number;
}

export interface LxScriptInfo {
  name: string;
  description: string;
  version: string;
  author: string;
  homepage: string;
}

export interface LxPlatformCapability {
  actions: string[];
  qualities: LxQuality[];
}

export interface LxSourceCapabilities {
  tx?: LxPlatformCapability;
  wy?: LxPlatformCapability;
}

export interface LxWorkerInitialization {
  sourceInfo: LxScriptInfo;
  capabilities: LxSourceCapabilities;
}

export interface LxWorkerInvocation {
  source: LxPlatform;
  quality: LxQuality;
  musicInfo: Record<string, unknown>;
  timeoutMs: number;
}

export interface LxRuntimeExit {
  expected: boolean;
  error?: Error;
}

export interface LxTrackUrlResolver {
  resolveTrackUrl(platform: MusicPlatform, id: string, quality?: string): Promise<TrackUrl | undefined>;
}

export interface LxSourceLifecycle {
  start(): void;
  updateAll(): Promise<void>;
  stop(): Promise<void>;
}

