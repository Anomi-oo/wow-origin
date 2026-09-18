export interface RuntimeRequest {
  method: string;
  url: URL;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, any>;
  rawBody: string;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  500: 'Internal Server Error',
  502: 'Bad Gateway'
};

function normalizedHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    headers[key.toLowerCase()] = String(value);
  }
  return headers;
}

function parseBody(rawBody: string, contentType: string): Record<string, any> {
  if (!rawBody) return {};
  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function runtimeRequest(): RuntimeRequest {
  const headers = normalizedHeaders($request.headers);
  const url = new URL($request.url || `https://pinhaoge.xyz${$request.path || '/'}`);
  const rawBody = $request.body || '';
  return {
    method: String($request.method || 'GET').toUpperCase(),
    url,
    path: ($request.path || url.pathname).split('?')[0],
    headers,
    query: Object.fromEntries(url.searchParams),
    body: parseBody(rawBody, headers['content-type'] || ''),
    rawBody
  };
}

export interface RuntimeResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  bodyBytes?: ArrayBuffer;
}

export function json(status: number, value: unknown, headers: Record<string, string> = {}): RuntimeResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(value)
  };
}

export function finish(response: RuntimeResponse): void {
  const headers = response.headers || {};
  if (typeof $task !== 'undefined') {
    $done({
      status: `HTTP/1.1 ${response.status} ${STATUS_TEXT[response.status] || ''}`.trim(),
      headers,
      ...(response.bodyBytes ? { bodyBytes: response.bodyBytes } : { body: response.body || '' })
    });
    return;
  }
  $done({
    response: {
      status: response.status,
      headers,
      ...(response.bodyBytes ? { body: new Uint8Array(response.bodyBytes) } : { body: response.body || '' })
    }
  });
}

export function continueRequest(): void {
  $done({});
}

export function authorizationToken(headers: Record<string, string>): string {
  const value = String(headers.authorization || '').trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return (match ? match[1] : value).trim();
}
