const crypto = require('crypto');

const REQUEST_KEY_HEX = 'bd305f10d0ff74b6ef54dab835b5e1cf'; // 16B → AES-128-GCM
const RESPONSE_KEY_HEX = '7a3f8c1d5e9b2f0a6c4d7e8b1f3a5c9d0e2b6f4a81'; // 21B，响应使用循环 XOR

const REQUEST_KEY = Buffer.from(REQUEST_KEY_HEX, 'hex');
const RESPONSE_KEY = Buffer.from(RESPONSE_KEY_HEX, 'hex');

const IV_LEN = 12;
const TAG_LEN = 16;

// 工具：循环 XOR
function xorCycle(dataBuf, keyBuf) {
  const out = Buffer.allocUnsafe(dataBuf.length);
  for (let i = 0; i < dataBuf.length; i++) {
    out[i] = dataBuf[i] ^ keyBuf[i % keyBuf.length];
  }
  return out;
}

/**
 * ag-1 请求加密（AES-GCM）
 * 输入 plaintext（string | Buffer | object），输出 Base64（[12B IV][CT][16B TAG]）
 */
function encryptRequest(plaintext, iv) {
  const ivBuf = iv ? Buffer.from(iv) : crypto.randomBytes(IV_LEN);

  let pt;
  if (Buffer.isBuffer(plaintext)) pt = plaintext;
  else if (typeof plaintext === 'string') pt = Buffer.from(plaintext, 'utf8');
  else if (typeof plaintext === 'object' && plaintext !== null) pt = Buffer.from(JSON.stringify(plaintext));
  else throw new TypeError('plaintext must be Buffer|string|object');

  const cipher = crypto.createCipheriv('aes-128-gcm', REQUEST_KEY, ivBuf, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([ivBuf, ct, tag]).toString('base64');
}

/**
 * ag-1 请求解密（AES-GCM）
 * 输入 Base64（[12B IV][CT][16B TAG]），输出 UTF-8 明文字符串
 */
function decryptRequest(b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('ag-1 packet too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);

  const dec = crypto.createDecipheriv('aes-128-gcm', REQUEST_KEY, iv);
  dec.setAuthTag(tag);
  const pt = Buffer.concat([dec.update(ct), dec.final()]);
  return pt.toString('utf8');
}

/**
 * ag-1 响应解密（循环 XOR）
 * - 输入：Base64 字符串或 Buffer（二进制响应体）
 * - 输出：UTF-8 明文字符串
 */
function decryptResponse(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'base64');
  const pt = xorCycle(buf, RESPONSE_KEY);
  return pt.toString('utf8');
}


/**
 * 为QQ音乐API请求生成zzcSign签名
 * @param {string} payload - 需要签名的请求载荷
 * @returns {string} 生成的签名
 */
function zzcSign(payload) {
    // 生成SHA1哈希
    const hash = crypto.createHash('sha1').update(payload).digest('hex').toUpperCase();

    // 使用预定义索引提取第一部分
    const part1Indexes = [23, 14, 6, 36, 16, 40, 7, 19];
    let part1 = '';
    for (const i of part1Indexes) {
        if (i < 40) {
            part1 += hash[i];
        }
    }

    // 使用预定义索引提取第二部分
    const part2Indexes = [16, 1, 32, 12, 19, 27, 8, 5];
    let part2 = '';
    for (const i of part2Indexes) {
        part2 += hash[i];
    }

    // 用于异或运算的混淆值
    const scrambleValues = [
        89, 39, 179, 150, 218, 82, 58, 252, 177,
        52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179
    ];

    // 通过哈希字节与混淆值进行异或运算创建第三部分
    const part3Array = new Uint8Array(scrambleValues.length);
    for (let i = 0; i < scrambleValues.length; i++) {
        const hashPart = hash.slice(i * 2, i * 2 + 2);
        const hashValue = parseInt(hashPart, 16);
        const value = scrambleValues[i] ^ hashValue;
        part3Array[i] = value;
    }

    // 转换为base64并移除特殊字符
    const buffer = Buffer.from(part3Array);
    let b64Part = buffer.toString('base64');
    b64Part = b64Part.replace(/[\/+=]/g, '');

    // 组合所有部分
    const sign = 'zzc' + part1 + b64Part + part2;
    return sign.toLowerCase();
}


module.exports = {
  encryptRequest,
  decryptRequest,
  decryptResponse,
  zzcSign
};
