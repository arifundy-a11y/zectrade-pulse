const memoryStorage = new Map<string, string>();

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Restricted iframe or SSR context
  }
  return null;
}

export function readStorageJson<T>(key: string): T | null {
  try {
    const store = getStorage();
    const raw = store ? store.getItem(key) : (memoryStorage.get(key) ?? null);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStorageJson<T>(key: string, value: T): void {
  try {
    const serialized = JSON.stringify(value);
    const store = getStorage();
    if (store) {
      store.setItem(key, serialized);
    } else {
      memoryStorage.set(key, serialized);
    }
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function removeStorageKey(key: string): void {
  try {
    const store = getStorage();
    if (store) {
      store.removeItem(key);
    } else {
      memoryStorage.delete(key);
    }
  } catch {
    // Ignore cleanly
  }
}

export function clearMemoryStorageForTests(): void {
  memoryStorage.clear();
}

export function randomHexId(bytes = 4): string {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      const arr = new Uint8Array(bytes);
      globalThis.crypto.getRandomValues(arr);
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  } catch {
    // Fallback below
  }
  let out = '';
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return out.toUpperCase();
}
