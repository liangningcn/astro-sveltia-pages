/**
 * Minimal SHA-256 / HMAC-SHA256 implementation.
 *
 * The OAuth state signature must run inside every edge runtime, so the
 * algorithm is implemented in plain JavaScript instead of relying on
 * `crypto.subtle`, which is not guaranteed to exist on all of them.
 */

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
]);

const INITIAL_HASH = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
]);

const BLOCK_SIZE = 64;
const DIGEST_SIZE = 32;

function rotr(value: number, shift: number): number {
    return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/** Computes the SHA-256 digest of the given bytes. */
export function sha256(message: Uint8Array): Uint8Array {
    const bitLength = message.length * 8;
    const paddedLength =
        (Math.floor((message.length + 8) / BLOCK_SIZE) + 1) * BLOCK_SIZE;
    const padded = new Uint8Array(paddedLength);

    padded.set(message);
    padded[message.length] = 0x80;

    const view = new DataView(padded.buffer);

    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);

    const hash = new Uint32Array(INITIAL_HASH);
    const w = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
        for (let index = 0; index < 16; index += 1) {
            w[index] = view.getUint32(offset + index * 4);
        }

        for (let index = 16; index < 64; index += 1) {
            const s0 =
                rotr(w[index - 15], 7) ^
                rotr(w[index - 15], 18) ^
                (w[index - 15] >>> 3);
            const s1 =
                rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);

            w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
        }

        let a = hash[0];
        let b = hash[1];
        let c = hash[2];
        let d = hash[3];
        let e = hash[4];
        let f = hash[5];
        let g = hash[6];
        let h = hash[7];

        for (let index = 0; index < 64; index += 1) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + ch + K[index] + w[index]) >>> 0;
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    const digest = new Uint8Array(DIGEST_SIZE);
    const digestView = new DataView(digest.buffer);

    for (let index = 0; index < 8; index += 1) {
        digestView.setUint32(index * 4, hash[index]);
    }

    return digest;
}

/** Computes HMAC-SHA256 of `message` with `key`. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    let normalizedKey = key;

    if (normalizedKey.length > BLOCK_SIZE) {
        normalizedKey = sha256(normalizedKey);
    }

    const paddedKey = new Uint8Array(BLOCK_SIZE);

    paddedKey.set(normalizedKey);

    const inner = new Uint8Array(BLOCK_SIZE + message.length);
    const outer = new Uint8Array(BLOCK_SIZE + DIGEST_SIZE);

    for (let index = 0; index < BLOCK_SIZE; index += 1) {
        inner[index] = paddedKey[index] ^ 0x36;
        outer[index] = paddedKey[index] ^ 0x5c;
    }

    inner.set(message, BLOCK_SIZE);
    outer.set(sha256(inner), BLOCK_SIZE);

    return sha256(outer);
}

const encoder = new TextEncoder();

/** Computes HMAC-SHA256 of a string and returns the lowercase hex digest. */
export function hmacSha256Hex(secret: string, message: string): string {
    const digest = hmacSha256(encoder.encode(secret), encoder.encode(message));

    return Array.from(digest)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Compares two hex digests without leaking their content through timing.
 *
 * The length check is not constant time, but the digest length is fixed and
 * public, so only the bytes themselves are compared in constant time.
 */
export function timingSafeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) {
        return false;
    }

    let diff = 0;

    for (let index = 0; index < left.length; index += 1) {
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }

    return diff === 0;
}
