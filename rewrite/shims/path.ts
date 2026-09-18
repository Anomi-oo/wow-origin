export function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
}

export default { join };
