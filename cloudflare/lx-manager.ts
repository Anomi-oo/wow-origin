import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import type { TrackUrl } from 'aduoer-wow-sdk';
import type { AppLxSourceManager } from '../src/app';
import type { MusicPlatform } from '../src/types';
import type { LxPlatform, LxQuality } from '../src/lx-resource/types';
import { bundledLxSource, installBundledLxSource } from './generated/lx-source';

const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' } as const;
const QUALITIES: LxQuality[] = ['128k', '320k', 'flac', 'flac24bit'];

type SourceCapability = { actions: string[]; qualities: LxQuality[] };
type RequestHandler = (input: Record<string, unknown>) => unknown;

function selectQuality(requested: string | undefined, supported: readonly LxQuality[]): LxQuality | undefined {
  if (requested === 'max') return [...QUALITIES].reverse().find((item) => supported.includes(item));
  if (requested === 'min') return QUALITIES.find((item) => supported.includes(item));
  const target: LxQuality = requested === 'standard' ? '128k' : requested === 'lossless' ? 'flac' : '320k';
  for (let index = QUALITIES.indexOf(target); index >= 0; index -= 1) {
    if (supported.includes(QUALITIES[index])) return QUALITIES[index];
  }
  return undefined;
}

function trackUrl(url: string, quality: LxQuality): TrackUrl {
  if (url.length > 2048) throw new Error('洛雪源返回的地址过长');
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('洛雪源返回了非 HTTP 地址');
  if (quality === '128k') return { url, quality: 'standard', format: '', bitrate: 128_000, size: 0 };
  if (quality === '320k') return { url, quality: 'exhigh', format: '', bitrate: 320_000, size: 0 };
  return { url, quality: 'lossless', format: '', bitrate: null, size: 0 };
}

function parseBody(raw: Buffer): unknown {
  const text = raw.toString();
  try { return JSON.parse(text); } catch { return text; }
}

function request(
  url: string,
  options: Record<string, any> = {},
  callback: (error: unknown, response: unknown, body: unknown) => void
): () => void {
  const controller = new AbortController();
  const timeout = Math.min(Math.max(Number(options.timeout) || 20_000, 1), 60_000);
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body === undefined && options.form) {
    body = new URLSearchParams(Object.entries(options.form).map(([key, value]) => [key, String(value)]));
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
  } else if (body === undefined && options.formData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(options.formData)) {
      if (value === undefined || value === null) continue;
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        formData.append(key, new Blob([value as Uint8Array]), key);
      } else {
        formData.append(key, String(value));
      }
    }
    body = formData;
  }
  void fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
    redirect: 'follow',
    signal: controller.signal
  }).then(async (response) => {
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.byteLength > 20 * 1024 * 1024) throw new Error('洛雪源请求响应超过 20 MiB');
    const parsed = parseBody(raw);
    callback(null, {
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: Object.fromEntries(response.headers),
      bytes: raw.byteLength,
      raw,
      body: parsed
    }, parsed);
  }).catch((error) => callback(error, null, null)).finally(() => clearTimeout(timer));
  return () => controller.abort();
}

function zlibCall(method: 'inflate' | 'deflate', input: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib[method](input, (error, result) => error ? reject(error) : resolve(result));
  });
}

export class CloudflareLxSourceManager implements AppLxSourceManager {
  private requestHandler?: RequestHandler;
  private readonly capabilities: Partial<Record<LxPlatform, SourceCapability>> = {};

  constructor() {
    if (!bundledLxSource.enabled) return;
    const lx = {
      EVENT_NAMES,
      request,
      on: async (event: string, handler: RequestHandler) => {
        if (event !== EVENT_NAMES.request || typeof handler !== 'function') throw new Error('不支持的洛雪事件');
        this.requestHandler = handler;
      },
      send: async (event: string, data?: any) => {
        if (event === EVENT_NAMES.updateAlert) return;
        if (event !== EVENT_NAMES.inited) throw new Error('不支持的洛雪事件');
        for (const platform of ['tx', 'wy'] as const) {
          const source = data?.sources?.[platform];
          const qualities = Array.isArray(source?.qualitys)
            ? source.qualitys.filter((item: unknown): item is LxQuality => QUALITIES.includes(item as LxQuality))
            : [];
          if (Array.isArray(source?.actions) && source.actions.includes('musicUrl') && qualities.length) {
            this.capabilities[platform] = { actions: ['musicUrl'], qualities };
          }
        }
      },
      utils: {
        crypto: {
          aesEncrypt(input: Uint8Array, mode: string, key: crypto.CipherKey, iv: crypto.BinaryLike | null) {
            const cipher = crypto.createCipheriv(mode, key, iv);
            return Buffer.concat([cipher.update(input), cipher.final()]);
          },
          rsaEncrypt(input: Uint8Array, key: crypto.KeyLike) {
            const buffer = Buffer.from(input);
            const padded = Buffer.concat([Buffer.alloc(Math.max(0, 128 - buffer.length)), buffer]);
            return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded);
          },
          randomBytes: (size: number) => crypto.randomBytes(size),
          md5: (value: string) => crypto.createHash('md5').update(value).digest('hex')
        },
        buffer: {
          from: (...args: any[]) => (Buffer.from as any)(...args),
          bufToString: (value: Uint8Array, encoding?: BufferEncoding) => Buffer.from(value).toString(encoding)
        },
        zlib: {
          inflate: (value: Uint8Array) => zlibCall('inflate', value),
          deflate: (value: Uint8Array) => zlibCall('deflate', value)
        }
      },
      currentScriptInfo: { ...bundledLxSource, rawScript: '' },
      version: '2.0.0',
      env: 'cloudflare'
    };
    const sandbox = { lx, console, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa };
    installBundledLxSource(sandbox, console);
    if (!this.requestHandler) throw new Error('打包的洛雪源没有注册 request 处理器');
  }

  start(): void {}
  reconcileAccountSources(): void {}
  async updateAll(): Promise<void> {}
  async stop(): Promise<void> {}

  async resolveTrackUrl(platform: MusicPlatform, id: string, requestedQuality?: string): Promise<TrackUrl | undefined> {
    if (!this.requestHandler) return undefined;
    const source: LxPlatform = platform === 'qq' ? 'tx' : 'wy';
    const quality = selectQuality(requestedQuality, this.capabilities[source]?.qualities || []);
    if (!quality) return undefined;
    const invocation = Promise.resolve(this.requestHandler({
      source,
      action: 'musicUrl',
      info: {
        type: quality,
        musicInfo: {
          id,
          songmid: id,
          ...(source === 'tx' ? { strMediaMid: id } : {}),
          source,
          types: this.capabilities[source]!.qualities.map((type) => ({ type, size: null }))
        }
      }
    }));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let result: unknown;
    try {
      result = await Promise.race([
        invocation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('洛雪源请求超时')), 15_000);
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return typeof result === 'string' && result ? trackUrl(result, quality) : undefined;
  }
}

export { bundledLxSource };
