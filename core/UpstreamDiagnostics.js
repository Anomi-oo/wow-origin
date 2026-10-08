'use strict';

// Only retain bounded, structured metadata. Raw errors, messages, headers,
// bodies and URL query/fragment/userinfo may contain login credentials.
function errorChain(error) {
  const errors = [];
  const seen = new Set();
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 4 || errors.length >= 12) return;
    seen.add(value);
    const entry = {};
    if (typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.name)) entry.name = value.name;
    if (typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)) entry.code = value.code;
    if (typeof value.syscall === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value.syscall)) entry.syscall = value.syscall;
    if (Number.isSafeInteger(value.errno)) entry.errno = value.errno;
    errors.push(entry);
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors)) for (const child of value.errors.slice(0, 8)) visit(child, depth + 1);
  }
  visit(error, 0);
  return errors;
}

function createUpstreamError(message, error, context) {
  const errors = errorChain(error);
  const details = { platform: context.platform, stage: context.stage, errors };
  try {
    const url = new URL(context.url);
    details.request = { method: context.method || 'GET', origin: url.origin, path: url.pathname };
  } catch (_) {}
  if (Number.isFinite(context.startedAt)) details.elapsedMs = Math.max(0, Date.now() - context.startedAt);
  if (Number.isFinite(context.timeoutMs)) details.timeoutMs = context.timeoutMs;
  if (Number.isFinite(context.httpStatus)) details.httpStatus = context.httpStatus;
  if (Number.isFinite(context.upstreamCode)) details.upstreamCode = context.upstreamCode;
  const code = context.code || errors.find(entry => entry.code)?.code
    || (errors.some(entry => entry.name === 'TimeoutError') ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR');
  const wrapped = Object.assign(new Error(message), { code, details });
  Object.defineProperty(wrapped, 'diagnostics', { value: { code, details } });
  return wrapped;
}

module.exports = { createUpstreamError };
