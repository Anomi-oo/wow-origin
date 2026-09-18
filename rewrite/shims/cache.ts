class NoopCache {
  get(): null { return null; }
  set(): void {}
  clear(): void {}
  clearRoute(): void {}
}

export const globalCache = new NoopCache();
export default { globalCache };
