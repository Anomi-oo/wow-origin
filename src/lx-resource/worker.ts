import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { parentPort, workerData } from 'node:worker_threads';
import axios, { type AxiosRequestConfig } from 'axios';
import type {
  LxLogLevel,
  LxScriptInfo,
  LxWorkerInvocation
} from './types';

type WorkerInput = {
  script: string;
  sourceInfo: LxScriptInfo;
};

type InvokeMessage = {
  type: 'invoke';
  requestId: string;
  invocation: Omit<LxWorkerInvocation, 'timeoutMs'>;
};

type CancelMessage = {
  type: 'cancel';
  requestId: string;
};

type StopMessage = {
  type: 'stop';
};

type ParentMessage = InvokeMessage | CancelMessage | StopMessage;

const input = workerData as WorkerInput;
if (!parentPort) throw new Error('LX source worker requires a parent port');
const port = parentPort;

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert'
} as const;
const SUPPORTED_EVENTS = new Set(Object.values(EVENT_NAMES));
const invocationContext = new AsyncLocalStorage<string>();
const invocationRequests = new Map<string, Set<AbortController>>();
const allRequests = new Set<AbortController>();
let requestHandler: ((data: unknown) => unknown) | undefined;
let initialized = false;
let updateAlertSent = false;

function safeLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.toString('hex').slice(0, 128)}>`;

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
  } catch {
    return String(value);
  }
}

function emitLog(level: LxLogLevel, args: unknown[]): void {
  const message = args.map(safeLogValue).join(' ').slice(0, 4096);
  port.postMessage({ type: 'log', level, message });
}

function sourceConsole() {
  return {
    debug: (...args: unknown[]) => emitLog('debug', args),
    log: (...args: unknown[]) => emitLog('info', args),
    info: (...args: unknown[]) => emitLog('info', args),
    warn: (...args: unknown[]) => emitLog('warn', args),
    error: (...args: unknown[]) => emitLog('error', args),
    group: (...args: unknown[]) => emitLog('info', args),
    groupCollapsed: (...args: unknown[]) => emitLog('info', args),
    groupEnd: () => undefined
  };
}

function registerController(controller: AbortController): () => void {
  allRequests.add(controller);
  const invocationId = invocationContext.getStore();
  if (invocationId) {
    const controllers = invocationRequests.get(invocationId) ?? new Set<AbortController>();
    controllers.add(controller);
    invocationRequests.set(invocationId, controllers);
  }

  return () => {
    allRequests.delete(controller);
    if (!invocationId) return;
    const controllers = invocationRequests.get(invocationId);
    controllers?.delete(controller);
    if (controllers?.size === 0) invocationRequests.delete(invocationId);
  };
}

function cancelInvocation(requestId: string): void {
  const controllers = invocationRequests.get(requestId);
  if (!controllers) return;
  for (const controller of controllers) controller.abort();
  invocationRequests.delete(requestId);
}

function normalizeFormData(value: Record<string, unknown>): FormData {
  const data = new FormData();
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    if (Buffer.isBuffer(entry) || entry instanceof Uint8Array) {
      data.append(key, new Blob([entry]), key);
    } else {
      data.append(key, String(entry));
    }
  }
  return data;
}

function parseResponseBody(raw: Buffer): unknown {
  const text = raw.toString();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function lxRequest(
  url: string,
  options: {
    method?: string;
    timeout?: number;
    headers?: Record<string, string>;
    body?: unknown;
    form?: Record<string, unknown>;
    formData?: Record<string, unknown>;
  } = {},
  callback: (error: unknown, response: unknown, body: unknown) => void
): () => void {
  const controller = new AbortController();
  const unregister = registerController(controller);
  const timeout = typeof options.timeout === 'number' && options.timeout > 0
    ? Math.min(options.timeout, 60_000)
    : 60_000;
  const headers = { ...(options.headers ?? {}) };
  let data: unknown = options.body;

  if (data === undefined && options.form) {
    const entries: Array<[string, string]> = Object.entries(options.form).flatMap(
      ([key, value]): Array<[string, string]> => value === undefined || value === null
        ? []
        : [[key, String(value)]]
    );
    data = new URLSearchParams(entries);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
  } else if (data === undefined && options.formData) {
    data = normalizeFormData(options.formData);
  }

  const requestConfig: AxiosRequestConfig = {
    url,
    method: options.method ?? 'get',
    headers,
    data,
    timeout,
    signal: controller.signal,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    maxContentLength: 20 * 1024 * 1024,
    validateStatus: () => true
  };

  void axios.request<ArrayBuffer>(requestConfig).then((response) => {
    const raw = Buffer.from(response.data);
    const body = parseResponseBody(raw);
    callback(null, {
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: response.headers,
      bytes: raw.byteLength,
      raw,
      body
    }, body);
  }).catch((error: unknown) => {
    callback(error, null, null);
  }).finally(unregister);

  return () => controller.abort();
}

const lx = {
  EVENT_NAMES,
  request: lxRequest,
  send(eventName: string, data?: unknown): Promise<void> {
    if (!SUPPORTED_EVENTS.has(eventName as typeof EVENT_NAMES[keyof typeof EVENT_NAMES])) {
      return Promise.reject(new Error(`The event is not supported: ${eventName}`));
    }
    if (eventName === EVENT_NAMES.inited) {
      if (initialized) return Promise.reject(new Error('Script is inited'));
      initialized = true;
      port.postMessage({
        type: 'initialized',
        data,
        hasRequestHandler: typeof requestHandler === 'function'
      });
      return Promise.resolve();
    }
    if (eventName === EVENT_NAMES.updateAlert) {
      if (updateAlertSent) {
        return Promise.reject(new Error('The update alert can only be called once.'));
      }
      updateAlertSent = true;
      emitLog('info', ['updateAlert', data]);
      return Promise.resolve();
    }
    return Promise.reject(new Error(`Unknown event name: ${eventName}`));
  },
  on(eventName: string, handler: (data: unknown) => unknown): Promise<void> {
    if (eventName !== EVENT_NAMES.request) {
      return Promise.reject(new Error(`The event is not supported: ${eventName}`));
    }
    if (typeof handler !== 'function') {
      return Promise.reject(new Error('Event handler must be a function'));
    }
    requestHandler = handler;
    return Promise.resolve();
  },
  utils: {
    crypto: {
      aesEncrypt(buffer: Uint8Array, mode: string, key: crypto.CipherKey, iv: crypto.BinaryLike | null) {
        const cipher = crypto.createCipheriv(mode, key, iv);
        return Buffer.concat([cipher.update(buffer), cipher.final()]);
      },
      rsaEncrypt(buffer: Uint8Array, key: crypto.KeyLike) {
        const inputBuffer = Buffer.from(buffer);
        const padded = Buffer.concat([Buffer.alloc(Math.max(0, 128 - inputBuffer.length)), inputBuffer]);
        return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded);
      },
      randomBytes(size: number) {
        return crypto.randomBytes(size);
      },
      md5(value: string) {
        return crypto.createHash('md5').update(value).digest('hex');
      }
    },
    buffer: {
      from(...args: Parameters<typeof Buffer.from>) {
        return Buffer.from(...args);
      },
      bufToString(buffer: Uint8Array, format?: BufferEncoding) {
        return Buffer.from(buffer).toString(format);
      }
    },
    zlib: {
      inflate(buffer: Uint8Array) {
        return new Promise<Buffer>((resolve, reject) => {
          zlib.inflate(buffer, (error, data) => error ? reject(error) : resolve(data));
        });
      },
      deflate(buffer: Uint8Array) {
        return new Promise<Buffer>((resolve, reject) => {
          zlib.deflate(buffer, (error, data) => error ? reject(error) : resolve(data));
        });
      }
    }
  },
  currentScriptInfo: {
    ...input.sourceInfo,
    rawScript: input.script
  },
  version: '2.0.0',
  env: 'desktop'
};

const context = vm.createContext({
  globalThis: undefined,
  lx,
  console: sourceConsole(),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  atob,
  btoa
});
context.globalThis = context;
context.window = context;
context.self = context;

port.on('message', (message: ParentMessage) => {
  if (message.type === 'cancel') {
    cancelInvocation(message.requestId);
    return;
  }
  if (message.type === 'stop') {
    for (const controller of allRequests) controller.abort();
    process.exit(0);
  }
  if (!requestHandler) {
    port.postMessage({ type: 'result', requestId: message.requestId, error: 'Request event is not defined' });
    return;
  }

  invocationContext.run(message.requestId, () => {
    try {
      const result = requestHandler!({
        source: message.invocation.source,
        action: 'musicUrl',
        info: {
          type: message.invocation.quality,
          musicInfo: message.invocation.musicInfo
        }
      });
      if (!result || typeof (result as Promise<unknown>).then !== 'function') {
        throw new Error('LX request handler must return a Promise');
      }
      void Promise.resolve(result).then((value) => {
        port.postMessage({ type: 'result', requestId: message.requestId, value });
      }).catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : String(error);
        port.postMessage({ type: 'result', requestId: message.requestId, error: messageText });
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      port.postMessage({ type: 'result', requestId: message.requestId, error: messageText });
    }
  });
});

try {
  const script = new vm.Script(input.script, { filename: `${input.sourceInfo.name || 'lx-source'}.js` });
  script.runInContext(context, { timeout: 10_000 });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  port.postMessage({ type: 'initializationError', error: message });
}
