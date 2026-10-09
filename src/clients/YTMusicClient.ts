import type {
  Album, AlbumDetail, AlbumPage, Artist, ArtistDetail, ArtistPage, Playlist, PlaylistCategory,
  PlaylistDetail, PlaylistPage, SearchSuggest, ToplistGroup, Track, TrackLyrics, TrackPage,
  TrackUrl, UserProfile, WowAdapter
} from 'aduoer-wow-sdk';
import { createHash } from 'node:crypto';
import { BadRequestError, NotFoundError, UnplayableError, UpstreamError } from '../errors';
import { YTMusicApi } from '../ytmusic/api';
import { at, continuation, findAll, mapAlbum, mapArtist, mapPlaylist, mapTrack, rows, text, thumbnail, tiles } from '../ytmusic/parse';

const SEARCH_PARAMS: Record<string, string> = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  playlists: 'Eg-KAQwIABAAGAAgACgBMABqChAEEAMQCRAFEAo%3D'
};

let rawTrackCacheGeneration = 0;
const rawTrackUrlCache = new Map<string, { value: TrackUrl; expiresAt: number }>();
const rawTrackUrlRequests = new Map<string, Promise<TrackUrl>>();

function rawTrackCacheKey(cookie: string, id: string, quality: string): string {
  return `${createHash('sha256').update(cookie).digest('hex')}:${id}:${quality}`;
}

function rawTrackCacheExpiry(url: string): number {
  const now = Date.now();
  const upstreamExpiry = Number(new URL(url).searchParams.get('expire')) * 1000;
  return Math.min(now + 30 * 60_000,
    Number.isFinite(upstreamExpiry) && upstreamExpiry > 0 ? upstreamExpiry - 5 * 60_000 : now + 5 * 60_000);
}

function page<T>(items: T[], offset: number, limit: number, hasMore: boolean) {
  return { items: items.slice(offset, offset + limit), offset, limit, hasMore };
}

function succeeded(response: any): boolean {
  return typeof response?.status === 'string' && response.status.includes('SUCCEEDED');
}

function isPlaylistId(id: string): boolean { return /^(PL|RD|OLAK|LM)/.test(id); }

export class YTMusicClient implements WowAdapter {
  private readonly api: YTMusicApi;
  private streamUrl?: (id: string, quality: string) => string;

  constructor(
    private readonly cookie: string,
    private readonly favoriteTracks = new Set<string>(),
    private readonly favoriteArtists = new Set<string>(),
    private readonly favoriteAlbums = new Set<string>(),
    private readonly savedPlaylists = new Set<string>()
  ) {
    this.api = new YTMusicApi(cookie);
  }

  setStreamUrl(builder: (id: string, quality: string) => string): void { this.streamUrl = builder; }

  private requireLogin(): void {
    if (!this.cookie) throw new BadRequestError('此操作需要 YouTube Music 浏览器 Cookie');
  }

  private withTrack(track: Track): Track { return { ...track, favorite: this.favoriteTracks.has(track.id) || track.favorite }; }
  private withArtist(artist: Artist): Artist { return { ...artist, favorite: this.favoriteArtists.has(artist.id) }; }
  private withAlbum(album: Album): Album { return { ...album, favorite: this.favoriteAlbums.has(album.id) }; }

  private async browseRows(id: string, target = 100): Promise<{ response: any; items: any[]; more: boolean }> {
    let response = await this.api.browse(id);
    const initial = response;
    const items = rows(response);
    let token = continuation(response);
    const seen = new Set<string>();
    while (token && items.length < target && !seen.has(token)) {
      seen.add(token);
      response = await this.api.request('browse', { continuation: token });
      items.push(...rows(response));
      token = continuation(response);
    }
    return { response: initial, items, more: Boolean(token) };
  }

  private async search(kind: keyof typeof SEARCH_PARAMS, keyword: string, offset: number, limit: number): Promise<{ items: any[]; more: boolean }> {
    const body = { query: keyword, params: SEARCH_PARAMS[kind] };
    let response = await this.api.request('search', body);
    const items = rows(response);
    let token = continuation(response);
    const seen = new Set<string>();
    while (token && items.length < offset + limit && !seen.has(token)) {
      seen.add(token);
      response = await this.api.request('search', { ...body, continuation: token });
      items.push(...rows(response));
      token = continuation(response);
    }
    return { items, more: Boolean(token) };
  }

