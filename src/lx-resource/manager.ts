import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import type { TrackUrl } from 'aduoer-wow-sdk';
import type { MusicPlatform } from '../types';
import {
  getLxSourceCacheDirectory,
  getLxSourceCachePath,
  mapLxQualityToTrackUrl,
  mapMusicPlatformToLx,
  parseLxScriptInfo,
  selectLxQuality,
  sourceLabel
} from './config';
import { LxSourceRuntime } from './runtime';
import type {
  LxLogLevel,
  LxSourceCapabilities,
  LxSourceConfig,
  LxSourceLifecycle,
  LxTrackUrlResolver
} from './types';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const INITIALIZATION_TIMEOUT_MS = 10_000;
const SOURCE_REQUEST_TIMEOUT_MS = 3_000;
const SOURCE_CHAIN_TIMEOUT_MS = 15_000;

type RegisteredSource = {
  config: LxSourceConfig;
  name: string;
  scriptDigest: string;
  capabilities: LxSourceCapabilities;
  runtime: LxSourceRuntime;
};

type ManagerOptions = {
  configs: LxSourceConfig[];
  workDir?: string;
  cacheDirectory?: string;
  downloadSource?: (url: string) => Promise<string>;
};

function contentDigest(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function validateAudioUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new Error('LX source returned an invalid audio URL');
  }
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('LX source returned a non-HTTP audio URL');
  }
  return value;
}

function safeErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status ? `${error.code || 'HTTP_ERROR'} (${status})` : (error.code || 'network error');
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 1024);
}

export class LxSourceManager implements LxTrackUrlResolver, LxSourceLifecycle {
  private readonly configs: LxSourceConfig[];
  private readonly cacheDirectory: string;
  private readonly downloadSourceImpl: (url: string) => Promise<string>;
  private readonly sources = new Map<string, RegisteredSource>();
  private readonly operations = new Map<string, Promise<void>>();
  private initialLoad?: Promise<void>;
  private stopped = false;

  constructor(options: ManagerOptions) {
    this.configs = [...options.configs].sort((left, right) => left.order - right.order);
    this.cacheDirectory = options.cacheDirectory
      ?? getLxSourceCacheDirectory(options.workDir);
    this.downloadSourceImpl = options.downloadSource ?? ((url) => this.downloadSource(url));
  }

  start(): void {
    if (this.initialLoad || this.stopped || this.configs.length === 0) return;
    this.initialLoad = Promise.all(this.configs.map((config) => (
      this.runExclusive(config, () => this.loadAtStartup(config))
    ))).then(() => undefined).catch((error) => {
      console.warn('[lx-source] initial background load failed', safeErrorMessage(error));
    });
  }

  async waitForInitialLoad(): Promise<void> {
    await this.initialLoad;
  }

