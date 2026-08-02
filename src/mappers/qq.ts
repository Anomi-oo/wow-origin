import type { Album, AlbumDetail, Artist, ArtistDetail, Playlist, Quality, SearchSuggest, Track, TrackLyrics, TrackUrl, UserProfile } from 'aduoer-wow-sdk';
import { makeTrackLyrics } from '../trackLyrics';
import type { Lyrics } from '../types';

type Creator = NonNullable<Playlist['creator']>;

const SOURCE_PREFIX = 'qq';

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
    wordLyrics.yrc?.lyric,
    lineLyrics.tlyric?.lyric || wordLyrics.tlyric?.lyric
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
  let coverUrl = artist.picUrl || artist.avatar || artist.coverUrl;
  if (!coverUrl && artist.mid) {
    coverUrl = `https://y.gtimg.cn/music/photo_new/T001R300x300M000${artist.mid}.jpg`;
  }
  return {
    id: toStringId(artist.mid || artist.id),
    name: artist.name || '',
    coverUrl: coverUrl || ''
  };
}

export function mapAlbum(album: any = {}): Album {
  const artistName = album.artistName || album.artist?.name || (Array.isArray(album.artists) ? album.artists.map((artist: any) => artist.name).filter(Boolean).join(', ') : '');
  let coverUrl = album.coverUrl || album.picUrl || album.coverImgUrl || album.img1v1Url;
  if (!coverUrl && album.mid) {
    coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.mid}.jpg`;
  }
  return {
    id: toStringId(album.id), // 专辑使用 id，而不是 mid，因为获取专辑详情是根据 id 来获取的
    name: album.name || '',
    coverUrl: coverUrl || '',
    artistName,
    publishTime: new Date(album.publishTime || album.publishDate || 0).getTime() || null,
  };
}

function mapQualities(value: any): Quality[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((quality: any) => {
    if (!quality || typeof quality.key !== 'string' || typeof quality.label !== 'string') {
      return [];
    }

    return [{
      key: quality.key,
      label: quality.label,
      description: quality.description,
      bitrate: quality.bitrate === null || quality.bitrate === undefined ? quality.bitrate : Number(quality.bitrate),
      format: quality.format,
      size: Number(quality.size) || 0
    }];
  });
}

export function mapTrack(track: any = {}): Track {
  return {
    id: toStringId(track.mid || track.id),
    title: track.name || track.title || '',
    artists: (track.ar || track.artists || []).map((artist: any) => mapArtist(artist)),
    album: mapAlbum(track.al || track.album),
    durationMs: Number(track.dt) || 0,
    aliases: Array.isArray(track.alia) ? track.alia.filter(Boolean) : [],
    mvId: optionalRawId(track.mv?.vid ?? track.mv?.id ?? track.mv),
    favorite: false,
    qualities: mapQualities(track.qualities),
    fee: track.fee === 1
  };
}

export function mapArtistDetail(artist: any = {}): ArtistDetail {
  return {
    id: toStringId(artist.id || artist.mid),
    name: artist.name || artist.artistName || '',
    coverUrl: artist.avatar || artist.picUrl || artist.cover || '',
    avatarUrl: artist.avatar || artist.picUrl || artist.cover || '',
    description: artist.briefDesc || artist.desc || artist.description || '',
    tracks: []
  };
}

export function mapAlbumDetail(raw: any = {}): AlbumDetail {
  const albumSource = raw.album || raw.data?.album || raw;
  let coverUrl = albumSource.coverUrl || albumSource.picUrl || albumSource.coverImgUrl;
  if (!coverUrl && albumSource.mid) {
    coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumSource.mid}.jpg`;
  }
  let artistCoverUrl = albumSource.artist?.coverUrl || albumSource.artist?.picUrl || albumSource.artist?.avatar;
  if (!artistCoverUrl && albumSource.singermid) {
    artistCoverUrl = `https://y.gtimg.cn/music/photo_new/T001R300x300M000${albumSource.singermid}.jpg`;
  }
  const album: AlbumDetail = {
    id: toStringId(albumSource.id),
    name: albumSource.name || raw.name || '',
    coverUrl: coverUrl || '',
    description: albumSource.desc || raw.desc || '',
    genre: albumSource.genre || raw.genre,
    language: albumSource.lan || raw.lan,
    artist: {
      id: toStringId(albumSource.singermid || albumSource.artist?.id || albumSource.artist?.mid),
      name: albumSource.singername || albumSource.artist?.name || '',
      coverUrl: artistCoverUrl || ''
    },
    publishTime: normalizeTimestamp(albumSource.aDate || albumSource.publishTime),
    trackCount: raw.total_song_num || albumSource.trackCount || 0,
    tracks: [],
  };

  const songs = raw.list || raw.songs || albumSource.tracks || [];
  (songs || []).forEach((song: any) => {
    album.tracks.push(mapTrack({
      ...song,
      mid: song.songmid || song.mid || song.id,
      name: song.songname || song.name || song.title,
      ar: song.singer || song.ar || song.artists,
      al: song.album || {
        id: song.albummid || song.al?.id,
        mid: song.albummid || song.al?.mid,
        name: song.albumname || song.al?.name
      },
      dt: Number(song.interval || song.dt) * (song.interval ? 1000 : 1),
      alia: song.alia || [],
      mv: song.songid || song.mv
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
