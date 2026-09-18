const express = require('express')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const request = require('supertest')
const {
  createDashboardRouter,
  createOriginAddPayload,
  listLanIpv4Addresses
} = require('../../../dist/dashboard')

describe('desktop dashboard', () => {
  test('生成 Aduoer Base64URL 深链且保留空 token 和 name', () => {
    const host = 'http://192.168.1.8:23231'
    const result = createOriginAddPayload(host)
    const auth = new URL(result.addUrl).searchParams.get('auth')

    expect(result.payload).toBe(`type=wow&host=${host}&token=&name=`)
    expect(Buffer.from(auth, 'base64url').toString('utf8')).toBe(result.payload)
    expect(auth).not.toMatch(/[+/=]/)
  })

  test('局域网地址优先私网、排除回环和链路本地地址', () => {
    expect(listLanIpv4Addresses({
      vpn: [{ address: '100.64.0.2', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' }],
      wifi: [{ address: '192.168.1.8', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' }],
      loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', cidr: null, mac: '' }],
      link: [{ address: '169.254.1.2', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' }]
    })).toEqual(['192.168.1.8', '100.64.0.2'])
  })

  test('状态接口返回浏览器可访问地址与二维码', async () => {
    const app = express()
    app.use('/app/api', createDashboardRouter())
    const response = await request(app).get('/app/api/status').set('Host', 'music-box.local:3000').expect(200)

    expect(response.body.data.addresses[0]).toMatchObject({
      ip: 'music-box.local',
      host: 'http://music-box.local:3000',
      isLoopback: false
    })
    expect(response.body.data.port).toBe(3000)
    expect(response.body.data.addresses[0].qrImage).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  test('账号二维码包含当前 host、token 和名称', async () => {
    const app = express()
    app.use(express.json())
    app.use('/app/api', createDashboardRouter())
    const response = await request(app).post('/app/api/origin-qr').send({
      host: 'http://192.168.1.8:23231',
      token: 'account-key',
      name: '我的 QQ'
    }).expect(200)

    expect(response.body.data.payload).toBe('type=wow&host=http://192.168.1.8:23231&token=account-key&name=我的 QQ')
    const auth = new URL(response.body.data.addUrl).searchParams.get('auth')
    expect(Buffer.from(auth, 'base64url').toString('utf8')).toBe(response.body.data.payload)
    expect(response.body.data.qrImage).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  test('内嵌 Node 启动器可从含空格的 sidecar 目录加载服务入口', () => {
    const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow sidecar '))
    try {
      const executableDir = path.join(temporaryDir, 'Wow App')
      const runtimeDir = path.join(executableDir, 'server-runtime', 'dist')
      fs.mkdirSync(runtimeDir, { recursive: true })
      fs.writeFileSync(
        path.join(runtimeDir, 'server.js'),
        "module.exports.start = () => process.stdout.write('WOW_BOOTSTRAP_OK')"
      )
      const bootstrap = fs.readFileSync(
        path.join(process.cwd(), 'src-tauri', 'src', 'node-runtime-bootstrap.cjs'),
        'utf8'
      )
      const executablePath = path.join(executableDir, process.platform === 'win32' ? 'node.exe' : 'node')
      const result = spawnSync(
        process.execPath,
        ['--eval', `process.execPath = ${JSON.stringify(executablePath)};\n${bootstrap}`],
        { encoding: 'utf8' }
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe('WOW_BOOTSTRAP_OK')
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true })
    }
  })

  test('本地页面包含导航、地址选择、账号二维码和动态账号配置表单', () => {
    const publicDirectory = path.join(process.cwd(), 'public')
    const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8')
    const script = fs.readFileSync(path.join(publicDirectory, 'app.js'), 'utf8')
    const styles = fs.readFileSync(path.join(publicDirectory, 'styles.css'), 'utf8')
    const tauriSource = fs.readFileSync(path.join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8')
    const tauriMain = fs.readFileSync(path.join(process.cwd(), 'src-tauri', 'src', 'main.rs'), 'utf8')
    const nodeBootstrap = fs.readFileSync(path.join(process.cwd(), 'src-tauri', 'src', 'node-runtime-bootstrap.cjs'), 'utf8')

    expect(html).toContain('data-page="home"')
    expect(html).toContain('data-page="login"')
    expect(html).toMatch(/class="nav-item tauri-only" data-page="home"/)
    expect(html).toMatch(/id="home-page" class="page tauri-only"/)
    expect(html).toContain('id="address-select"')
    expect(html).toContain('id="account-config"')
    expect(html).toContain('class="account-identity"')
    expect(html).toContain('id="account-origin-qr"')
    expect(html).toContain('id="add-lx-source"')
    expect(html).toMatch(/id="account-lx-source-settings"[^>]*>[\s\S]*账号洛雪源/)
    expect(html).not.toContain('id="origin-qr"')
    expect(html).not.toContain('id="desktop-account-list"')
    expect(script).toContain("location.pathname === '/login'")
    expect(script).toContain("function initialPage()")
    expect(script).toContain("if (!isTauri()) return 'login'")
    expect(script).toContain("function selectedOriginHost()")
    expect(script).toContain('if (!isTauri()) return window.location.origin')
    expect(script).toContain("if (!isTauri() && page === 'home') page = 'login'")
    expect(script).toContain("$('address-select').addEventListener('change'")
    expect(script).toContain("addSourceInput(value = '')")
    expect(script).toContain("history.replaceState({}, '', page === 'login' ? '#login' : '#home')")
    expect(script).not.toMatch(/location\.hash\s*=(?!=)/)
    expect(script).toContain('document.body.dataset.page = page')
    expect(script).toContain("accounts = await request('/app/api/accounts')")
    expect(script).toMatch(/async function loadDesktopAccounts\(\) \{\s+if \(!isTauri\(\)\) return;/)
    expect(tauriSource).not.toContain('fn list_accounts<R: Runtime>')
    expect(tauriSource).not.toContain('.join("accounts.json")')
    expect(tauriSource).toContain('.arg("--eval")')
    expect(tauriSource).toContain('include_str!("node-runtime-bootstrap.cjs")')
    expect(tauriSource).not.toContain('.arg(script.to_string_lossy().to_string())')
    expect(tauriSource).not.toContain('WOW_RUNTIME_SCRIPT')
    expect(tauriSource).toContain('logs_dir.join("backend.log")')
    expect(tauriSource).toContain('capture_stderr(&state, &bytes)')
    expect(tauriMain).toContain('windows_subsystem = "windows"')
    expect(nodeBootstrap).toContain('createRequire(process.execPath)')
    expect(nodeBootstrap).not.toContain('process.chdir(')
    expect(nodeBootstrap).toContain("'./server-runtime/dist/server.js'")
    expect(nodeBootstrap).toContain("'../Resources/server-runtime/dist/server.js'")
    expect(nodeBootstrap).toContain('runtimeRequire(runtimeScript).start()')
    expect(styles).toContain('.tauri body[data-page="login"] .content')
    expect(styles).toContain('.account-identity { display:grid;')
    expect(styles).toContain('.splash #splash-message')
    expect(styles).toContain('scrollbar-width:none')
    expect(html).not.toMatch(/<script[^>]+https?:\/\//)
  })
})
