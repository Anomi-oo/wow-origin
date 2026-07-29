const crypto = require('crypto');

const SALT = 'dAWsBhCqtOaNLLJ25hBzWbqWXwiK99Wd';
const K = 4294967296; // 2^32

const B = x => ((x % 256) + 256) & 0xFF;
const u32be = n => Buffer.from([(n>>>24)&0xFF,(n>>>16)&0xFF,(n>>>8)&0xFF,n&0xFF]);

function makeE(now, d8) {
  const hi = Math.floor(now / K) >>> 0;
  const lo = (now % K) >>> 0;
  const c = Buffer.concat([u32be(hi), u32be(lo)]); // 8 bytes

  const rand = d8 ? Buffer.from(d8.map(B)) : crypto.randomBytes(8);
  const out = Buffer.alloc(16);

  for (let l = 0; l < 16; l++) {
    const g = l >> 1;
    if ((l & 1) === 0) {
      // 偶数位：高半字节
      out[l] =
        ((rand[g] & 0x10) >>> 4) |
        ((rand[g] & 0x20) >>> 3) |
        ((rand[g] & 0x40) >>> 2) |
        ((rand[g] & 0x80) >>> 1) |
        ((c[g]    & 0x10) >>> 3) |
        ((c[g]    & 0x20) >>> 2) |
        ((c[g]    & 0x40) >>> 1) |
        ((c[g]    & 0x80) >>> 0);
    } else {
      // 奇数位：低半字节
      out[l] =
        ((rand[g] & 0x01) << 0) |
        ((rand[g] & 0x02) << 1) |
        ((rand[g] & 0x04) << 2) |
        ((rand[g] & 0x08) << 3) |
        ((c[g]    & 0x01) << 1) |
        ((c[g]    & 0x02) << 2) |
        ((c[g]    & 0x04) << 3) |
        ((c[g]    & 0x08) << 4);
    }
  }
  return out;
}

function rFromE(Ebuf, salt = SALT) {
  const hexE = Ebuf.toString('hex');
  const md5hex = crypto.createHash('md5').update(hexE + salt, 'utf8').digest('hex');
  const md8 = Buffer.from(md5hex.slice(0, 16), 'hex');
  return Buffer.concat([md8, Ebuf]).toString('base64').replace(/=+$/, '');
}

/**
 * 生成 r
 */
function bc({ now = Date.now(), d8 = null } = {}) {
  const E = makeE(now, d8);
  return rFromE(E);
}


// - La(e) 输入是字符串，输出为小写 hex 字符串

// 密钥（来自 a[82], a[277], a[41], a[143], a[84], a[117]）
const KEY = Buffer.from([31, 125, 244, 60, 32, 48]); // 0x1F,0x7D,0xF4,0x3C,0x20,0x30

// 把可能包含 %xx 的字符串解析为字节
function percentStringToBytes(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%') {
      if (i + 2 >= s.length) throw new Error('Bad %xx sequence');
      const v = parseInt(s[i + 1] + s[i + 2], 16);
      if (Number.isNaN(v)) throw new Error('Bad hex in %xx');
      out.push(v & 0xFF);
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xFF);
    }
  }
  return Buffer.from(out);
}

// La(e) -> hex
function La(e) {
  if (!e) return '';
  const input = percentStringToBytes(e);
  const out = Buffer.allocUnsafe(input.length);
  for (let i = 0; i < input.length; i++) {
    const v1 = (input[i] ^ KEY[i % KEY.length]) & 0xFF; // XOR
    const v2 = (256 - v1) & 0xFF;                       // 8位环绕的相反数
    out[i] = v2;
  }
  return out.toString('hex'); // 小写 hex
}

const genCheckToken = (type) => {
    if(type === 'weapi'){
        return La(JSON.stringify({
            "r": 1,
            "d": "dyRmOyIM4HJEUVQUVBLGhjpWetksmiyy",
            "b": bc()
        }))
    }
    else if(type === 'eapi'){
        return La(JSON.stringify({
            "r": 1,
            "d": "jiEABHxUxtVBFBVEQFKSgnoWYHsMEqAV",
            "b": bc()
        }))
    }
}



module.exports = genCheckToken