import type { Album, AlbumDetail, AlbumPage, Artist, ArtistDetail, ArtistPage, Playlist, PlaylistCategory, PlaylistDetail, PlaylistPage, SearchSuggest, ToplistGroup, Track, TrackLyrics, TrackPage, TrackUrl, UserProfile } from 'aduoer-wow-sdk';
import { mapAlbum, mapAlbumDetail, mapArtist, mapArtistDetail, mapPlaylist, mapSearchSuggest, mapTrack, mapTrackLyrics, mapTrackUrl, mapUserDetail } from '../mappers/netease';
import { MusicClientBase } from './MusicClientBase';
import { APIError, BadRequestError, NotFoundError, UnplayableError, UpstreamError } from '../errors';
import { getNeteasePlaylistCategoryMap } from '../playlistCategories';
import { resolveTrackUrlWithFallback } from '../trackUrl';

const NETEASE_NO_LYRICS_PLACEHOLDER = '[00:00.00]暂无歌词';

export class NeteaseClient extends MusicClientBase {
  private readonly musicU: string;

  constructor(cookie: string, favoriteTrackSet?: Set<string>, favoriteArtistSet?: Set<string>, favoriteAlbumSet?: Set<string>, userPlaylistSet?: Set<string>) {
    super(cookie, 'netease', favoriteTrackSet, favoriteArtistSet, favoriteAlbumSet, userPlaylistSet);
    this.musicU = this.getCookieValue('MUSIC_U');
  }

  private async call(route: string, query: Record<string, any> = {}, keepEnvelope = false): Promise<any> {
    return this.callModule(route, {
      ...query,
      MUSIC_U: this.musicU || query.MUSIC_U || ''
    }, {}, keepEnvelope);
  }

