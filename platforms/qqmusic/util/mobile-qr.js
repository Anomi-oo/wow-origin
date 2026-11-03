'use strict';

const mqtt = require('mqtt-packet');
const { loginFetch } = require('./login-http');

// QQ 音乐客户端通过 MQTT 5 推送扫码结果；协议编解码交给 mqtt-packet。
// Reference: https://l-1124.github.io/QQMusicApi/reference/modules/login/
async function watchMobileQr(qrcodeId, expiresAt, path = '/ws/handshake', redirects = 0) {
  const headers = { Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' };
  let socket;
  const worker = typeof WebSocketPair !== 'undefined';
  if (worker) {
    const response = await loginFetch(`https://mu.y.qq.com${path}`, {
      headers: { ...headers, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'mqtt' },
    }, 'QQ 音乐二维码连接');
    socket = response.webSocket;
    if (!socket) throw new Error('QQ 音乐未建立二维码连接');
  } else {
    const WebSocket = require('ws');
    socket = new WebSocket(`wss://mu.y.qq.com${path}`, 'mqtt', { headers, handshakeTimeout: 20000 });
  }
  socket.binaryType = 'arraybuffer';
  const topic = `management.qrcode_login/${qrcodeId}`;
  const parser = mqtt.parser({ protocolVersion: 5 });
  let event = { type: 'waiting' };
  let redirect;
  let closed = false;
  let ping;
  let expiry;
  let handshake;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    clearTimeout(expiry);
    clearTimeout(handshake);
    try { socket.close(); } catch { /* 连接尚未建立时也需完成本地清理。 */ }
  }
  function fail(message) {
    if (closed) return;
    event = { type: 'error', message };
    rejectReady(new Error(message));
    close();
  }
  function send(packet) {
    if (!closed) socket.send(mqtt.generate(packet, { protocolVersion: 5 }));
  }
  function connect() {
    try {
      send({
        cmd: 'connect', protocolId: 'MQTT', protocolVersion: 5,
        clientId: `${Date.now()}${Math.floor(Math.random() * 9000) + 1000}`, clean: true, keepalive: 45,
        properties: {
          authenticationMethod: 'pass',
          userProperties: { tmeAppID: 'qqmusic', business: 'management', hashTag: qrcodeId, clientTag: 'management.user', userID: qrcodeId },
        },
      });
    } catch { fail('QQ 音乐二维码连接失败，请刷新二维码'); }
  }
  parser.on('packet', (packet) => {
    if (closed) return;
    try {
      if (packet.cmd === 'connack') {
        const reference = packet.properties?.serverReference;
        if ([0x9c, 0x9d].includes(packet.reasonCode) && typeof reference === 'string'
          && /^[A-Za-z0-9._:-]+$/.test(reference) && redirects < 3) {
          // 上游会把扫码会话分配到指定节点，仍经 mu.y.qq.com 的握手路径连接。
          redirect = `/ws/handshake/${reference}`;
          close();
          resolveReady();
          return;
        }
        if (packet.reasonCode !== 0) return fail('QQ 音乐拒绝二维码连接，请刷新二维码');
        send({ cmd: 'subscribe', messageId: 1, subscriptions: [{ topic, qos: 0 }],
          properties: { userProperties: { authorization: 'tmelogin', pubsub: 'unicast' } } });
      } else if (packet.cmd === 'suback') {
        if (packet.granted.some(code => code >= 128)) return fail('QQ 音乐二维码订阅失败');
        clearTimeout(handshake);
        ping = setInterval(() => {
          try { send({ cmd: 'pingreq' }); } catch { fail('QQ 音乐二维码连接中断，请刷新二维码'); }
        }, 20000);
        ping.unref?.();
        resolveReady();
      } else if (packet.cmd === 'publish' && packet.topic === topic) {
        if (packet.qos === 1) send({ cmd: 'puback', messageId: packet.messageId, reasonCode: 0 });
        const type = packet.properties?.userProperties?.type;
        if (!['scanned', 'cookies', 'canceled', 'timeout', 'loginFailed'].includes(type)) return;
        event = { type, payload: type === 'cookies' ? JSON.parse(packet.payload.toString('utf8')) : undefined };
        clearTimeout(handshake);
        resolveReady();
        if (type !== 'scanned') close();
      } else if (packet.cmd === 'disconnect') fail('QQ 音乐二维码连接已关闭，请刷新二维码');
    } catch { fail('QQ 音乐返回了无效的二维码消息'); }
  });
  parser.on('error', () => fail('QQ 音乐返回了无效的二维码消息'));
  socket.addEventListener('message', (message) => {
    if (closed) return;
    try { parser.parse(Buffer.from(message.data)); }
    catch { fail('QQ 音乐返回了无效的二维码消息'); }
  });
  socket.addEventListener('error', () => fail('QQ 音乐二维码连接失败，请刷新二维码'));
  socket.addEventListener('close', () => fail('QQ 音乐二维码连接中断，请刷新二维码'));
  if (!worker) socket.addEventListener('open', connect);
  handshake = setTimeout(() => fail('QQ 音乐二维码连接超时，请重试'), 20000);
  expiry = setTimeout(() => { event = { type: 'timeout' }; rejectReady(new Error('二维码已过期')); close(); }, Math.max(0, expiresAt - Date.now()));
  handshake.unref?.();
  expiry.unref?.();
  if (worker) {
    try { socket.accept(); connect(); } catch { fail('QQ 音乐二维码连接失败，请刷新二维码'); }
  }
  await ready;
  if (redirect) return watchMobileQr(qrcodeId, expiresAt, redirect, redirects + 1);
  return { get event() { return event; }, close };
}

module.exports = { watchMobileQr };
