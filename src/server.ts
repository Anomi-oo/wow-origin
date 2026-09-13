import 'dotenv/config';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app';

const WelcomePage = require('../core/WelcomePage');

async function start() {
  try {
    WelcomePage.clear();
    WelcomePage.showBanner();
    WelcomePage.showStartupStatus();

    const preferredPort = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '';
    const app = await createApp();
    const { server: httpServer, port } = await listenWithOptionalFallback(
      app,
      preferredPort,
      host,
      process.env.PORT_FALLBACK === '1'
    );
    app.server = httpServer;
    app.loginRefreshScheduler?.start();
    app.lxSourceUpdateScheduler?.start();

    const serverInfo = buildServerInfo(app, {
      port,
      host
    });

    serverInfo.platforms.forEach((platform: any) => {
      WelcomePage.showPlatformStatus(
        platform.name,
        platform.modules,
        platform.deviceId || 'N/A',
        platform.staticIP,
        platform.defaultUid
      );
    });

    WelcomePage.showReadyStatus(serverInfo);

    if (process.env.WOW_DESKTOP === '1') {
      console.log(`WOW_ORIGIN_READY:${JSON.stringify({ host, port })}`);
    }

    let shuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      const { red, bright, reset } = WelcomePage.colors;
      console.log(`\n${red}${bright}🛑 ${signal} received, shutting down gracefully...${reset}`);
      app.loginRefreshScheduler?.stop();
      app.lxSourceUpdateScheduler?.stop();

      if (httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      await app.lxSourceManager?.stop();
      console.log(`${red}👋 Server closed${reset}`);
      process.exit(0);
    };

    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    if (process.env.WOW_DESKTOP === '1') {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        if (String(chunk).split(/\r?\n/).some((line) => line.trim() === 'shutdown')) {
          void gracefulShutdown('desktop');
        }
      });
    }

  } catch (error) {
    WelcomePage.showError('Server startup failed', error);
    process.exit(1);
  }
}

async function listenOnce(app: any, port: number, host: string): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const listener: Server = app.listen(port, host);
    const onError = (error: Error) => {
      listener.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      listener.off('error', onError);
      resolve(listener);
    };
    // Express 5 invokes its listen callback even when Node emits EADDRINUSE,
    // so the server events are the authoritative readiness signal here.
    listener.once('error', onError);
    listener.once('listening', onListening);
  });
}

export async function listenWithOptionalFallback(
  app: any,
  preferredPort: number,
  host: string,
  allowFallback: boolean
): Promise<{ server: Server; port: number }> {
  let server: Server;
  try {
    server = await listenOnce(app, preferredPort, host);
  } catch (error) {
    if (!allowFallback || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    console.warn(`[server] 端口 ${preferredPort} 已占用，正在选择空闲端口`);
    server = await listenOnce(app, 0, host);
  }
  const address = server.address() as AddressInfo | null;
  if (!address) throw new Error('服务器启动后未返回监听地址');
  return { server, port: address.port };
}

function buildServerInfo(app: any, options: { port: string | number; host: string }) {
  const serverInfo = {
    host: options.host || 'localhost',
    port: options.port,
    platforms: [] as any[]
  };

  if (app.platformFactory) {
    const availablePlatforms: string[] = app.platformFactory.getAvailablePlatforms();

    serverInfo.platforms = availablePlatforms.map((name: string) => {
      const platform = app.platformFactory.getPlatform(name);

      const platformInfo: any = {
        name,
        modules: platform.modules ? platform.modules.size : 0,
        status: 'ready'
      };

      if (platform.staticDeviceId) {
        platformInfo.deviceId = platform.staticDeviceId;
      } else if (platform.deviceId) {
        platformInfo.deviceId = platform.deviceId;
      }

      if (platform.staticCnIP) {
        platformInfo.staticIP = platform.staticCnIP;
      }

      if (platform.defaultUid) {
        platformInfo.defaultUid = platform.defaultUid;
      }

      return platformInfo;
    });
  }

  return serverInfo;
}

if (require.main === module) {
  start();
}

export { start };
