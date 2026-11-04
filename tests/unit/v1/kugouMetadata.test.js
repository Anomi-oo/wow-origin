const express = require('express');
const request = require('supertest');
const { createWowRouter } = require('aduoer-wow-sdk');
const { KugouClient } = require('../../../dist/clients/KugouClient');
const { createWowContextResolver } = require('../../../dist/adapter');
const { mapTrack, mapPlaylist, imageUrl, findLikedPlaylist, trackResource } = require('../../../dist/mappers/kugou');

const hash = 'a'.repeat(32);
const cover = 'http://imge.kugou.com/stdmusic/{size}/song.jpg';
const song = { hash, name: '歌手 - 歌曲.mp3', fileid: 9, cover };
const liked = { listid: 42, name: '我喜欢', is_def: 2, list_create_userid: '1', type: 0, source: 1, count: 1, list_ver: 1, pic: '' };
function mockRoutes(handlers) {
  const call = jest.fn(async (route, { query }) => {
    if (!handlers[route]) throw new Error(`Unexpected Kugou route: ${route}`);
    return { code: 200, body: await handlers[route](query) };
  });
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule: call }) };
  return call;
}
function client(context = {}) {
  return new KugouClient('userid=1', undefined, undefined, undefined, undefined, context);
}
afterEach(() => { jest.restoreAllMocks(); delete global.__musicPlatformFactory__; });

test('missing create listid is resolved using the new own playlist, excluding old duplicate names and foreign/album rows', async () => {
  let created = false;
  const old = { listid: 50, name: '新歌单', list_create_userid: '1' };
  const added = { ...old, listid: 51 };
  const call = mockRoutes({
    'user/playlist': () => ({ data: { info: created ? [old, added, { ...added, listid: 52, list_create_userid: '2' }, { ...added, listid: 53, source: 2 }] : [old] } }),
    'playlist/add': () => { created = true; return { status: 1, data: { total_ver: 10 } }; }
  });
  const c = client();
  await expect(c.createPlaylist('新歌单')).resolves.toMatchObject({ id: 'user:51', name: '新歌单', favorite: false });
  expect(call.mock.calls.filter(([route]) => route === 'playlist/add')).toHaveLength(1);
  expect(call.mock.calls.filter(([route]) => route === 'user/playlist')).toHaveLength(2);
  await expect(c.getPlaylistDetail('user:51', 0)).resolves.toMatchObject({ id: 'user:51' });
});

test('create responses with a direct listid do not need a post-write discovery', async () => {
  const call = mockRoutes({ 'user/playlist': () => [], 'playlist/add': () => ({ status: 1, data: { listid: 51 } }) });
  await expect(client().createPlaylist('新歌单')).resolves.toMatchObject({ id: 'user:51', name: '新歌单' });
  expect(call.mock.calls.filter(([route]) => route === 'user/playlist')).toHaveLength(1);
});

test.each([{ added: [] }, { added: [{ listid: 51, name: '新歌单' }, { listid: 52, name: '新歌单' }] }])('ambiguous post-create snapshots never trigger a second creation or return a guessed ID', async ({ added }) => {
  let created = false;
  const call = mockRoutes({ 'user/playlist': () => created ? added : [], 'playlist/add': () => { created = true; return { status: 1 }; } });
  await expect(client().createPlaylist('新歌单')).rejects.toThrow('已创建歌单，但无法唯一确认');
  expect(call.mock.calls.filter(([route]) => route === 'playlist/add')).toHaveLength(1);
});

test('default collection and liked songs remain separate; the system liked flag takes priority', () => {
  const defaultList = { ...liked, listid: 41, name: '默认收藏', is_def: 1 };
  expect(findLikedPlaylist([defaultList, { ...liked, name: '系统红心列表' }], '1').listid).toBe(42);
  expect(mapPlaylist(defaultList, true, '1').id).toBe('user:41');
  expect(mapPlaylist(liked, true, '1').id).toBe('user:42');
});

test.each([
  [{ flexible_cover: '', imgurl: '', pic: cover }, 'https://imge.kugou.com/stdmusic/500/song.jpg'],
  [{ pic: 'stdmusic/song.jpg' }, 'https://imge.kugou.com/stdmusic/500/song.jpg'],
  [{ pic: 'custom/{size}/song.jpg' }, 'https://imge.kugou.com/custom/500/song.jpg'],
  [{ pic: 'custom/150/song.jpg' }, 'https://imge.kugou.com/custom/150/song.jpg']
])('playlist cover mapping skips blank fields and normalizes upstream image paths: %j', (raw, expected) => {
  expect(mapPlaylist(raw).coverUrl).toBe(expected);
});

