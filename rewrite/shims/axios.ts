import { Buffer } from 'buffer';

export interface AxiosConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string | number>;
  data?: unknown;
  params?: Record<string, unknown>;
  responseType?: string;
  timeout?: number;
  validateStatus?: (status: number) => boolean;
  maxRedirects?: number;
}

function normalizeHeaders(headers: Record<string, string | string[]> = {}): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = value;
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function arrayBuffer(value: ArrayBuffer | undefined): ArrayBuffer {
  return value || new ArrayBuffer(0);
}

function parseBody(body: string | undefined, headers: Record<string, any>): unknown {
  const text = body || '';
  const contentType = String(headers['content-type'] || '');
  if (contentType.includes('json') || /^[\s\uFEFF]*[\[{]/.test(text)) {
    try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch {}
  }
  return text;
}

function requestUrl(rawUrl: string, params?: Record<string, unknown>): string {
  if (!params || !Object.keys(params).length) return rawUrl;
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function bytesToArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

async function proxyFetch(request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  bodyBytes?: ArrayBuffer;
  followRedirects: boolean;
  binaryResponse: boolean;
}): Promise<{ statusCode: number; headers: Record<string, string | string[]>; body?: string; bodyBytes?: ArrayBuffer }> {
  if (typeof $task !== 'undefined') {
    return $task.fetch({
      url: request.url,
      method: request.method,
      headers: request.headers,
      ...(request.bodyBytes ? { bodyBytes: request.bodyBytes } : request.body !== undefined ? { body: request.body } : {}),
      opts: { redirection: request.followRedirects }
    });
  }
  if (typeof $httpClient === 'undefined') throw new Error('当前脚本环境不支持网络请求');
  return new Promise((resolve, reject) => {
    const method = request.method.toLowerCase();
    const send = $httpClient[method] || $httpClient.get;
    const body = request.bodyBytes ? new Uint8Array(request.bodyBytes) : request.body;
    send({
      url: request.url,
      headers: request.headers,
      'binary-mode': request.binaryResponse,
      'auto-redirect': request.followRedirects,
      ...(body !== undefined ? { body } : {})
    }, (error, response, data) => {
      if (error) {
        reject(new Error(String(error)));
        return;
      }
      const statusCode = Number(response?.statusCode || response?.status || 0);
      resolve({
        statusCode,
        headers: response?.headers || {},
        ...(data instanceof Uint8Array ? { bodyBytes: bytesToArrayBuffer(data) } : { body: String(data || '') })
      });
    });
  });
}

async function request(config: AxiosConfig): Promise<any> {
  if (!config.url) throw new Error('Proxy axios: url is required');
  const headers = Object.fromEntries(
    Object.entries(config.headers || {}).map(([key, value]) => [key, String(value)])
  );
  const body = config.data === undefined
    ? undefined
    : typeof config.data === 'string'
      ? config.data
      : config.data instanceof ArrayBuffer || ArrayBuffer.isView(config.data)
        ? undefined
        : JSON.stringify(config.data);
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
  if (body !== undefined && !hasContentType) {
    headers['Content-Type'] = typeof config.data === 'string'
      ? 'application/x-www-form-urlencoded'
      : 'application/json';
  }
  const binaryBody = config.data instanceof ArrayBuffer
    ? config.data
    : ArrayBuffer.isView(config.data)
      ? config.data.buffer.slice(config.data.byteOffset, config.data.byteOffset + config.data.byteLength) as ArrayBuffer
      : undefined;

  const response = await proxyFetch({
    url: requestUrl(config.url, config.params),
    method: (config.method || 'GET').toUpperCase(),
    headers,
    ...(binaryBody ? { bodyBytes: binaryBody } : body !== undefined ? { body } : {}),
    followRedirects: config.maxRedirects !== 0,
    binaryResponse: config.responseType === 'arraybuffer'
  });
  const responseHeaders = normalizeHeaders(response.headers);
  const data = config.responseType === 'arraybuffer'
    ? Buffer.from(arrayBuffer(response.bodyBytes))
    : parseBody(response.body, responseHeaders);
  const result = {
    data,
    status: response.statusCode,
    statusText: String(response.statusCode),
    headers: responseHeaders,
    config
  };
  const valid = config.validateStatus
    ? config.validateStatus(response.statusCode)
    : response.statusCode >= 200 && response.statusCode < 300;
  if (!valid) {
    const error: any = new Error(`Request failed with status code ${response.statusCode}`);
    error.response = result;
    throw error;
  }
  return result;
}

type Axios = ((config: AxiosConfig) => Promise<any>) & {
  get(url: string, config?: AxiosConfig): Promise<any>;
  post(url: string, data?: unknown, config?: AxiosConfig): Promise<any>;
  put(url: string, data?: unknown, config?: AxiosConfig): Promise<any>;
  delete(url: string, config?: AxiosConfig): Promise<any>;
};

const axios = request as Axios;
axios.get = (url, config = {}) => request({ ...config, method: 'GET', url });
axios.post = (url, data, config = {}) => request({ ...config, method: 'POST', url, data });
axios.put = (url, data, config = {}) => request({ ...config, method: 'PUT', url, data });
axios.delete = (url, config = {}) => request({ ...config, method: 'DELETE', url });

export default axios;
export { axios, request };
