const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { KugouClient } = require('../../../dist/clients/KugouClient');
const { createAdapter, createWowContextResolver } = require('../../../dist/adapter');
const { loadAccountSessions, updateAccountCookieByAccessKey } = require('../../../dist/accounts');
const { createLocalAccountStore } = require('../../../dist/storage/accounts');
const { createLoginRouter } = require('../../../dist/login');
const { createWowRouter } = require('aduoer-wow-sdk');
const { mapTrack, krcToWordLyrics } = require('../../../dist/mappers/kugou');
const KugouPlatform = require('../../../platforms/kugou/KugouPlatform');

const hash = 'a'.repeat(32);
const song = { hash, name: '歌手 - 歌曲', album_id: '7', mixsongid: '8', fileid: 99, timelen: 180000 };
const liked = { listid: 42, name: '我喜欢的音乐', is_def: 1, list_create_userid: '1' };
const stores = [];
beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
function storeAccount(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-kugou-'));
  const store = createLocalAccountStore(dir); stores.push(store);
  store.insert({ platform: 'kugou', cookie: 'userid=1; token=old', api_access_key: 'key', stateless: false });
  const registry = loadAccountSessions(store);
  registry.sessions[0].kugouState = state;
  return { store, registry, dir };
}
function mockRoutes(handlers) {
  const call = jest.fn(async (route, req) => {
    if (!handlers[route]) throw new Error(`Unexpected Kugou route: ${route}`);
    const body = await handlers[route](req.query);
    return { code: 200, body };
  });
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule: call }) };
  return call;
}
afterEach(() => { jest.restoreAllMocks(); delete global.__musicPlatformFactory__; while (stores.length) stores.pop().close(); });

test('clients share the liked list in memory and a session restart rediscovers it without database writes', async () => {
  const { store, registry, dir } = storeAccount();
  const update = jest.spyOn(store, 'update');
  const call = mockRoutes({ 'user/playlist': () => ({ data: { info: [liked] } }), 'playlist/track/all/new': () => ({ data: { info: [song] } }) });
  expect((await createAdapter(registry.sessions[0]).userFavoriteTracks())[0]).toMatchObject({ id: hash, favorite: true });
  expect(registry.sessions[0].kugouState).toEqual({ userId: '1', likedPlaylistId: '42' });
  await createAdapter(registry.sessions[0]).userFavoriteTracks();
  expect(call.mock.calls.filter(([route]) => route === 'user/playlist')).toHaveLength(1);
  expect(store.list()[0]).not.toHaveProperty('kugouState');
  const reopened = createLocalAccountStore(dir); stores.push(reopened);
  expect(loadAccountSessions(reopened).sessions[0].kugouState).toBeUndefined();
  await createAdapter(loadAccountSessions(reopened).sessions[0]).userFavoriteTracks();
  expect(call.mock.calls.filter(([route]) => route === 'user/playlist')).toHaveLength(2);
  expect(update).not.toHaveBeenCalled();
});

test.each([
  ['default collection first', [
    { listid: 41, name: '默认收藏', is_def: 1, list_create_userid: '1' },
    { ...liked, is_def: undefined }
  ], '42'],
  ['liked list first', [liked, { listid: 41, name: '默认收藏', is_def: 1 }], '42'],
  ['foreign and album rows first', [
    { ...liked, listid: 40, list_create_userid: '2' },
    { ...liked, listid: 41, source: 2 },
    { ...liked, name: '我喜欢', is_def: undefined }
  ], '42'],
  ['system flag fallback', [{ listid: 43, name: '系统歌单', is_default: 1 }], '43'],
  ['default collection fallback', [{ listid: 41, name: '默认收藏' }], '41']
])('liked list discovery handles %s', async (_name, lists, expectedId) => {
  const context = {};
  const call = mockRoutes({ 'user/playlist': () => lists, 'playlist/track/all/new': () => [song] });
  await new KugouClient('userid=1', undefined, undefined, undefined, undefined, context).userFavoriteTracks();
  expect(context.kugouState).toEqual({ userId: '1', likedPlaylistId: expectedId });
  expect(call).toHaveBeenCalledWith('playlist/track/all/new', expect.objectContaining({ query: expect.objectContaining({ listid: expectedId }) }));
});

