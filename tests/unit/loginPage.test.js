const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Minimal DOM for executing the real page event handlers without sending SMS.
function page({ adminManagementEnabled = false } = {}) {
  const elements = new Map()
  function element(id, dataset = {}) {
    if (elements.has(id)) return elements.get(id)
    const classes = new Set()
    const el = {
      open: false, focus() {},
      showModal() { this.open = true }, close() { this.open = false; this.handlers.close?.() },
      remove() { elements.delete(id) },
      dataset, value: '', textContent: '', disabled: false, handlers: {}, children: [],
      append(...children) { this.children.push(...children) },
      replaceChildren(...children) { this.children = children },
      classList: {
        add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle(c, on) { if (on) classes.add(c); else classes.delete(c) },
      },
      addEventListener(name, callback) { this.handlers[name] = callback },
      removeAttribute(name) { delete this[name] }, setAttribute(name, value) { this[name] = value },
      getAttribute(name) { return this[name] ?? null }, reportValidity: () => true,
    }
    elements.set(id, el)
    return el
  }
  const methods = ['qr', 'phone', 'cookie'].map(method => element(method, { method }))
  const platforms = ['qq', 'netease', 'ytmusic'].map(platform => element(platform, { platform }))
  const steps = ['login-choose', 'login-verify', 'login-scan', 'account-config'].map(id => element(id));
  const document = {
    createElement: tag => element(`${tag}-${elements.size}`),
    getElementById: element, documentElement: element('document'), body: element('body'),
    querySelectorAll: selector => selector === '.login-step' ? steps : selector === '#login-methods button' ? methods : selector === '#platform-switch button' ? platforms : [],
  }
  const fetch = jest.fn(async url => {
    if (url === '/app/api/status') return { ok: true, json: async () => ({ code: 200, data: { adminManagementEnabled } }) }
    if (url === '/app/api/origin-qr' || url === '/login/api/start') return { ok: true, json: async () => ({ code: 200, data: { platform: 'qq', token: 'qr-token', qrImage: 'data:image/png;base64,test' } }) }
    throw new Error('Unexpected request')
  })
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), 'public/app.js'), 'utf8'), {
    document, fetch, window: { addEventListener() {}, location: { origin: 'https://example.com' } }, location: { pathname: '/login' },
    history: { pushState() {}, replaceState() {} }, setTimeout: jest.fn(), clearTimeout: jest.fn(),
    Date, URL,
  })
  element('phone-number').value = '13800000000'
  element('phone-country').value = '86'
  return { element, fetch }
}

test('QQ CAPTCHA is embedded, allows immediate resend with same token, and clears after success', async () => {
  const { element, fetch } = page()
  await new Promise(setImmediate)
  element('phone').handlers.click()
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: {
    status: 'captcha', token: 'same-session', securityPath: '/login/api/phone/captcha?token=same-session', retryAfter: 0,
  } }) })
  await element('phone-send').handlers.click()
  expect(element('phone-send').disabled).toBe(false)
  expect(element('phone-send').textContent).not.toContain('秒')
  expect(element('phone-captcha').classList.contains('hidden')).toBe(false)
  expect(element('phone-captcha-frame').src).toBe('/login/api/phone/captcha?token=same-session')
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: { status: 'sent', token: 'same-session', retryAfter: 60 } }) })
  await element('phone-send').handlers.click()
  expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).token).toBe('same-session')
  expect(element('phone-send').disabled).toBe(true)
  expect(element('phone-captcha').classList.contains('hidden')).toBe(true)
  expect(element('phone-captcha-frame').src).toBeUndefined()
})

test('switching to NetEase keeps the phone option and clears a previous challenge', async () => {
  const { element } = page()
  await new Promise(setImmediate)
  element('phone').handlers.click()
  element('phone-captcha-frame').src = 'https://example.com/verify'
  element('netease').handlers.click()
  expect(element('phone-login-panel').classList.contains('hidden')).toBe(false)
  expect(element('phone-captcha-frame').src).toBeUndefined()
})

test('switching to YouTube Music opens Cookie login and hides other methods', async () => {
  const { element } = page()
  await new Promise(setImmediate)
  element('ytmusic').handlers.click()
  expect(element('cookie-login-panel').classList.contains('hidden')).toBe(false)
  expect(element('qr-login-panel').classList.contains('hidden')).toBe(true)
  expect(element('qr').classList.contains('hidden')).toBe(true)
  expect(element('phone').classList.contains('hidden')).toBe(true)
  expect(element('ytmusic-cookie-help').classList.contains('hidden')).toBe(false)
})

test('desktop only allows the local CAPTCHA proxy frame', () => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'))
  expect(config.app.security.csp).toContain('frame-src http://127.0.0.1:*')
  expect(config.app.security.csp).not.toContain('frame-src https://c.y.qq.com')
  const html = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf8')
  expect(html).toContain('<iframe id="phone-captcha-frame"')
  expect(html).toContain('sandbox="allow-scripts allow-forms"')
  expect(html).not.toContain('<a id="phone-captcha"')
  expect(html).not.toContain('<button data-method="phone"')
})

test('relogin title uses the configured name across methods and resets when creating an account', async () => {
  const { element, fetch } = page()
  await new Promise(setImmediate)
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: {
    platform: 'qq', apiAccessKey: 'account-key', name: '客厅 <音乐>', accountName: '平台昵称', lxSource: [],
  } }) })
  await element('verify-submit').handlers.click()
  element('account-name').value = '未保存的名称'
  await element('relogin').handlers.click()
  expect(element('login-title').textContent).toBe('重新登录账号 客厅 <音乐>')
  element('cookie').handlers.click()
  expect(element('login-title').textContent).toBe('重新登录账号 客厅 <音乐>')
  element('phone').handlers.click()
  expect(element('login-title').textContent).toBe('重新登录账号 客厅 <音乐>')
  element('choose-create').handlers.click()
  expect(element('login-title').textContent).toBe('登录账号')
  await new Promise(setImmediate)
})

