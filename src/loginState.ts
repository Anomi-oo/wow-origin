import type { MusicPlatform } from './types';

export type LoginMode = 'create' | 'update';

export interface PendingLogin {
  mode: LoginMode;
  apiAccessKey: string;
  platform: MusicPlatform;
  createdAt: number;
}

export interface PendingPhone extends PendingLogin {
  captchaUrl?: string;
}

/** 扫码/手机登录在发起与确认之间需要共享的最小状态。 */
export interface LoginStateStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  entries?(): Promise<Array<[string, T]>>;
  cleanup?(maxAgeMs: number, now?: number): void | Promise<void>;
}

export interface LoginStateStores {
  qr: LoginStateStore<PendingLogin>;
  phone: LoginStateStore<PendingPhone>;
  cleanup?(): void | Promise<void>;
}

export const QR_LOGIN_TTL_MS = 180_000;
export const PHONE_LOGIN_TTL_MS = 600_000;

export class MemoryLoginStateStore<T extends { createdAt: number }> implements LoginStateStore<T> {
  private readonly values = new Map<string, T>();

  async get(key: string): Promise<T | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async entries(): Promise<Array<[string, T]>> {
    return [...this.values.entries()];
  }

  cleanup(maxAgeMs: number, now: number = Date.now()): void {
    for (const [key, value] of this.values) {
      if (now - value.createdAt > maxAgeMs) this.values.delete(key);
    }
  }
}

export function createMemoryLoginStateStores(): LoginStateStores {
  const qr = new MemoryLoginStateStore<PendingLogin>();
  const phone = new MemoryLoginStateStore<PendingPhone>();
  return {
    qr,
    phone,
    cleanup() {
      qr.cleanup(QR_LOGIN_TTL_MS);
      phone.cleanup(PHONE_LOGIN_TTL_MS);
    }
  };
}