test('My Playlists refresh corrects a cached default ID and liked-list discovery restarts with a new session', async () => {
  const { store, registry, dir } = storeAccount({ userId: '1', likedPlaylistId: '41' });
  const call = mockRoutes({
    'user/playlist': () => [{ listid: 41, name: '默认收藏', is_def: 1 }, { ...liked, is_def: undefined }],
    'playlist/track/all/new': () => [song],
    'playlist/tracks/add': () => ({ status: 1 })
  });
  const client = createAdapter(registry.sessions[0]);
  await client.getUserPlaylist();
  await client.userFavoriteTracks();
  await client.favoriteTrack(hash, true);
  expect(registry.sessions[0].kugouState).toEqual({ userId: '1', likedPlaylistId: '42' });
  expect(store.list()[0]).not.toHaveProperty('kugouState');
  expect(call).toHaveBeenCalledWith('playlist/tracks/add', expect.objectContaining({ query: expect.objectContaining({ listid: '42' }) }));
  const reopened = createLocalAccountStore(dir); stores.push(reopened);
  await createAdapter(loadAccountSessions(reopened).sessions[0]).userFavoriteTracks();
  expect(call.mock.calls.filter(([route]) => route === 'user/playlist')).toHaveLength(2);
});

test('same-user token refresh keeps the liked ID; switching userid clears it and all favorite caches', async () => {
  const state = { userId: '1', likedPlaylistId: '42' };
  const { store, registry } = storeAccount(state);
  const session = registry.sessions[0];
  updateAccountCookieByAccessKey('key', 'kugou', 'userid=1; token=new', registry, store);
  expect(session.kugouState).toEqual(state);
  expect(store.list()[0]).not.toHaveProperty('kugouState');
  session.favoriteTrackIds.add(hash); session.kugouPlaylists = [liked];
  updateAccountCookieByAccessKey('key', 'kugou', 'userid=2; token=other', registry, store);
  expect(session.kugouState).toBeUndefined(); expect(session.kugouPlaylists).toBeUndefined();
  expect(session.favoriteTrackIds.size).toBe(0); expect(store.list()[0].kugouState).toBeUndefined();
});

test('Kugou defaults to enabling LX, preserves explicit opt-out, and saves account source settings', async () => {
  const { app, registry, store } = loginApp(loginPlatform());
  expect(registry.sessions[0].useLuoxue).toBe(true);
  const settings = { api_access_key: 'key', name: '酷狗', stateless: false, useLuoxue: true, lxSource: ['https://source.test/kugou.js'] };
  await request(app).put('/login/api/account/config').send(settings).expect(200);
  expect(store.list()[0]).toMatchObject({ useLuoxue: true, lxSource: settings.lxSource });
  expect(registry.sessions[0]).toMatchObject({ useLuoxue: true, lxSource: settings.lxSource });
  await request(app).put('/login/api/account/config').send({ ...settings, useLuoxue: false }).expect(200);
  expect(loadAccountSessions(store).sessions[0].useLuoxue).toBe(false);
});

test('parallel favorites reads share discovery; stale in-flight discovery cannot enter a different account', async () => {
  let finish;
  const { store, registry } = storeAccount();
  const session = registry.sessions[0];
  const call = mockRoutes({ 'user/playlist': () => new Promise(resolve => { finish = resolve; }), 'playlist/track/all/new': () => [song] });
  const client = createAdapter(session);
  const first = client.userFavoriteTracks(); const second = client.userFavoriteTracks();
  const assertions = [expect(first).rejects.toThrow('账号已变更'), expect(second).rejects.toThrow('账号已变更')];
  await new Promise(setImmediate);
  expect(call).toHaveBeenCalledTimes(1);
  updateAccountCookieByAccessKey('key', 'kugou', 'userid=2; token=new', registry, store);
  finish({ data: { info: [liked] } });
  await Promise.all(assertions);
  expect(session.kugouPlaylists).toBeUndefined(); expect(store.list()[0].kugouState).toBeUndefined();
});

