const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')

describe('universal rewrite build', () => {
  const outputDirectory = path.join(process.cwd(), 'rewrite', 'dist')
  const bundlePath = path.join(outputDirectory, 'wow-origin.rewrite.js')
  const releaseBase = 'https://github.com/Anomi-oo/wow-origin/releases/latest/download'
  const scriptUrl = `${releaseBase}/wow-origin.rewrite.js`
  const uiUrl = 'https://raw.githubusercontent.com/Anomi-oo/wow-origin/main/rewrite/ui/index.html'

  beforeAll(() => {
    execFileSync(process.execPath, ['rewrite/scripts/build.mjs'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    })
  })

  function baseGlobals() {
    return {
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      ArrayBuffer,
      Uint8Array,
      DataView,
      Map,
      Set,
      Promise,
      Date,
      Math,
      JSON,
      RegExp,
      Error,
      TypeError,
      console: { log() {}, error() {}, warn() {} },
      setTimeout,
      clearTimeout
    }
  }

  function request(method, url, body, headers = {}) {
    const parsed = new URL(url)
    return {
      url,
      path: parsed.pathname,
      method,
      headers: {
        Host: parsed.host,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    }
  }

  function loadStrictCommonJS(filePath, requireModule = require) {
    const module = { exports: {} }
    const context = vm.createContext({ module, exports: module.exports, require: requireModule })
    const source = fs.readFileSync(filePath, 'utf8')
    vm.runInContext(`(function (require, module, exports) { 'use strict';\n${source}\n})(require, module, exports)`, context)
    return module.exports
  }

  test('QQ 歌单详情在 QuanX 严格模式下不写入未声明全局变量', async () => {
    const playlistDetail = loadStrictCommonJS(
      path.join(process.cwd(), 'platforms', 'qqmusic', 'module', 'playlist_detail.js')
    )
    const requestQQ = jest.fn(async () => ({
      status: 200,
      body: {
        dirinfo: { id: 1234, title: 'Test', songnum: 0 },
        songlist: []
      }
    }))

    await expect(playlistDetail({ id: '1234', limit: 100 }, requestQQ)).resolves.toMatchObject({
      playlist: { id: 1234, name: 'Test', tracks: [] }
    })
  })

  test('QQ 每日推荐在 QuanX 严格模式下可继续读取推荐歌单', async () => {
    const playlistDetailPath = path.join(process.cwd(), 'platforms', 'qqmusic', 'module', 'playlist_detail.js')
    const playlistDetail = loadStrictCommonJS(playlistDetailPath)
    const recommendSongs = loadStrictCommonJS(
      path.join(process.cwd(), 'platforms', 'qqmusic', 'module', 'recommend_songs.js'),
      (moduleName) => {
        if (moduleName === './playlist_detail') return playlistDetail
        return require(moduleName)
      }
    )
    const requestQQ = jest.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { v_shelf: [{ v_niche: [{ v_card: [{ title: '每日30首', id: 1234 }] }] }] }
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          dirinfo: { id: 1234, title: '每日30首', songnum: 0 },
          songlist: []
        }
      })

    await expect(recommendSongs({ uin: '1', qm_keyst: 'key' }, requestQQ)).resolves.toEqual({
      data: { dailySongs: [] }
    })
  })

  test('构建核心 JS 和独立 HTML，并从 Raw 提供 QuanX/Loon 配置', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    const releaseWorkflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8')
    const rewriteWorkflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'rewrite.yml'), 'utf8')
    const bundle = fs.readFileSync(bundlePath, 'utf8')
    const quanx = fs.readFileSync(path.join(process.cwd(), 'rewrite', 'resources', 'wow-origin.quantumultx.snippet'), 'utf8')
    const loon = fs.readFileSync(path.join(process.cwd(), 'rewrite', 'resources', 'wow-origin.loon.plugin'), 'utf8')

    expect(packageJson.scripts['rewrite:build']).toBe('node rewrite/scripts/build.mjs')
    expect(packageJson.scripts['rewrite:typecheck']).toBe('npm run rewrite:build && tsc -p rewrite/tsconfig.json')
    expect(releaseWorkflow).not.toContain('npm run rewrite:typecheck')
    expect(releaseWorkflow).toContain('needs: [desktop, docker]')
    expect(releaseWorkflow).toContain('paths-ignore:')
    expect(rewriteWorkflow).toContain('workflow_dispatch:')
    expect(rewriteWorkflow).toContain('npm run rewrite:typecheck')
    expect(rewriteWorkflow).toContain('path: rewrite/dist/*')
    expect(rewriteWorkflow).toContain('gh release upload "$target_tag" rewrite/dist/*')
    expect(rewriteWorkflow).toContain('--clobber')
    expect(bundle.length).toBeGreaterThan(100_000)
    expect(bundle).not.toContain('node:sqlite')
    expect(bundle).not.toContain('node:http')
    expect(bundle).not.toContain('CF_LX_SOURCE_URL')
    expect(bundle).toContain('binary-mode')
    expect(bundle).toContain(uiUrl)
    const uiSource = fs.readFileSync(path.join(process.cwd(), 'rewrite', 'ui', 'index.html'), 'utf8')
    expect(uiSource).toContain('<style>')
    expect(uiSource).toContain('<script>')
    expect(uiSource).not.toContain('href="./styles.css"')
    expect(uiSource).not.toContain('src="./app.js"')
    expect(fs.existsSync(path.join(outputDirectory, 'wow-origin.rewrite.html'))).toBe(true)
    expect(fs.existsSync(path.join(outputDirectory, 'wow-origin.install.json'))).toBe(false)
    expect(fs.existsSync(path.join(outputDirectory, 'wow-origin.quantumultx.snippet'))).toBe(false)
    expect(fs.existsSync(path.join(outputDirectory, 'wow-origin.loon.plugin'))).toBe(false)
    expect(fs.existsSync(path.join(outputDirectory, 'wow-origin.boxjs.json'))).toBe(false)
    expect(fs.existsSync(path.join(outputDirectory, 'wow-origin.cookie.js'))).toBe(false)

    expect(quanx).not.toContain('[http_backend]')
    expect(quanx).toContain('^https?:\\/\\/pinhaoge\\.xyz(?::\\d+)?')
    expect(quanx).toContain(scriptUrl)
    expect(quanx).toContain('script-analyze-echo-response')
    const quanxServicePattern = quanx.split('\n').find((line) => line.includes('script-analyze-echo-response')).split(' url ')[0]
    expect(new RegExp(quanxServicePattern).test('https://pinhaoge.xyz:443/v1/status')).toBe(true)
    expect(new RegExp(quanxServicePattern).test('http://pinhaoge.xyz:80/v1/status')).toBe(true)
    expect(new RegExp(quanxServicePattern).test('https://pinhaoge.xyz/v1/status')).toBe(true)
    expect(quanx).toContain('script-request-header')
    expect(quanx).toContain('script-request-body')
    expect(loon).toContain('[Script]')
    expect(loon).toContain('#!desc=Aduoer Wow Origin For Serverless')
    expect(loon).toContain(`script-path=${scriptUrl}`)
    expect(loon).toContain('http-request ^https?:\\/\\/pinhaoge\\.xyz(?::\\d+)?')
    expect(loon).toContain('tag=Wow Origin API,requires-body=true')
    expect(loon).toContain('[MITM]')
    expect(loon).not.toContain('%APPEND%')
  })

  test('同一脚本在 QuanX 中捕获 Cookie 并提供页面与 Wow API', async () => {
    const source = fs.readFileSync(bundlePath, 'utf8')
    const preferences = new Map()
    const notifications = []
    const context = vm.createContext({
      ...baseGlobals(),
      $prefs: {
        valueForKey: (key) => preferences.get(key) ?? null,
        setValueForKey: (value, key) => { preferences.set(key, value); return true },
        removeValueForKey: (key) => preferences.delete(key)
      },
      $task: {
        fetch: async ({ url }) => {
          if (url === uiUrl) {
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              body: '<!doctype html><title>Remote UI</title><h1>远程账号页面</h1>'
            }
          }
          throw new Error(`unexpected fetch: ${url}`)
        }
      },
      $notify: (...args) => notifications.push(args)
    })

    async function invoke(httpRequest) {
      return new Promise((resolve, reject) => {
        context.$request = httpRequest
        context.$done = resolve
        try { vm.runInContext(source, context) } catch (error) { reject(error) }
      })
    }

    await invoke(request('GET', 'https://c.y.qq.com/base/fcgi-bin/fcg_check', undefined, {
      cOoKiE: 'uin=12345; qm_keyst=secret'
    }))
    expect(preferences.get('wow-origin.cookie.qq.v1')).toBe('uin=12345; qm_keyst=secret')
    expect(notifications[0][1]).toBe('QQ 音乐 Cookie 获取成功')

    await invoke(request('POST', 'https://music.163.com/weapi/user/level', undefined, {
      Cookie: 'MUSIC_U=netease-secret; __csrf=token'
    }))
    expect(preferences.get('wow-origin.cookie.netease.v1')).toBe('MUSIC_U=netease-secret; __csrf=token')

    const home = await invoke(request('GET', 'https://pinhaoge.xyz/'))
    expect(home.status).toBe('HTTP/1.1 200 OK')
    expect(home.body).toContain('远程账号页面')

    const latest = await invoke(request('GET', 'https://pinhaoge.xyz/login/api/captured-cookie'))
    expect(JSON.parse(latest.body).data).toEqual({
      platform: 'netease',
      cookie: 'MUSIC_U=netease-secret; __csrf=token',
      capturedAt: expect.any(Number)
    })

    const imported = await invoke(request('POST', 'https://pinhaoge.xyz/login/api/account/import', {
      platform: 'qq',
      name: 'QuanX Test',
      api_access_key: 'quanx-test-key',
      cookie: '',
      stateless: true,
      use_captured_cookie: true
    }))
    expect(JSON.parse(imported.body).data.apiAccessKey).toBe('quanx-test-key')
    expect(JSON.parse(preferences.get('wow-origin.rewrite.accounts.v1'))[0].cookie).toBe('uin=12345; qm_keyst=secret')

    const status = await invoke(request('GET', 'https://pinhaoge.xyz/v1/status', undefined, {
      Authorization: 'Bearer quanx-test-key'
    }))
    expect(status.status).toBe('HTTP/1.1 200 OK')
    expect(JSON.parse(status.body).data.capabilities).toContain('search')
  })

  test('同一脚本在 Loon persistentStore 环境返回 response 对象', async () => {
    const source = fs.readFileSync(bundlePath, 'utf8')
    const values = new Map()
    const notifications = []
    const context = vm.createContext({
      ...baseGlobals(),
      $persistentStore: {
        read: (key) => values.get(key) ?? null,
        write: (value, key) => { values.set(key, value); return true }
      },
      $notification: { post: (...args) => notifications.push(args) },
      $httpClient: {
        get: (options, callback) => callback(
          null,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
          options.url === uiUrl ? '<h1>Loon Remote UI</h1>' : '{}'
        ),
        post: (_options, callback) => callback(null, { status: 200, headers: {} }, '{}')
      }
    })

    async function invoke(httpRequest) {
      return new Promise((resolve, reject) => {
        context.$request = httpRequest
        context.$done = resolve
        try { vm.runInContext(source, context) } catch (error) { reject(error) }
      })
    }

    await invoke(request('GET', 'https://c.y.qq.com/base/fcgi-bin/fcg_check', undefined, {
      Cookie: 'uin=loon; qm_keyst=loon-secret'
    }))
    expect(values.get('wow-origin.cookie.qq.v1')).toBe('uin=loon; qm_keyst=loon-secret')
    expect(notifications[0][1]).toBe('QQ 音乐 Cookie 获取成功')

    const home = await invoke(request('GET', 'http://pinhaoge.xyz/'))
    expect(home.response.status).toBe(200)
    expect(home.response.body).toContain('Loon Remote UI')

    const imported = await invoke(request('POST', 'http://pinhaoge.xyz/login/api/account/import', {
      platform: 'qq',
      name: 'Loon Test',
      api_access_key: 'loon-test-key',
      cookie: '',
      stateless: true,
      use_captured_cookie: true
    }))
    expect(imported.response.status).toBe(200)
    expect(JSON.parse(imported.response.body).data.apiAccessKey).toBe('loon-test-key')

    const status = await invoke(request('GET', 'http://pinhaoge.xyz/v1/status', undefined, {
      Authorization: 'Bearer loon-test-key'
    }))
    expect(status.response.status).toBe(200)
    expect(JSON.parse(status.response.body).data.type).toBe('wow')
  })
})
