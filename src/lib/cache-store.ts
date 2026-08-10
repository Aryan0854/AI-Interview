class CacheStore {
  private static instance: CacheStore;
  private store = new Map<string, { data: any; timestamp: number; key?: string }>();

  static getInstance(): CacheStore {
    if (!CacheStore.instance) {
      CacheStore.instance = new CacheStore();
    }
    return CacheStore.instance;
  }

  get(key: string, ttlMs: number, subKey?: string): any | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.store.delete(key);
      return null;
    }
    if (subKey !== undefined && entry.key !== subKey) {
      return null;
    }
    return entry.data;
  }

  set(key: string, data: any, subKey?: string) {
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      key: subKey
    });
  }

  invalidate(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

export const cacheStore = CacheStore.getInstance();
