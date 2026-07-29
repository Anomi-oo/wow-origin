import type {
  AlbumDetail,
  AlbumPage,
  Artist,
  ArtistDetail,
  ArtistPage,
  MutationStatus,
  MutationSuccess,
  Playlist,
  PlaylistCategory,
  PlaylistDetail,
  PlaylistPage,
  SearchSuggest,
  ToplistGroup,
  Track,
  TrackLyrics,
  TrackUrl,
  TrackPage,
  UserProfile,
  WowAdapter
} from 'aduoer-wow-sdk';
import path from 'path';
import { type MusicPlatform, notSupported } from '../types';

export abstract class MusicClientBase implements WowAdapter {
  protected readonly cookie: string;
  protected readonly platform: MusicPlatform;
  protected readonly favoriteTrackSet: Set<string>;

  constructor(cookie: string, platform: MusicPlatform, favoriteTrackSet?: Set<string>) {
    this.cookie = cookie || '';
    this.platform = platform;
    this.favoriteTrackSet = favoriteTrackSet || new Set<string>();
  }

  protected unsupported(feature: string): never {
    return notSupported(this.platform, feature);
  }

  protected get platformFactory(): any {
    return (globalThis as any).__musicPlatformFactory__ || require(path.resolve(__dirname, '..', '..', 'platforms', 'PlatformFactory'));
  }

  private get platformModuleName(): string {
    return this.platform === 'qq' ? 'qqmusic' : this.platform;
  }

  protected async callModule(route: string, query: Record<string, any> = {}, body: Record<string, any> = {}): Promise<any> {
    const platformName = this.platformModuleName;
    const platform = this.platformFactory.getPlatform(platformName);
    const normalizedRoute = route.replace(/_/g, '/');
    const response = await platform.callModule(normalizedRoute, {
      query: {
        ...query,
        platform: platformName,
      },
      body,
      ip: 'internal'
    });

    if (!response || response.code !== 200) {
      throw new Error(response?.message || `${this.platform} ${route} request failed`);
    }

    if (response.body !== undefined) return response.body;
    if (response.data !== undefined) return response.data;
    const { code, ...data } = response;
    return data;
  }

  protected getCookieValue(name: string): string {
    if (!this.cookie || !name) return '';
    const match = this.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${name}=`));
    return match ? match.split('=').slice(1).join('=') : '';
  }

  protected hasFavoriteTrack(id: string): boolean {
    return this.favoriteTrackSet.has(id);
  }

  protected addFavoriteTrack(id: string): void {
    this.favoriteTrackSet.add(id);
  }

  protected removeFavoriteTrack(id: string): void {
    this.favoriteTrackSet.delete(id);
  }

  protected clearFavoriteTracks(): void {
    this.favoriteTrackSet.clear();
  }

  protected withFavoriteTrack<T extends Track>(track: T): T {
    return { ...track, favorite: this.hasFavoriteTrack(track.id) } as T;
  }

  protected withFavoriteTracks<T extends Track>(tracks: T[]): T[] {
    return tracks.map((track) => this.withFavoriteTrack(track)) as T[];
  }

  protected toArrayPayload<T = any>(value: any, keys: string[] = []): T[] {
    const payload = Array.isArray(value) ? value : value?.data ?? value;
    if (Array.isArray(payload)) {
      return payload;
    }
    for (const key of keys) {
      const nested = payload?.[key];
      if (Array.isArray(nested)) {
        return nested;
      }
    }
    return [];
  }

  protected cachedUntilNextLocalMidnight<T>(route: string, params: Record<string, any>, producer: () => T): T {
    const { globalCache } = require(path.resolve(__dirname, '..', '..', 'core', 'PlatformCache'));
    const platformName = this.platformModuleName;
    const cached = globalCache.get(platformName, route, params);
    if (cached) {
      return cached as T;
    }
    const value = producer();
    globalCache.set(platformName, route, params, value, this.millisecondsUntilNextLocalMidnight());
    return value;
  }

  private millisecondsUntilNextLocalMidnight(now: Date = new Date()): number {
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    return Math.max(1, nextMidnight.getTime() - now.getTime());
  }

  abstract getPlaylists(offset: number, limit: number, category?: string): Promise<PlaylistPage>;
  abstract getPlaylistCategories(): Promise<PlaylistCategory[]>;
  abstract getToplist(): Promise<ToplistGroup[]>;
  abstract getToplistTracks(id: string, offset: number, limit: number): Promise<PlaylistDetail>;
  abstract getNewTracks(): Promise<Track[]>;
  abstract getTopArtists(): Promise<Artist[]>;
  abstract getRecommendedPlaylist(offset: number, limit: number): Promise<PlaylistPage>;
  abstract getPlaylistDetail(id: string, trackLimit?: number): Promise<PlaylistDetail>;
  abstract getDailyFM(): Promise<Track[]>;
  abstract getDailyTracks(): Promise<Track[]>;
  abstract getPersonalFM(): Promise<Track[]>;
  abstract getTrackDetail(id: string): Promise<Track>;
  abstract getSimilarTracks(id: string): Promise<Track[]>;
  abstract getTrackUrl(id: string, quality?: string): Promise<TrackUrl>;
  abstract getTrackLyric(id: string): Promise<TrackLyrics>;
  abstract searchSuggest(keyword: string): Promise<SearchSuggest>;
  abstract searchTracks(keyword: string, offset: number, limit: number): Promise<TrackPage>;
  abstract searchArtists(keyword: string, offset: number, limit: number): Promise<ArtistPage>;
  abstract searchAlbums(keyword: string, offset: number, limit: number): Promise<AlbumPage>;
  abstract searchPlaylists(keyword: string, offset: number, limit: number): Promise<PlaylistPage>;
  abstract getArtistDetail(id: string, trackLimit?: number): Promise<ArtistDetail>;
  abstract getArtistTracks(id: string, order: string, offset: number, limit: number): Promise<TrackPage>;
  abstract getArtistAlbums(id: string, offset: number, limit: number): Promise<AlbumPage>;
  abstract getAlbumDetail(id: string, trackLimit?: number): Promise<AlbumDetail>;
  abstract getUserPlaylist(): Promise<Playlist[]>;
  abstract userFavoriteTracks(): Promise<Track[]>;
  abstract getUserMe(): Promise<UserProfile>;
  abstract favoriteTrack(id: string, status: boolean): Promise<MutationStatus>;
  abstract createPlaylist(name: string): Promise<Playlist>;
  abstract deletePlaylist(id: string): Promise<MutationSuccess>;
  abstract updatePlaylist(id: string, name: string, description: string): Promise<Playlist>;
  abstract addTrackToPlaylist(playlistId: string, trackId: string): Promise<MutationSuccess>;
  abstract removeTrack(playlistId: string, trackId: string): Promise<MutationSuccess>;
  abstract favoritePlaylist(id: string, status: boolean): Promise<MutationStatus>;
}
