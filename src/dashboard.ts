import os from 'node:os';
import type { Request, Response, Router } from 'express';
import express from 'express';
import QRCode from 'qrcode';

export interface DashboardAddress {
  ip: string;
  host: string;
  payload: string;
  addUrl: string;
  qrImage: string;
  isLoopback: boolean;
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function listLanIpv4Addresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string[] {
  const addresses: Array<{ ip: string; private: boolean; interfaceName: string }> = [];
  Object.entries(interfaces).forEach(([interfaceName, records]) => {
    (records ?? []).forEach((record) => {
      if (record.family !== 'IPv4') return;
      if (record.internal || record.address.startsWith('169.254.')) return;
      addresses.push({ ip: record.address, private: isPrivateIpv4(record.address), interfaceName });
    });
  });
  addresses.sort((left, right) => {
    if (left.private !== right.private) return left.private ? -1 : 1;
    return left.interfaceName.localeCompare(right.interfaceName) || left.ip.localeCompare(right.ip);
  });
  return [...new Set(addresses.map(({ ip }) => ip))];
}

export function createOriginAddPayload(
  host: string,
  token: string = '',
  name: string = ''
): { payload: string; addUrl: string } {
  const payload = `type=wow&host=${host}&token=${token}&name=${name}`;
  const auth = Buffer.from(payload, 'utf8').toString('base64url');
  return { payload, addUrl: `aduoer://origin/add?auth=${auth}` };
}

function browserEndpoint(req: Request): { ip: string; port: number } {
  const raw = String(req.headers.host || '').trim();
  const fallbackPort = Number(req.socket.localPort || process.env.PORT || 3000);
  if (!raw) return { ip: '127.0.0.1', port: fallbackPort };
  if (raw.startsWith('[')) {
    const closingBracket = raw.indexOf(']');
    if (closingBracket > 0) {
      const externalPort = Number(raw.slice(closingBracket + 1).match(/^:(\d+)$/)?.[1]);
      return {
        ip: raw.slice(1, closingBracket),
        port: externalPort > 0 && externalPort <= 65535 ? externalPort : fallbackPort
      };
    }
  }
  const hostAndPort = raw.match(/^(.*):(\d+)$/);
  const externalPort = Number(hostAndPort?.[2]);
  return {
    ip: hostAndPort?.[1] || raw,
    port: externalPort > 0 && externalPort <= 65535 ? externalPort : fallbackPort
  };
}

export function createDashboardRouter(): Router {
  const router = express.Router();

  router.post('/origin-qr', async (req: Request, res: Response, next) => {
    try {
      const host = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      let parsedHost: URL;
      try {
        parsedHost = new URL(host);
      } catch {
        res.status(400).json({ code: 400, message: '源地址无效' });
        return;
      }
      if (!['http:', 'https:'].includes(parsedHost.protocol) || host.length > 2048 || token.length > 256 || name.length > 100) {
        res.status(400).json({ code: 400, message: '二维码内容无效' });
        return;
      }
      const { payload, addUrl } = createOriginAddPayload(host, token, name);
      const qrImage = await QRCode.toDataURL(addUrl, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'H'
      });
      res.json({ code: 200, data: { payload, addUrl, qrImage } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', async (req: Request, res: Response, next) => {
    try {
      const desktop = process.env.WOW_DESKTOP === '1';
      const browser = browserEndpoint(req);
      const port = desktop
        ? Number(req.socket.localPort || process.env.PORT || 3000)
        : browser.port;
      const lanAddresses = desktop ? listLanIpv4Addresses() : [browser.ip];
      const ips = lanAddresses.length > 0 ? lanAddresses : ['127.0.0.1'];
      const addresses: DashboardAddress[] = await Promise.all(ips.map(async (ip) => {
        const renderedIp = ip.includes(':') ? `[${ip}]` : ip;
        const host = `http://${renderedIp}:${port}`;
        const { payload, addUrl } = createOriginAddPayload(host);
        return {
          ip,
          host,
          payload,
          addUrl,
          qrImage: await QRCode.toDataURL(addUrl, {
            width: 320,
            margin: 1,
            errorCorrectionLevel: 'H'
          }),
          isLoopback: ip === '127.0.0.1' || ip === 'localhost'
        };
      }));

      res.json({
        code: 200,
        data: {
          status: 'running',
          port,
          preferredIp: addresses[0].ip,
          addresses
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