test('transport errors retain the saved list ID; only a confirmed deleted list triggers rediscovery', async () => {
  const context = { kugouState: { userId: '1', likedPlaylistId: '42' } };
  const callModule = jest.fn(async (route, { query }) => {
    if (route === 'user/playlist') return { code: 200, body: { data: [ { ...liked, listid: 43 } ] } };
    if (query.listid === '43') return { code: 200, body: [song] };
    return { code: 502, message: 'timeout', stalePlaylist: false };
  });
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  const client = new KugouClient('userid=1', undefined, undefined, undefined, undefined, context);
  await expect(client.userFavoriteTracks()).rejects.toThrow('timeout');
  expect(context.kugouState.likedPlaylistId).toBe('42'); expect(callModule).toHaveBeenCalledTimes(1);
  callModule.mockImplementationOnce(async () => ({ code: 502, message: '歌单不存在', stalePlaylist: true }));
  await client.userFavoriteTracks();
  expect(context.kugouState.likedPlaylistId).toBe('43');
});

test('refreshing My Playlists clears a missing liked ID and never picks an arbitrary similarly-named playlist', async () => {
  const { store, registry } = storeAccount({ userId: '1', likedPlaylistId: '42' });
  mockRoutes({ 'user/playlist': () => [{ listid: 45, name: '我喜欢的摇滚', list_create_userid: '1' }] });
  const client = createAdapter(registry.sessions[0]); await client.getUserPlaylist();
  expect(registry.sessions[0].kugouState).toEqual({ userId: '1' });
  expect(store.list()[0]).not.toHaveProperty('kugouState');
  await expect(client.userFavoriteTracks()).rejects.toThrow('未找到');
});

test('favorite add uses hash+album+MixSongID and removal uses cloud fileid, with no playlist-list lookup', async () => {
  const ids = new Set(); const context = { kugouState: { userId: '1', likedPlaylistId: '42' } };
  const call = mockRoutes({ 'playlist/track/all/new': () => [song], 'playlist/tracks/add': () => ({ status: 1 }), 'playlist/tracks/del': () => ({ status: 1 }) });
  const client = new KugouClient('userid=1', ids, undefined, undefined, undefined, context);
  await client.userFavoriteTracks(); await client.favoriteTrack(hash, false); await client.favoriteTrack(hash, true);
  expect(call).toHaveBeenCalledWith('playlist/tracks/del', expect.objectContaining({ query: expect.objectContaining({ listid: '42', fileids: '99' }) }));
  expect(call).toHaveBeenCalledWith('playlist/tracks/add', expect.objectContaining({ query: expect.objectContaining({ data: [{ name: '歌手 - 歌曲', hash, album_id: '7', mixsongid: '8' }] }) }));
  expect(ids.has(hash)).toBe(true);
  call.mockImplementationOnce(async () => ({ code: 502, message: 'failed write' }));
  await expect(client.favoriteTrack(hash, true)).rejects.toThrow('failed write');
  expect(ids.has(hash)).toBe(true);
});

test('pagination preserves offsets crossing pages and total on the response root', async () => {
  const call = mockRoutes({ search: query => ({ total: 205, data: Array.from({ length: query.page === 3 ? 5 : 100 }, (_, i) => ({ ...song, hash: ((query.page - 1) * 100 + i).toString(16).padStart(32, '0') })) }) });
  const page = await new KugouClient('userid=1').searchTracks('歌', 95, 20);
  expect(page.items).toHaveLength(20); expect(page.items[0].id).toBe((95).toString(16).padStart(32, '0'));
  expect(page.items[19].id).toBe((114).toString(16).padStart(32, '0')); expect(page.hasMore).toBe(true);
  expect(call).toHaveBeenCalledTimes(2);
});

test('album favorites use source=2 and remove the account-local listid', async () => {
  let saved = false;
  const call = mockRoutes({ 'user/playlist': () => saved ? [{ source: 2, listid: 80, list_create_listid: 7, name: '专辑' }] : [], 'album/detail': () => [{ album_id: 7, album_name: '专辑', authors: [{ author_id: 9, author_name: '歌手' }] }], 'playlist/add': () => { saved = true; return {}; }, 'playlist/del': () => ({}) });
  const client = new KugouClient('userid=1'); await client.favoriteAlbum('7', true); await client.favoriteAlbum('7', false);
  expect(call).toHaveBeenCalledWith('playlist/add', expect.objectContaining({ query: expect.objectContaining({ source: 2, type: 1, list_create_listid: '7', list_create_userid: '9' }) }));
  expect(call).toHaveBeenCalledWith('playlist/del', expect.objectContaining({ query: expect.objectContaining({ listid: 80 }) }));
});

const favoriteList = { listid: 51, name: '收藏歌单', list_create_userid: '2', type: 1, source: 1, list_create_gid: 'collection_3_2_77_0', global_collection_id: 'collection_alias' };
const favoriteListIds = ['user:51', favoriteList.list_create_gid, favoriteList.global_collection_id];

