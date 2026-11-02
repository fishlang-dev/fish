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