  async searchTracks(keyword: string, offset: number, limit: number): Promise<TrackPage> {
    const { items, more } = await this.search('songs', keyword, offset, limit);
    const mapped = items.map(mapTrack).filter((track) => track.id).map((track) => this.withTrack(track));
    return page(mapped, offset, limit, more || offset + limit < mapped.length);
  }

  async searchArtists(keyword: string, offset: number, limit: number): Promise<ArtistPage> {
    const { items, more } = await this.search('artists', keyword, offset, limit);
    const mapped = items.map(mapArtist).filter((artist) => artist.id).map((artist) => this.withArtist(artist));
    return page(mapped, offset, limit, more || offset + limit < mapped.length);
  }

  async searchAlbums(keyword: string, offset: number, limit: number): Promise<AlbumPage> {
    const { items, more } = await this.search('albums', keyword, offset, limit);
    const mapped = items.map(mapAlbum).filter((album) => album.id).map((album) => this.withAlbum(album));
    return page(mapped, offset, limit, more || offset + limit < mapped.length);
  }

  async searchPlaylists(keyword: string, offset: number, limit: number): Promise<PlaylistPage> {
    const { items, more } = await this.search('playlists', keyword, offset, limit);
    const mapped = items.map(mapPlaylist).filter((playlist) => playlist.id);
    return page(mapped, offset, limit, more || offset + limit < mapped.length);
  }

  async searchSuggest(keyword: string): Promise<SearchSuggest> {
    const tracks = await this.searchTracks(keyword, 0, 5);
    return { songs: tracks.items, artists: [], albums: [] };
  }

  async getPlaylistDetail(id: string, trackLimit = -1): Promise<PlaylistDetail> {
    const normalized = id.replace(/^VL/, '');
    const { response, items } = await this.browseRows(`VL${normalized}`, trackLimit < 0 ? 1000 : Math.max(1, trackLimit));
    const header = findAll(response, 'musicResponsiveHeaderRenderer', 1)[0] || findAll(response, 'musicEditablePlaylistDetailHeaderRenderer', 1)[0];
    if (!header) throw new NotFoundError('YouTube Music 歌单不存在');
    const tracks = trackLimit === 0 ? [] : items.map(mapTrack).filter((track) => track.id)
      .slice(0, trackLimit < 0 ? undefined : trackLimit).map((track) => this.withTrack(track));
    const countText = text(header.secondSubtitle);
    const count = Number(countText.match(/([\d,]+) (?:songs|tracks)/)?.[1]?.replace(/,/g, '') || tracks.length);
    return {
      id: normalized,
      name: text(header.title),
      description: text(at(header, 'description', 'musicDescriptionShelfRenderer', 'description')),
      coverUrl: thumbnail(header),
      trackCount: count,
      tracks
    };
  }

  async getAlbumDetail(id: string, trackLimit = -1): Promise<AlbumDetail> {
    const response = await this.api.browse(id);
    const header = findAll(response, 'musicResponsiveHeaderRenderer', 1)[0];
    if (!header) throw new NotFoundError('YouTube Music 专辑不存在');
    const artistRun = header.straplineTextOne?.runs?.[0];
    const artist = artistRun ? { id: String(at(artistRun, 'navigationEndpoint', 'browseEndpoint', 'browseId') || ''), name: String(artistRun.text || '') } : undefined;
    const tracks = trackLimit === 0 ? [] : rows(findAll(response, 'musicShelfRenderer', 1)[0] || response)
      .map(mapTrack).filter((track) => track.id).slice(0, trackLimit < 0 ? undefined : trackLimit)
      .map((track) => this.withTrack({ ...track, album: { id, name: text(header.title), coverUrl: thumbnail(header) } }));
    return {
      id,
      name: text(header.title),
      coverUrl: thumbnail(header),
      artistName: artist?.name,
      artist,
      description: text(at(header, 'description', 'musicDescriptionShelfRenderer', 'description')),
      trackCount: Number(text(header.secondSubtitle).match(/(\d+) songs/)?.[1] || tracks.length),
      favorite: this.favoriteAlbums.has(id),
      tracks
    };
  }