test.each(favoriteListIds)('canceling a playlist favorite through %s clears every alias across clients', async id => {
  const { registry } = storeAccount();
  const session = registry.sessions[0];
  const call = mockRoutes({
    'user/playlist': () => [favoriteList],
    'playlist/del': () => ({}),
    'playlist/track/all': () => ({ data: { list_info: favoriteList } })
  });
  const client = createAdapter(session);
  await client.getUserPlaylist();
  // Both public IDs may already have been cached by earlier requests.
  favoriteListIds.forEach(alias => { session.playlistFavorites.set(alias, true); session.userPlaylistIds.add(alias); });
  await client.favoritePlaylist(id, false);
  expect(call).toHaveBeenCalledWith('playlist/del', expect.objectContaining({ query: expect.objectContaining({ listid: 51 }) }));
  expect(session.kugouPlaylists).toBeUndefined();
  const next = createAdapter(session);
  for (const alias of favoriteListIds) {
    expect(session.playlistFavorites.apply({ id: alias }).favorite).toBe(false);
    expect(session.userPlaylistIds.has(alias)).toBe(false);
  }
  expect((await next.getPlaylistDetail(favoriteList.list_create_gid, 0)).favorite).toBe(false);
});

test('a failed playlist deletion retains favorite state for every alias', async () => {
  const { registry } = storeAccount();
  const session = registry.sessions[0];
  mockRoutes({ 'user/playlist': () => [favoriteList], 'playlist/del': () => { throw new Error('failed write'); } });
  const client = createAdapter(session);
  await client.getUserPlaylist();
  favoriteListIds.forEach(alias => { session.playlistFavorites.set(alias, true); session.userPlaylistIds.add(alias); });
  await expect(client.favoritePlaylist('user:51', false)).rejects.toThrow('failed write');
  for (const alias of favoriteListIds) {
    expect(session.playlistFavorites.apply({ id: alias }).favorite).toBe(true);
    expect(session.userPlaylistIds.has(alias)).toBe(true);
  }
});

test('adding a playlist favorite caches public aliases and the returned account-local ID', async () => {
  const { registry } = storeAccount();
  const session = registry.sessions[0];
  mockRoutes({
    'user/playlist': () => [],
    'playlist/track/all': () => ({ data: { list_info: favoriteList } }),
    'playlist/add': () => ({ data: { listid: 51 } })
  });
  await createAdapter(session).favoritePlaylist(favoriteList.list_create_gid, true);
  for (const alias of favoriteListIds) {
    expect(session.playlistFavorites.apply({ id: alias }).favorite).toBe(true);
    expect(session.userPlaylistIds.has(alias)).toBe(true);
  }
});

test('public list detail uses list_info and namespaced local IDs cannot delete the system liked list', async () => {
  mockRoutes({ 'playlist/track/all': () => ({ data: { list_info: { name: '公开歌单', global_collection_id: 'collection_1' }, songs: [song] } }), 'user/playlist': () => [liked] });
  const client = new KugouClient('userid=1');
  expect(await client.getPlaylistDetail('collection_1', 1)).toMatchObject({ id: 'collection_1', name: '公开歌单', tracks: [{ id: hash }] });
  await expect(client.deletePlaylist('user:42')).rejects.toThrow('不能删除');
});

test('normalizes real search, KMR, and new-song payloads and converts KRC relative word timing', () => {
  expect(mapTrack({ FileHash: hash.toUpperCase(), SongName: '歌曲', Singers: [{ id: 9, name: '歌手' }], Duration: 180, HQFileSize: 500 })).toMatchObject({ id: hash, durationMs: 180000, artists: [{ id: '9', name: '歌手' }], qualities: [{ key: 'exhigh', size: 500 }] });
  expect(mapTrack({ ...song, timelen: undefined, timelength: 181000, filesize_flac: 900, album_sizable_cover: 'http://x/{size}' })).toMatchObject({ durationMs: 181000, coverUrl: 'https://x/500' });
  expect(mapTrack({ audio_info: { hash_128: hash, duration: 182000 }, base: { audio_name: '歌曲', album_id: 7 } })).toMatchObject({ id: hash, title: '歌曲', durationMs: 182000 });
  expect(krcToWordLyrics('[ar:歌手]\n[1000,600]<0,300,0>你<300,300,0>好')).toBe('[1000,600](1000,300,0)你(1300,300,0)好');
});

