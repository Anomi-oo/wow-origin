import type { Album, AlbumDetail, AlbumPage, Artist, ArtistDetail, ArtistPage, Playlist, PlaylistCategory, PlaylistDetail, PlaylistPage, SearchSuggest, ToplistGroup, Track, TrackLyrics, TrackPage, TrackUrl, UserProfile } from 'aduoer-wow-sdk';
import { MusicClientBase } from './MusicClientBase';
import { BadRequestError, NotFoundError, UnplayableError, UpstreamError } from '../errors';
import { bitrate, dataOf, findLikedPlaylist, imageUrl, isLikedPlaylist, mapAlbum, mapArtist, mapPlaylist, mapTrack, qualityKeys, rows, text, trackResource, krcToWordLyrics } from '../mappers/kugou';
import { type KugouAccountContext, kugouUserId, kugouEdition } from '../kugouState';
import { resolveTrackUrlWithFallback } from '../trackUrl';
import { makeTrackLyrics } from '../trackLyrics';

export class KugouClient extends MusicClientBase {
  private readonly context: KugouAccountContext;
  private readonly userId: string;
  private readonly resources = new Map<string, any>();

  constructor(cookie: string, tracks?: Set<string>, artists?: Set<string>, albums?: Set<string>, playlists?: Set<string>, context: KugouAccountContext = {}) {
    super(cookie, 'kugou', tracks, artists, albums, playlists);
    this.context = context;
    this.userId = kugouUserId(cookie);
  }
  private async call(route: string, params: Record<string, unknown> = {}): Promise<any> {
    this.assertCurrentAccount();
    const result = await this.platformFactory.getPlatform('kugou').callModule(route, { query: { ...params, cookie: this.cookie, platform: 'kugou' }, body: {}, ip: 'internal' });
    this.assertCurrentAccount();
    if (result?.code !== 200) {
      const error = new UpstreamError(result?.message || '酷狗请求失败');
      Object.assign(error, { upstreamCode: result?.upstreamCode, stalePlaylist: result?.stalePlaylist });
      throw error;
    }
    return result.body ?? result.data ?? result;
  }
  private tracks(raw: any): Track[] {
    return rows(raw).map(item => {
      const track = mapTrack(item);
      if (track.id) this.resources.set(track.id, item);
      return this.withFavoriteTrack(track);
    }).filter(track => /^[a-f0-9]{32}$/.test(track.id));
  }
  protected override withFavoriteTrack<T extends Track>(track: T): T {
    return {
      ...super.withFavoriteTrack(track),
      artists: this.withFavoriteArtists(track.artists),
      album: this.withFavoriteAlbums([track.album])[0]
    };
  }
  private hash(id: string): string {
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new BadRequestError('酷狗歌曲 ID 必须是音频 hash');
    return id.toLowerCase();
  }
  /** Offset may start within a page, so fetch enough pages before slicing. */
  private async page<T>(route: string, params: Record<string, unknown>, offset: number, limit: number, map: (value: any) => T[], size = 100, variablePageSize = false): Promise<{ items: T[]; offset: number; limit: number; hasMore: boolean }> {
    if (limit <= 0) return { items: [], offset, limit, hasMore: false };
    const startPage = variablePageSize ? 1 : Math.floor(offset / size) + 1;
    const skip = variablePageSize ? offset : offset % size;
    const values: T[] = [];
    let hasMore = true;
    let previousBatch = '';
    for (let page = startPage; values.length < skip + limit && hasMore; page++) {
      const result = await this.call(route, { ...params, page, pagesize: size });
      const batch = map(result);
      const fingerprint = JSON.stringify(batch);
      if (fingerprint === previousBatch) { hasMore = false; break; }
      previousBatch = fingerprint;
      values.push(...batch);
      const data = dataOf(result);
      const total = Number(data.total ?? data.total_count ?? result.total ?? data.count);
      const next = data.has_next ?? data.has_more;
      hasMore = next != null ? Boolean(Number(next)) : Number.isFinite(total) && total >= 0 ? (variablePageSize ? values.length : page * size) < total : batch.length >= size;
      if (!batch.length) hasMore = false;
    }
    return { items: values.slice(skip, skip + limit), offset, limit, hasMore: values.length > skip + limit || hasMore };
  }
  private async allRows(route: string, params: Record<string, unknown> = {}): Promise<any[]> {
    const output: any[] = [];
    const seen = new Set<string>();
    const size = route === 'album/songs' ? 30 : 300;
    for (let page = 1; ; page++) {
      const response = await this.call(route, { ...params, page, pagesize: size });
      const batch = rows(response);
      let added = 0;
      for (const row of batch) {
        const key = text(row.fileid ?? row.listid ?? row.hash ?? row.FileHash ?? row.album_audio_id ?? row.base?.album_audio_id ?? row.audio_info?.hash_128 ?? row.audio_info?.hash ?? row.author_id ?? row.singerid ?? row.id);
        if (!key || seen.has(key)) continue;
        seen.add(key); output.push(row); added++;
      }
      const data = dataOf(response);
      const total = Number(data.total ?? data.total_count ?? response.total ?? data.count);
      const next = data.has_next ?? data.has_more;
      if (!added || (Number.isFinite(total) ? output.length >= total : next != null ? !Number(next) : batch.length < size)) return output;
    }
  }
  async getPlaylists(offset: number, limit: number, category = '0'): Promise<PlaylistPage> {
    return this.page('top/playlist', { category_id: category, withsong: 0 }, offset, limit,
      response => rows(dataOf(response)?.special_recommend ?? response).map(row => this.playlistFavorites.apply(mapPlaylist(row))).filter(item => item.id !== ''), 30, true);
  }
  async getRecommendedPlaylist(offset: number, limit: number): Promise<PlaylistPage> { return this.getPlaylists(offset, limit); }
  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const response = await this.call('playlist/tags');
    const result: PlaylistCategory[] = [];
    const walk = (value: any): void => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (!value || typeof value !== 'object') return;
      if (value.tag_id != null && (value.tag_name || value.name)) result.push({ key: text(value.tag_id), label: text(value.tag_name || value.name) });
      for (const nested of Object.values(value)) if (nested && typeof nested === 'object') walk(nested);
    };
    walk(dataOf(response));
    return [{ key: '0', label: '推荐' }, ...new Map(result.map(item => [item.key, item])).values()];
  }
  async getToplist(): Promise<ToplistGroup[]> {
    const response = await this.call('rank/list');
    const groups = new Map<string, ToplistGroup>();
    for (const raw of rows(response)) {
      const name = text(raw.rank_type_name || raw.type_name || raw.type_info?.name || '酷狗榜单');
      const group = groups.get(name) || { name, list: [] };
      group.list.push({ id: text(raw.rankid), name: text(raw.rankname), coverUrl: imageUrl(raw.imgurl || raw.img_9 || raw.album_img_9), updateFrequency: text(raw.update_frequency || raw.updatefrequency), tracks: rows(raw.songinfo || raw.songs || []).slice(0, 3).map(song => ({ name: text(song.name || song.songname), artistName: text(song.author || song.author_name || song.singername) })) });
      groups.set(name, group);
    }
    return [...groups.values()];
  }
  async getToplistTracks(id: string, offset: number, limit: number): Promise<PlaylistDetail> {
    const [info, page] = await Promise.all([this.call('rank/info', { rankid: id }), this.page('rank/audio', { rankid: id }, offset, limit, raw => this.tracks(raw))]);
    const raw = dataOf(info);
    return { id, name: text(raw.rankname || raw.name), coverUrl: imageUrl(raw.imgurl), description: text(raw.intro), trackCount: Math.max(page.items.length, Number(raw.total || raw.count) || 0), favorite: false, tracks: page.items };
  }
  async getNewTracks(): Promise<Track[]> { return this.tracks(await this.call('top/song', { pagesize: 100 })); }
  async getDailyTracks(): Promise<Track[]> { return this.tracks(await this.call('everyday/recommend')); }
  async getRoamTracks(): Promise<Track[]> { return this.tracks(await this.call('personal/fm', { action: 'play', remain_songcnt: 0 })); }
  async getTopArtists(): Promise<Artist[]> { return (await this.getArtists(0, 100)).items; }
  async getArtists(offset: number, limit: number): Promise<ArtistPage> {
    if (limit <= 0) return { items: [], offset, limit, hasMore: false };
    // The endpoint returns a hot group followed by alphabetical groups. Keep
    // hotsize fixed so offset pagination does not change the underlying ordering.
    const groups = rows(await this.call('artist/lists', { hotsize: 100 }));
    const artists = groups.flatMap(group => Array.isArray(group.singer) ? group.singer : [group]).map(mapArtist).filter(artist => artist.id && artist.name);
    const list = [...new Map(artists.map(artist => [artist.id, artist])).values()];
    return { items: this.withFavoriteArtists(list.slice(offset, offset + limit)), offset, limit, hasMore: list.length > offset + limit };
  }
  private async userRows(refresh = false): Promise<any[]> {
    this.assertCurrentAccount();
    if (!refresh && this.context.kugouPlaylists) return this.context.kugouPlaylists;
    if (this.context.kugouPlaylistsLoading) return this.context.kugouPlaylistsLoading;
    const loading = (async () => {
      const list = await this.allRows('user/playlist');
      const liked = findLikedPlaylist(list, this.userId);
      this.setLikedId(liked?.listid ? text(liked.listid) : undefined);
      this.assertCurrentAccount();
      this.context.kugouPlaylists = list;
      return list;
    })();
    this.context.kugouPlaylistsLoading = loading;
    try { return await loading; }
    finally { if (this.context.kugouPlaylistsLoading === loading) this.context.kugouPlaylistsLoading = undefined; }
  }
  private assertCurrentAccount(): void {
    if (this.context.cookie !== undefined && (kugouUserId(this.context.cookie) !== this.userId || kugouEdition(this.context.cookie) !== kugouEdition(this.cookie))) {
      throw new BadRequestError('酷狗账号已变更，请重新请求');
    }
  }
  private setLikedId(likedPlaylistId?: string): void {
    this.assertCurrentAccount();
    this.context.kugouState = { userId: this.userId, ...(likedPlaylistId ? { likedPlaylistId } : {}) };
  }
  private async likedId(): Promise<string> {
    this.assertCurrentAccount();
    const state = this.context.kugouState;
    if (state?.userId === this.userId && state.likedPlaylistId) return state.likedPlaylistId;
    await this.userRows(true);
    const id = this.context.kugouState?.likedPlaylistId;
    if (!id) throw new NotFoundError('酷狗账号中未找到「我喜欢」歌单');
    return id;
  }
  async getUserPlaylist(): Promise<Playlist[]> {
    const list = (await this.userRows(true)).filter(row => Number(row.source) !== 2).map(row => mapPlaylist(row, true, this.userId));
    this.replaceUserPlaylists(list);
    for (const row of this.context.kugouPlaylists || []) {
      if (Number(row.source) === 2) continue;
      for (const original of [row.list_create_gid, row.global_collection_id].map(text).filter(Boolean)) {
        this.playlistFavorites.set(original, text(row.list_create_userid) !== this.userId);
      }
    }
    const liked = (this.context.kugouPlaylists || []).find(row => text(row.listid) === this.context.kugouState?.likedPlaylistId);
    const hideLiked = liked && (Number(liked.is_def) === 2 || ((Number(liked.is_def) === 1 || Number(liked.is_default) === 1) && ['我喜欢', '我喜欢的音乐'].includes(text(liked.name).trim())));
    return hideLiked ? list.filter(playlist => playlist.id !== `user:${liked.listid}`) : list;
  }
  private async ownedRow(id: string): Promise<any> {
    const localId = id.startsWith('user:') ? id.slice(5) : '';
    const list = await this.userRows();
    const found = list.find(row => Number(row.source) !== 2 && (localId ? text(row.listid) === localId : [row.list_create_gid, row.global_collection_id].map(text).includes(id)));
    if (!found) throw new NotFoundError('当前酷狗账号中未找到该歌单');
    return found;
  }
  private async publicPlaylistInfo(id: string): Promise<any> {
    // This endpoint supplies both a canonical public list ID and cloud-list ownership.
    const response = await this.call('playlist/track/all', { id, page: 1, pagesize: 1 });
    const info = dataOf(response).list_info;
    if (info) return info;
    return rows(await this.call('playlist/detail', { ids: id }))[0];
  }
  async getPlaylistDetail(id: string, trackLimit = -1): Promise<PlaylistDetail> {
    let playlist: Playlist;
    let route: string;
    let params: Record<string, unknown>;
    if (id.startsWith('user:')) {
      const row = await this.ownedRow(id);
      playlist = mapPlaylist(row, true, this.userId);
      route = 'playlist/track/all/new'; params = { listid: row.listid, type: Number(row.type || 0) };
    } else {
      const row = await this.publicPlaylistInfo(id);
      if (!row) throw new NotFoundError('酷狗歌单不存在');
      playlist = this.playlistFavorites.apply({ ...mapPlaylist(row), id });
      route = 'playlist/track/all'; params = { id };
    }
    const tracks = trackLimit === 0 ? [] : trackLimit === -1
      ? this.tracks(await this.allRows(route, params))
      : (await this.page(route, params, 0, trackLimit, raw => this.tracks(raw))).items;
    return { ...playlist, tracks };
  }
  async userFavoriteTracks(): Promise<Track[]> {
    let listid = await this.likedId();
    let raw: any[];
    try { raw = await this.allRows('playlist/track/all/new', { listid }); }
    catch (error) {
      // Only a confirmed stale list ID warrants rediscovery; transport/auth errors retain it.
      if (!(error as any).stalePlaylist) throw error;
      this.setLikedId(); this.context.kugouPlaylists = undefined;
      listid = await this.likedId();
      raw = await this.allRows('playlist/track/all/new', { listid });
    }
    // Cloud pages need not follow the saved display order. Sort globally after
    // loading every page; retain upstream order for ties or missing positions.
    const position = (row: any): number => {
      const value = row.sort;
      if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return Infinity;
      const number = Number(value);
      return Number.isFinite(number) ? number : Infinity;
    };
    raw.sort((left, right) => position(left) - position(right));
    const tracks = this.tracks(raw);
    this.clearFavoriteTracks(); tracks.forEach(track => this.addFavoriteTrack(track.id));
    return this.withFavoriteTracks(tracks);
  }
  async getTrackDetail(id: string): Promise<Track> {
    const hash = this.hash(id);
    const response = await this.call('privilege/lite', { hash });
    const raw = rows(response)[0];
    if (!raw) throw new NotFoundError('酷狗歌曲不存在');
    const quality = response.quality_vip?.[0];
    let merged = { ...(this.resources.get(hash) || {}), ...raw, hash, quality_vip: quality };
    const resource = trackResource(merged);
    if (resource.mixId && resource.mixId !== '0') {
      const metadata = await this.call('krm/audio', { album_audio_id: resource.mixId, fields: 'base,album_info,authors.base,audio_info' }).then(value => rows(value)[0], () => undefined);
      if (metadata) merged = { ...merged, ...metadata, hash, quality_vip: quality };
    }
    this.resources.set(hash, merged);
    return this.withFavoriteTrack(mapTrack(merged));
  }
  async getSimilarTracks(id: string): Promise<Track[]> {
    const hash = this.hash(id);
    await this.getTrackDetail(hash);
    const resource = trackResource(this.resources.get(hash));
    if (!resource.mixId) return [];
    return this.tracks(await this.call('ai/recommend', { album_audio_id: resource.mixId })).filter(track => track.id !== hash);
  }
  async getTrackUrl(id: string, quality?: string): Promise<TrackUrl> {
    return resolveTrackUrlWithFallback('kugou', quality, () => this.getTrackDetail(id), candidate => this.getTrackUrlForQuality(id, candidate));
  }
  async getTrackUrlForQuality(id: string, quality: string): Promise<TrackUrl> {
    const hash = this.hash(id);
    if (!this.resources.has(hash)) await this.getTrackDetail(hash);
    const resource = trackResource(this.resources.get(hash));
    const verification = dataOf(await this.call('user/verify'));
    if (!verification.auth) throw new UnplayableError('酷狗账号未取得播放授权，请刷新登录状态');
    const response = await this.call('song/url/auth/merge', { hash, auth: verification.auth, quality: qualityKeys[quality], album_id: resource.albumId, album_audio_id: resource.mixId });
    const raw = dataOf(response);
    const urls = raw.url ?? raw.urls ?? response.url;
    const url = Array.isArray(urls) ? urls[0] : urls;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new UnplayableError('酷狗账号无该歌曲或音质的播放权限');
    return { url, quality, format: text(raw.extName || raw.extname || (['lossless', 'hires'].includes(quality) ? 'flac' : 'mp3')), bitrate: bitrate(raw.bitrate), size: Math.max(0, Number(raw.fileSize ?? raw.filesize ?? raw.size) || 0) };
  }
  async getTrackLyrics(id: string): Promise<TrackLyrics> {
    const candidate = rows(await this.call('search/lyric', { hash: this.hash(id) }), ['candidates'])[0];
    if (!candidate) return makeTrackLyrics('', '');
    const params = { id: candidate.id, accesskey: candidate.accesskey, decode: true };
    const [line, word] = await Promise.allSettled([this.call('lyric', { ...params, fmt: 'lrc' }), this.call('lyric', { ...params, fmt: 'krc' })]);
    if (line.status === 'rejected' && word.status === 'rejected') throw line.reason;
    const lrc = line.status === 'fulfilled' ? line.value.decodeContent ?? dataOf(line.value).decodeContent : '';
    const krc = word.status === 'fulfilled' ? word.value.decodeContent ?? dataOf(word.value).decodeContent : '';
    return makeTrackLyrics(lrc, krcToWordLyrics(krc));
  }
  async searchTracks(keyword: string, offset: number, limit: number): Promise<TrackPage> { return this.page('search', { keywords: keyword, type: 'song' }, offset, limit, raw => this.tracks(raw)); }
  async searchArtists(keyword: string, offset: number, limit: number): Promise<ArtistPage> { return this.page('search', { keywords: keyword, type: 'author' }, offset, limit, raw => this.withFavoriteArtists(rows(raw).map(mapArtist))); }
  async searchAlbums(keyword: string, offset: number, limit: number): Promise<AlbumPage> { return this.page('search', { keywords: keyword, type: 'album' }, offset, limit, raw => this.withFavoriteAlbums(rows(raw).map(mapAlbum))); }
  async searchPlaylists(keyword: string, offset: number, limit: number): Promise<PlaylistPage> { return this.page('search', { keywords: keyword, type: 'special' }, offset, limit, raw => rows(raw).map(row => this.playlistFavorites.apply(mapPlaylist(row))).filter(item => !!item.id)); }
  async searchSuggest(keyword: string): Promise<SearchSuggest> {
    const response = dataOf(await this.call('search/suggest', { keywords: keyword }));
    if (Array.isArray(response)) {
      // getSearchTip only returns textual keywords, while Wow requires real entities.
      const [songs, artists, albums] = await Promise.all([this.searchTracks(keyword, 0, 5), this.searchArtists(keyword, 0, 3), this.searchAlbums(keyword, 0, 3)]);
      return { songs: songs.items, artists: artists.items, albums: albums.items };
    }
    const suggested = (key: string): any[] => rows(response[key]?.[0]?.RecordDatas ?? response[key]?.RecordDatas ?? response[key]);
    return { songs: this.tracks(suggested('Song')), artists: this.withFavoriteArtists(suggested('Singer').map(mapArtist)), albums: this.withFavoriteAlbums(suggested('Album').map(mapAlbum)) };
  }
  async getArtistDetail(id: string, trackLimit = -1): Promise<ArtistDetail> {
    const response = await this.call('artist/detail', { id });
    const raw = rows(response)[0] ?? dataOf(response);
    const artist = mapArtist(raw);
    const tracks = trackLimit === 0 ? [] : (await this.getArtistTracks(id, 'hot', 0, trackLimit < 0 ? 50 : trackLimit)).items;
    return { ...artist, id, favorite: this.hasFavoriteArtist(id), avatarUrl: artist.coverUrl, description: Array.isArray(raw.long_intro) ? raw.long_intro.map((row: any) => row.content).join('\n\n') : text(raw.long_intro || raw.intro), tracks };
  }
  async getArtistTracks(id: string, order: string, offset: number, limit: number): Promise<TrackPage> { return this.page('artist/audios/new', { id, sort: order }, offset, limit, raw => this.tracks(raw)); }
  async getArtistAlbums(id: string, offset: number, limit: number): Promise<AlbumPage> { return this.page('artist/albums', { id }, offset, limit, raw => this.withFavoriteAlbums(rows(raw).map(mapAlbum))); }
  async getAlbumDetail(id: string, trackLimit = -1): Promise<AlbumDetail> {
    const response = await this.call('album/detail', { id });
    const raw = rows(response)[0] ?? dataOf(response);
    const album = mapAlbum(raw);
    const tracks = trackLimit === 0 ? [] : trackLimit === -1 ? this.tracks(await this.allRows('album/songs', { id })) : (await this.page('album/songs', { id }, 0, trackLimit, raw => this.tracks(raw), 30)).items;
    return { ...album, id, favorite: this.hasFavoriteAlbum(id), description: text(raw.intro), artist: this.withFavoriteArtists(rows(raw.authors).map(mapArtist))[0], tracks };
  }
  async getUserMe(): Promise<UserProfile> {
    const response = await this.call('user/detail');
    const data = dataOf(response);
    const raw = data.userinfo || data.user_info || data;
    return { userId: text(raw.userid || response.userId || this.userId), nickname: text(raw.nickname || raw.username || response.nickname), avatar: imageUrl(raw.pic || raw.avatar || raw.sizable_avatar), platform: 'kugou' };
  }
  async favoriteTrack(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const listid = await this.likedId();
    if (status) await this.addToList(listid, [id]); else await this.removeFromList(listid, id);
    if (status) this.addFavoriteTrack(this.hash(id)); else this.removeFavoriteTrack(this.hash(id));
    return { success: true, status };
  }
  async favoriteTracks(ids: string[], status: boolean): Promise<{ id: string }[]> {
    const failures: { id: string }[] = [];
    for (const id of ids) { try { await this.favoriteTrack(id, status); } catch { failures.push({ id }); } }
    return failures;
  }
  private async addToList(listid: string, ids: string[]): Promise<void> {
    const data: Record<string, string>[] = [];
    for (const id of ids) {
      const hash = this.hash(id);
      if (!this.resources.has(hash)) await this.getTrackDetail(hash);
      const resource = trackResource(this.resources.get(hash));
      if (!resource.name) throw new UpstreamError('酷狗未返回歌曲名称，无法添加');
      data.push({ name: resource.name, hash, album_id: resource.albumId || '0', mixsongid: resource.mixId || '0' });
    }
    await this.call('playlist/tracks/add', { listid, data });
  }
  private async removeFromList(listid: string, id: string): Promise<void> {
    const hash = this.hash(id);
    const matches = (await this.allRows('playlist/track/all/new', { listid })).filter(row => trackResource(row).hash === hash);
    if (!matches.length) return;
    if (matches.some(row => !row.fileid)) throw new UpstreamError('酷狗歌单未返回歌曲 fileid');
    await this.call('playlist/tracks/del', { listid, fileids: matches.map(row => row.fileid).join(',') });
  }
  private async writableRow(id: string): Promise<any> {
    const row = await this.ownedRow(id);
    if (text(row.list_create_userid) !== this.userId || Number(row.type) === 1) throw new BadRequestError('只能编辑自己创建的酷狗歌单');
    return row;
  }
  async createPlaylist(name: string): Promise<Playlist> {
    const previousIds = new Set((await this.userRows(true)).map(row => text(row.listid)));
    const response = await this.call('playlist/add', { name, type: 0, source: 1, list_create_userid: this.userId });
    const listid = text(dataOf(response).listid);
    this.context.kugouPlaylists = undefined;
    if (/^[1-9]\d*$/.test(listid)) return mapPlaylist({ ...dataOf(response), listid, name, list_create_userid: this.userId }, true, this.userId);
    // Success responses may omit listid. Identify the new list without issuing
    // another write or confusing it with an older playlist of the same name.
    const candidates = (await this.userRows(true)).filter(row => !previousIds.has(text(row.listid)) && /^[1-9]\d*$/.test(text(row.listid)) && text(row.name) === name && text(row.list_create_userid || this.userId) === this.userId && Number(row.source) !== 2 && Number(row.type || 0) === 0);
    if (candidates.length !== 1) throw new UpstreamError('酷狗已创建歌单，但无法唯一确认新歌单，请刷新歌单列表后查看');
    return mapPlaylist({ ...candidates[0], list_create_userid: candidates[0].list_create_userid || this.userId }, true, this.userId);
  }
  async deletePlaylist(id: string): Promise<{ success: boolean }> {
    const row = await this.writableRow(id);
    if (isLikedPlaylist(row) || text(row.listid) === this.context.kugouState?.likedPlaylistId) throw new BadRequestError('不能删除「我喜欢」歌单');
    await this.call('playlist/del', { listid: row.listid });
    this.context.kugouPlaylists = undefined;
    return { success: true };
  }
  async updatePlaylist(id: string, name: string, description: string): Promise<Playlist> {
    const row = await this.writableRow(id);
    const response = await this.call('user/playlist', { page: 1, pagesize: 1 });
    const version = dataOf(response).total_ver ?? response.total_ver;
    if (version == null) throw new UpstreamError('酷狗歌单列表未返回 total_ver');
    await this.call('playlist/update', { listid: row.listid, total_ver: version, type: Number(row.type || 0), name, intro: description, sort: row.sort || 0, tags: row.tags || '' });
    this.context.kugouPlaylists = undefined;
    return mapPlaylist({ ...row, name, intro: description }, true, this.userId);
  }
  async addTrackToPlaylist(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    await this.addToList(text((await this.writableRow(playlistId)).listid), [trackId]); return { success: true };
  }
  async removeTrack(playlistId: string, trackId: string): Promise<{ success: boolean }> {
    await this.removeFromList(text((await this.writableRow(playlistId)).listid), trackId); return { success: true };
  }
  async favoritePlaylist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const existing = (await this.userRows(true)).find(row => Number(row.source) !== 2 && (id === `user:${row.listid}` || [row.list_create_gid, row.global_collection_id].map(text).includes(id)));
    if (existing && text(existing.list_create_userid) === this.userId) throw new BadRequestError('不能收藏或取消收藏自己的歌单');
    let row = existing;
    let listid = existing?.listid;
    if (status && !existing) {
      const raw = await this.publicPlaylistInfo(id);
      if (!raw) throw new NotFoundError('酷狗歌单不存在');
      const response = await this.call('playlist/add', { name: raw.name || raw.specialname, type: 1, source: 1, list_create_userid: raw.list_create_userid, list_create_listid: raw.list_create_listid || raw.specialid, list_create_gid: id });
      row = raw;
      listid = dataOf(response).listid;
    } else if (!status && existing) await this.call('playlist/del', { listid: existing.listid });
    this.context.kugouPlaylists = undefined;
    // Public collection IDs and the account-local ID refer to the same favorite.
    const aliases = new Set([id, listid ? `user:${listid}` : '', text(row?.list_create_gid), text(row?.global_collection_id)].filter(Boolean));
    for (const alias of aliases) {
      this.playlistFavorites.set(alias, status); this.setUserPlaylist(alias, status);
    }
    return { success: true, status };
  }
  async favoriteArtist(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    await this.call(status ? 'artist/follow' : 'artist/unfollow', { id });
    this.setFavoriteArtist(id, status); return { success: true, status };
  }
  async userArtists(): Promise<Artist[]> {
    const raw = rows(await this.call('user/follow')).map(row => {
      if (typeof row.ext_params !== 'string') return row;
      try { return { ...row, ext_params: JSON.parse(row.ext_params) }; } catch { return { ...row, ext_params: {} }; }
    });
    const artists = raw.filter(row => Number(row.singerid || row.author_id || row.ext_params?.singerid) > 0).map(row => mapArtist({ ...row, singerid: row.singerid || row.author_id || row.ext_params?.singerid, singername: row.singername || row.nickname }));
    this.replaceFavoriteArtists(artists);
    return artists.map(artist => ({ ...artist, favorite: true }));
  }
  async userAlbums(): Promise<Album[]> {
    const albums = (await this.userRows(true)).filter(row => Number(row.source) === 2).map(row => mapAlbum({ ...row, album_id: row.list_create_listid, album_name: row.name }));
    this.replaceFavoriteAlbums(albums); return albums.map(album => ({ ...album, favorite: true }));
  }
  async favoriteAlbum(id: string, status: boolean): Promise<{ success: boolean; status: boolean }> {
    const existing = (await this.userRows(true)).find(row => Number(row.source) === 2 && text(row.list_create_listid) === id);
    if (status && !existing) {
      const album = await this.getAlbumDetail(id, 0);
      await this.call('playlist/add', { name: album.name, type: 1, source: 2, list_create_userid: album.artist?.id, list_create_listid: id });
    } else if (!status && existing) await this.call('playlist/del', { listid: existing.listid });
    this.context.kugouPlaylists = undefined;
    this.setFavoriteAlbum(id, status); return { success: true, status };
  }
}
