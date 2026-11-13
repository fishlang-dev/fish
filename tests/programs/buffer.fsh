// case: buffer_from_and_print
// expect: <Buffer 68 c3 a9 6c 6c 6f> <Buffer 01 02 ff> <Buffer > <Buffer ab> <Buffer 68 69> <Buffer 68 69 3e ff> <Buffer e9 13> <Buffer e9>
// expect: <Buffer > [ <Buffer 68 69> ] { a: { b: { c: <Buffer 78> } } }
// expect: <Buffer 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ... 1 more byte>
// Text in each encoding and bytes, printed as Node prints a Buffer at any depth. Hex stops at the
// first pair that isn't hex, and base64 takes either alphabet.
function main() {
  console.log(Buffer.from("héllo"), Buffer.from([1, 2, 255]), Buffer.from("zz12ab", "hex"), Buffer.from("abc", "hex"), Buffer.from("aGk=\n", "base64"), Buffer.from("aGk-_w", "base64url"), Buffer.from("é✓", "latin1"), Buffer.from("é", "ascii"));
  console.log(Buffer.alloc(0), [Buffer.from("hi")], { a: { b: { c: Buffer.from("x") } } });
  console.log(Buffer.alloc(51));
}
// case: buffer_to_string
// expect: héllo ✓ héllo ✓ 68c3a96c6c6f20e29c93 aMOpbGxvIOKckw== aMOpbGxvIOKckw
// expect: héÈ hiH héÈ
// expect: é 68c3 true 9c93
function main() {
  const x = Buffer.from("héllo ✓");
  console.log(x.toString(), x.toString("utf-8"), x.toString("hex"), x.toString("base64"), x.toString("base64url"));
  const y = Buffer.from([104, 233, 200]);
  console.log(y.toString("latin1"), y.toString("ascii"), y.toString("binary"));
  console.log(x.toString("utf8", 1, 3), x.toString("hex", -2, 2), x.toString("hex", 4, 1) === "", x.toString("hex", 8, 100));
}
// case: buffer_statics
// expect: <Buffer 00 00 00> 2 <Buffer 01 01> <Buffer 61 62 63> <Buffer 61 62> <Buffer 61 00 00> <Buffer >
// expect: 10 2 2 -1 1 0
function main() {
  const none: Buffer[] = [];
  console.log(Buffer.alloc(3), Buffer.allocUnsafe(2).length, Buffer.alloc(2, 257), Buffer.concat([Buffer.from("a"), Buffer.from("bc")]), Buffer.concat([Buffer.from("abc")], 2), Buffer.concat([Buffer.from("a")], 3), Buffer.concat(none));
  console.log(Buffer.byteLength("héllo ✓"), Buffer.byteLength(Buffer.from([1, 2])), Buffer.byteLength("ab", "utf8"), Buffer.compare(Buffer.from([1]), Buffer.from([2])), Buffer.compare(Buffer.from([1, 2]), Buffer.from([1])), Buffer.compare(Buffer.from("a"), Buffer.from("a")));
}
// case: buffer_methods
// expect: true false -1 2 -1 1 true false 6 true
// expect: ab cd 8 97
// equals, compare, and indexOf and includes finding text as well as a byte.
function main() {
  const b = Buffer.from("ab\r\n\r\ncd");
  console.log(b.equals(Buffer.from("ab\r\n\r\ncd")), b.equals(Buffer.from("ab")), b.compare(Buffer.from("b")), b.indexOf("\r\n\r\n"), b.indexOf("cd", 7), b.indexOf("b", -8), b.includes("cd"), b.includes("zz"), b.indexOf(99), b.includes(97));
  console.log(b.subarray(0, 2).toString("ascii"), b.slice(6).toString(), b.length, b[0]);
}
// case: buffer_reads
// expect: 255 1 -1 513 258 513 258 -1 -255
// expect: 67305985 16909060 4294967295 4294902018 -1 -65278
// expect: 289077008695033855n 18446744069431493380n 289077008695033855n 18446744069431493380n 289077008695033855n -4278058236n
// expect: 1 4.600602988224807e-41 1 0.0078125
function main(): void throws RangeError {
  const r = Buffer.from([255, 255, 255, 255, 1, 2, 3, 4]);
  console.log(r.readUInt8(), r.readUint8(4), r.readInt8(0), r.readUInt16LE(4), r.readUInt16BE(4), r.readUint16LE(4), r.readUint16BE(4), r.readInt16LE(2), r.readInt16BE(3));
  console.log(r.readUInt32LE(4), r.readUInt32BE(4), r.readUint32LE(0), r.readUint32BE(2), r.readInt32LE(0), r.readInt32BE(2));
  console.log(r.readBigUInt64LE(0), r.readBigUInt64BE(), r.readBigUint64LE(0), r.readBigUint64BE(0), r.readBigInt64LE(0), r.readBigInt64BE(0));
  const f = Buffer.from([0x3f, 0x80, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f]);
  console.log(f.readFloatBE(0), f.readFloatLE(0), f.readDoubleLE(2), f.readDoubleBE(0));
}
// case: buffer_read_errors
// expect: RangeError ERR_OUT_OF_RANGE The value of "offset" is out of range. It must be >= 0 and <= 4. Received 5
// expect: RangeError ERR_OUT_OF_RANGE The value of "offset" is out of range. It must be >= 0 and <= 7. Received 8
// expect: RangeError ERR_OUT_OF_RANGE The value of "offset" is out of range. It must be >= 0 and <= 6. Received -1
// expect: RangeError ERR_BUFFER_OUT_OF_BOUNDS Attempt to access memory outside buffer bounds
// expect: RangeError ERR_BUFFER_OUT_OF_BOUNDS Attempt to access memory outside buffer bounds
function show(e: RangeError) {
  console.log(e.name, e.code, e.message);
}
function main() {
  const r = Buffer.from([255, 255, 255, 255, 1, 2, 3, 4]);
  try { r.readUInt32LE(5); } catch (e) { show(e); }
  try { r.readUInt8(8); } catch (e) { show(e); }
  try { r.readInt16BE(-1); } catch (e) { show(e); }
  try { Buffer.alloc(4).readBigInt64LE(0); } catch (e) { show(e); }
  try { Buffer.alloc(0).readUInt8(); } catch (e) { show(e); }
}
// case: buffer_std_apis
// expect: written 7 3 td
// expect: 32 16 <Buffer 01 02>
// A Buffer passes where std takes a u8[], and std's bytes come back as one.
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
function count(bytes: Ref<u8[]>): usize {
  return bytes.length;
}
function main(): void throws IoError {
  const dir = mkdtempSync(join(tmpdir(), "fish-buffer-"));
  const path = join(dir, "b.txt");
  writeFileSync(path, Buffer.from("written"));
  const back: Buffer = readFileSync(path);
  rmSync(dir, { recursive: true });
  console.log(back.toString(), count(back), count(Buffer.from([1, 2, 3])), new TextDecoder().decode(Buffer.from("td")));
  const plain: u8[] = [1, 2];
  const wrapped: Buffer = plain;
  console.log(randomBytes(16).toString("hex").length, randomBytes(16).length, wrapped);
}
// case: buffer_import_bare
// expect: <Buffer 68 69>
import { Buffer } from "buffer";
function main() {
  const b: Buffer = Buffer.from("hi");
  console.log(b);
}
// case: buffer_unknown_encoding
// error: Buffer has no encoding 'utf16le' here; use one of 'utf8', 'utf-8', 'hex', 'base64', 'base64url', 'latin1', 'binary', 'ascii'
function main() {
  console.log(Buffer.from("hi").toString("utf16le"));
}
// case: buffer_encoding_not_known
// error: argument of type 'string' is not assignable to parameter of type
function main() {
  const encoding: string = "hex";
  console.log(Buffer.from("hi", encoding));
}
// case: buffer_refused_method
// error: 'buf.writeUInt32BE' isn't supported yet; a Buffer has toString, equals, compare and the read methods, and the methods of a Uint8Array
function main() {
  let b = Buffer.alloc(4);
  b.writeUInt32BE(1, 0);
}
// case: buffer_refused_static
// error: 'Buffer.isBuffer' isn't supported yet; Buffer has from, alloc, allocUnsafe, concat, byteLength, compare
function main() {
  console.log(Buffer.isBuffer(Buffer.alloc(1)));
}
// case: buffer_bytes_with_encoding
// error: 'Buffer.from' takes an encoding only with a string; bytes are copied as they are
function main() {
  console.log(Buffer.from([1], "hex"));
}
// case: buffer_read_must_be_handled
// error: 'main' must declare 'throws RangeError'
function main() {
  console.log(Buffer.from([1]).readUInt8(0));
}
// case: buffer_import_renamed
// error: Buffer is a global, so import it under its own name, as in 'import { Buffer } from "node:buffer"'
import { Buffer as B } from "node:buffer";
function main() {}
// case: buffer_import_other
// error: 'node:buffer' has no export named 'Blob'
import { Blob } from "node:buffer";
function main() {}
