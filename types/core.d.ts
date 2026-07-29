declare module '*/core/Result' {
  class Result {
    static success(data: any): any;
    static error(error: Error | string, code?: number): { code: number; message: string; data: null };
  }
  export = Result;
}

declare module '*/core/Logger' {
  class Logger {
    constructor(context?: Record<string, any>);
    compact(level: string, message: string, icon?: string): void;
    info(message: string, ...args: any[]): void;
    error(message: string, error?: any, meta?: Record<string, any>): void;
    debug(message: string, ...args: any[]): void;
  }
  export = Logger;
}

declare module '*/core/WelcomePage' {
  class WelcomePage {
    static colors: {
      reset: string;
      bright: string;
      dim: string;
      red: string;
      green: string;
      yellow: string;
      blue: string;
      magenta: string;
      cyan: string;
      white: string;
      gray: string;
    };
    static clear(): void;
    static showBanner(): void;
    static showStartupStatus(): void;
    static showPlatformStatus(name: string, modules: number, deviceId: string, staticIP?: string, defaultUid?: string): void;
    static showReadyStatus(serverInfo: any): void;
    static showError(title: string, error: any): void;
  }
  export = WelcomePage;
}

declare module '*/core/ConcurrencyLimiter' {
  class ConcurrencyLimiter {
    constructor(options?: { maxConcurrent?: number; queueTimeout?: number });
    getStatus(): {
      activeCount: number;
      queueLength: number;
      availableSlots: number;
      stats: Record<string, any>;
    };
  }
  const globalLimiter: ConcurrencyLimiter;
  export { globalLimiter, ConcurrencyLimiter };
}

declare module '*/platforms/PlatformFactory' {
  interface Platform {
    modules: Map<string, any>;
    deviceId?: string;
    staticDeviceId?: string;
    staticCnIP?: string;
    defaultUid?: string;
    callModule(route: string, request: any): Promise<any>;
  }

  class PlatformFactory {
    register(name: string, PlatformClass: any, config?: Record<string, any>): boolean;
    initialize(): Promise<boolean>;
    getPlatform(name: string): Platform;
    getAvailablePlatforms(): string[];
    getAvailableRoutes(): string[];
  }

  const platformFactory: PlatformFactory;
  export = platformFactory;
}

declare module '*/platforms/netease/NeteasePlatform' {
  class NeteasePlatform {
    constructor(config?: Record<string, any>);
  }
  export = NeteasePlatform;
}

declare module '*/platforms/qqmusic/QQMusicPlatform' {
  class QQMusicPlatform {
    constructor(config?: Record<string, any>);
  }
  export = QQMusicPlatform;
}