  async resolveTrackUrl(platform: MusicPlatform, id: string, quality?: string): Promise<TrackUrl | undefined> {
    if (this.stopped || this.sources.size === 0) return undefined;
    const lxPlatform = mapMusicPlatformToLx(platform);
    const deadline = Date.now() + SOURCE_CHAIN_TIMEOUT_MS;

    for (const config of this.configs) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const source = this.sources.get(config.hash);
      const capability = source?.capabilities[lxPlatform];
      if (!source || !capability) continue;
      const lxQuality = selectLxQuality(quality, capability.qualities);
      if (!lxQuality) continue;

      try {
        const result = await source.runtime.invoke({
          source: lxPlatform,
          quality: lxQuality,
          timeoutMs: Math.min(SOURCE_REQUEST_TIMEOUT_MS, remaining),
          musicInfo: {
            id,
            songmid: id,
            ...(lxPlatform === 'tx' ? { strMediaMid: id } : {}),
            source: lxPlatform,
            types: capability.qualities.map((type) => ({ type, size: null }))
          }
        });
        return mapLxQualityToTrackUrl(validateAudioUrl(result), lxQuality);
      } catch (error) {
        this.log('warn', source.name, config.hash, `获取音频失败: ${safeErrorMessage(error)}`);
      }
    }
    return undefined;
  }

  async updateAll(): Promise<void> {
    if (this.stopped) return;
    for (const config of this.configs) {
      await this.runExclusive(config, () => this.updateSource(config));
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.allSettled([...this.operations.values()]);
    const runtimes = [...this.sources.values()].map((source) => source.runtime);
    this.sources.clear();
    await Promise.allSettled(runtimes.map((runtime) => runtime.terminate()));
  }

  private async loadAtStartup(config: LxSourceConfig): Promise<void> {
    if (this.stopped) return;
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    const cachePath = getLxSourceCachePath(this.cacheDirectory, config.hash);

    let cachedName = '';
    try {
      const cachedScript = await fs.readFile(cachePath, 'utf8');
      cachedName = parseLxScriptInfo(cachedScript).name;
      await this.registerScript(config, cachedScript, false);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('warn', cachedName, config.hash, `本地缓存加载或注册失败，准备重新下载: ${safeErrorMessage(error)}`);
      }
    }

    let downloadedName = '';
    try {
      const downloadedScript = await this.downloadSourceImpl(config.url);
      downloadedName = parseLxScriptInfo(downloadedScript).name;
      await this.registerScript(config, downloadedScript, true);
    } catch (error) {
      this.log('error', downloadedName, config.hash, `下载或注册失败: ${safeErrorMessage(error)}`);
    }
  }

  private async updateSource(config: LxSourceConfig): Promise<void> {
    const current = this.sources.get(config.hash);
    try {
      const script = await this.downloadSourceImpl(config.url);
      const digest = contentDigest(script);
      if (current && current.scriptDigest === digest) {
        this.log('info', current.name, config.hash, '源内容无变化');
        return;
      }
      await this.registerScript(config, script, true);
      const updated = this.sources.get(config.hash);
      this.log('info', updated?.name ?? current?.name ?? '', config.hash, '源更新成功');
    } catch (error) {
      this.log('error', current?.name ?? '', config.hash, `源更新失败，保留当前版本: ${safeErrorMessage(error)}`);
    }
  }

  /**
   * 先在独立 Worker 中完成初始化校验；需要持久化时，再写入临时文件并原子替换缓存。
   * 只有以上步骤全部成功后才切换注册表，避免半成品源进入请求链。
   */
  private async registerScript(config: LxSourceConfig, script: string, persist: boolean): Promise<void> {
    if (!script.trim()) throw new Error('LX source script is empty');
    if (Buffer.byteLength(script) > MAX_SOURCE_BYTES) throw new Error('LX source script exceeds 5 MiB');
    const sourceInfo = parseLxScriptInfo(script);
    let runtimeLogName = sourceInfo.name;
    let runtime: LxSourceRuntime;
    runtime = new LxSourceRuntime({
      script,
      sourceInfo,
      initializationTimeoutMs: INITIALIZATION_TIMEOUT_MS,
      onLog: (level, message) => this.log(level, runtimeLogName, config.hash, message),
      onExit: (event) => {
        if (event.expected) return;
        const current = this.sources.get(config.hash);
        if (current?.runtime !== runtime) return;
        this.sources.delete(config.hash);
        this.log('error', current.name, config.hash, `Worker 异常退出: ${safeErrorMessage(event.error)}`);
      }
    });

    let initialization;
    try {
      initialization = await runtime.initialize();
      runtimeLogName = initialization.sourceInfo.name;
      if (persist) await this.persistScript(config, script);
    } catch (error) {
      await runtime.terminate();
      throw error;
    }

    if (this.stopped) {
      await runtime.terminate();
      return;
    }
    const previous = this.sources.get(config.hash);
    const registered: RegisteredSource = {
      config,
      name: initialization.sourceInfo.name,
      scriptDigest: contentDigest(script),
      capabilities: initialization.capabilities,
      runtime
    };
    this.sources.set(config.hash, registered);
    const platforms = Object.keys(initialization.capabilities).filter((key) => (
      initialization.capabilities[key as keyof LxSourceCapabilities]
    ));
    this.log('info', registered.name, config.hash, `注册成功，支持 ${platforms.join('/')}`);
    if (previous) void previous.runtime.drainAndTerminate();
  }

  private async persistScript(config: LxSourceConfig, script: string): Promise<void> {
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    const target = getLxSourceCachePath(this.cacheDirectory, config.hash);
    const temporary = path.join(
      this.cacheDirectory,
      `.${config.hash}.${process.pid}.${Date.now()}.tmp`
    );
    try {
      await fs.writeFile(temporary, script, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async downloadSource(url: string): Promise<string> {
    const response = await axios.get<ArrayBuffer>(url, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: MAX_SOURCE_BYTES,
      maxBodyLength: MAX_SOURCE_BYTES,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300
    });
    const buffer = Buffer.from(response.data);
    if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error('LX source script exceeds 5 MiB');
    return buffer.toString('utf8');
  }

  private runExclusive(config: LxSourceConfig, operation: () => Promise<void>): Promise<void> {
    const previous = this.operations.get(config.hash) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.operations.set(config.hash, next);
    void next.then(() => {
      if (this.operations.get(config.hash) === next) this.operations.delete(config.hash);
    }, () => {
      if (this.operations.get(config.hash) === next) this.operations.delete(config.hash);
    });
    return next;
  }

  private log(level: LxLogLevel, name: string, hash: string, message: string): void {
    const prefix = `[lx-source:${sourceLabel(name, hash)}]`;
    const output = `${prefix} ${message}`;
    if (level === 'error') console.error(output);
    else if (level === 'warn') console.warn(output);
    else if (level === 'debug') console.debug(output);
    else console.info(output);
  }
}
