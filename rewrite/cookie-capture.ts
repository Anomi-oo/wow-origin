import { storageSet } from './storage';

interface CapturedPlatform {
  id: 'qq' | 'netease';
  name: string;
  key: string;
}

function platformFor(url: string): CapturedPlatform | undefined {
  if (/^https:\/\/c\.y\.qq\.com\/base\/fcgi-bin\/fcg_check(?:[/?]|$)/i.test(url)) {
    return { id: 'qq', name: 'QQ 音乐', key: 'wow-origin.cookie.qq.v1' };
  }
  if (/^https:\/\/music\.163\.com\/weapi\/user\/level(?:[/?]|$)/i.test(url)) {
    return { id: 'netease', name: '网易云音乐', key: 'wow-origin.cookie.netease.v1' };
  }
  return undefined;
}

function notify(title: string, subtitle: string, message: string): void {
  if (typeof $notify !== 'undefined') $notify(title, subtitle, message);
  else if (typeof $notification !== 'undefined') $notification.post(title, subtitle, message);
}

export function isCookieCaptureRequest(url: string): boolean {
  return Boolean(platformFor(url));
}

export function captureCookie(url: string, headers: Record<string, string> = {}): void {
  const platform = platformFor(url);
  if (!platform) return;
  const headerName = Object.keys(headers).find((name) => name.toLowerCase() === 'cookie');
  const cookie = headerName ? String(headers[headerName] || '').trim() : '';
  if (!cookie) {
    notify('Wow Origin', `${platform.name} Cookie 获取失败`, '请求头中没有 Cookie，请确认账号已登录后重试。');
    return;
  }
  const capturedAt = String(Date.now());
  const saved = storageSet(cookie, platform.key)
    && storageSet(platform.id, 'wow-origin.cookie.latest-platform.v1')
    && storageSet(cookie, 'wow-origin.cookie.latest-value.v1')
    && storageSet(capturedAt, 'wow-origin.cookie.latest-at.v1');
  notify(
    'Wow Origin',
    `${platform.name} Cookie ${saved ? '获取成功' : '保存失败'}`,
    saved ? '已保存，可在 Wow Origin 页面复制或导入账号。' : '当前代理工具无法写入持久化存储。'
  );
}
