import type { LxSourceLifecycle } from './types';

export interface LxSourceUpdateScheduler {
  start(): void;
  stop(): void;
}

function millisecondsUntilNextOneAm(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(1, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}

export function createLxSourceUpdateScheduler(
  lifecycle: LxSourceLifecycle
): LxSourceUpdateScheduler {
  let timer: NodeJS.Timeout | undefined;
  let stopped = true;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await lifecycle.updateAll();
      } catch (error) {
        console.error('[lx-source] scheduled update failed', error);
      } finally {
        schedule();
      }
    }, millisecondsUntilNextOneAm());
    timer.unref?.();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

export { millisecondsUntilNextOneAm };

