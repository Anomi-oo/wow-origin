jest.mock('axios', () => jest.fn());
const axios = require('axios');
const CryptoJS = require('crypto-js');
const { createRequest } = require('../../../platforms/kugou/util/request');
const { cryptoMd5, playlistAesDecrypt } = require('../../../platforms/kugou/util/crypto');
const authMerge = require('../../../platforms/kugou/module/song_url_auth_merge');
const KugouPlatform = require('../../../platforms/kugou/KugouPlatform');

test('SMS sending preserves the registered device through the actual module and signed HTTP request', async () => {
  const platform = new KugouPlatform();
  platform.modules.set('captcha/sent', require('../../../platforms/kugou/module/captcha_sent'));
  const cookie = { KUGOU_API_GUID: 'guid', KUGOU_API_MID: '12345', KUGOU_API_DEV: 'device', dfid: 'registered-dfid' };
  axios.mockResolvedValueOnce({ data: { status: 1 }, headers: {} });
  const result = await platform.callModule('login/phone/send', { query: { phone: '13800000000', cookie }, body: {} });
  expect(result).toMatchObject({ code: 200, body: { status: 'sent' }, cookie });
  expect(axios).toHaveBeenCalledWith(expect.objectContaining({
    baseURL: 'https://loginserviceretry.kugou.com',
    url: '/v7/send_mobile_code', method: 'POST',
    data: { businessid: 5, mobile: '13800000000', plat: 3 },
    params: expect.objectContaining({ mid: '12345', dfid: 'registered-dfid', signature: expect.any(String) }),
    headers: expect.objectContaining({ mid: '12345', dfid: 'registered-dfid' })
  }));
});

test('token refresh uses the verified HTTPS login service', async () => {
  const refresh = require('../../../platforms/kugou/module/login_token');
  const send = jest.fn(async () => ({ body: { status: 0 }, cookie: [] }));
  await refresh({ cookie: { userid: '1', token: 'token', KUGOU_API_GUID: 'guid', KUGOU_API_MAC: 'mac', KUGOU_API_DEV: 'dev' } }, send);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://loginserviceretry.kugou.com', url: '/v5/login_by_token' }));
});

