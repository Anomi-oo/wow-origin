import { loadLxSourceConfigs } from './config';
import { LxSourceManager } from './manager';

export * from './config';
export * from './manager';
export * from './runtime';
export * from './scheduler';
export * from './types';

export function createLxSourceManager(): LxSourceManager {
  return new LxSourceManager({
    configs: loadLxSourceConfigs()
  });
}

