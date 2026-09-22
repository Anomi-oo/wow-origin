const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Minimal DOM for executing the real page event handlers without sending SMS.
function page() {
  const elements = new Map()
  function element(id, dataset = {}) {
    if (elements.has(id)) return elements.get(id)
    const classes = new Set()
    const el = {
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
  const platforms = ['qq', 'netease'].map(platform => element(platform, { platform }))
  const document = {
    createElement: tag => element(`${tag}-${elements.size}`),
    getElementById: element, documentElement: element('document'), body: element('body'),
    querySelectorAll: selector => selector === '#login-methods button' ? methods : selector === '#platform-switch button' ? platforms : [],
  }
  const fetch = jest.fn(async url => {
    if (url === '/app/api/status') return { ok: true, json: async () => ({ code: 200, data: {} }) }
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
