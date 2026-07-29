import 'dotenv/config';
import type { Server } from 'node:http';
import { createApp } from './app';

const WelcomePage = require('../core/WelcomePage');

async function start() {
  try {
    WelcomePage.clear();
    WelcomePage.showBanner();
    WelcomePage.showStartupStatus();

    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '';
    const app = await createApp();
    const httpServer = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(port, host, () => resolve(listener));
      listener.on('error', reject);
    });
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

  } catch (error) {
    WelcomePage.showError('Server startup failed', error);
    process.exit(1);
  }
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
