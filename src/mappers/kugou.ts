import type { Album, Artist, Playlist, Quality, Track } from 'aduoer-wow-sdk';

export const bitrate = (value: unknown): number | null => {
  const number = Number(value);
  return number > 0 ? (number < 10000 ? number * 1000 : number) : null;
};
export const text = (value: unknown): string => value == null ? '' : String(value);
export function imageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  let url = value.trim().replace(/\{size\}/g, '500').replace(/^http:/, 'https:').replace(/^\/\//, 'https://');
  if (/^(?:stdmusic|custom)\//.test(url)) {
    url = `https://imge.kugou.com/${url.replace(/^([^/]+)\/(?!\d+\/)/, '$1/500/')}`;
  }
  return /^https?:\/\//i.test(url) ? url.replace('c1.kgimg.com', 'imge.kugou.com') : '';
}
const firstImage = (...values: unknown[]): string => values.map(imageUrl).find(Boolean) || '';
export function rows(value: any, keys = ['info', 'Info', 'list', 'lists', 'songs', 'song_list', 'songlist', 'special_list', 'files', 'data', 'items', 'authors', 'albums', 'album_list']): any[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  if (value.data && value.data !== value) return rows(value.data, keys);
  return [];
}
export const dataOf = (value: any): any => value?.data ?? value ?? {};
export function mapArtist(raw: any = {}): Artist {
  raw = { ...raw, ...raw.base };
  return {
    id: text(raw.author_id ?? raw.singerid ?? raw.AuthorId ?? raw.singer_id ?? raw.id),
    name: text(raw.author_name ?? raw.singername ?? raw.AuthorName ?? raw.singer_name ?? raw.name),
    coverUrl: firstImage(raw.sizable_avatar, raw.Avatar, raw.imgurl, raw.avatar, raw.pic, raw.dycover?.first_frame_image)
  };
}
export function mapAlbum(raw: any = {}): Album {
  return {
    id: text(raw.album_id ?? raw.AlbumID ?? raw.albumid ?? raw.id),
    name: text(raw.album_name ?? raw.AlbumName ?? raw.albumname ?? raw.name),
    coverUrl: firstImage(raw.sizable_cover, raw.album_sizable_cover, raw.imgurl, raw.pic, raw.img, raw.cover),
    artistName: text(raw.author_name ?? raw.singername ?? raw.SingerName ?? raw.singer),
    publishTime: Date.parse(text(raw.publish_date ?? raw.publish_time ?? raw.publishtime)) || null,
    trackCount: Math.max(0, Number(raw.songcount ?? raw.song_count ?? raw.count) || 0)
  };
}
export function mapPlaylist(raw: any = {}, user = false, userId = ''): Playlist {
  const extra = raw.extra || {};
  const id = user ? `user:${text(raw.listid)}` : text(raw.global_collection_id || raw.gid || raw.list_create_gid || extra.global_collection_id);
  return {
    id,
    name: text(raw.name ?? raw.specialname ?? raw.SpecialName ?? raw.title),
    description: text(raw.intro ?? raw.description ?? raw.desc),
    coverUrl: firstImage(raw.flexible_cover, raw.imgurl, raw.pic, raw.img, raw.cover, raw.image_url, extra.imgurl),
    trackCount: Math.max(0, Number(raw.count ?? raw.song_count ?? raw.songcount) || 0),
    playCount: Math.max(0, Number(raw.playcount ?? raw.play_count) || 0),
    favorite: user && text(raw.list_create_userid) !== userId && !isLikedPlaylist(raw),
    creator: { id: text(raw.list_create_userid ?? raw.userid ?? raw.suid ?? extra.list_create_userid), name: text(raw.list_create_username ?? raw.nickname ?? raw.username), avatarUrl: imageUrl(raw.user_pic) },
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag: any) => text(tag.name ?? tag.tag_name ?? tag)).filter(Boolean) : [],
    createdAt: timestamp(raw.create_time ?? raw.addtime),
    updatedAt: timestamp(raw.update_time)
  };
}
function timestamp(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? (number < 1e12 ? number * 1000 : number) : null;
}
/** Exact system names/flags; never choose an arbitrary user-created playlist containing 喜欢. */
export function isLikedPlaylist(raw: any): boolean {
  return Number(raw.source) !== 2 && (
    Number(raw.is_def) === 1 || Number(raw.is_def) === 2 || Number(raw.is_default) === 1 ||
    ['我喜欢', '我喜欢的音乐', '默认收藏'].includes(text(raw.name).trim())
  );
}
/** Prefer the actual liked list over the separate default collection, regardless of upstream order. */
export function findLikedPlaylist(list: any[], userId: string): any {
  const candidates = list.filter(row => row.listid && isLikedPlaylist(row) && text(row.list_create_userid || userId) === userId);
  return candidates.find(row => Number(row.is_def) === 2)
    ?? candidates.find(row => text(row.name).trim() === '我喜欢的音乐')
    ?? candidates.find(row => text(row.name).trim() === '我喜欢')
    ?? candidates.find(row => Number(row.is_def) === 1 || Number(row.is_def) === 2 || Number(row.is_default) === 1)
    ?? candidates[0];
}
export const qualityKeys: Record<string, string> = { standard: '128', exhigh: '320', lossless: 'flac', hires: 'high' };
const qualityNames: Record<string, string> = { standard: '标准', exhigh: '高品质', lossless: '无损', hires: 'Hi-Res' };
export function trackResource(raw: any = {}): { hash: string; albumId: string; mixId: string; name: string } {
  const base = raw.base || {};
  const audio = raw.audio_info || raw.audioInfo || {};
  return {
    hash: text(raw.hash ?? raw.FileHash ?? raw.filehash ?? raw.hash_128 ?? audio.hash_128 ?? audio.hash ?? base.hash).toLowerCase(),
    albumId: text([raw.album_id, raw.AlbumID, raw.albumid, audio.album_id, base.album_id, raw.album_info?.album_id, raw.recommend_album_id].find(value => Number(value) > 0)),
    mixId: text(raw.mixsongid ?? raw.add_mixsongid ?? raw.MixSongID ?? raw.album_audio_id ?? base.album_audio_id ?? audio.album_audio_id ?? raw.audio_id ?? audio.audio_id),
    name: text(raw.songname ?? raw.SongName ?? raw.song_name ?? raw.audio_name ?? base.songname ?? base.audio_name ?? audio.songname ?? audio.filename ?? audio.name ?? raw.name ?? raw.filename ?? raw.FileName)
  };
}
export function mapTrack(raw: any = {}): Track {
  const resource = trackResource(raw);
  const base = raw.base || {};
  const audio = raw.audio_info || {};
  const album = mapAlbum(raw.album_info || raw.albuminfo || { ...raw, name: raw.album_name ?? raw.AlbumName ?? raw.albumname ?? '' });
  const singerName = text(raw.singername ?? raw.SingerName ?? raw.author_name ?? base.author_name ?? audio.author_name ?? audio.singername);
  const artists = rows(raw.authors || raw.singers || raw.Singers || raw.singerinfo || raw.SingerInfo || audio.singerinfo).map(mapArtist);
  if (!artists.length && singerName) artists.push({ id: text(raw.singerid ?? raw.AuthorId ?? raw.SingerId?.[0]), name: singerName });
  // Cloud playlists return filenames such as “歌手 - 歌曲.mp3”. Keep the raw
  // resource name for upstream writes, but omit audio extensions in display titles.
  let title = resource.name.trim().replace(/\.(?:mp3|flac|wav|aac|m4a|ape|ogg|wma|opus|alac|aiff|dsf|dff)$/i, '').trim();
  if (!raw.songname && !raw.SongName && title.includes(' - ')) {
    const [singer, ...parts] = title.split(' - ');
    title = parts.join(' - ');
    if (!artists.length) artists.push({ id: '', name: singer });
  }
  const qualityInfo = raw.quality_vip || raw;
  const qualities: Quality[] = [];
  if (Array.isArray(qualityInfo.qualities)) {
    for (const [key, upstream] of Object.entries(qualityKeys)) {
      const item = qualityInfo.qualities.find((q: any) => q.quality === upstream && q.exists);
      if (item) qualities.push({ key, label: qualityNames[key], size: Math.max(0, Number(item.size) || 0), format: text(item.extname), bitrate: bitrate(item.bitrate) });
    }
  } else {
    for (const [key, fields] of Object.entries({ standard: ['filesize_128', 'filesize', 'FileSize'], exhigh: ['filesize_320', '320filesize', 'HQFileSize'], lossless: ['filesize_flac', 'sqfilesize', 'SQFileSize'], hires: ['filesize_high', 'hrfilesize', 'HiResFileSize'] })) {
      const size = Number(fields.map(field => raw[field] ?? audio[field]).find(value => Number(value) > 0));
      if (size > 0) qualities.push({ key, label: qualityNames[key], size, format: ['lossless', 'hires'].includes(key) ? 'flac' : 'mp3' });
    }
  }
  return {
    id: resource.hash,
    title,
    artists,
    album,
    coverUrl: firstImage(raw.union_cover, raw.trans_param?.union_cover, raw.info?.image, raw.img, raw.cover, raw.pic, raw.album_sizable_cover, raw.sizable_cover, audio.img, album.coverUrl),
    durationMs: Math.max(0, Number(raw.timelen ?? raw.timelength ?? raw.timelength_128 ?? audio.timelength ?? audio.timelength_128 ?? audio.duration_128 ?? audio.duration ?? raw.info?.duration ?? base.timelength) || (Number(raw.time_length ?? raw.duration ?? raw.Duration) || 0) * 1000),
    favorite: false,
    qualities,
    fee: Array.isArray(qualityInfo.qualities) && qualityInfo.qualities.some((q: any) => q.need_vip)
  };
}

/** Convert KRC relative word offsets to YRC absolute timestamps understood by Wow clients. */
export function krcToWordLyrics(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split(/\r?\n/).flatMap(line => {
    const match = /^\[(\d+),(\d+)\](.*)$/.exec(line);
    if (!match) return [];
    const start = Number(match[1]);
    const words = [...match[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)];
    if (!words.length) return [];
    return [`[${start},${match[2]}]` + words.map(word => `(${start + Number(word[1])},${word[2]},0)${word[3]}`).join('')];
  }).join('\n');
}
