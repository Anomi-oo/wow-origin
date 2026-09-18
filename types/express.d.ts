import { Server } from 'http';
import type { LoginRefreshScheduler } from '../src/loginRefresh';
import type {
  LxSourceLifecycle,
  LxTrackUrlResolver,
  LxSourceUpdateScheduler
} from '../src/lx-resource';

declare global {
  namespace Express {
    interface Application {
      server?: Server;
      platformFactory?: any;
      loginRefreshScheduler?: LoginRefreshScheduler;
      lxSourceManager?: LxSourceLifecycle & LxTrackUrlResolver;
      lxSourceUpdateScheduler?: LxSourceUpdateScheduler;
    }
  }
}

export {};
