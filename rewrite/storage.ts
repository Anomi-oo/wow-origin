export function storageGet(key: string): string | null {
  if (typeof $prefs !== 'undefined') return $prefs.valueForKey(key);
  if (typeof $persistentStore !== 'undefined') return $persistentStore.read(key);
  return null;
}

export function storageSet(value: string, key: string): boolean {
  if (typeof $prefs !== 'undefined') return $prefs.setValueForKey(value, key);
  if (typeof $persistentStore !== 'undefined') return $persistentStore.write(value, key);
  return false;
}