  async getArtistDetail(id: string, trackLimit = -1): Promise<ArtistDetail> {
    const response = await this.api.browse(id);
    const header = findAll(response, 'musicImmersiveHeaderRenderer', 1)[0] || findAll(response, 'musicVisualHeaderRenderer', 1)[0];
    if (!header) throw new NotFoundError('YouTube Music 歌手不存在');
    const shelf = findAll(response, 'musicShelfRenderer', 1)[0];
    const tracks = trackLimit === 0 ? [] : rows(shelf || {}).map(mapTrack).filter((track) => track.id)
      .slice(0, trackLimit < 0 ? undefined : trackLimit).map((track) => this.withTrack(track));
    return {
      id,
      name: text(header.title),
      coverUrl: thumbnail(header),
      avatarUrl: thumbnail(header),
      description: text(findAll(response, 'musicDescriptionShelfRenderer', 1)[0]?.description),
      favorite: this.favoriteArtists.has(id),
      tracks
    };
  }

  async getArtistTracks(id: string, _order: string, offset: number, limit: number): Promise<TrackPage> {
    const response = await this.api.browse(id);
    const shelf = findAll(response, 'musicShelfRenderer', 1)[0];
    const playlistId = at(shelf, 'title', 'runs', 0, 'navigationEndpoint', 'browseEndpoint', 'browseId');
    if (!playlistId) {
      const items = rows(shelf || {}).map(mapTrack).filter((track) => track.id).map((track) => this.withTrack(track));
      return page(items, offset, limit, offset + limit < items.length);
    }
    const { items, more } = await this.browseRows(playlistId, offset + limit);
    const tracks = items.map(mapTrack).filter((track) => track.id).map((track) => this.withTrack(track));
    return page(tracks, offset, limit, more || offset + limit < tracks.length);
  }

  async getArtistAlbums(id: string, offset: number, limit: number): Promise<AlbumPage> {
    const response = await this.api.browse(id);
    const shelves = findAll(response, 'musicCarouselShelfRenderer');
    const albumShelf = shelves.find((shelf) => /albums|singles/i.test(text(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title)));
    const albums = tiles(albumShelf || {}).map(mapAlbum).filter((album) => album.id).map((album) => this.withAlbum(album));
    return page(albums, offset, limit, offset + limit < albums.length);
  }

  async getTrackDetail(id: string): Promise<Track> {
    const [response, musicResponse] = await Promise.all([
      this.api.player(id),
      this.api.request('next', { videoId: id, isAudioOnly: true }).catch(() => null)
    ]);
    const details = response.videoDetails;
    if (!details) throw new NotFoundError('YouTube Music 歌曲不存在');
    const musicTrack = findAll(musicResponse, 'playlistPanelVideoRenderer')
      .find((row) => row.videoId === id);
    return this.withTrack(mapTrack({
      videoId: id,
      title: details.title,
      author: details.author,
      channelId: details.channelId,
      duration_seconds: Number(details.lengthSeconds),
      thumbnails: musicTrack?.thumbnail?.thumbnails || []
    }));
  }

