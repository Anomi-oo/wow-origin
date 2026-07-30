import type { Album, AlbumDetail, AlbumPage, Artist, ArtistDetail, ArtistPage, Playlist, PlaylistCategory, PlaylistDetail, PlaylistPage, SearchSuggest, ToplistGroup, Track, TrackLyrics, TrackPage, TrackUrl, UserProfile } from 'aduoer-wow-sdk';
import { mapAlbum, mapAlbumDetail, mapArtist, mapArtistDetail, mapPlaylist, mapSearchSuggest, mapTrack, mapTrackLyrics, mapTrackUrl, mapUserDetail } from '../mappers/qq';
import { MusicClientBase } from './MusicClientBase';
import { NotFoundError, UnplayableError } from '../errors';
import { getQQPlaylistCategoryEntries, getQQPlaylistCategoryMap } from '../playlistCategories';

const DEFAULT_QQ_QUALITY = 'exhigh';

export function getQualityCandidates(quality?: string): string[] {
  if (!quality) return [DEFAULT_QQ_QUALITY, 'higher', 'standard'];
  if (quality === 'max') return ['lossless', 'exhigh', 'higher', 'standard'];
  if (quality === 'min') return ['standard', 'higher', 'exhigh', 'lossless'];
  return [quality];
}

export function normalizeQQCredentials(cookie: string = ''): { uin: string; qm_keyst: string } {
  const getCookie = (name: string): string => {
    if (!cookie || !name) return '';
    const match = cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${name}=`));
    return match ? match.split('=').slice(1).join('=') : '';
  };

  const uin = getCookie('uin').replace(/^o/, '');
  const qmKeyst = getCookie('qm_keyst');
  return { uin, qm_keyst: qmKeyst };
}

export class QQClient extends MusicClientBase {
  private readonly uin: string;
  private readonly qm_keyst: string;

  constructor(cookie: string, favoriteTrackSet?: Set<string>) {
    super(cookie, 'qq', favoriteTrackSet);
    const credentials = normalizeQQCredentials(cookie);
    this.uin = credentials.uin;
    this.qm_keyst = credentials.qm_keyst;
  }

  private async call(route: string, query: Record<string, any> = {}): Promise<any> {
    const result = await this.callModule(route, {
      ...query,
      uin: this.uin,
      qm_keyst: this.qm_keyst
    });
    return result;
  }

  async getPlaylists(offset: number, limit: number, category?: string): Promise<PlaylistPage> {
    const categoryMap = getQQPlaylistCategoryMap();
    const resolvedCategory = category || Object.keys(categoryMap)[0];
    if (!resolvedCategory || !categoryMap[resolvedCategory]) {
      return { items: [], offset, limit, hasMore: false };
    }

    const query = { offset, limit, category: resolvedCategory };
    const playlists = await this.call('top_playlist', query);
    const items = (playlists.playlists || playlists.toplists || []).map((item: any) => mapPlaylist(item));
    return { items, offset, limit, hasMore: items.length === limit };
  }

  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    return this.cachedUntilNextLocalMidnight('playlist/category', {}, () => (
      getQQPlaylistCategoryEntries().map(([key, label]) => ({ key, label }))
    ));
  }

  async getToplist(): Promise<ToplistGroup[]> {
    const raw = await this.call('toplist_detail_v2');
    const groups = Array.isArray(raw) ? raw : raw.data || raw.group || [];
    return groups.map((group: any) => ({
      name: group.name || group.groupName || '',
      displayType: group.displayType || 'TOP_3',
      list: (group.list || group.toplist || []).map((toplist: any) => ({
        id: String(toplist.id ?? toplist.topId ?? ''),
        name: toplist.name || toplist.title || '',
        coverUrl: toplist.coverUrl || toplist.coverImgUrl || toplist.headPicUrl || '',
        updateFrequency: toplist.updateFrequency || toplist.updateTips || '',
        tracks: (toplist.tracks || toplist.songList || toplist.song || []).slice(0, 3).map((track: any) => ({
          name: track.first || track.songname || track.name || track.title || '',
          artistName: track.second || track.singername || track.singerName || ''
        })),
        targetType: toplist.targetType || ''
      }))
    }));
  }

  async getToplistTracks(id: string, offset: number, limit: number): Promise<PlaylistDetail> {
    const raw = await this.call('toplist_songs_v2', { topId: id, offset, limit });
    const playlist = raw.playlist;
    if (!playlist) {
      throw new NotFoundError('Toplist not found');
    }
    const tracks = (playlist.tracks || []).map((item: any) => this.withFavoriteTrack(mapTrack(item)));
    return { ...mapPlaylist(playlist), tracks };
  }

  async getNewTracks(): Promise<Track[]> {
    const raw = await this.call('top_song');
    const tracks = this.toArrayPayload(raw, ['data', 'songs', 'songlist']);
    return tracks.map((item: any) => this.withFavoriteTrack(mapTrack(item)));
  }

  async getTopArtists(): Promise<Artist[]> {
    const raw = await this.call('top_artists');
    const artists = this.toArrayPayload(raw, ['artists', 'list']);
    return artists.map((item: any) => mapArtist(item));
  }

  async getRecommendedPlaylist(offset: number, limit: number): Promise<PlaylistPage> {
    const result = await this.call('personalized', { offset, limit });
    const items = (result.result || []).map((item: any) => mapPlaylist(item));
    return { items, offset, limit, hasMore: items.length === limit };
  }

  async getPlaylistDetail(id: string, trackLimit: number = -1): Promise<PlaylistDetail> {
    const upstreamLimit = trackLimit === -1 ? 1000 : trackLimit === 0 ? 1 : trackLimit;
    const result = await this.call('playlist_detail', { id, trackLimit, limit: upstreamLimit, offset: 0 });
    const playlist = result.playlist;
    if (!playlist) {
      throw new NotFoundError('Playlist not found');
    }
    const tracks = trackLimit !== 0 ? (playlist.tracks || []).slice(0, upstreamLimit).map((item: any) => this.withFavoriteTrack(mapTrack(item))) : [];
    return { ...mapPlaylist(playlist), tracks };
  }

  async getDailyFM(): Promise<Track[]> {
    return this.getPersonalFM();
  }

  async getDailyTracks(): Promise<Track[]> {
    const result = await this.call('recommend_songs');
    const tracks = this.toArrayPayload(result, ['dailySongs', 'tracks', 'songs']);
    return tracks.map((track: any) => this.withFavoriteTrack(mapTrack(track)));
  }

  async getPersonalFM(): Promise<Track[]> {
    const result = await this.call('personal_fm');
    const tracks = this.toArrayPayload(result, ['tracks', 'songs', 'data']);
    return tracks.map((track: any) => this.withFavoriteTrack(mapTrack(track)));
  }

  async getTrackDetail(id: string): Promise<Track> {
    const result = await this.call('song_detail', { mid: id, ids: id });
    const track = result.songs?.[0];
    if (!track) throw new NotFoundError('Song not found');
    return this.withFavoriteTrack(mapTrack(track));
  }

  /** QQ 相似歌曲接口只接受数字 song id，因此先通过对外使用的 mid 查询歌曲详情。 */
  async getSimilarTracks(id: string): Promise<Track[]> {
    const detail = await this.call('song_detail', { mid: id });
    const songId = detail.songs?.[0]?.id;
    if (songId === undefined || songId === null || String(songId).trim() === '') {
      throw new NotFoundError('Song not found');
    }

    const result = await this.call('similar_track', { id: songId });
    const tracks = this.toArrayPayload(result, ['songs', 'data']);
    return tracks.map((track: any) => this.withFavoriteTrack(mapTrack(track)));
  }

  async getTrackUrl(id: string, quality?: string): Promise<TrackUrl> {
    let resolvedAudio: any | undefined;

    for (const candidate of getQualityCandidates(quality)) {
      const result = await this.call('song_url', { mid: id, level: candidate });
      const audio = Array.isArray(result) ? result[0] : result.data?.[0] || result.data || result.songs?.[0];
      if (audio?.url) {
        resolvedAudio = { ...audio, level: candidate };
        break;
      }
    }

    if (!resolvedAudio) {
      throw new UnplayableError('Song has no playable audio URL');
    }

    return mapTrackUrl(resolvedAudio);
  }

  async getTrackLyric(id: string): Promise<TrackLyrics> {
    const lineLyricsPromise = this.call('lyric', { mid: id }).catch(() => ({}));
    const wordLyricsPromise = this.call('lyric_new', { mid: id }).catch(() => ({}));
    const [lineLyrics, wordLyrics] = await Promise.all([lineLyricsPromise, wordLyricsPromise]);
    return mapTrackLyrics(lineLyrics, wordLyrics);
  }

  async getTrackLineLyric(id: string): Promise<string> {
    const lineLyrics = await this.call('lyric', { mid: id });
    return mapTrackLyrics(lineLyrics).lyric;
  }

  async getTrackWordLyric(id: string): Promise<string> {
    const wordLyrics = await this.call('lyric_new', { mid: id });
    return mapTrackLyrics({}, wordLyrics).wordLyric;
  }

  async searchSuggest(keyword: string): Promise<SearchSuggest> {
    const raw = await this.call('search_suggest', { keywords: keyword });
    const result = mapSearchSuggest(raw);
    return { ...result, songs: this.withFavoriteTracks(result.songs) };
  }

  async searchTracks(keyword: string, offset: number, limit: number): Promise<TrackPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 1, offset, limit });
    const result = raw.result || {};
    const items = Array.isArray(result.songs) ? this.withFavoriteTracks(result.songs.map((item: any) => mapTrack(item))) : [];
    const total = result.songCount || 0;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async searchArtists(keyword: string, offset: number, limit: number): Promise<ArtistPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 100, offset, limit });
    const result = raw.result || {};
    const items = Array.isArray(result.artists) ? result.artists.map((item: any) => mapArtist(item)) : [];
    const total = result.artistCount || 0;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async searchAlbums(keyword: string, offset: number, limit: number): Promise<AlbumPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 10, offset, limit });
    const result = raw.result || {};
    const items = Array.isArray(result.albums) ? result.albums.map((item: any) => mapAlbum(item)) : [];
    const total = result.albumCount || 0;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async searchPlaylists(keyword: string, offset: number, limit: number): Promise<PlaylistPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 1000, offset, limit });
    const result = raw.result || {};
    const items = Array.isArray(result.playlists) ? result.playlists.map((item: any) => mapPlaylist(item)) : [];
    const total = result.playlistCount || 0;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async getArtistDetail(id: string, trackLimit: number = -1): Promise<ArtistDetail> {
    const raw = await this.call('artist_detail', { id });
    const data = raw.data?.artist || raw.artist || raw.data || raw;
    const detail = mapArtistDetail(data);
    if (trackLimit !== 0) {
      const limit = trackLimit === -1 ? 1000 : trackLimit;
      const tracks = await this.call('artist_tracks', { id, order: 'hot', offset: 0, limit });
      detail.tracks = (tracks.songs || []).map((item: any) => this.withFavoriteTrack(mapTrack(item)));
    }
    return detail;
  }

  async getArtistTracks(id: string, order: string, offset: number, limit: number): Promise<TrackPage> {
    const raw = await this.call('artist_tracks', { id, order, offset, limit });
    const items = Array.isArray(raw.songs) ? this.withFavoriteTracks(raw.songs.map((item: any) => mapTrack(item))) : [];
    const total = raw.total || 0;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async getArtistAlbums(id: string, offset: number, limit: number): Promise<AlbumPage> {
    const raw = await this.call('artist_album', { id, offset, limit });
    const items = Array.isArray(raw.hotAlbums) ? raw.hotAlbums.map((item: any) => mapAlbum(item)) : [];
    const total = raw.total || 0;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async getAlbumDetail(id: string, trackLimit: number = -1): Promise<AlbumDetail> {
    const raw = await this.call('album', { id, trackLimit });
    const detail = mapAlbumDetail(raw);
    detail.tracks = trackLimit !== 0 ? this.withFavoriteTracks(detail.tracks) : [];
    return detail;
  }

  async getUserPlaylist(): Promise<Playlist[]> {
    const result = await this.call('user_playlist', { uin: this.uin });
    const playlists = result.playlist || [];
    return playlists.map((item: any) => mapPlaylist(item));
  }

  async userFavoriteTracks(): Promise<Track[]> {
    const playlists = await this.getUserPlaylist();
    const favoritePlaylist = playlists.find((playlist) => playlist.name === '我喜欢');
    if (!favoritePlaylist) {
      this.clearFavoriteTracks();
      return [];
    }
    const detail = await this.getPlaylistDetail(favoritePlaylist.id);
    const tracks = detail.tracks || [];
    this.clearFavoriteTracks();
    tracks.forEach((track: Track) => this.addFavoriteTrack(track.id));
    return this.withFavoriteTracks(tracks);
  }

  async getUserMe(): Promise<UserProfile> {
    const raw = await this.call('user_detail', { uin: this.uin });
    return mapUserDetail(raw);
  }

  async favoriteTrack(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const curStatus = this.hasFavoriteTrack(id);
    const detail = await this.call('song_detail', { mid: id });
    const songId = detail.songs?.[0]?.id;
    if (songId === undefined || songId === null || String(songId).trim() === '') {
      throw new NotFoundError('Song not found');
    }
    const result = await this.call('like', { id: songId, like: status ? 'true' : 'false' });
    if (Number(result?.result?.tid) <= 0) {
      return { success: false, status: curStatus };
    }
    if (status) {
      this.addFavoriteTrack(id);
    } else {
      this.removeFavoriteTrack(id);
    }
    return { success: true, status };
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const raw = await this.call('playlist_create', { name });
    const playlist = raw.playlist || raw;
    return mapPlaylist({
      id: playlist.id,
      name: playlist.name || name,
      description: playlist.description || '',
      creator: { userId: this.uin, nickname: '' }
    });
  }

  async deletePlaylist(id: string): Promise<{ success: boolean }> {
    await this.call('playlist_delete', { id });
    return { success: true };
  }

  async updatePlaylist(id: string, name: string, description: string): Promise<Playlist> {
    await this.call('playlist_update', { id, name, desc: description });
    const detail = await this.getPlaylistDetail(id, 0);
    return { ...detail, name: name || detail.name, description };
  }

  async addTrackToPlaylist(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    const songId = await this.resolveWritableSongId(trackId);
    await this.call('playlist_tracks', { pid: playlistId, tracks: String(songId), op: 'add' });
    return { success: true };
  }

  async removeTrack(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    const songId = await this.resolveWritableSongId(trackId);
    await this.call('playlist_tracks', { pid: playlistId, tracks: String(songId), op: 'del' });
    return { success: true };
  }

  async favoritePlaylist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    await this.call('playlist_subscribe', { id, t: status ? 1 : 0 });
    return { success: true, status };
  }

  private async resolveWritableSongId(id: string): Promise<string | number> {
    if (/^\d+$/.test(id)) {
      return id;
    }

    const detail = await this.call('song_detail', { mid: id });
    const songId = detail.songs?.[0]?.id;
    if (songId === undefined || songId === null || String(songId).trim() === '') {
      throw new NotFoundError('Song not found');
    }
    return songId;
  }

}
