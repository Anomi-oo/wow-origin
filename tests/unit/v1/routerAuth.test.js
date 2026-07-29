const express = require('express')
const request = require('supertest')
const { createWowRouter } = require('aduoer-wow-sdk')
const { createWowContextResolver } = require('../../../dist/adapter')

function createApp() {
  const app = express()
  const registry = {
    sessions: [],
    byAccessKey: new Map([
      ['key-1', {
        platform: 'qq',
        name: 'QQ',
        cookie: 'uin=o123; qm_keyst=abc',
        apiAccessKey: 'key-1',
        favoriteTrackIds: new Set()
      }]
    ])
  }
  app.use(createWowRouter({ resolveContext: createWowContextResolver(registry) }))
  return app
}

describe('v1 router auth', () => {
  test('/v1/status 缺少 Authorization 返回 401', async () => {
    const response = await request(createApp())
      .get('/v1/status')
      .expect(401)

    expect(response.body).toMatchObject({ code: 401, data: null })
    expect(response.body.message).toContain('Authorization token')
  })

  test('/v1/status 支持 Bearer token', async () => {
    const response = await request(createApp())
      .get('/v1/status')
      .set('Authorization', 'Bearer key-1')
      .expect(200)

    expect(response.body).toMatchObject({
      code: 200,
      data: {
        type: 'wow',
        version: require('aduoer-wow-sdk').sdkVersion
      }
    })
  })
})
