// 代理脚本运行时没有 AsyncLocalStorage；不通过全局变量模拟，避免并发串号。
export function getRequestContext(): undefined { return undefined; }
export function formatRequestContextPrefix(): string { return ''; }
export function runWithRequestContext<T>(_context: unknown, callback: () => T): T { return callback(); }
