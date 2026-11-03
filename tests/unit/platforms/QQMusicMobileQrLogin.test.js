const mqtt = require('mqtt-packet')

describe('QQ Music mobile QR login', () => {
  let qr, androidLoginCgi, sockets, redirect, terminalBeforeSuback
  class Socket {
    constructor() {
      this.handlers = {}
      this.sent = []
      this.parser = mqtt.parser({ protocolVersion: 5 })
      this.parser.on('packet', packet => {
        this.sent.push(packet)
        if (packet.cmd === 'connect') {
          this.receive(redirect && sockets.length === 1
            ? { cmd: 'connack', reasonCode: 0x9d, sessionPresent: false, properties: { serverReference: 'node:29001' } }
            : { cmd: 'connack', reasonCode: 0, sessionPresent: false })
        }
        if (packet.cmd === 'subscribe') {
          if (terminalBeforeSuback) this.publish('canceled')
          else this.receive({ cmd: 'suback', messageId: packet.messageId, granted: [0] })
        }
      })
      sockets.push(this)
      queueMicrotask(() => this.handlers.open?.({}))
    }
    addEventListener(type, handler) { this.handlers[type] = handler }
    accept() { this.accepted = true }
    send(data) { this.parser.parse(data) }
    close() { this.closed = true; this.handlers.close?.({}) }
    receive(packet) {
      queueMicrotask(() => this.handlers.message?.({ data: mqtt.generate(packet, { protocolVersion: 5 }) }))
    }
    publish(type, payload = {}, qos = 0) {
      this.receive({ cmd: 'publish', topic: 'management.qrcode_login/qr-id', qos, messageId: 7,
        properties: { userProperties: { type } }, payload: JSON.stringify(payload) })
    }
  }
  beforeEach(() => {
    jest.resetModules()
    sockets = []; redirect = false; terminalBeforeSuback = false
    androidLoginCgi = jest.fn(async (_module, method) => method === 'CreateQRCode'
      ? { code: 0, data: { qrcode: 'aW1hZ2U=', qrcodeID: 'qr-id' } }
      : { code: 0, data: { musicid: 999, musickey: 'music-key', refresh_key: 'refresh' } })
    jest.doMock('ws', () => Socket)
    jest.doMock('../../../platforms/qqmusic/util/android-login', () => ({
      createAndroidLoginContextFromIdentity: () => ({ androidLoginCgi }), bindAndroidLoginContext: jest.fn(),
    }))
    qr = require('../../../platforms/qqmusic/util/qq-login')
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    sockets.forEach(socket => socket.close())
    jest.restoreAllMocks()
    jest.dontMock('ws')
    jest.dontMock('../../../platforms/qqmusic/util/android-login')
    delete global.WebSocketPair
  })
  const flush = () => new Promise(setImmediate)

  test('subscribes with MQTT5 auth, maps scanned state and exchanges pushed credentials once', async () => {
    const { token } = await qr.startLogin(undefined, 'mobile')
    const socket = sockets[0]
    expect(socket.sent[0]).toMatchObject({ cmd: 'connect', protocolVersion: 5, properties: {
      authenticationMethod: 'pass', userProperties: { tmeAppID: 'qqmusic', hashTag: 'qr-id', userID: 'qr-id', business: 'management', clientTag: 'management.user' },
    } })
    expect(socket.sent[1]).toMatchObject({ cmd: 'subscribe', subscriptions: [{ topic: 'management.qrcode_login/qr-id', qos: 0 }],
      properties: { userProperties: { authorization: 'tmelogin', pubsub: 'unicast' } } })
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'waiting' })
    socket.publish('scanned'); await flush()
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'confirming' })
    socket.publish('cookies', { cookies: { qqmusic_uin: { value: '999' }, qqmusic_key: { value: 'pushed-key' } } }, 1)
    await flush()
    expect(socket.sent.at(-1)).toMatchObject({ cmd: 'puback', messageId: 7 })
    expect(socket.closed).toBe(true)
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'done', cookie: { loginType: '6', qm_keyst: 'music-key', refresh_key: 'refresh' } })
    expect(androidLoginCgi).toHaveBeenLastCalledWith('music.login.LoginServer', 'Login', { musicid: 999, qrCodeID: 'qr-id', token: 'pushed-key' }, {}, { tmeLoginType: 6 })
    expect(await qr.pollLogin(token)).toEqual({ status: 'expired' })
    expect(androidLoginCgi).toHaveBeenCalledTimes(2)
  })

  test('follows upstream node redirect on the same host', async () => {
    redirect = true
    const { token } = await qr.startLogin(undefined, 'mobile')
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closed).toBe(true)
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'waiting' })
    qr.cancelLogin(token)
    expect(sockets[1].closed).toBe(true)
  })

  test('Workers uses fetch upgrade and accepts the socket', async () => {
    global.WebSocketPair = class {}
    const socket = new Socket()
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 101, webSocket: socket })
    const { token } = await qr.startLogin(undefined, 'mobile')
    expect(fetch).toHaveBeenCalledWith('https://mu.y.qq.com/ws/handshake', expect.objectContaining({ headers: expect.objectContaining({ Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'mqtt' }) }))
    expect(socket.accepted).toBe(true)
    expect(socket.sent.filter(packet => packet.cmd === 'connect')).toHaveLength(1)
    qr.cancelLogin(token)
    expect(socket.closed).toBe(true)
  })

  test.each([['canceled', 'error'], ['timeout', 'expired'], ['loginFailed', 'error']])('terminal %s closes connection without exchanging credentials', async (type, status) => {
    const { token } = await qr.startLogin(undefined, 'mobile')
    sockets[0].publish(type); await flush()
    expect(await qr.pollLogin(token)).toMatchObject({ status })
    expect(sockets[0].closed).toBe(true)
    expect(androidLoginCgi).toHaveBeenCalledTimes(1)
  })

  test('terminal publish before SUBACK does not leave QR generation hanging', async () => {
    terminalBeforeSuback = true
    const { token } = await qr.startLogin(undefined, 'mobile')
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'error' })
    expect(sockets[0].closed).toBe(true)
  })

  test('connection errors become terminal login errors and close the socket', async () => {
    const { token } = await qr.startLogin(undefined, 'mobile')
    sockets[0].handlers.error({})
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'error' })
    expect(sockets[0].closed).toBe(true)
    expect(androidLoginCgi).toHaveBeenCalledTimes(1)
  })

  test('session expiry closes an abandoned connection without polling', async () => {
    const { watchMobileQr } = require('../../../platforms/qqmusic/util/mobile-qr')
    const watcher = await watchMobileQr('qr-id', Date.now() + 25)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(watcher.event.type).toBe('timeout')
    expect(sockets[0].closed).toBe(true)
  })

  test('malformed pushed credentials fail without calling login', async () => {
    const { token } = await qr.startLogin(undefined, 'mobile')
    sockets[0].publish('cookies', { cookies: {} }); await flush()
    expect(await qr.pollLogin(token)).toMatchObject({ status: 'error' })
    expect(androidLoginCgi).toHaveBeenCalledTimes(1)
  })
})