test('SMS TLS failures report the failing module and safe transport code without leaking credentials', async () => {
  const platform = new KugouPlatform();
  platform.modules.set('captcha/sent', require('../../../platforms/kugou/module/captcha_sent'));
  const error = Object.assign(new Error('certificate failed: secret'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID', config: { token: 'secret' } });
  axios.mockRejectedValueOnce(error);
  const result = await platform.callModule('login/phone/send', { query: { phone: '13800000000', cookie: { dfid: 'dfid' } }, body: {} });
  expect(result).toMatchObject({
    code: 502, message: expect.stringContaining('ERR_TLS_CERT_ALTNAME_INVALID'),
    diagnostics: { code: 'ERR_TLS_CERT_ALTNAME_INVALID', details: { route: 'captcha/sent' } }
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|13800000000/);
});

test('SMS upstream error codes and messages survive request rejection', async () => {
  const platform = new KugouPlatform();
  platform.modules.set('captcha/sent', require('../../../platforms/kugou/module/captcha_sent'));
  axios.mockResolvedValueOnce({ data: { status: 0, error_code: 20006, errmsg: '请求参数错误' }, headers: {} });
  const result = await platform.callModule('login/phone/send', { query: { phone: '13800000000', cookie: { dfid: 'dfid' } }, body: {} });
  expect(result).toMatchObject({ code: 502, message: expect.stringContaining('请求参数错误'), upstreamCode: 20006, diagnostics: { details: { route: 'captcha/sent', upstreamCode: 20006 } } });
});

test('SMS HTTP failures expose the status without including the raw request or response', async () => {
  const platform = new KugouPlatform();
  platform.modules.set('captcha/sent', require('../../../platforms/kugou/module/captcha_sent'));
  axios.mockRejectedValueOnce(Object.assign(new Error('request secret'), {
    code: 'ERR_BAD_RESPONSE', config: { token: 'secret' }, response: { status: 503, data: '<html>secret</html>' }
  }));
  const result = await platform.callModule('login/phone/send', { query: { phone: '13800000000', cookie: { dfid: 'dfid' } }, body: {} });
  expect(result).toMatchObject({ code: 502, diagnostics: { code: 'ERR_BAD_RESPONSE', details: { route: 'captcha/sent', httpStatus: 503 } } });
  expect(JSON.stringify(result)).not.toMatch(/secret|13800000000/);
});

test('a device registration failure identifies registration and never reaches SMS sending', async () => {
  const platform = new KugouPlatform();
  const send = jest.fn();
  platform.modules.set('register/dev', async () => { throw { body: { status: 0, error_code: 123 } }; });
  platform.modules.set('captcha/sent', send);
  const result = await platform.callModule('login/phone/send', { query: { phone: '13800000000' }, body: {} });
  expect(result).toMatchObject({ code: 502, diagnostics: { details: { route: 'register/dev', upstreamCode: 123 } } });
  expect(send).not.toHaveBeenCalled();
});

test.each([1, 0])('SSA headers preserve the upstream response with status=%i when no WebGL hash is supplied', async status => {
  const body = { status, data: { userid: 1, nickname: 'test' }, ...(status ? {} : { error_code: 1001 }) };
  axios.mockResolvedValueOnce({ data: body, headers: { 'ssa-code': 'test-ssa' } });
  const pending = createRequest({ url: '/test', method: 'POST', cookie: { userid: 1, KUGOU_API_MID: 'mid', dfid: 'dfid' } });
  const response = status ? await pending : await pending.catch(error => error);
  expect(response).toMatchObject({
    status: status ? 200 : 502,
    headers: { 'ssa-code': 'test-ssa' },
    body: { ...body, ssaCode: 'test-ssa', edt: expect.any(String), sid: expect.any(String) }
  });
  expect(response.body.edt.length).toBeGreaterThan(0);
  expect(response.body.sid.length).toBeGreaterThan(0);
});

test('binary responses remain Buffers with axios ArrayBuffer responses used by Workers', async () => {
  const key = 'abc123';
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify({ status: 1, data: { dfid: 'device' } }), CryptoJS.enc.Utf8.parse(cryptoMd5(key).slice(0, 16)), { iv: CryptoJS.enc.Utf8.parse(cryptoMd5(key).slice(16)), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  const bytes = Uint8Array.from(Buffer.from(encrypted.ciphertext.toString(CryptoJS.enc.Base64), 'base64'));
  axios.mockResolvedValueOnce({ data: bytes.buffer, headers: {} });
  const response = await createRequest({ url: '/test', method: 'POST', responseType: 'arraybuffer', cookie: {} });
  expect(Buffer.isBuffer(response.body)).toBe(true);
  expect(playlistAesDecrypt({ key, str: response.body.toString('base64') })).toEqual({ status: 1, data: { dfid: 'device' } });
});

test('authorization failure rejects immediately and never sends a URL request', async () => {
  const failure = { status: 502, body: { error: 'expired' } };
  const request = jest.fn(async () => { throw failure; });
  await expect(authMerge({ hash: 'a'.repeat(32), cookie: {} }, request)).rejects.toBe(failure);
  expect(request).toHaveBeenCalledTimes(1);
});

test('authorization and URL requests use the same account/device and token', async () => {
  const cookie = { userid: '1', token: 'account-token', dfid: 'device' };
  const request = jest.fn(async options => options.url === '/v1/authorization'
    ? { body: { data: { auth: 'song-auth', open_time: 123 } } }
    : { body: { url: ['https://example.com/audio.ogg'] } });
  await authMerge({ hash: 'a'.repeat(32), auth: 'user-auth', cookie }, request);
  expect(request.mock.calls[0][0].cookie).toEqual(cookie);
  expect(request.mock.calls[1][0].cookie).toEqual(cookie);
  expect(request.mock.calls[1][0].params).toMatchObject({ auth: 'song-auth', open_time: 123 });
});

test('QR generation uses SVG and escapes the upstream key without PNG streams', async () => {
  const create = require('../../../platforms/kugou/module/login_qr_create');
  const result = await create({ key: 'key&next=1', qrimg: true });
  expect(result.body.data.url).toContain('qrcode=key%26next%3D1');
  expect(result.body.data.base64).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(Buffer.from(result.body.data.base64.split(',')[1], 'base64').toString()).toContain('<svg');
});

test('adding playlist songs preserves comma and pipe characters in song names', async () => {
  const add = require('../../../platforms/kugou/module/playlist_tracks_add');
  const request = jest.fn(async () => ({ status: 200, body: { status: 1 } }));
  await add({ listid: 42, cookie: { userid: '1', token: 'token' }, data: [{ name: 'Hello, world | live', hash: 'a'.repeat(32), album_id: '7', mixsongid: '8' }] }, request);
  expect(request.mock.calls[0][0].data.data).toEqual([expect.objectContaining({ name: 'Hello, world | live', album_id: 7, mixsongid: 8 })]);
});

test('concurrent editions use their own application IDs and signing salts despite opposite process configuration', async () => {
  const { createHash } = require('node:crypto');
  const previous = process.env.KUGOU_PLATFORM;
  process.env.KUGOU_PLATFORM = 'lite';
  try {
    const releases = [];
    axios.mockImplementation(() => new Promise(resolve => releases.push(() => resolve({ data: { status: 1 }, headers: {} }))));
    const editions = ['standard', 'lite', undefined, 'lite', 'standard'];
    const pending = editions.map(edition => createRequest({ url: '/v7/get_all_list', method: 'POST', encryptKey: true, data: { type: 2 }, params: { hash: 'abc' }, cookie: { userid: '1', token: 'test', KUGOU_API_MID: 'mid', ...(edition ? { KUGOU_API_PLATFORM: edition } : {}) } }));
    expect(axios).toHaveBeenCalledTimes(5);
    for (const [index, [options]] of axios.mock.calls.entries()) {
      const lite = editions[index] === 'lite';
      const appid = lite ? 3116 : 1005;
      expect(options.params).toMatchObject({ appid, clientver: lite ? 11440 : 20489 });
      const { signature, ...unsigned } = options.params;
      const md5 = value => createHash('md5').update(value).digest('hex');
      expect(unsigned.key).toBe(md5(`abc${lite ? '185672dd44712f60bb1736df5a377e82' : '57ae12eb6890223e355ccfcb74edf70d'}${appid}mid1`));
      const salt = lite ? 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA' : 'OIlwieks28dk2k092lksi2UIkp';
      expect(signature).toBe(md5(salt + Object.keys(unsigned).sort().map(key => `${key}=${unsigned[key]}`).join('') + JSON.stringify(options.data) + salt));
    }
    releases.reverse().forEach(release => release());
    await Promise.all(pending);
    expect(process.env.KUGOU_PLATFORM).toBe('lite');
  } finally {
    if (previous === undefined) delete process.env.KUGOU_PLATFORM; else process.env.KUGOU_PLATFORM = previous;
  }
});

test.each(['standard', 'lite'])('%s applies the same edition to QR, SMS encryption, metadata, cloud signing and playback', async edition => {
  const { createHash } = require('node:crypto');
  const { createCloudRequest } = require('../../../platforms/kugou/util/request');
  const { cryptoRSAEncrypt, publicRasKey, publicLiteRasKey } = require('../../../platforms/kugou/util/crypto');
  const cookie = { userid: '1', token: 'test', dfid: 'dfid', KUGOU_API_PLATFORM: edition, KUGOU_API_MID: 'mid' };
  const lite = edition === 'lite';
  const appid = lite ? 3116 : 1005;
  const send = jest.fn(async () => ({ body: { status: 0 }, cookie: [] }));
  await require('../../../platforms/kugou/module/login_qr_key')({ cookie }, send);
  expect(send.mock.calls.at(-1)[0].params.qrcode_txt).toContain(`appid=${appid}&`);
  await require('../../../platforms/kugou/module/login_qr_check')({ cookie, key: 'qr-key' }, send);
  expect(send.mock.calls.at(-1)[0].params.appid).toBe(appid);
  await require('../../../platforms/kugou/module/login_cellphone')({ cookie, mobile: '13800000000', code: '123456' }, send);
  const login = send.mock.calls.at(-1)[0].data;
  expect(login.t1 === 0).toBe(!lite);
  const plain = { token: 'test', clienttime: 123 };
  expect(cryptoRSAEncrypt(plain, undefined, cookie)).toBe(cryptoRSAEncrypt(plain, lite ? publicLiteRasKey : publicRasKey));
  await require('../../../platforms/kugou/module/login_token')({ cookie }, send);
  expect(send.mock.calls.at(-1)[0].data.t1 === 0).toBe(!lite);
  await require('../../../platforms/kugou/module/top_playlist')({ cookie }, send);
  const metadata = send.mock.calls.at(-1)[0].data;
  const salt = lite ? 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA' : 'OIlwieks28dk2k092lksi2UIkp';
  const md5 = value => createHash('md5').update(value).digest('hex');
  expect(metadata.appid).toBe(appid);
  expect(metadata.key).toBe(md5(`${appid}${salt}${lite ? 11440 : 20489}${metadata.clienttime}`));
  await require('../../../platforms/kugou/module/song_url_auth')({ cookie, hash: 'a'.repeat(32) }, send);
  expect(send.mock.calls.at(-1)[0].params).toMatchObject({ pid: lite ? 411 : 2, page_id: lite ? 967177915 : 151369488 });
  axios.mockResolvedValue({ data: Buffer.from(JSON.stringify({ status: 1 })), headers: {} });
  await createCloudRequest({ url: '/v1/modify_list', cookie, data: { listid: 42 } });
  const cloud = axios.mock.calls.at(-1)[0].params;
  expect(cloud.appid).toBe(appid);
  expect(cloud.key).toBe(md5(`${appid}${salt}${lite ? 11440 : 20489}${cloud.clienttime}`));
});
