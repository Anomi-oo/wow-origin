const request = require('supertest')

jest.mock('../../dist/onload', () => ({
  preloadData: jest.fn().mockResolvedValue(undefined)
}))

const { MultiPlatformServer } = require('../../dist/app')
const originalNodeEnv = process.env.NODE_ENV

async function createApp(nodeEnv = 'development') {
  process.env.NODE_ENV = nodeEnv
  const server = new MultiPlatformServer()
  return server.initialize()
}

describe('OpenAPI documentation', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  test('GET /openapi.json returns the v1 contract and shared schemas', async () => {
    const response = await request(await createApp())
      .get('/openapi.json')
      .expect(200)

    expect(response.body.openapi).toBe('3.1.0')
    expect(response.body.paths).toHaveProperty('/v1/status')
    expect(response.body.paths).toHaveProperty('/v1/playlist/list')
    expect(response.body.paths).toHaveProperty('/v1/playlist/detail')
    expect(response.body.paths).toHaveProperty('/v1/playlist/recommended')
    expect(response.body.paths).toHaveProperty('/v1/playlist/create')
    expect(response.body.paths).toHaveProperty('/v1/playlist/update')
    expect(response.body.paths).toHaveProperty('/v1/playlist/delete')
    expect(response.body.paths).toHaveProperty('/v1/playlist/addTrack')
    expect(response.body.paths).toHaveProperty('/v1/playlist/removeTrack')
    expect(response.body.paths).toHaveProperty('/v1/playlist/favorite')
    expect(response.body.paths).toHaveProperty('/v1/toplist/list')
    expect(response.body.paths).toHaveProperty('/v1/toplist/detail')
    expect(response.body.paths).toHaveProperty('/v1/track')
    expect(response.body.paths).toHaveProperty('/v1/track/daily')
    expect(response.body.paths).toHaveProperty('/v1/track/fm')
    expect(response.body.paths).not.toHaveProperty('/v1/track/personal-fm')
    expect(response.body.paths).toHaveProperty('/v1/track/url')
    expect(response.body.paths).toHaveProperty('/v1/track/lyric')
    expect(response.body.paths).toHaveProperty('/v1/artist/detail')
    expect(response.body.paths).toHaveProperty('/v1/album/detail')
    expect(response.body.paths).toHaveProperty('/v1/search/tracks')
    expect(response.body.paths).not.toHaveProperty('/v1/metadata/match')
    expect(response.body.paths).not.toHaveProperty('/v1/source/status')
    expect(response.body.paths).not.toHaveProperty('/v1/playlists')
    expect(response.body.paths).not.toHaveProperty('/v1/song')
    expect(response.body.paths).not.toHaveProperty('/v1/recommended_playlist')
    expect(response.body.paths).not.toHaveProperty('/v1/artist')
    expect(response.body.paths).not.toHaveProperty('/v1/artist/{id}/tracks')
    expect(response.body.paths).not.toHaveProperty('/v1/artist/{id}/albums')
    expect(response.body.paths).not.toHaveProperty('/v1/album')
    expect(response.body.components.schemas).toHaveProperty('ApiResponse')
    expect(response.body.components.schemas).toHaveProperty('ErrorResponse')
    expect(response.body.components.schemas).toHaveProperty('Track')
    expect(response.body.components.schemas).toHaveProperty('Album')
    expect(response.body.components.schemas).toHaveProperty('Artist')
    expect(response.body.components.schemas).toHaveProperty('Playlist')
    expect(response.body.paths['/v1/playlist/create'].post.requestBody).toBeDefined()
    expect(response.body.paths['/v1/playlist/addTrack'].post.requestBody).toBeDefined()
    expect(response.body.paths['/v1/track/favorite'].post.requestBody).toBeDefined()
    expect(response.body.components.schemas).toHaveProperty('MutationStatus')
    expect(response.body.components.schemas).toHaveProperty('MutationSuccess')
    expect(response.body.components.schemas).toHaveProperty('TrackUrl')
    expect(response.body.components.schemas).toHaveProperty('TrackLyrics')
    expect(response.body.components.schemas).toHaveProperty('ToplistTrackSummary')
    expect(response.body.components.schemas).not.toHaveProperty('ToplistTrackPreview')
    expect(response.body.components.schemas).not.toHaveProperty('MetadataMatchRequest')
    expect(response.body.components.schemas.ToplistTrackSummary.required).toEqual(['name', 'artistName'])
    expect(response.body.components.schemas.TrackLyrics.required).toEqual([
      'lyric',
      'wordLyric',
      'translateLyric',
      'translateWordLyric'
    ])
    expect(response.body.paths['/v1/track/url'].get.responses['200'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/TrackUrl')
    expect(response.body.paths['/v1/track/lyric'].get.responses['200'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/TrackLyrics')
    expect(response.body.paths['/v1/track/favorite'].post.parameters).toEqual([])
    expect(response.body.paths['/v1/track/favorite'].post.requestBody.content['application/json'].schema.properties.status.type).toBe('boolean')
    expect(response.body.paths['/v1/playlist/favorite'].post.requestBody.content['application/json'].schema.properties.status.type).toBe('boolean')
  })

  test('request and response descriptions come from the SDK contract', async () => {
    const response = await request(await createApp())
      .get('/openapi.json')
      .expect(200)

    expect(response.body.components.schemas.TrackUrl.description).toBeTruthy()
    expect(response.body.components.schemas.TrackUrl.properties.bitrate.description).toContain('bps')
    expect(response.body.components.schemas.ToplistTrackSummary.properties.artistName.description).toBeTruthy()
    expect(response.body.paths['/v1/track/url'].get.description).toBeTruthy()
    expect(response.body.paths['/v1/track/url'].get.parameters)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'quality', description: expect.any(String) })]))
    expect(response.body.paths['/v1/track/favorite'].post.requestBody.description).toBeTruthy()
    expect(response.body.paths['/v1/track/url'].get.responses['200'].description).toContain('TrackUrl')
  })

  test('platform is resolved by account config and not exposed as X-Platform header', async () => {
    const response = await request(await createApp())
      .get('/openapi.json')
      .expect(200)

    expect(response.body.components.parameters?.PlatformHeader).toBeUndefined()
    expect(JSON.stringify(response.body.paths)).not.toContain('X-Platform')
  })

  test('common error responses use reusable components', async () => {
    const response = await request(await createApp())
      .get('/openapi.json')
      .expect(200)

    expect(Object.keys(response.body.paths['/v1/status'].get.responses)).toEqual(['200', '400', '401', '500', '501'])
    expect(response.body.components.schemas).toHaveProperty('ErrorResponse')
    expect(response.body.components.responses).toHaveProperty('Unauthorized')
  })

  test('project does not expose a custom /status route', async () => {
    await request(await createApp())
      .get('/status')
      .expect(404)
  })

  test('documentation routes are not exposed in production', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const app = await createApp('production')

    try {
      await request(app)
        .get('/openapi.json')
        .expect(404)

    } finally {
      consoleError.mockRestore()
    }
  })
})
