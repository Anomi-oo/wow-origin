import { cbc, ecb, gcm } from '@noble/ciphers/aes.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { Buffer } from 'buffer';

type Encoding = BufferEncoding | undefined;

function bytes(value: string | ArrayBuffer | ArrayBufferView, encoding?: BufferEncoding): Buffer {
  if (typeof value === 'string') return Buffer.from(value, encoding);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(value);
}

function secureRandom(size: number): Buffer {
  const output = Buffer.alloc(size);
  const runtimeCrypto = (globalThis as any).crypto;
  if (runtimeCrypto?.getRandomValues) {
    runtimeCrypto.getRandomValues(output);
    return output;
  }

  // Quantumult X does not document getRandomValues on every supported build.
  // Mix time and Math.random as a compatibility fallback for request nonces.
  let state = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  for (let index = 0; index < output.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output[index] = (state ^ Math.floor(Math.random() * 256)) & 0xff;
  }
  return output;
}

class Hash {
  private readonly chunks: Buffer[] = [];

  constructor(private readonly algorithm: string) {}

  update(value: string | ArrayBuffer | ArrayBufferView, encoding?: BufferEncoding): this {
    this.chunks.push(bytes(value, encoding));
    return this;
  }

  digest(encoding?: 'hex' | 'base64'): Buffer | string {
    const input = Buffer.concat(this.chunks);
    const output = this.algorithm.toLowerCase() === 'md5'
      ? Buffer.from(md5(input))
      : this.algorithm.toLowerCase() === 'sha1'
        ? Buffer.from(sha1(input))
        : (() => { throw new Error(`Rewrite crypto: unsupported hash ${this.algorithm}`); })();
    return encoding ? output.toString(encoding) : output;
  }
}

class Cipher {
  private readonly chunks: Buffer[] = [];
  private authTag?: Buffer;

  constructor(
    private readonly algorithm: string,
    private readonly key: Buffer,
    private readonly iv: Buffer | null,
    private readonly decrypting: boolean
  ) {}

  update(value: string | ArrayBuffer | ArrayBufferView, inputEncoding?: BufferEncoding): Buffer {
    this.chunks.push(bytes(value, inputEncoding));
    return Buffer.alloc(0);
  }

  final(outputEncoding?: BufferEncoding): Buffer | string {
    const input = Buffer.concat(this.chunks);
    let output: Uint8Array;
    if (this.algorithm === 'aes-128-cbc') {
      if (!this.iv) throw new Error('Rewrite crypto: CBC requires an IV');
      const instance = cbc(this.key, this.iv);
      output = this.decrypting ? instance.decrypt(input) : instance.encrypt(input);
    } else if (this.algorithm === 'aes-128-ecb') {
      const instance = ecb(this.key);
      output = this.decrypting ? instance.decrypt(input) : instance.encrypt(input);
    } else if (this.algorithm === 'aes-128-gcm') {
      if (!this.iv) throw new Error('Rewrite crypto: GCM requires an IV');
      const instance = gcm(this.key, this.iv);
      if (this.decrypting) {
        if (!this.authTag) throw new Error('Rewrite crypto: GCM auth tag is missing');
        output = instance.decrypt(Buffer.concat([input, this.authTag]));
      } else {
        const encrypted = Buffer.from(instance.encrypt(input));
        this.authTag = encrypted.subarray(encrypted.length - 16);
        output = encrypted.subarray(0, encrypted.length - 16);
      }
    } else {
      throw new Error(`Rewrite crypto: unsupported cipher ${this.algorithm}`);
    }
    const buffer = Buffer.from(output);
    return outputEncoding ? buffer.toString(outputEncoding) : buffer;
  }

  getAuthTag(): Buffer {
    if (!this.authTag) throw new Error('Rewrite crypto: auth tag is not available');
    return Buffer.from(this.authTag);
  }

  setAuthTag(tag: ArrayBuffer | ArrayBufferView): this {
    this.authTag = bytes(tag);
    return this;
  }
}

function modularPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let value = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
}

function bigintFromBytes(value: Uint8Array): bigint {
  const hex = Buffer.from(value).toString('hex');
  return BigInt(`0x${hex || '0'}`);
}

function bigintToBytes(value: bigint, length: number): Buffer {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex.slice(-length * 2), 'hex');
}

function rsaPublicKey(pem: string): { modulus: Buffer; exponent: bigint } {
  const der = Buffer.from(
    pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, ''),
    'base64'
  );
  const marker = Buffer.from([0x02, 0x81, 0x81, 0x00]);
  const modulusOffset = der.indexOf(marker);
  if (modulusOffset < 0) throw new Error('Rewrite crypto: unsupported RSA public key');
  const modulus = der.subarray(modulusOffset + marker.length, modulusOffset + marker.length + 128);
  const exponentMarker = Buffer.from([0x02, 0x03, 0x01, 0x00, 0x01]);
  if (der.indexOf(exponentMarker, modulusOffset + marker.length + 128) < 0) {
    throw new Error('Rewrite crypto: unsupported RSA exponent');
  }
  return { modulus, exponent: 65537n };
}

export const constants = { RSA_NO_PADDING: 3 } as const;

export function createHash(algorithm: string): Hash {
  return new Hash(algorithm);
}

export function createCipheriv(
  algorithm: string,
  key: ArrayBuffer | ArrayBufferView,
  iv: ArrayBuffer | ArrayBufferView | null,
  _options?: unknown
): Cipher {
  return new Cipher(algorithm, bytes(key), iv === null ? null : bytes(iv), false);
}

export function createDecipheriv(
  algorithm: string,
  key: ArrayBuffer | ArrayBufferView,
  iv: ArrayBuffer | ArrayBufferView | null
): Cipher {
  return new Cipher(algorithm, bytes(key), iv === null ? null : bytes(iv), true);
}

export function randomBytes(size: number): Buffer {
  return secureRandom(size);
}

export function randomUUID(): string {
  const value = secureRandom(16);
  value[6] = (value[6] & 0x0f) | 0x40;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function publicEncrypt(
  options: { key: string; padding?: number },
  input: ArrayBuffer | ArrayBufferView
): Buffer {
  if (options.padding !== constants.RSA_NO_PADDING) {
    throw new Error('Rewrite crypto: only RSA_NO_PADDING is supported');
  }
  const { modulus, exponent } = rsaPublicKey(options.key);
  return bigintToBytes(
    modularPow(bigintFromBytes(bytes(input)), exponent, bigintFromBytes(modulus)),
    modulus.length
  );
}

const crypto = {
  constants,
  createHash,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  randomBytes,
  randomUUID
};

export default crypto;