async function openAccount(ui) {
  ui.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: {
    platform: 'netease', apiAccessKey: 'own-key', name: '个人账号', lxSource: [],
  } }) })
  await ui.element('verify-submit').handlers.click()
  await new Promise(setImmediate)
}

test('ordinary account key user can cancel then confirm account deletion without admin password', async () => {
  const ui = page()
  await new Promise(setImmediate)
  expect(ui.element('admin-mode').classList.contains('hidden')).toBe(true)
  await openAccount(ui)
  expect(ui.element('delete-account').classList.contains('hidden')).toBe(false)
  ui.element('delete-account').handlers.click()
  expect(ui.element('delete-dialog').open).toBe(true)
  ui.element('delete-cancel').handlers.click()
  expect(ui.fetch.mock.calls.some(([url]) => url === '/app/api/accounts/delete')).toBe(false)
  ui.element('delete-account').handlers.click()
  ui.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: null }) })
  await ui.element('delete-confirm').handlers.click()
  const [, options] = ui.fetch.mock.calls.find(([url]) => url === '/app/api/accounts/delete')
  expect(JSON.parse(options.body)).toEqual({ api_access_key: 'own-key' })
  expect(options.headers.Authorization).toBeUndefined()
  expect(ui.element('account-key').textContent).toBe('')
  expect(ui.element('account-origin-qr').src).toBeUndefined()
  expect(ui.element('delete-dialog').open).toBe(false)
})

test('admin modal handles incorrect key and only keeps successful credentials until exit', async () => {
  const ui = page({ adminManagementEnabled: true })
  await new Promise(setImmediate)
  expect(ui.element('admin-mode').classList.contains('hidden')).toBe(false)
  ui.element('admin-mode').handlers.click()
  ui.element('admin-password').value = 'bad'
  ui.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: 401, message: '管理员密钥错误' }) })
  await ui.element('admin-form').handlers.submit({ preventDefault() {} })
  expect(ui.element('admin-error').textContent).toBe('管理员密钥错误')
  expect(ui.element('admin-dialog').open).toBe(true)
  ui.element('admin-password').value = 'secret'
  ui.fetch.mockResolvedValue({ ok: true, json: async () => ({ code: 200, data: [] }) })
  await ui.element('admin-form').handlers.submit({ preventDefault() {} })
  expect(ui.element('admin-mode').textContent).toBe('退出管理员模式')
  expect(ui.element('admin-password').value).toBe('')
  expect(ui.fetch.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer secret')
  ui.element('admin-mode').handlers.click()
  expect(ui.element('admin-mode').textContent).toBe('管理员模式')
  expect(ui.element('account-key').textContent).toBe('')
})


test('switching account keeps details visible and ignores stale responses', async () => {
  const ui = page({ adminManagementEnabled: true })
  await new Promise(setImmediate)
  const accounts = ['first', 'second', 'third'].map(key => ({ platform: 'netease', apiAccessKey: key, name: key, lxSource: [] }))
  const result = data => ({ ok: true, json: async () => ({ code: 200, data }) })
  const pending = new Map()
  ui.fetch.mockImplementation(async (url, options) => {
    if (url === '/app/api/accounts') return result(accounts)
    if (url === '/app/api/origin-qr') return result({ qrImage: 'test-qr' })
    if (url === '/login/api/verify-key') {
      const key = JSON.parse(options.body).api_access_key
      return new Promise(resolve => pending.set(key, resolve))
    }
    throw new Error('Unexpected request')
  })
  ui.element('admin-mode').handlers.click()
  ui.element('admin-password').value = 'secret'
  await ui.element('admin-form').handlers.submit({ preventDefault() {} })
  const clickAccount = index => ui.element('desktop-account-list').children[index].handlers.click()
  const first = clickAccount(0)
  pending.get('first')(result(accounts[0]))
  await first
  await new Promise(setImmediate)
  expect(ui.element('account-config').classList.contains('hidden')).toBe(false)
  expect(ui.element('login-choose').classList.contains('hidden')).toBe(true)

  const second = clickAccount(1)
  expect(ui.element('account-config').classList.contains('hidden')).toBe(false)
  expect(ui.element('login-choose').classList.contains('hidden')).toBe(true)
  expect(ui.element('account-key').textContent).toBe('first')
  expect(ui.element('account-config').getAttribute('aria-busy')).toBe('true')
  expect(ui.element('account-config').getAttribute('inert')).toBe('')
  const third = clickAccount(2)
  pending.get('second')(result(accounts[1]))
  await second
  expect(ui.element('account-key').textContent).toBe('first')
  pending.get('third')(result(accounts[2]))
  await third
  expect(ui.element('account-key').textContent).toBe('third')
  expect(ui.element('account-config').getAttribute('inert')).toBeNull()
  expect(ui.element('account-config').getAttribute('aria-busy')).toBeNull()
  expect(ui.element('login-choose').classList.contains('hidden')).toBe(true)

  const failed = clickAccount(1)
  pending.get('second')({ ok: false, status: 500, json: async () => ({ code: 500, message: '加载失败' }) })
  await failed
  expect(ui.element('account-key').textContent).toBe('third')
  expect(ui.element('account-config').getAttribute('inert')).toBeNull()
  expect(ui.element('login-error').textContent).toBe('加载失败')
})