test('image mapping rejects non-string fields and upgrades legacy image hosts', () => {
  expect(imageUrl({ url: cover })).toBe('');
  expect(imageUrl('//c1.kgimg.com/stdmusic/{size}/x.jpg')).toBe('https://imge.kugou.com/stdmusic/500/x.jpg');
});

test('large playlist snapshots only use paginated list requests and never request songs or metadata for covers', async () => {
  const lists = Array.from({ length: 1000 }, (_, i) => ({ ...liked, listid: i + 100, is_def: 0, name: `歌单${i}` }));
  const call = mockRoutes({ 'user/playlist': query => ({ data: { total: lists.length, info: lists.slice((query.page - 1) * query.pagesize, query.page * query.pagesize) } }) });
  const result = await client().getUserPlaylist();
  expect(result).toHaveLength(1000);
  expect(result.every(p => p.coverUrl === '')).toBe(true);
  expect(call).toHaveBeenCalledTimes(4);
  expect(call.mock.calls.every(([route]) => route === 'user/playlist')).toBe(true);
});

test.each([
  [{ name: '歌手 - 歌曲.mp3' }, '歌曲'],
  [{ filename: '歌手 - 歌曲.FLAC  ' }, '歌曲'],
  [{ FileName: '歌曲.m4a' }, '歌曲'],
  [{ audio_info: { filename: '歌手 - 歌曲.ogg' } }, '歌曲'],
  [{ songname: '歌曲.mp3 (Live)' }, '歌曲.mp3 (Live)']
])('display titles remove final audio extensions without changing raw resources: %j', (raw, title) => {
  expect(mapTrack({ hash, ...raw }).title).toBe(title);
  if (raw.name) expect(trackResource(raw).name).toBe(raw.name);
});

test('liked tracks and playlist detail expose clean titles and the cloud song cover field', async () => {
  mockRoutes({ 'user/playlist': () => [liked], 'playlist/track/all/new': () => ({ data: { info: [song] } }) });
  const c = client();
  await expect(c.userFavoriteTracks()).resolves.toMatchObject([{ title: '歌曲', favorite: true, coverUrl: 'https://imge.kugou.com/stdmusic/500/song.jpg' }]);
  await expect(c.getPlaylistDetail('user:42')).resolves.toMatchObject({ coverUrl: '', tracks: [{ title: '歌曲', coverUrl: 'https://imge.kugou.com/stdmusic/500/song.jpg' }] });
});

const artist = (id, name) => ({ singerid: id, singername: name, imgurl: `http://singerimg.kugou.com/{size}/${id}.jpg` });
test('artist groups are flattened, deduplicated, and paginated beyond 1000 results', async () => {
  const hot = artist(1, '热门歌手');
  const call = mockRoutes({ 'artist/lists': () => ({ data: { info: [
    { title: '热门', singer: [hot] },
    { title: 'A', singer: [hot, ...Array.from({ length: 1200 }, (_, i) => artist(i + 2, `歌手${i + 2}`))] }
  ] } }) });
  const c = client();
  expect((await c.getTopArtists())[0]).toMatchObject({ id: '1', name: '热门歌手', coverUrl: 'https://singerimg.kugou.com/500/1.jpg' });
  const first = await c.getArtists(0, 2);
  const next = await c.getArtists(2, 2);
  expect(first.items.map(a => a.id)).toEqual(['1', '2']);
  expect(next.items.map(a => a.id)).toEqual(['3', '4']);
  expect((await c.getArtists(1200, 2))).toMatchObject({ items: [{ id: '1201' }], hasMore: false });
  expect(call.mock.calls.every(([, { query }]) => query.hotsize === 100)).toBe(true);
});

test('SDK artist list and homepage artist routes return names and avatars from grouped payloads', async () => {
  mockRoutes({ 'artist/lists': () => ({ data: { info: [{ title: '热门', singer: [artist(3520, '周杰伦')] }] } }) });
  const account = { platform: 'kugou', cookie: 'userid=1', apiAccessKey: 'key', favoriteArtistsLoaded: true, favoriteAlbumsLoaded: true };
  const app = express();
  app.use(createWowRouter({ resolveContext: createWowContextResolver({ sessions: [account], byAccessKey: new Map([['key', account]]) }) }));
  for (const route of ['artist/list', 'artist/top']) {
    const res = await request(app).get('/v1/' + route).set('Authorization', 'Bearer key').expect(200);
    const list = Array.isArray(res.body.data) ? res.body.data : res.body.data.items;
    expect(list[0]).toMatchObject({ id: '3520', name: '周杰伦', coverUrl: 'https://singerimg.kugou.com/500/3520.jpg' });
  }
});
