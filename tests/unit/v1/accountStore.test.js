const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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
})
