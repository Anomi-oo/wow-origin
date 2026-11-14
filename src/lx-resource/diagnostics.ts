import type { LxLogLevel } from './types';

export function safeDiagnosticText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .replace(/\b(cookie|authorization|token|secret|password|api[_-]?key|key|MUSIC_U|qm_keyst|musickey)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1024);
}

/** 只保留上游状态和错误说明，避免把音频地址、请求头或整个业务响应写入日志。 */
export function upstreamResponse(status: number, body: unknown): Record<string, unknown> {
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) body = new TextDecoder().decode(body);
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* 上游可能返回纯文本错误。 */ }
  }
  const summary: Record<string, unknown> = { status };
  const visit = (value: unknown, prefix = '', depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 2) return;
    for (const key of ['code', 'status', 'message', 'msg', 'error', 'reason', 'detail', 'data']) {
      const item = (value as Record<string, unknown>)[key];
      const field = prefix ? `${prefix}.${key}` : key;
      if (typeof item === 'string' && key !== 'data') summary[field] = safeDiagnosticText(item);
      else if (typeof item === 'number' || typeof item === 'boolean') summary[field] = item;
      else if (item && typeof item === 'object') visit(item, field, depth + 1);
    }
  };
  if (typeof body === 'string') summary.message = safeDiagnosticText(body);
  else visit(body);
  return summary;
}

export function diagnosticError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { message: safeDiagnosticText(String(error)) };
  // Worker 的 vm Error 与宿主 Error 不共享原型，不能使用 instanceof Error。
  const value = error as Record<string, any>;
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'message', 'msg', 'code', 'status']) {
    if (typeof value[key] === 'string') result[key] = safeDiagnosticText(value[key]);
    else if (typeof value[key] === 'number') result[key] = value[key];
  }
  if (!result.message) result.message = result.msg || safeDiagnosticText(String(error));
  if (value.response) result.upstream = upstreamResponse(value.response.status, value.response.data);
  if (Array.isArray(value.upstream)) result.upstream = value.upstream.slice(-5).map((item: unknown) => {
    if (!item || typeof item !== 'object') return {};
    const fields: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(item)) {
      if (!/^(?:(?:data|error|detail)\.){0,3}(?:name|status|code|message|msg|reason|error|detail)$/.test(key)) continue;
      if (typeof entry === 'string') fields[key] = safeDiagnosticText(entry);
      else if (typeof entry === 'number' || typeof entry === 'boolean') fields[key] = entry;
    }
    return fields;
  });
  return result;
}

export function logLxResolution(level: LxLogLevel, event: string, context: Record<string, unknown>): void {
  const output = `[lx-source] ${event} ${JSON.stringify(context)}`;
  if (level === 'warn') console.warn(output);
  else if (level === 'error') console.error(output);
  else if (level === 'debug') console.debug(output);
  else console.info(output);
}
