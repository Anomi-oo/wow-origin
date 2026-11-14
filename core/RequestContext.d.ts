import type { MusicAccountSession } from '../src/accounts';

export interface RequestContext {
  readonly accountId?: number | string;
  readonly accountName?: string;
  readonly platform?: string;
}

export function getRequestContext(): Readonly<RequestContext> | undefined;
export function formatRequestContextPrefix(): string;
export function runWithRequestContext<T>(context: RequestContext | undefined, callback: () => T): T;
export function runWithAccountContext<T>(
  account: Pick<MusicAccountSession, 'id' | 'name' | 'platform' | 'apiAccessKey'> | undefined,
  callback: () => T
): T;