  async getRawTrackUrl(id: string, quality = 'higher'): Promise<TrackUrl> {
    const generation = rawTrackCacheGeneration;
    const key = rawTrackCacheKey(this.cookie, id, quality);
    const cached = rawTrackUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const inFlight = rawTrackUrlRequests.get(key);
    if (inFlight) return inFlight;

    const request = (async () => {
      const response = await this.api.player(id);
      const formats = (response.streamingData?.adaptiveFormats || [])
        .filter((format: any) => format.url && String(format.mimeType || '').startsWith('audio/mp4'))
        .sort((left: any, right: any) => Number(left.bitrate || 0) - Number(right.bitrate || 0));
      if (!formats.length) {
        throw new UnplayableError(response.playabilityStatus?.reason || 'YouTube Music 未返回可播放的音频地址');
      }
      const selected = quality === 'min' || quality === 'standard' ? formats[0] : formats[formats.length - 1];
      const result: TrackUrl = {
        url: selected.url,
        quality: quality === 'min' || quality === 'standard' ? 'standard' : 'higher',
        format: 'm4a',
        bitrate: Number(selected.bitrate) || null,
        size: Number(selected.contentLength) || 0
      };
      const expiresAt = rawTrackCacheExpiry(result.url);
      if (generation === rawTrackCacheGeneration && expiresAt > Date.now()) {
        rawTrackUrlCache.set(key, { value: result, expiresAt });
        if (rawTrackUrlCache.size > 256) rawTrackUrlCache.delete(rawTrackUrlCache.keys().next().value!);
      }
      return result;
    })();
    rawTrackUrlRequests.set(key, request);
    try { return await request; }
    finally { rawTrackUrlRequests.delete(key); }
  }

  async getTrackUrl(id: string, quality = 'higher'): Promise<TrackUrl> {
    const raw = await this.getRawTrackUrl(id, quality);
    return { ...raw, url: this.streamUrl ? this.streamUrl(id, quality) : raw.url };
  }

  async getTrackLyrics(id: string): Promise<TrackLyrics> {
    const next = await this.api.request('next', { videoId: id, isAudioOnly: true });
    const lyricsId = findAll(next, 'browseEndpoint').find((entry) => String(entry.browseId || '').startsWith('MPLY'))?.browseId;
    if (!lyricsId) return { lyrics: '', wordLyrics: '', translatedLyrics: '' };
    const response = await this.api.browse(lyricsId);
    const shelf = findAll(response, 'musicDescriptionShelfRenderer', 1)[0];
    return { lyrics: text(shelf?.description), wordLyrics: '', translatedLyrics: '' };
  }

  async getSimilarTracks(id: string): Promise<Track[]> {
    const response = await this.api.request('next', {
      videoId: id, playlistId: `RDAMVM${id}`, params: 'wAEB',
      isAudioOnly: true, enablePersistentPlaylistPanel: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL'
    });
    return findAll(response, 'playlistPanelVideoRenderer').map((row) => {
      const runs = row.longBylineText?.runs || [];
      const separator = runs.findIndex((run: any) => run.text === ' • ');
      const artistRuns = separator < 0 ? runs : runs.slice(0, separator);
      const artists = artistRuns.filter((run: any) => run.text && !/^[,& ]+$/.test(run.text)).map((run: any) => ({
        id: String(at(run, 'navigationEndpoint', 'browseEndpoint', 'browseId') || ''), name: String(run.text)
      }));
      const albumRun = runs.find((run: any) => String(at(run, 'navigationEndpoint', 'browseEndpoint', 'browseId') || '').startsWith('MPRE'));
      return this.withTrack(mapTrack({
        videoId: row.videoId,
        title: text(row.title),
        artists,
        album: albumRun ? { id: at(albumRun, 'navigationEndpoint', 'browseEndpoint', 'browseId'), name: albumRun.text } : undefined,
        duration: text(row.lengthText),
        thumbnails: at(row, 'thumbnail', 'thumbnails') || []
      }));
    }).filter((track) => track.id && track.id !== id);
  }

  async getRoamTracks(): Promise<Track[]> {
    const tracks = await this.getDailyTracks();
    const seed = tracks[0] || (await this.getNewTracks())[0];
    return seed ? this.getSimilarTracks(seed.id) : [];
  }

  async getRecommendedPlaylist(offset: number, limit: number): Promise<PlaylistPage> {
    const response = await this.api.browse('FEmusic_home');
    let items = tiles(response).map(mapPlaylist).filter((item) => isPlaylistId(item.id));
    if (!items.length && this.cookie) {
      // Signed-in home shelves can contain only albums and non-browsable radio mixes.
      // Use the public home playlists so the Wow playlist shelf remains usable.
      const publicHome = await new YTMusicApi('').browse('FEmusic_home');
      items = tiles(publicHome).map(mapPlaylist).filter((item) => isPlaylistId(item.id));
    }
    return page(items, offset, limit, offset + limit < items.length);
  }

