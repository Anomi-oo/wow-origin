declare global {
  const $request: {
    url: string;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBytes?: ArrayBuffer;
  };

  const $prefs: {
    valueForKey(key: string): string | null;
    setValueForKey(value: string, key: string): boolean;
    removeValueForKey(key: string): boolean;
  };

  const $persistentStore: {
    read(key: string): string | null;
    write(value: string, key: string): boolean;
  };

  const $task: {
    fetch(request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyBytes?: ArrayBuffer;
      opts?: Record<string, unknown>;
    }): Promise<{
      statusCode: number;
      headers: Record<string, string | string[]>;
      body?: string;
      bodyBytes?: ArrayBuffer;
    }>;
  };

  const $httpClient: Record<string, (
    request: Record<string, unknown>,
    callback: (error: string | null, response: {
      status?: number;
      statusCode?: number;
      headers?: Record<string, string | string[]>;
    }, body?: string | Uint8Array) => void
  ) => void>;

  const $notification: {
    post(title: string, subtitle: string, message: string): void;
  };

  function $notify(title: string, subtitle: string, message: string): void;

  function $done(response?: any): void;

  var __wowPlatformModules__: Record<string, Record<string, (...args: any[]) => any>> | undefined;
  var __musicPlatformFactory__: any;
}

export {};
