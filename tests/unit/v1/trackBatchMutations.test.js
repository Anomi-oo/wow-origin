const express = require('express');
const request = require('supertest');
const { createWowRouter } = require('aduoer-wow-sdk');
const { NeteaseClient } = require('../../../dist/clients/NeteaseClient');
const { QQClient } = require('../../../dist/clients/QQClient');
const { YTMusicClient } = require('../../../dist/clients/YTMusicClient');

function app(adapter) {
  const value = express();
  value.use(express.json());
  value.use(createWowRouter({ resolveContext: () => ({ adapter, stateless: false }), validateResponses: true }));
  return value;
}

function platform(callModule) {
  global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule }) };
}

describe('batch track mutations', () => {
  afterEach(() => { delete global.__musicPlatformFactory__; });

  test('Netease adds multiple songs in one upstream request', async () => {
    const call = jest.fn(async () => ({ code: 200, body: { code: 200 } }));
    platform(call);
    const result = await request(app(new NeteaseClient('MUSIC_U=key'))).post('/v1/playlist/addTrack')
      .send({ playlistId: 'list', trackIds: 'one,two,three' }).expect(200);
    expect(result.body.data).toEqual([]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('playlist/tracks', expect.objectContaining({
      query: expect.objectContaining({ pid: 'list', tracks: 'one,two,three', op: 'add' })
    }));
  });

  test('Netease favorite uses isolated single writes only because upstream has no batch API', async () => {
    const visited = [];
    platform(jest.fn(async (_route, { query }) => {
      visited.push(query.id);
      if (query.id === 'bad') throw new Error('song failed');
      return { code: 200, body: { code: 200 } };
    }));
    const result = await request(app(new NeteaseClient('MUSIC_U=key'))).post('/v1/track/favorite')
      .send({ ids: 'first,bad,last', status: true }).expect(200);
    expect(result.body.data).toEqual([{ id: 'bad' }]);
    expect(visited).toEqual(['first', 'bad', 'last']);
  });

  test.each(['favorite', 'playlist'])('QQ %s submits valid songs once and returns only unresolved IDs', async (operation) => {
    const writes = [];
    platform(jest.fn(async (route, { query }) => {
      if (route === 'song/detail') {
        if (query.mid === 'bad') throw new Error('missing');
        return { code: 200, songs: [{ id: query.mid === 'first' ? 11 : 22 }] };
      }
      writes.push([route, query]);
      return { code: 200, body: { success: true } };
    }));
    const client = new QQClient('uin=o123; qm_keyst=key');
    const endpoint = operation === 'favorite' ? '/v1/track/favorite' : '/v1/playlist/addTrack';
    const body = operation === 'favorite' ? { ids: 'first,bad,last', status: true } : { playlistId: 'list', trackIds: 'first,bad,last' };
    const response = await request(app(client)).post(endpoint).send(body).expect(200);
    expect(response.body.data).toEqual([{ id: 'bad' }]);
    expect(writes).toHaveLength(1);
    expect(writes[0][1][operation === 'favorite' ? 'ids' : 'tracks']).toBe('11,22');
  });

  test('YouTube Music adds all actions in one request', async () => {
    const client = new YTMusicClient('SAPISID=key');
    client.api.request = jest.fn(async () => ({ status: 'STATUS_SUCCEEDED' }));
    const response = await request(app(client)).post('/v1/playlist/addTrack')
      .send({ playlistId: 'PLlist', trackIds: 'one,two' }).expect(200);
    expect(response.body.data).toEqual([]);
    expect(client.api.request).toHaveBeenCalledTimes(1);
    expect(client.api.request).toHaveBeenCalledWith('browse/edit_playlist', {
      playlistId: 'PLlist', actions: [
        { action: 'ACTION_ADD_VIDEO', addedVideoId: 'one' }, { action: 'ACTION_ADD_VIDEO', addedVideoId: 'two' }
      ]
    });
  });

  test('native batch request errors keep a non-200 response and are not retried', async () => {
    const call = jest.fn(async () => { throw new Error('offline'); });
    platform(call);
    await request(app(new NeteaseClient('MUSIC_U=key'))).post('/v1/playlist/addTrack')
      .send({ playlistId: 'list', trackIds: 'one,two' }).expect(500);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