  async getPlaylists(offset: number, limit: number, _category?: string): Promise<PlaylistPage> {
    return this.getRecommendedPlaylist(offset, limit);
  }

  async getPlaylistCategories(): Promise<PlaylistCategory[]> { return [{ key: 'recommended', label: '推荐' }]; }

  async getToplist(): Promise<ToplistGroup[]> {
    const response = await this.api.browse('FEmusic_charts');
    return findAll(response, 'musicCarouselShelfRenderer').map((shelf) => ({
      name: text(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title),
      displayType: 'GRID',
      list: tiles(shelf).map(mapPlaylist).filter((item) => isPlaylistId(item.id)).map((item) => ({
        id: item.id, name: item.name, coverUrl: item.coverUrl, updateFrequency: '', tracks: []
      }))
    })).filter((group) => group.list.length);
  }

  async getToplistTracks(id: string, offset: number, limit: number): Promise<PlaylistDetail> {
    const detail = await this.getPlaylistDetail(id, offset + limit);
    return { ...detail, tracks: detail.tracks.slice(offset, offset + limit) };
  }

  async getNewTracks(): Promise<Track[]> {
    const response = await this.api.browse('FEmusic_explore');
    return rows(response).map(mapTrack).filter((track) => track.id).map((track) => this.withTrack(track));
  }

  async getDailyTracks(): Promise<Track[]> {
    const response = await this.api.browse('FEmusic_home');
    const tracks = rows(response).map(mapTrack).filter((track) => track.id).map((track) => this.withTrack(track));
    return tracks.length ? tracks : this.getNewTracks();
  }

  async getUserPlaylist(): Promise<Playlist[]> {
    this.requireLogin();
    const response = await this.api.browse('FEmusic_liked_playlists');
    const items = [...tiles(response), ...rows(response)].map(mapPlaylist).filter((item) => item.id);
    this.savedPlaylists.clear(); items.forEach((item) => this.savedPlaylists.add(item.id));
    return items;
  }

  async userFavoriteTracks(): Promise<Track[]> {
    this.requireLogin();
    const { items } = await this.browseRows('VLLM', 1000);
    const tracks = items.map(mapTrack).filter((track) => track.id);
    this.favoriteTracks.clear(); tracks.forEach((track) => this.favoriteTracks.add(track.id));
    return tracks.map((track) => this.withTrack(track));
  }

  async userArtists(): Promise<Artist[]> {
    this.requireLogin();
    const { response, items } = await this.browseRows('FEmusic_library_corpus_artists', 500);
    const artists = [...items, ...tiles(response)].map(mapArtist).filter((artist) => artist.id);
    this.favoriteArtists.clear(); artists.forEach((artist) => this.favoriteArtists.add(artist.id));
    return artists.map((artist) => this.withArtist(artist));
  }

  async userAlbums(): Promise<Album[]> {
    this.requireLogin();
    const { response, items } = await this.browseRows('FEmusic_liked_albums', 500);
    const albums = [...items, ...tiles(response)].map(mapAlbum).filter((album) => album.id);
    this.favoriteAlbums.clear(); albums.forEach((album) => this.favoriteAlbums.add(album.id));
    return albums.map((album) => this.withAlbum(album));
  }

  async getUserMe(): Promise<UserProfile> {
    this.requireLogin();
    const response = await this.api.request('account/account_menu');
    const header = findAll(response, 'activeAccountHeaderRenderer', 1)[0];
    if (!header) throw new BadRequestError('YouTube Music 未识别登录态。请从 music.youtube.com 的 youtubei/v1/browse 请求复制完整 Cookie，并确认浏览器中已登录');
    return {
      userId: text(header.channelHandle) || text(header.accountName),
      nickname: text(header.accountName),
      avatar: thumbnail(header.accountPhoto),
      platform: 'ytmusic'
    };
  }

  async favoriteTrack(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    this.requireLogin();
    const response = await this.api.request(status ? 'like/like' : 'like/removelike', { target: { videoId: id } });
    if (!succeeded(response)) throw new UpstreamError('YouTube Music 收藏歌曲失败');
    if (status) this.favoriteTracks.add(id); else this.favoriteTracks.delete(id);
    return { success: true, status };
  }

