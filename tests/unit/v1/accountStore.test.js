const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const {
  createLocalAccountStore,
  sqliteAccountsFilePath
} = require('../../../dist/storage/accounts')

function makeWorkDir() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-account-store-'))
  fs.mkdirSync(path.join(workDir, 'data'), { recursive: true })
  return workDir
}

describe('SQLite account store', () => {
  test('账号数据库使用简洁的 data.db 文件名', () => {
    const workDir = makeWorkDir()

    expect(sqliteAccountsFilePath(workDir)).toBe(path.join(workDir, 'data', 'data.db'))
  })

  test('自动接管旧版 wow-origin.sqlite 数据库文件', () => {
    const workDir = makeWorkDir()
    const legacyPath = path.join(workDir, 'data', 'wow-origin.sqlite')
    fs.writeFileSync(legacyPath, '')

    const store = createLocalAccountStore(workDir)

    expect(store.location).toBe(path.join(workDir, 'data', 'data.db'))
    expect(fs.existsSync(store.location)).toBe(true)
    expect(fs.existsSync(legacyPath)).toBe(false)
  })

  test('首次启动将 accounts.json 迁移到 SQLite，后续以数据库为准', () => {
    const workDir = makeWorkDir()
    const legacyPath = path.join(workDir, 'data', 'accounts.json')
    fs.writeFileSync(legacyPath, JSON.stringify([
      {
        platform: 'qq',
        name: '旧账号',
        cookie: 'uin=1',
        api_access_key: 'legacy-key',
        stateless: false,
        useLuoxue: true,
        lxSource: ['https://example.com/source.js']
      }
    ]))

    const store = createLocalAccountStore(workDir)

    expect(fs.existsSync(sqliteAccountsFilePath(workDir))).toBe(true)
    expect(store.list()).toEqual([
      expect.objectContaining({
        platform: 'qq',
        name: '旧账号',
        api_access_key: 'legacy-key',
        stateless: false,
        useLuoxue: true,
        lxSource: ['https://example.com/source.js']
      })
    ])

    fs.writeFileSync(legacyPath, '[]')
    expect(createLocalAccountStore(workDir).list()).toHaveLength(1)
  })

  test('插入和更新账号后可由新的 store 实例读取', () => {
    const workDir = makeWorkDir()
    const store = createLocalAccountStore(workDir)
    store.insert({
      platform: 'netease',
      name: '网易云',
      cookie: 'MUSIC_U=old',
      api_access_key: 'key-1',
      stateless: false,
      useLuoxue: true,
      lxSource: []
    })
    store.update('key-1', {
      cookie: 'MUSIC_U=new',
      useLuoxue: false,
      lxSource: ['https://example.com/new.js']
    })

    expect(createLocalAccountStore(workDir).list()).toEqual([
      expect.objectContaining({
        api_access_key: 'key-1',
        cookie: 'MUSIC_U=new',
        useLuoxue: false,
        lxSource: ['https://example.com/new.js']
      })
    ])
  })

  test('旧数据库升级后持久化 deviceId 和设备状态', () => {
    const workDir = makeWorkDir()
    const database = new DatabaseSync(sqliteAccountsFilePath(workDir))
    database.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, platform TEXT, name TEXT, cookie TEXT, api_access_key TEXT, stateless TEXT, use_luoxue TEXT, lx_source TEXT, updated_at TEXT)')
    database.exec("INSERT INTO accounts (platform, api_access_key) VALUES ('\"qq\"', 'qq-key')")
    database.close()

    const store = createLocalAccountStore(workDir)
    store.update('qq-key', { deviceId: 'android-id', deviceState: 'encoded-device-state' })
    store.close()
    const reopened = createLocalAccountStore(workDir)
    expect(reopened.list()[0]).toMatchObject({ deviceId: 'android-id', deviceState: 'encoded-device-state' })
    reopened.close()
  })
})

test('startup removes legacy JSON and deleted final account never returns', () => {
  const workDir = makeWorkDir()
  const legacy = path.join(workDir, 'data', 'accounts.json')
  const content = JSON.stringify([{ platform: 'netease', api_access_key: 'old-key' }])
  fs.writeFileSync(legacy, content)
  const store = createLocalAccountStore(workDir)
  expect(fs.existsSync(legacy)).toBe(false)
  store.delete('old-key')
  store.close()
  // Even a restored stale legacy file cannot resurrect an account.
  fs.writeFileSync(legacy, content)
  const reopened = createLocalAccountStore(workDir)
  expect(reopened.list()).toEqual([])
  expect(fs.existsSync(legacy)).toBe(false)
  reopened.close()
})

test('failed legacy JSON migration retains original file', () => {
  const workDir = makeWorkDir()
  const legacy = path.join(workDir, 'data', 'accounts.json')
  fs.writeFileSync(legacy, '{broken')
  expect(() => createLocalAccountStore(workDir)).toThrow('迁移失败')
  expect(fs.readFileSync(legacy, 'utf8')).toBe('{broken')
})
