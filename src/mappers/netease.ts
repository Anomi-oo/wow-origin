import type { Album, AlbumDetail, Artist, ArtistDetail, Playlist, Quality, SearchSuggest, Track, TrackLyrics, TrackUrl, UserProfile } from 'aduoer-wow-sdk';
import { makeTrackLyrics, stripNeteaseWordLyricMetadata } from '../trackLyrics';
import type { Lyrics } from '../types';

type Creator = NonNullable<Playlist['creator']>;

const SOURCE_PREFIX = 'netease';

function toStringId(value: string | number | undefined | null): string {
  return value === undefined || value === null ? '' : String(value);
}

function optionalRawId(value: string | number | undefined | null): string | null {
  const id = toStringId(value).trim();
  return id ? id : null;
}

export function normalizeTimestamp(value: number | string | undefined | null): number | null {
  const timestamp = Number(value) || 0;
  if (!timestamp) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

export function mapLyrics(lyrics: any = {}): Lyrics {
  return {
    original: lyrics.lrc?.lyric || '',
    translation: lyrics.tlyric?.lyric || '',
    romanized: lyrics.romalrc?.lyric || ''
  };
}

export function mapTrackLyrics(lineLyrics: any = {}, wordLyrics: any = {}): TrackLyrics {
  return makeTrackLyrics(
    lineLyrics.lrc?.lyric,
    stripNeteaseWordLyricMetadata(wordLyrics.yrc?.lyric),
    lineLyrics.tlyric?.lyric || wordLyrics.tlyric?.lyric,
    wordLyrics.ytlrc?.lyric
  );
}

export function mapTrackUrl(audio: any = {}): TrackUrl {
  const quality = audio.level || '';
  return {
    url: audio.url || '',
    quality,
    format: audio.type || audio.encodeType || '',
    bitrate: audio.br ?? null,
    size: Number(audio.size) || 0
  };
}

export function mapCreator(creator: any = {}): Creator {
  return {
    id: toStringId(creator.userId),
    name: creator.nickname || '',
    avatarUrl: creator.avatarUrl || ''
  };
}

export function mapPlaylist(playlist: any = {}): Playlist {
  return {
    id: toStringId(playlist.id),
    name: playlist.name || '',
    description: playlist.description || '',
    coverUrl: playlist.coverImgUrl || playlist.picUrl || '',
    trackCount: Number(playlist.trackCount) || 0,
    playCount: Number(playlist.playCount) || 0,
    favoriteCount: Number(playlist.subCount) || 0,
    tags: Array.isArray(playlist.tags) ? playlist.tags.filter(Boolean) : [],
    creator: mapCreator(playlist.creator),
    createdAt: normalizeTimestamp(playlist.createTime),
    updatedAt: normalizeTimestamp(playlist.updateTime || playlist.modifyTime)
  };
}

export function mapArtist(artist: any = {}): Artist {
  return {
    id: toStringId(artist.id || artist.mid),
    name: artist.name || '',
    coverUrl: artist.picUrl || artist.avatar || artist.coverUrl || artist.img1v1Url || ''
  };
}

export function mapAlbum(album: any = {}): Album {
  const artistName = album.artistName || album.artist?.name || (Array.isArray(album.artists) ? album.artists.map((artist: any) => artist.name).filter(Boolean).join(', ') : '');
  return {
    id: toStringId(album.id || album.mid),
    name: album.name || '',
    coverUrl: album.coverUrl || album.picUrl || album.coverImgUrl || album.img1v1Url || '',
    artistName,
    publishTime: new Date(album.publishTime || album.publishDate || 0).getTime() || null,
  };
}

export const QUALITY_MAP: Record<string, Quality> = {
  "l": {
    key: "standard",
    label: "标准",
    bitrate: 128000,
    // format: "mp3",
    size: 0.
  },
  "m": {
    key: "higher",
    label: "高品质",
    bitrate: 192000,
    // format: "mp3",
    size: 0.
  },
  "h": {
    key: "exhigh",
    label: "极高 HQ",
    bitrate: 320000,
    // format: "mp3",
    size: 0.
  },
  "sq": {
    key: "lossless",
    label: "无损 SQ",
    // format: "flac",
    size: 0.
  },
};

export function mapTrack(track: any = {}): Track {
  const qualities: Quality[] = [];
  Object.entries(QUALITY_MAP).forEach(([key, el]) => {
    if (track[key] && track[key].size > 0) {
      const q: Quality = {
        ...el,
        size: Number(track[key].size) || 0,
        bitrate: track[key].br > 0 ? track[key].br : (el.bitrate || 0),
        format: el.format
      };
      qualities.push(q);
    }
  });
  return {
    id: toStringId(track.id || track.mid),
    title: track.name || track.title || '',
    artists: Array.isArray(track.ar) ? track.ar.map((artist: any) => mapArtist(artist)) : Array.isArray(track.artists) ? track.artists.map((artist: any) => mapArtist(artist)) : [],
    album: mapAlbum(track.al || track.album),
    durationMs: Number(track.dt) || 0,
    aliases: Array.isArray(track.alia) ? track.alia.filter(Boolean) : [],
    mvId: optionalRawId(track.mv?.vid ?? track.mv?.id ?? track.mv),
    favorite: false,
    qualities: qualities,
    fee: track.fee === 1
  };
}

export function mapArtistDetail(artist: any = {}): ArtistDetail {
  return {
    id: toStringId(artist.id || artist.mid),
    name: artist.name || artist.artistName || '',
    coverUrl: artist.avatar || artist.picUrl || artist.cover || artist.img1v1Url || '',
    avatarUrl: artist.avatar || artist.picUrl || artist.cover || artist.img1v1Url || '',
    description: artist.briefDesc || artist.desc || artist.description || '',
    tracks: []
  };
}

export function mapAlbumDetail(raw: any = {}): AlbumDetail {
  const albumSource = raw.album || raw.data?.album || raw;
  const album: AlbumDetail = {
    id: toStringId(albumSource.id || albumSource.mid),
    name: albumSource.name || raw.name || '',
    coverUrl: albumSource.picUrl || albumSource.coverUrl || albumSource.coverImgUrl || '',
    description: albumSource.description || albumSource.desc || raw.desc || '',
    genre: albumSource.genre || raw.genre,
    language: albumSource.lan || raw.lan,
    artist: {
      id: toStringId(albumSource.artist?.id || albumSource.artist?.mid),
      name: albumSource.artist?.name || albumSource.artistName || '',
      coverUrl: albumSource.artist?.picUrl || albumSource.artist?.coverUrl || albumSource.artist?.avatar || ''
    },
    publishTime: normalizeTimestamp(albumSource.publishTime || albumSource.aDate),
    trackCount: albumSource.trackCount || raw.total_song_num || 0,
    tracks: [],
  };

  const songs = raw.songs || raw.list || albumSource.tracks || [];
  (songs || []).forEach((song: any) => {
    album.tracks.push(mapTrack({
      ...song,
      al: song.al || song.album || albumSource,
    }));
  });

  return album;
}

export function mapSearchSuggest(raw: any = {}): SearchSuggest {
  const result = raw.result || raw;
  const songs: Track[] = Array.isArray(result.songs) ? result.songs.map((song: any) => mapTrack(song)) : [];
  const artists: Artist[] = Array.isArray(result.artists) ? result.artists.map((artist: any) => mapArtist(artist)) : [];
  const albums: Album[] = Array.isArray(result.albums) ? result.albums.map((album: any) => mapAlbum(album)) : [];
  return { songs, artists, albums };
}

export function mapUserDetail(raw: any): UserProfile {
  const profile = raw.profile || raw.data?.profile || raw.data || raw;
  return {
    userId: String(profile.userId || profile.uid || raw.userId || ''),
    nickname: profile.nickname || profile.nickName || raw.nickname || '',
    avatar: profile.avatarUrl || profile.avatar || raw.avatarUrl || '',
    isVip: Boolean(profile.vipType || profile.isVip || raw.vipType || false),
    platform: SOURCE_PREFIX
  };
}
