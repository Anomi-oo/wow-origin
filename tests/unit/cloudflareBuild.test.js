const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

describe('Cloudflare-only build pipeline', () => {
  test('将构建时洛雪源生成为静态模块并自动记录摘要', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-cf-lx-'))
    const outputPath = path.join(outputDirectory, 'lx-source.ts')
    const moduleUrl = pathToFileURL(path.join(process.cwd(), 'cloudflare', 'scripts', 'prepare-lx.mjs')).href
    const source = `/**\n * @name 构建测试源\n * @version 1.0.0\n */\n` +
      `globalThis.lx.on(globalThis.lx.EVENT_NAMES.request, async () => 'https://audio.test/a.mp3')\n` +
      `globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, { sources: { tx: { type: 'music', actions: ['musicUrl'], qualitys: ['320k'] } } })\n`
    const runner = `
      import { prepareLxSource } from ${JSON.stringify(moduleUrl)};
      const source = process.env.TEST_LX_SOURCE;
      const result = await prepareLxSource({
        sourceUrl: 'https://source.test/lx.js',
        outputPath: process.env.TEST_LX_OUTPUT,
        fetchImpl: async () => new Response(source, { status: 200 })
      });
      process.stdout.write(JSON.stringify(result));
    `
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', runner], {
      encoding: 'utf8',
      env: { ...process.env, TEST_LX_SOURCE: source, TEST_LX_OUTPUT: outputPath }
    }))
    const generated = fs.readFileSync(outputPath, 'utf8')

    expect(result.enabled).toBe(true)
    expect(result.name).toBe('构建测试源')
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(generated).toContain('export function installBundledLxSource')
    expect(generated).toContain('构建测试源')
    expect(generated).toContain(result.digest)
    expect(generated).not.toContain('eval(')
    expect(generated).not.toContain('new Function')
  })

  test('普通构建配置和 Docker/桌面运行时不包含 CF 生成目录', () => {
    const tsconfig = fs.readFileSync(path.join(process.cwd(), 'tsconfig.build.json'), 'utf8')
    const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8')
    const desktopPrepare = fs.readFileSync(path.join(process.cwd(), 'scripts', 'prepare-desktop.mjs'), 'utf8')
    const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')

    expect(tsconfig).not.toContain('cloudflare')
    expect(dockerfile).not.toContain('cloudflare')
    expect(desktopPrepare).not.toContain("'cloudflare'")
    expect(gitignore).toContain('cloudflare/generated/')
  })

  test('使用免费套餐可用的 Worker 与 Durable Object SQLite 配置', () => {
    const wrangler = fs.readFileSync(path.join(process.cwd(), 'wrangler.jsonc'), 'utf8')
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
    const cloudflareEnv = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8')
    const dockerEnv = fs.readFileSync(path.join(process.cwd(), 'docker.env.example'), 'utf8')
    const cloudflareVariables = cloudflareEnv.split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))

    expect(wrangler).toContain('"new_sqlite_classes"')
    expect(wrangler).toContain('"nodejs_compat"')
    expect(wrangler).toContain('"crons": ["0 17 * * *"]')
    expect(wrangler).not.toContain('"containers"')
    expect(packageJson.scripts.deploy).toBe('npm run cloudflare:deploy')
    expect(readme).toContain('https://deploy.workers.cloudflare.com/button')
    expect(readme.indexOf('### Cloudflare Workers')).toBeLessThan(readme.indexOf('### Docker'))
    expect(readme.indexOf('### Docker')).toBeLessThan(readme.indexOf('### 桌面版'))
    expect(readme).not.toContain('CF_LX_SOURCE_SHA256')
    expect(cloudflareVariables).toEqual(['CF_LX_SOURCE_URL='])
    expect(dockerEnv).toContain('PORT=3000')
    expect(dockerEnv).not.toContain('CF_LX_SOURCE_URL')
  })

  test('每个 Durable Object 使用独立的空闲内部端口', () => {
    const worker = fs.readFileSync(path.join(process.cwd(), 'cloudflare', 'worker.ts'), 'utf8')

    expect(worker).not.toContain('NODE_SERVER_PORT')
    expect(worker).toContain("server.listen(0, '127.0.0.1'")
    expect(worker).toContain('handleAsNodeRequest(port, request, this.env)')
    expect(worker).toContain('loginRefreshScheduler?.runNow()')
    expect(worker).toContain("getByName('primary').refreshLogins()")
  })
})