  async getPlaylists(offset: number, limit: number, category?: string): Promise<PlaylistPage> {
    const categoryMap = getNeteasePlaylistCategoryMap();
    const resolvedCategory = category || Object.keys(categoryMap)[0];
    const label = resolvedCategory ? categoryMap[resolvedCategory] : undefined;
    if (!label) {
      return { items: [], offset, limit, hasMore: false };
    }

    const raw = await this.call('top_playlist', { offset, limit, total: true, cat: label });
    const items = (raw.playlists || raw.playlist || raw.toplists || []).map((item: any) => this.playlistFavorites.apply(mapPlaylist(item)));
    return { items, offset, limit, hasMore: items.length === limit };
  }

  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    return this.cachedUntilNextLocalMidnight('playlist/category', {}, () => (
      Object.entries(getNeteasePlaylistCategoryMap()).map(([key, label]) => ({ key, label }))
    ));
  }

  async getToplist(): Promise<ToplistGroup[]> {
    // v2 只提供精选分组；完整列表用于补齐遗漏的歌单榜，补充请求失败不影响原有分组。
    const [raw, fullList] = await Promise.all([
      this.call('toplist_detail_v2'),
      this.call('toplist_detail').catch(() => ({}))
    ]);
    const groups = Array.isArray(raw) ? raw : raw.data || raw.list || [];
    const isPlaylist = (toplist: any): boolean => (
      // H5 榜单没有歌单详情，且共用 id=0，会导致客户端列表标识冲突。
      (!toplist.targetType || toplist.targetType === 'PLAYLIST')
      && /^[1-9]\d*$/.test(String(toplist.id ?? ''))
    );
    const mapToplist = (toplist: any): ToplistGroup['list'][number] => ({
      id: String(toplist.id),
      name: toplist.name || '',
      coverUrl: toplist.coverUrl || toplist.coverImgUrl || '',
      updateFrequency: toplist.updateFrequency || '',
      tracks: (toplist.tracks || toplist.trackRankList || toplist.songList || []).slice(0, 3).map((track: any) => ({
        name: track.first || track.songName || track.songname || '',
        artistName: track.second || track.artistName || track.singername || ''
      })),
      targetType: 'PLAYLIST'
    });
    const result: ToplistGroup[] = groups.map((group: any) => ({
      name: group.name || '',
      displayType: group.displayType || group.frontDisplayType || 'TOP_3',
      list: (group.list || group.toplist || []).filter(isPlaylist).map(mapToplist)
    })).filter((group: ToplistGroup) => group.list.length > 0);

    const existingIds = new Set(result.flatMap((group) => group.list.map((toplist) => toplist.id)));
    const additional = (fullList.list || []).filter(isPlaylist).filter((toplist: any) => {
      const id = String(toplist.id);
      if (existingIds.has(id)) return false;
      existingIds.add(id);
      return true;
    }).map(mapToplist);
    if (additional.length > 0) {
      result.push({ name: '更多榜单', displayType: 'ONLY_COVER', list: additional });
    }
    return result;
  }

  async getToplistTracks(id: string, offset: number, limit: number): Promise<PlaylistDetail> {
    const raw = await this.call('playlist_detail', { id, n: limit, offset, toplistTrackCache: '1' });
    const playlist = raw.playlist;
    if (!playlist) {
      throw new NotFoundError('Toplist not found');
    }
    const tracks = (playlist.tracks || []).slice(0, limit).map((item: any) => this.withFavoriteTrack(mapTrack(item)));
    return this.playlistFavorites.apply({ ...mapPlaylist(playlist), tracks });
  }

  async getNewTracks(): Promise<Track[]> {
    const raw = await this.call('top_song');
    const tracks = this.toArrayPayload(raw, ['data', 'songs']);
    return tracks.map((item: any) => this.withFavoriteTrack(mapTrack(item)));
  }

  async getTopArtists(): Promise<Artist[]> {
    const raw = await this.call('top_artists');
    const artists = this.toArrayPayload(raw, ['artists', 'list']);
    return this.withFavoriteArtists(artists.map((item: any) => mapArtist(item)));
  }

  async getRecommendedPlaylist(offset: number, limit: number): Promise<PlaylistPage> {
    const raw = await this.call('personalized', { offset, limit });
    const items = (raw.result || raw.playlists || []).map((item: any) => this.playlistFavorites.apply(mapPlaylist(item)));
    return { items, offset, limit, hasMore: items.length === limit };
  }

  async getPlaylistDetail(id: string, trackLimit: number = -1): Promise<PlaylistDetail> {
    const raw = await this.call('playlist_detail', { id, n: trackLimit === -1 ? 1000 : trackLimit });
    const playlist = raw.playlist;
    if (!playlist) {
      throw new NotFoundError('Playlist not found');
    }
    const tracks = trackLimit !== 0 ? (playlist.tracks || []).slice(0, trackLimit === -1 ? 1000 : trackLimit).map((item: any) => this.withFavoriteTrack(mapTrack(item))) : [];
    return this.playlistFavorites.apply({ ...mapPlaylist(playlist), tracks },
      typeof playlist.subscribed === 'boolean' ? playlist.subscribed : undefined);
  }

  async getDailyTracks(): Promise<Track[]> {
    const raw = await this.call('recommend_songs');
    const tracks = this.toArrayPayload(raw, ['dailySongs', 'recommend', 'songs', 'data']);
    return tracks.map((item: any) => this.withFavoriteTrack(mapTrack(item)));
  }

  async getRoamTracks(): Promise<Track[]> {
    const raw = await this.call('personal_fm');
    const tracks = this.toArrayPayload(raw, ['tracks', 'songs', 'data']);
    return tracks.map((item: any) => this.withFavoriteTrack(mapTrack(item)));
  }

  async getTrackDetail(id: string): Promise<Track> {
    const [raw, audioDetail] = await Promise.all([
      this.call('song_detail', { ids: id }),
      this.call('song_music_detail', { id }).catch(() => null)
    ]);
    const track = raw.songs?.[0];
    if (!track) {
      throw new NotFoundError('Song not found');
    }
    return this.withFavoriteTrack(mapTrack({ ...track, ...(audioDetail || {}) }));
  }

  async getSimilarTracks(id: string): Promise<Track[]> {
    const raw = await this.call('similar_track', { id });
    const tracks = this.toArrayPayload(raw, ['songs', 'data']);
    return tracks.map((track: any) => this.withFavoriteTrack(mapTrack(track)));
  }

  async getTrackUrl(id: string, quality?: string): Promise<TrackUrl> {
    if (!/^\d+$/.test(id)) throw new BadRequestError('网易云歌曲 ID 必须为数字');
    return resolveTrackUrlWithFallback('netease', quality, () => this.getTrackDetail(id), (candidate) => this.getTrackUrlForQuality(id, candidate));
  }

  async getTrackUrlForQuality(id: string, quality: string): Promise<TrackUrl> {
    let raw: any;
    try {
      raw = await this.call('song_url_xeapi', { id, level: quality });
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new UpstreamError('获取歌曲链接失败');
    }
    const audio = [raw?.data, raw?.body?.data, raw?.songs, raw]
      .flatMap((candidate) => Array.isArray(candidate) ? candidate : [candidate])
      .find((item) => item?.url);
    if (!audio?.url) throw new NotFoundError('Song has no playable audio URL');
    // 网易会在无完整播放权限时返回有效试听 URL；必须在映射丢弃试听信息前识别。
    if (audio.freeTrialInfo) throw new UnplayableError('Song only has a trial audio URL');
    return mapTrackUrl({ ...audio, level: audio.level || quality });
  }

  async getTrackLyrics(id: string): Promise<TrackLyrics> {
    const lineLyricsPromise = this.call('lyric', { id }).catch(() => ({}));
    const wordLyricsPromise = this.call('lyric_new', { id }).catch(() => ({}));
    const [lineLyrics, wordLyrics] = await Promise.all([lineLyricsPromise, wordLyricsPromise]);
    const lyrics = mapTrackLyrics(lineLyrics, wordLyrics);
    if (lyrics.lyrics.trim() === NETEASE_NO_LYRICS_PLACEHOLDER) {
      throw new NotFoundError('Lyrics not found');
    }
    return lyrics;
  }

  async getTrackLineLyric(id: string): Promise<string> {
    const lineLyrics = await this.call('lyric', { id });
    return mapTrackLyrics(lineLyrics).lyrics;
  }

  async getTrackWordLyric(id: string): Promise<string> {
    const wordLyrics = await this.call('lyric_new', { id });
    return mapTrackLyrics({}, wordLyrics).wordLyrics;
  }

  async searchSuggest(keyword: string): Promise<SearchSuggest> {
    const raw = await this.call('search_suggest', { keywords: keyword });
    const result = mapSearchSuggest(raw);
    const artists = this.withFavoriteArtists(result.artists);
    const albums = this.withFavoriteAlbums(result.albums);
    return { ...result, songs: this.withFavoriteTracks(result.songs), artists, albums };
  }

  async searchTracks(keyword: string, offset: number, limit: number): Promise<TrackPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 1, offset, limit });
    const result = raw.result || raw;
    const items = Array.isArray(result.songs) ? this.withFavoriteTracks(result.songs.map((item: any) => mapTrack(item))) : [];
    const total = result.songCount || items.length;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async searchArtists(keyword: string, offset: number, limit: number): Promise<ArtistPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 100, offset, limit });
    const result = raw.result || raw;
    const items = this.withFavoriteArtists(Array.isArray(result.artists) ? result.artists.map((item: any) => mapArtist(item)) : []);
    const total = result.artistCount || items.length;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async searchAlbums(keyword: string, offset: number, limit: number): Promise<AlbumPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 10, offset, limit });
    const result = raw.result || raw;
    const items = this.withFavoriteAlbums(Array.isArray(result.albums) ? result.albums.map((item: any) => mapAlbum(item)) : []);
    const total = result.albumCount || items.length;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async searchPlaylists(keyword: string, offset: number, limit: number): Promise<PlaylistPage> {
    const raw = await this.call('cloudsearch', { keywords: keyword, type: 1000, offset, limit });
    const result = raw.result || raw;
    const items = Array.isArray(result.playlists) ? result.playlists.map((item: any) => this.playlistFavorites.apply(mapPlaylist(item))) : [];
    const total = result.playlistCount || items.length;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async getArtistDetail(id: string, trackLimit: number = -1): Promise<ArtistDetail> {
    const raw = await this.call('artist_detail', { id });
    const data = raw.data?.artist || raw.artist || raw.data || raw;
    const detail = mapArtistDetail(data);
    detail.favorite = this.hasFavoriteArtist(detail.id);
    if (trackLimit !== 0) {
      const limit = trackLimit === -1 ? 1000 : trackLimit;
      const tracks = await this.call('artist_tracks', { id, order: 'hot', offset: 0, limit });
      detail.tracks = (tracks.songs || []).map((item: any) => {
        const track = this.withFavoriteTrack(mapTrack(item));
        return { ...track, artists: this.withFavoriteArtists(track.artists) };
      });
    }
    return detail;
  }

  async getArtistTracks(id: string, order: string, offset: number, limit: number): Promise<TrackPage> {
    const raw = await this.call('artist_tracks', { id, order, offset, limit });
    const songs = Array.isArray(raw.songs) ? raw.songs : [];
    const items = this.withFavoriteTracks(songs.map((item: any) => mapTrack(item)));
    const total = raw.total || items.length;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async getArtistAlbums(id: string, offset: number, limit: number): Promise<AlbumPage> {
    const raw = await this.call('artist_album', { id, offset, limit });
    const items = this.withFavoriteAlbums(Array.isArray(raw.hotAlbums) ? raw.hotAlbums.map((item: any) => mapAlbum(item)) : []);
    const total = raw.total || items.length;
    return { items, offset, limit, hasMore: offset + items.length < total };
  }

  async getAlbumDetail(id: string, trackLimit: number = -1): Promise<AlbumDetail> {
    const raw = await this.call('album', { id });
    const detail = mapAlbumDetail(raw);
    detail.favorite = this.hasFavoriteAlbum(detail.id);
    if (detail.artist) detail.artist.favorite = this.hasFavoriteArtist(detail.artist.id);
    detail.tracks = trackLimit !== 0 ? this.withFavoriteTracks(detail.tracks).map((track) => ({
      ...track,
      album: { ...track.album, favorite: this.hasFavoriteAlbum(track.album.id) },
      artists: this.withFavoriteArtists(track.artists)
    })) : [];
    return detail;
  }

  async getUserPlaylist(): Promise<Playlist[]> {
    const items: Playlist[] = [];
    const seen = new Set<string>();
    const limit = 1000;
    for (let offset = 0; ; offset += limit) {
      const raw = await this.call('user_playlist', { offset, limit });
      const playlists = raw.playlist || raw.data?.playlist || [];
      const previousCount = items.length;
      for (const playlist of playlists) {
        const item = mapPlaylist(playlist);
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      if (raw.more !== true || items.length === previousCount) break;
    }
    this.replaceUserPlaylists(items);
    return items;
  }

  async userArtists(): Promise<Artist[]> {
    const artists = await this.loadSubscribedItems(
      (offset, limit) => this.call('artist_sublist', { offset, limit }, true),
      mapArtist
    );
    this.replaceFavoriteArtists(artists);
    return artists;
  }

  async userAlbums(): Promise<Album[]> {
    const albums = await this.loadSubscribedItems(
      (offset, limit) => this.call('album_sublist', { offset, limit }, true),
      mapAlbum
    );
    this.replaceFavoriteAlbums(albums);
    return albums;
  }

  async userFavoriteTracks(): Promise<Track[]> {
    const playlists = await this.getUserPlaylist();
    const favoritePlaylist = playlists.find((playlist) => /.+喜欢的音乐$/.test(playlist.name));
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
    const raw = await this.call('user_detail');
    return mapUserDetail(raw);
  }

  async favoriteTrack(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const curStatus = this.hasFavoriteTrack(id);
    const raw = await this.call('song_like', { id, like: status ? 'true' : 'false' });
    if (raw.code !== 200) {
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
    const raw = await this.call('playlist_create', { name, privacy: '0' });
    const playlist = raw.playlist || raw;
    if (!playlist?.id) {
      throw new NotFoundError('Playlist not found');
    }
    return mapPlaylist({ ...playlist, name: playlist.name || name });
  }

  async deletePlaylist(id: string): Promise<{ success: boolean }> {
    const raw = await this.call('playlist_delete', { id });
    return { success: raw.code === undefined || Number(raw.code) === 200 };
  }

  async updatePlaylist(id: string, name: string, description: string): Promise<Playlist> {
    await this.call('playlist_update', { id, name, desc: description });
    const detail = await this.getPlaylistDetail(id, 0);
    return { ...detail, name: name || detail.name, description };
  }

  async addTrackToPlaylist(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    const raw = await this.call('playlist_tracks', { pid: playlistId, tracks: trackId, op: 'add' });
    return { success: raw.code === undefined || Number(raw.code) === 200 };
  }

  /** 上游支持逗号分隔的歌曲列表；请求级错误继续由 HTTP 错误处理。 */
  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<{ id: string }[]> {
    if (!trackIds.length) return [];
    const raw = await this.call('playlist_tracks', { pid: playlistId, tracks: trackIds.join(','), op: 'add' });
    if (raw.code !== undefined && Number(raw.code) !== 200) throw new UpstreamError('网易云音乐添加歌曲失败');
    return [];
  }

  async removeTrack(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    const raw = await this.call('playlist_tracks', { pid: playlistId, tracks: trackId, op: 'del' });
    return { success: raw.code === undefined || Number(raw.code) === 200 };
  }

  async favoritePlaylist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const raw = await this.call('playlist_subscribe', { id, t: status ? 1 : 0 });
    if (raw.code !== undefined && Number(raw.code) !== 200) {
      return { success: false, status };
    }
    this.setUserPlaylist(id, status);
    this.playlistFavorites.set(id, status);
    return { success: true, status };
  }

  async favoriteArtist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const raw = await this.call('artist_sub', { id, t: status ? 1 : 0 });
    const success = Number(raw?.code ?? 200) === 200;
    if (success) this.setFavoriteArtist(id, status);
    return { success, status: success ? status : this.hasFavoriteArtist(id) };
  }

  async favoriteAlbum(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const raw = await this.call('album_sub', { id, t: status ? 1 : 0 });
    const success = Number(raw?.code ?? 200) === 200;
    if (success) this.setFavoriteAlbum(id, status);
    return { success, status: success ? status : this.hasFavoriteAlbum(id) };
  }

}
