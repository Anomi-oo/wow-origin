const { QQClient } = require('../../../dist/clients/QQClient');
const { NeteaseClient } = require('../../../dist/clients/NeteaseClient');
const { KugouClient } = require('../../../dist/clients/KugouClient');

const cases = [
  ['QQ', QQClient, 'uin=o123; qm_keyst=key',
    { id: 42, dirId: '201', name: '改过名的红心列表', creator: { userId: 123 }, subscribed: false },
    { id: 43, dirId: 301, name: '我喜欢', creator: { userId: 123 }, subscribed: false },
    { id: 44, dirId: 201, name: '我喜欢', creator: { userId: 456 }, subscribed: true }],
  ['网易', NeteaseClient, 'MUSIC_U=test',
    { id: 42, specialType: 5, name: '改过名的红心列表', creator: { userId: 123 }, subscribed: false },
    { id: 43, specialType: 0, name: '我喜欢的音乐', creator: { userId: 123 }, subscribed: false },
    { id: 44, specialType: 5, name: '其他人喜欢的音乐', creator: { userId: 456 }, subscribed: true }]
];
afterEach(() => { delete global.__musicPlatformFactory__; });

test.each(cases)('%s hides only the own system liked list and still reads its tracks', async (_name, Client, cookie, liked, sameName, foreign) => {
  const callModule = jest.fn(async (route, { query }) => {
    if (route === 'user/playlist') return { code: 200, playlist: [sameName, foreign, liked], more: false };
    if (route === 'playlist/detail') {
      expect(query.id).toBe('42');
      return { code: 200, playlist: { ...liked, tracks: [{ id: 1, mid: 'track-mid', name: '歌曲', ar: [], al: {} }] } };
    }
    throw new Error(`Unexpected route: ${route}`);
  });
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  const ids = new Set();
  const c = new Client(cookie, ids);
  expect((await c.getUserPlaylist()).map(item => item.id)).toEqual(['43', '44']);
  expect(callModule).toHaveBeenCalledTimes(1);
  const tracks = await c.userFavoriteTracks();
  expect(tracks).toHaveLength(1);
  expect(tracks[0].favorite).toBe(true);
  expect(ids.has(tracks[0].id)).toBe(true);
  expect(callModule.mock.calls.map(([route]) => route)).toEqual(['user/playlist', 'user/playlist', 'playlist/detail']);
});

test.each(cases)('%s preserves same-name ordinary playlists when the system list is absent', async (_name, Client, cookie, _liked, sameName, foreign) => {
  const callModule = jest.fn(async () => ({ code: 200, playlist: [sameName, foreign], more: false }));
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  const c = new Client(cookie);
  expect((await c.getUserPlaylist()).map(item => item.id)).toEqual(['43', '44']);
  expect(await c.userFavoriteTracks()).toEqual([]);
  expect(callModule.mock.calls.every(([route]) => route === 'user/playlist')).toBe(true);
});

test('NetEase keeps paginating after a page containing only the hidden system list', async () => {
  const callModule = jest.fn(async (_route, { query }) => ({ code: 200, more: query.offset === 0, playlist: query.offset === 0 ? [cases[1][3]] : [cases[1][4]] }));
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  expect((await new NeteaseClient('MUSIC_U=test').getUserPlaylist()).map(item => item.id)).toEqual(['43']);
  expect(callModule.mock.calls.map(([, { query }]) => query.offset)).toEqual([0, 1000]);
});

test.each([false, true])('Kugou preserves default collection and ordinary same-name playlists; renamed=%s', async renamed => {
  const liked = { listid: 42, is_def: 2, name: renamed ? '红心列表' : '我喜欢', list_create_userid: '1' };
  const sameName = { listid: 43, is_def: 0, name: '我喜欢', list_create_userid: '1' };
  const defaultList = { listid: 41, is_def: 1, name: '默认收藏', list_create_userid: '1' };
  const foreign = { ...liked, listid: 44, list_create_userid: '2' };
  const context = { saveKugouState: jest.fn(async () => {}) };
  const callModule = jest.fn(async (route, { query }) => {
    if (route === 'user/playlist') return { code: 200, body: [defaultList, sameName, foreign, liked] };
    if (route === 'playlist/track/all/new') {
      expect(query.listid).toBe('42');
      return { code: 200, body: [{ hash: 'a'.repeat(32), name: '歌曲', fileid: 9 }] };
    }
    throw new Error(`Unexpected route: ${route}`);
  });
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  const c = new KugouClient('userid=1', undefined, undefined, undefined, undefined, context);
  expect((await c.getUserPlaylist()).map(item => item.id)).toEqual(['user:41', 'user:43', 'user:44']);
  expect(callModule).toHaveBeenCalledTimes(1);
  expect(context.kugouState.likedPlaylistId).toBe('42');
  expect((await c.userFavoriteTracks())[0].favorite).toBe(true);
  expect(callModule.mock.calls.map(([route]) => route)).toEqual(['user/playlist', 'playlist/track/all/new']);
});

test('Kugou retains default collection when it is the only fallback for favorite tracks', async () => {
  const callModule = jest.fn(async () => ({ code: 200, body: [{ listid: 41, is_def: 1, name: '默认收藏', list_create_userid: '1' }] }));
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  expect((await new KugouClient('userid=1').getUserPlaylist()).map(item => item.id)).toEqual(['user:41']);
});

test('Kugou never hides an unmarked user-created same-name list', async () => {
  const callModule = jest.fn(async () => ({ code: 200, body: [{ listid: 43, is_def: 0, name: '我喜欢', list_create_userid: '1' }] }));
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
  expect((await new KugouClient('userid=1').getUserPlaylist()).map(item => item.id)).toEqual(['user:43']);
});

test('YouTube Music keeps hiding LM while favorite tracks still use VLLM', async () => {
  const { YTMusicClient } = require('../../../dist/clients/YTMusicClient');
  const c = new YTMusicClient('SAPISID=test');
  const browse = jest.spyOn(c.api, 'browse').mockImplementation(async id => {
    if (id === 'FEmusic_liked_playlists') return { items: ['VLLM', 'VLPLmine'].map(browseId => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: '我喜欢' }] }, navigationEndpoint: { browseEndpoint: { browseId } } } })) };
    if (id === 'VLLM') return { items: [{ musicResponsiveListItemRenderer: { playlistItemData: { videoId: 'aaaaaaaaaaa' }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: '歌曲' }] } } }] } }] };
    throw new Error(`Unexpected browse: ${id}`);
  });
  const detail = jest.spyOn(c, 'getPlaylistDetail').mockResolvedValue({ id: 'PLmine', creator: { id: 'me', name: '用户' }, tracks: [] });
  expect((await c.getUserPlaylist()).map(item => item.id)).toEqual(['PLmine']);
  expect(detail).toHaveBeenCalledTimes(1);
  expect(detail).toHaveBeenCalledWith('PLmine', 0);
  expect((await c.userFavoriteTracks())[0]).toMatchObject({ id: 'aaaaaaaaaaa', favorite: true });
  expect(browse.mock.calls.map(([id]) => id)).toEqual(['FEmusic_liked_playlists', 'VLLM']);
});
