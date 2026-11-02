// case: crypto_uuid
// expect: true true
// Each UUID is 36 lowercase hex digits and dashes, version 4 and variant 10, and 1000 are distinct.
function isUuid(s: string): boolean {
  if (s.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = s.charCodeAt(i);
    const dash = i === 8 || i === 13 || i === 18 || i === 23;
    if (dash !== (c === 45)) return false;
    if (!dash && !((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return s[14] === "4" && "89ab".includes(s[19]);
}
function main() {
  let seen = new Set<string>();
  let valid = true;
  for (let i = 0; i < 1000; i++) {
    const id = crypto.randomUUID();
    if (!isUuid(id)) valid = false;
    seen.add(id);
  }
  console.log(valid, seen.size === 1000);
}
// case: crypto_fill
// expect: true 65536 true 0
// getRandomValues fills the array in place and gives it back; 65536 bytes hold every byte value.
function main() {
  let bytes: u8[] = new Array(65536).fill(0 as u8);
  const length = crypto.getRandomValues(bytes).length;
  let counts: i64[] = new Array(256).fill(0);
  for (const b of bytes) counts[b as usize] += 1;
  let none: u8[] = [];
  crypto.getRandomValues(none);
  console.log(counts.every((n) => n > 0), length, bytes.length === 65536, none.length);
}
// case: crypto_imports
// expect: 16 0 true true
import { getRandomValues, randomBytes, randomUUID as uuid } from "node:crypto";
import nodeCrypto from "crypto";
function main() {
  let a = randomBytes(16);
  const before = a.join(",");
  getRandomValues(a);
  console.log(a.length, randomBytes(0).length, a.join(",") !== before, uuid() !== nodeCrypto.randomUUID());
}
// case: crypto_quota
// panic: QuotaExceededError: getRandomValues fills at most 65536 bytes a call, not 65537; fill a larger array in pieces
function main() {
  let bytes: u8[] = new Array(65537).fill(0 as u8);
  crypto.getRandomValues(bytes);
}
// case: crypto_negative_size
// panic: randomBytes takes a size of 0 or more, not -1
function main() {
  console.log(crypto.randomBytes(-1).length);
}
// case: crypto_comptime
// error: 'crypto.randomUUID' can't run while compiling; its value would be fixed into the program
function id(): string { return crypto.randomUUID(); }
const ID = comptime id();
function main() { console.log(ID); }
// case: crypto_own_names_in_comptime
// expect: mine 3
// A program's own functions named like std's run while compiling as any function does.
function randomUUID(): string { return "mine"; }
function randomBytes(n: i64): i64 { return n; }
const ID = comptime randomUUID();
const N = comptime randomBytes(3);
function main() { console.log(ID, N); }
// case: crypto_unknown_member
// error: 'node:crypto' has no export named 'createHash'; it has 'getRandomValues', 'randomBytes', 'randomUUID'
import crypto from "node:crypto";
function main() {
  console.log(crypto.createHash("sha256"));
}
// case: crypto_sha
// expect: a9993e364706816aba3e25717850c26c9cd0d89d
// expect: da39a3ee5e6b4b0d3255bfef95601890afd80709
// expect: 84983e441c3bd26ebaae4aa1f95129e5e54670f1
// expect: 34aa973cd4c4daa4f61eeb2bdbad27316534016f
// expect: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
// expect: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
// expect: 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1
// expect: cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0
// expect: 20 32 true
// FIPS 180's vectors: "abc", the empty message, the 448-bit message, and a million "a"s.
function main() {
  const two = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  const million = new TextEncoder().encode("a".repeat(1000000));
  console.log(crypto.sha1("abc").toHex());
  console.log(crypto.sha1("").toHex());
  console.log(crypto.sha1(two).toHex());
  console.log(crypto.sha1(million.clone()).toHex());
  console.log(crypto.sha256("abc").toHex());
  console.log(crypto.sha256([]).toHex());
  console.log(crypto.sha256(two).toHex());
  console.log(crypto.sha256(million).toHex());
  console.log(crypto.sha1("x").length, crypto.sha256("x").length, crypto.sha256("é").toHex() === crypto.sha256(new TextEncoder().encode("é")).toHex());
}
// case: crypto_hmac
// expect: b617318655057264e28bc0b6fb378c8ef146be00
// expect: effcdf6ae5eb2fa2d27416d5f184df9c259a7c79
// expect: aa4ae5e15272d00e95705637ce8a3b55ed402112
// expect: b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
// expect: 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
// expect: 60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54
// expect: 20 32
// RFC 2202's cases 1, 2 and 6 for SHA-1 and RFC 4231's cases 1, 2 and 6 for SHA-256; case 6 keys
// are longer than a block, so they're hashed first.
function main() {
  const key: u8[] = new Array(20).fill(0x0b as u8);
  const long: u8[] = new Array(80).fill(0xaa as u8);
  const longer: u8[] = new Array(131).fill(0xaa as u8);
  console.log(crypto.hmac("sha1", key.clone(), "Hi There").toHex());
  console.log(crypto.hmac("sha1", "Jefe", "what do ya want for nothing?").toHex());
  console.log(crypto.hmac("sha1", long, "Test Using Larger Than Block-Size Key - Hash Key First").toHex());
  console.log(crypto.hmac("sha256", key, "Hi There").toHex());
  console.log(crypto.hmac("sha256", "Jefe", new TextEncoder().encode("what do ya want for nothing?")).toHex());
  console.log(crypto.hmac("sha256", longer, "Test Using Larger Than Block-Size Key - Hash Key First").toHex());
  console.log(crypto.hmac("sha1", "", "").length, crypto.hmac("sha256", [], []).length);
}
// case: crypto_hash
// expect: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
// expect: qZk+NkcGgWq6PiVxeFDCbJzQ2J0=
// expect: 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU true
// Node's crypto.hash: hex by default, then base64, and unpadded base64url, here as imports.
import { hash, sha256 } from "node:crypto";
function main() {
  console.log(hash("sha256", "abc"));
  console.log(hash("sha1", new TextEncoder().encode("abc"), "base64"));
  console.log(hash("sha256", "", "base64url"), hash("sha256", "x", "hex") === sha256("x").toHex());
}
// case: crypto_hash_algorithm
// error: argument of type '"md5"' is not assignable to parameter of type '"sha1" | "sha256"'
import { hash } from "node:crypto";
function main() {
  console.log(hash("md5", "abc"));
}
// case: crypto_block_edges
// expect: 55 c1c8bbdc22796e28c0e15163d20899b65621d65a 9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318
// expect: 56 c2db330f6083854c99d4b5bfb6e8f29f201be699 b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a
// expect: 63 03f09f5b158a7a8cdad920bddc29b81c18a551f5 7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34
// expect: 64 0098ba824b5c16427bd7a1122a5a442a25ec644d ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb
// expect: 65 11655326c708d70319be2610e8a57d9a5b959d3b 635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0
// expect: 64 9c6d8ea88eaae0dda58c8f4a0f8e9a190edc28e4 ce3c639dcb9d8baae5d44c3b8b5e233faab4d1860e07489af5c84f213998bd79
// expect: 65 349e9189de217e47242c1aaa2acfe9084d584f3f c2b9a0a013df029c7d812c5ac18388feef0194ee64fcc5f321d149c06137caa3
// Messages around where the length no longer fits the last block, and HMAC keys of exactly one
// block and one byte more, which is hashed; expected values are node:crypto's.
function main() {
  for (const n of [55, 56, 63, 64, 65]) {
    const data: u8[] = new Array(n).fill(0x61 as u8);
    console.log(n, crypto.sha1(data.clone()).toHex(), crypto.sha256(data).toHex());
  }
  for (const n of [64, 65]) {
    const key: u8[] = new Array(n).fill(0xaa as u8);
    console.log(n, crypto.hmac("sha1", key.clone(), "x").toHex(), crypto.hmac("sha256", key, "x").toHex());
  }
}