  async favoriteArtist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    this.requireLogin();
    await this.api.request(status ? 'subscription/subscribe' : 'subscription/unsubscribe', { channelIds: [id] });
    if (status) this.favoriteArtists.add(id); else this.favoriteArtists.delete(id);
    return { success: true, status };
  }

  async favoritePlaylist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    this.requireLogin();
    const response = await this.api.request(status ? 'like/like' : 'like/removelike', { target: { playlistId: id } });
    if (!succeeded(response)) throw new UpstreamError('YouTube Music 收藏歌单失败');
    if (status) this.savedPlaylists.add(id); else this.savedPlaylists.delete(id);
    return { success: true, status };
  }

  async favoriteAlbum(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    this.requireLogin();
    const response = await this.api.browse(id);
    const playlistId = findAll(response, 'watchPlaylistEndpoint').find((entry) => String(entry.playlistId || '').startsWith('OLAK'))?.playlistId;
    if (!playlistId) throw new NotFoundError('YouTube Music 专辑播放列表不存在');
    const result = await this.api.request(status ? 'like/like' : 'like/removelike', { target: { playlistId } });
    if (!succeeded(result)) throw new UpstreamError('YouTube Music 收藏专辑失败');
    if (status) this.favoriteAlbums.add(id); else this.favoriteAlbums.delete(id);
    return { success: true, status };
  }

  async createPlaylist(name: string): Promise<Playlist> {
    this.requireLogin();
    const response = await this.api.request('playlist/create', { title: name, description: '', privacyStatus: 'PRIVATE' });
    if (!response.playlistId) throw new UpstreamError('YouTube Music 创建歌单失败');
    return { id: response.playlistId, name, description: '', coverUrl: '', trackCount: 0 };
  }

  async deletePlaylist(id: string): Promise<{ success: boolean }> {
    this.requireLogin();
    const response = await this.api.request('playlist/delete', { playlistId: id });
    if (!succeeded(response)) throw new UpstreamError('YouTube Music 删除歌单失败');
    return { success: true };
  }

  async updatePlaylist(id: string, name: string, description: string): Promise<Playlist> {
    this.requireLogin();
    const actions = [
      { action: 'ACTION_SET_PLAYLIST_NAME', playlistName: name },
      { action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: description }
    ];
    const response = await this.api.request('browse/edit_playlist', { playlistId: id, actions });
    if (!succeeded(response)) throw new UpstreamError('YouTube Music 更新歌单失败');
    const detail = await this.getPlaylistDetail(id, 0);
    return { ...detail, name, description };
  }

  async addTrackToPlaylist(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    this.requireLogin();
    const response = await this.api.request('browse/edit_playlist', {
      playlistId, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: trackId }]
    });
    if (!succeeded(response)) throw new UpstreamError('YouTube Music 添加歌曲失败');
    return { success: true };
  }

  async removeTrack(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    this.requireLogin();
    const { items } = await this.browseRows(`VL${playlistId.replace(/^VL/, '')}`, 1000);
    const row = items.map((item) => item.musicResponsiveListItemRenderer)
      .find((item) => item.playlistItemData?.videoId === trackId);
    const setVideoId = row?.playlistItemData?.playlistSetVideoId;
    if (!setVideoId) throw new NotFoundError('歌单中未找到可删除的歌曲');
    const result = await this.api.request('browse/edit_playlist', {
      playlistId,
      actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: trackId, setVideoId }]
    });
    if (!succeeded(result)) throw new UpstreamError('YouTube Music 移除歌曲失败');
    return { success: true };
  }
}

export function clearYTMusicTrackCache(cookie: string): void {
  rawTrackCacheGeneration += 1;
  const prefix = `${createHash('sha256').update(cookie).digest('hex')}:`;
  for (const key of rawTrackUrlCache.keys()) if (key.startsWith(prefix)) rawTrackUrlCache.delete(key);
  for (const key of rawTrackUrlRequests.keys()) if (key.startsWith(prefix)) rawTrackUrlRequests.delete(key);
}
