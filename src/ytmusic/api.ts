import { createHash } from 'node:crypto';
import { UpstreamError } from '../errors';

const ORIGIN = 'https://music.youtube.com';
const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const VISIONOS_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const visitors = new Map<string, { value: string; expires: number }>();
const musicVisitors = new Map<string, { value: string; expires: number }>();
// The same InnerTube endpoint and browser authentication used by sigma67/ytmusicapi.
// Overridable via env so deployments are not forced to rely on a key baked into source control.
const API_KEY = process.env.YTMUSIC_API_KEY || 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

export function cookieValue(cookie: string, name: string): string {
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

export class YTMusicApi {
  constructor(private readonly cookie: string) {}

  private async musicVisitorData(): Promise<string> {
    const key = createHash('sha256').update(this.cookie).digest('hex');
    const cached = musicVisitors.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    try {
      const response = await fetch(ORIGIN, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
          ...(this.cookie ? { Cookie: this.cookie } : {})
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        musicVisitors.set(key, { value: '', expires: Date.now() + 5 * 60 * 1000 });
        return '';
      }
      const html = await response.text();
      const value = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] || '';
      musicVisitors.set(key, { value, expires: Date.now() + (value ? 30 : 5) * 60 * 1000 });
      return value;
    } catch {
      // A missing visitor ID must not prevent the authenticated request itself.
      musicVisitors.set(key, { value: '', expires: Date.now() + 5 * 60 * 1000 });
      return '';
    }
  }

  private async visitorData(videoId: string): Promise<string> {
    const key = createHash('sha256').update(this.cookie).digest('hex');
    const cached = visitors.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    let response: Response;
    try {
      response = await fetch(`${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(videoId)}`, {
        headers: {
          'User-Agent': VISIONOS_USER_AGENT,
          ...(this.cookie ? { Cookie: this.cookie } : {})
        },
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new UpstreamError(`YouTube 访客标识请求失败: ${(error as Error).message}`);
    }
    if (!response.ok) throw new UpstreamError(`YouTube 访客标识请求返回 HTTP ${response.status}`);
    const html = await response.text();
    const value = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1];
    if (!value) throw new UpstreamError('YouTube 未返回访客标识');
    visitors.set(key, { value, expires: Date.now() + 30 * 60 * 1000 });
    return value;
  }

  async player(videoId: string): Promise<any> {
    const visitorData = await this.visitorData(videoId);
    const context = {
      client: {
        clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple',
        deviceModel: 'RealityDevice17,1', userAgent: VISIONOS_USER_AGENT,
        osName: 'visionOS', osVersion: '26.5.23O471', visitorData, hl: 'en', gl: 'US'
      },
      user: {}
    };
    let response: Response;
    try {
      response = await fetch(`${YOUTUBE_ORIGIN}/youtubei/v1/player?alt=json&key=${API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': YOUTUBE_ORIGIN,
          'Referer': `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(videoId)}`,
          'User-Agent': VISIONOS_USER_AGENT,
          'X-YouTube-Client-Name': '101',
          'X-YouTube-Client-Version': '1.02',
          'X-Goog-Visitor-Id': visitorData,
          ...(this.cookie ? { Cookie: this.cookie } : {})
        },
        body: JSON.stringify({
          context, videoId, contentCheckOk: true, racyCheckOk: true,
          playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } }
        }),
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new UpstreamError(`YouTube 播放信息请求失败: ${(error as Error).message}`);
    }
    if (!response.ok) throw new UpstreamError(`YouTube 播放信息请求返回 HTTP ${response.status}`);
    try { return await response.json(); }
    catch { throw new UpstreamError('YouTube 播放信息无法解析'); }
  }

  async request(endpoint: string, body: Record<string, unknown> = {}): Promise<any> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const visitorData = this.cookie ? await this.musicVisitorData() : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': ORIGIN,
      'Referer': `${ORIGIN}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': `1.${day}.01.00`,
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {})
    };
    if (this.cookie) {
      headers.Cookie = this.cookie;
      headers['X-Goog-AuthUser'] = '0';
      const sapisid = cookieValue(this.cookie, '__Secure-3PAPISID') || cookieValue(this.cookie, 'SAPISID');
      if (sapisid) {
        const timestamp = Math.floor(Date.now() / 1000);
        const hash = createHash('sha1').update(`${timestamp} ${sapisid} ${ORIGIN}`).digest('hex');
        headers.Authorization = `SAPISIDHASH ${timestamp}_${hash}`;
        headers['X-Origin'] = ORIGIN;
      }
    }

    let response: Response;
    try {
      response = await fetch(`${ORIGIN}/youtubei/v1/${endpoint}?alt=json&key=${API_KEY}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          context: { client: { clientName: 'WEB_REMIX', clientVersion: `1.${day}.01.00`, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) }, user: {} },
          ...body
        }),
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new UpstreamError(`YouTube Music 请求失败: ${(error as Error).message}`);
    }
    if (!response.ok) throw new UpstreamError(`YouTube Music 返回 HTTP ${response.status}`);
    try {
      const payload: any = await response.json();
      if (payload?.error) throw new UpstreamError(payload.error.message || 'YouTube Music 请求失败');
      return payload;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('YouTube Music 返回的数据无法解析');
    }
  }

  browse(id: string, params?: string): Promise<any> {
    return this.request('browse', { browseId: id, ...(params ? { params } : {}) });
  }
}