test('Wow SDK routes expose Kugou without changing the public protocol', async () => {
  const { registry } = storeAccount({ userId: '1', likedPlaylistId: '42' });
  mockRoutes({ 'playlist/track/all/new': () => [song], 'top/playlist': () => ({ data: { special_list: [{ global_collection_id: 'collection_1', specialname: '推荐' }] } }), 'rank/list': () => ({ data: { info: [{ rankid: 8, rankname: '热歌', img_9: 'http://x/{size}', songinfo: [{ name: '歌曲', author: '歌手' }] }] } }) });
  const app = express(); app.use(createWowRouter({ resolveContext: createWowContextResolver(registry) }));
  for (const route of ['user/favorite/tracks', 'playlist/list', 'toplist/list']) {
    const res = await request(app).get('/v1/' + route).set('Authorization', 'Bearer key');
    expect({ route, status: res.status, body: res.body }).toMatchObject({ status: 200, body: { code: 200 } });
  }
});

function loginApp(platform) {
  const { store, registry } = storeAccount(); const app = express(); app.use(express.json());
  app.use('/login', createLoginRouter({ registry, platformFactory: { getPlatform: () => platform }, accountStore: store }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  return { app, registry, store };
}
function loginPlatform() {
  const p = new KugouPlatform();
  p.device = jest.fn(async cookie => ({ ...cookie, dfid: 'device', KUGOU_API_GUID: 'guid' }));
  p.modules.set('user/playlist', async () => ({ body: { data: [liked] } }));
  p.modules.set('playlist/track/all/new', async () => ({ body: { data: [song] } }));
  p.modules.set('user/follow', async () => ({ body: { data: [] } }));
  global.__musicPlatformFactory__ = { getPlatform: () => p };
  p.modules.set('user/detail', async () => ({ body: { status: 1, data: { userid: 1, nickname: '酷狗用户' } } }));
  return p;
}
test('QR login carries its device identity through confirmation and account creation', async () => {
  const p = loginPlatform();
  p.modules.set('login/qr/key', async () => ({ body: { status: 1, data: { qrcode: 'qr-key' } } }));
  p.modules.set('login/qr/create', async () => ({ body: { data: { base64: 'data:image/png;base64,test' } } }));
  const check = jest.fn(async () => ({ body: { status: 1, data: { status: 4 } }, cookie: ['userid=1', 'token=logged-in'] }));
  p.modules.set('login/qr/check', check);
  const { app, registry } = loginApp(p);
  await request(app).post('/login/api/start').send({ platform: 'kugou', mode: 'create' }).expect(200);
  await request(app).post('/login/api/check').send({ token: 'qr-key' }).expect(200);
  expect(check.mock.calls[0][0].cookie).toMatchObject({ dfid: 'device', KUGOU_API_GUID: 'guid' });
  expect(registry.sessions[1].cookie).toContain('token=logged-in'); expect(registry.sessions[1].useLuoxue).toBe(true);
});

test('SMS flow reuses the device and never sends the Wow pending token as an upstream credential', async () => {
  const p = loginPlatform(); p.modules.set('captcha/sent', async () => ({ body: { status: 1 } }));
  const check = jest.fn(async () => ({ body: { status: 1 }, cookie: ['userid=1', 'token=sms-login'] }));
  p.modules.set('login/cellphone', check);
  const { app, registry } = loginApp(p);
  const body = { platform: 'kugou', mode: 'create', phone: '13800000000', countryCode: '86' };
  const first = await request(app).post('/login/api/phone/send').send(body).expect(200);
  const second = await request(app).post('/login/api/phone/send').send({ ...body, token: first.body.data.token }).expect(200);
  expect(p.device.mock.calls[1][0].dfid).toBe('device');
  await request(app).post('/login/api/phone/check').send({ token: second.body.data.token, code: '123456' }).expect(200);
  expect(check.mock.calls[0][0]).toMatchObject({ mobile: body.phone, code: '123456', cookie: { dfid: 'device' } });
  expect(check.mock.calls[0][0].token).toBeUndefined(); expect(check.mock.calls[0][0].cookie.token).toBeUndefined();
  expect(registry.sessions[1].cookie).toContain('token=sms-login');
});

test('upstream HTTP error objects never expose request credentials', async () => {
  const p = new KugouPlatform();
  p.modules.set('search', async () => { throw { body: { msg: { config: { token: 'secret' } } } }; });
  const result = await p.callModule('search', { query: {}, body: {} });
  expect(result.code).toBe(502); expect(JSON.stringify(result)).not.toContain('secret');
});

test('playback obtains account authorization and downgrades only to available lower qualities', async () => {
  const call = mockRoutes({ 'privilege/lite': () => ({ data: [song], quality_vip: [{ qualities: [{ quality: '128', exists: true, size: 100 }] }] }), 'krm/audio': () => [song], 'user/verify': () => ({ data: { auth: 'user-auth' } }), 'song/url/auth/merge': query => {
    if (query.quality === 'high') throw new Error('No Hi-Res permission');
    return { url: ['https://example.com/audio.ogg'], extName: 'ogg', bitrate: 128000, fileSize: 100 };
  } });
  const url = await new KugouClient('userid=1').getTrackUrl(hash, 'hires');
  expect(url).toMatchObject({ quality: 'standard', format: 'ogg', bitrate: 128000 });
  const urls = call.mock.calls.filter(([route]) => route === 'song/url/auth/merge');
  expect(urls.map(([, { query }]) => query.quality)).toEqual(['high', '128']);
  expect(urls[0][1].query).toMatchObject({ album_id: '7', album_audio_id: '8', auth: 'user-auth' });
});

test('recommendation offsets account for variable upstream page sizes', async () => {
  mockRoutes({ 'top/playlist': query => ({ data: { has_next: query.page < 3 ? 1 : 0, special_list: Array.from({ length: 6 }, (_, i) => ({ global_collection_id: `collection_${(query.page - 1) * 6 + i}`, name: '歌单' })) } }) });
  const page = await new KugouClient('userid=1').getPlaylists(8, 5);
  expect(page.items.map(item => item.id)).toEqual(['collection_8', 'collection_9', 'collection_10', 'collection_11', 'collection_12']);
  expect(page.hasMore).toBe(true);
});

test.each(['standard', 'lite'])('%s QR login persists its edition through confirmation, profile lookup and store reload', async kugouEdition => {
  const p = loginPlatform();
  const start = jest.fn(async () => ({ body: { status: 1, data: { qrcode: 'edition-qr' } } }));
  const check = jest.fn(async () => ({ body: { status: 1, data: { status: 4 } }, cookie: ['userid=1', 'token=edition-token'] }));
  p.modules.set('login/qr/key', start);
  p.modules.set('login/qr/create', async () => ({ body: { data: { base64: 'data:image/svg+xml;base64,test' } } }));
  p.modules.set('login/qr/check', check);
  const { app, store } = loginApp(p);
  const qr = await request(app).post('/login/api/start').send({ mode: 'create', platform: 'kugou', kugouEdition }).expect(200);
  expect(qr.body.data.kugouEdition).toBe(kugouEdition);
  expect(start.mock.calls[0][0].cookie.KUGOU_API_PLATFORM).toBe(kugouEdition);
  const result = await request(app).post('/login/api/check').send({ token: qr.body.data.token, kugouEdition: 'tampered' }).expect(200);
  expect(result.body.data.kugouEdition).toBe(kugouEdition);
  expect(check.mock.calls[0][0].cookie.KUGOU_API_PLATFORM).toBe(kugouEdition);
  expect(store.list()[1].cookie).toContain(`KUGOU_API_PLATFORM=${kugouEdition}`);
  const loaded = loadAccountSessions(store).sessions[1];
  const verified = await request(app).post('/login/api/verify-key').send({ api_access_key: loaded.apiAccessKey }).expect(200);
  expect(verified.body.data.kugouEdition).toBe(kugouEdition);
});

test('SMS resending cannot change edition and confirmation keeps the saved concept edition', async () => {
  const p = loginPlatform();
  p.modules.set('captcha/sent', async () => ({ body: { status: 1 } }));
  const check = jest.fn(async () => ({ body: { status: 1 }, cookie: ['userid=1', 'token=sms'] }));
  p.modules.set('login/cellphone', check);
  const { app, store } = loginApp(p);
  const body = { mode: 'create', platform: 'kugou', kugouEdition: 'lite', phone: '13800000000' };
  const sent = await request(app).post('/login/api/phone/send').send(body).expect(200);
  await request(app).post('/login/api/phone/send').send({ ...body, token: sent.body.data.token, kugouEdition: 'standard' }).expect(400);
  const login = await request(app).post('/login/api/phone/check').send({ token: sent.body.data.token, code: '123456' }).expect(200);
  expect(login.body.data.kugouEdition).toBe('lite');
  expect(check.mock.calls[0][0].cookie.KUGOU_API_PLATFORM).toBe('lite');
  expect(store.list()[1].cookie).toContain('KUGOU_API_PLATFORM=lite');
});

test('manual cookie login validates edition and relogin defaults to the saved edition', async () => {
  const p = loginPlatform();
  const profile = jest.fn(async () => ({ body: { status: 1, data: { userid: 1, nickname: '用户' } } }));
  p.modules.set('user/detail', profile);
  const { app, store, registry } = loginApp(p);
  await request(app).post('/login/api/cookie').send({ mode: 'create', platform: 'kugou', kugouEdition: 'bad', cookie: 'userid=1; token=test' }).expect(400);
  await request(app).post('/login/api/cookie').send({ mode: 'create', platform: 'kugou', kugouEdition: 'standard', cookie: 'userid=1; token=test; KUGOU_API_PLATFORM=lite' }).expect(400);
  const login = await request(app).post('/login/api/cookie').send({ mode: 'create', platform: 'kugou', kugouEdition: 'lite', cookie: 'userid=1; token=test' }).expect(200);
  expect(profile.mock.calls[0][0].cookie.KUGOU_API_PLATFORM).toBe('lite');
  const key = login.body.data.apiAccessKey;
  await request(app).post('/login/api/cookie').send({ mode: 'update', api_access_key: key, kugouEdition: 'standard', cookie: 'userid=1; token=wrong' }).expect(400);
  const relogin = await request(app).post('/login/api/cookie').send({ mode: 'update', api_access_key: key, cookie: 'userid=1; token=renewed' }).expect(200);
  expect(relogin.body.data.kugouEdition).toBe('lite');
  expect(store.list()[1].cookie).toContain('KUGOU_API_PLATFORM=lite');
  expect(registry.byAccessKey.get(key).cookie).toContain('token=renewed');
});

test('changing edition clears cached liked IDs and rejects old in-flight discovery for the same user', async () => {
  const { store, registry } = storeAccount({ userId: '1', likedPlaylistId: '42' });
  const session = registry.sessions[0];
  session.favoriteTrackIds.add(hash);
  let finish;
  mockRoutes({ 'user/playlist': () => new Promise(resolve => { finish = resolve; }) });
  const loading = createAdapter(session).getUserPlaylist();
  const rejected = expect(loading).rejects.toThrow('账号已变更');
  await new Promise(setImmediate);
  updateAccountCookieByAccessKey('key', 'kugou', 'userid=1; token=other; KUGOU_API_PLATFORM=lite', registry, store);
  finish([liked]);
  await rejected;
  expect(session.favoriteTrackIds.size).toBe(0);
  expect(session.kugouState).toBeUndefined();
  expect(store.list()[0].kugouState).toBeUndefined();
});

test('concept token refresh preserves edition, device identity and the in-memory liked list', async () => {
  const { refreshLoginSession } = require('../../../dist/loginRefresh');
  const p = loginPlatform();
  const { store, registry } = storeAccount();
  updateAccountCookieByAccessKey('key', 'kugou', 'userid=1; token=old; KUGOU_API_PLATFORM=lite; dfid=device', registry, store);
  const session = registry.sessions[0];
  session.kugouState = { userId: '1', likedPlaylistId: '42' };
  const refresh = jest.fn(async () => ({ body: { status: 1 }, cookie: ['userid=1', 'token=refreshed'] }));
  p.modules.set('login/token', refresh);
  await refreshLoginSession(session, { registry, platformFactory: { getPlatform: () => p }, accountStore: store });
  expect(refresh.mock.calls[0][0].cookie).toMatchObject({ KUGOU_API_PLATFORM: 'lite', dfid: 'device', token: 'old' });
  expect(store.list()[0].cookie).toContain('KUGOU_API_PLATFORM=lite');
  expect(store.list()[0].cookie).toContain('token=refreshed');
  expect(session.kugouState).toEqual({ userId: '1', likedPlaylistId: '42' });
  expect(store.list()[0]).not.toHaveProperty('kugouState');
});
