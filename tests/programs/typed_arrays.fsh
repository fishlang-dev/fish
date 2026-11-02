// case: typed_array_types
// expect: 3
// expect: Uint8Array(2) [ 4, 5 ] Float64Array(2) [ 1.5, 2 ] [ 4, 5 ] 2
// expect: { inner: { deep: { a: [Uint8Array] } } }
// expect: Int32Array(0) [] [ Uint8Array(2) [ 4, 5 ] ]
// expect: Float32Array(2) [ 0.10000000149011612, 1.0000000200408773e+21 ]
// expect: { a: { b: Int32Array(0) [] } } { a: { b: { c: Int32Array(0) [] } } }
// expect: Uint8Array(2) [ 4, 5 ] Uint8Array(2) [ 4, 5 ]
// expect: Int8Array(1) [ -1 ] Uint16Array(1) [ 65535 ] Int16Array(1) [ -2 ] Uint32Array(1) [ 4294967295 ]
// A typed array holds its sized element, prints under its name as Node prints it, and fits the
// plain array of its element both ways.
function total(a: Uint8Array): u8 {
  return a[0] + a[1];
}
function plain(a: u8[]): u8[] {
  return a;
}
function main() {
  const bytes: u8[] = [1, 2, 3];
  console.log(total(bytes));
  const a: Uint8Array = [4, 5];
  const f: Float64Array = [1.5, 2];
  console.log(a, f, [4, 5], a.length);
  console.log({ inner: { deep: { a: a.clone() } } });
  const e: Int32Array = [];
  console.log(e, [a.clone()]);
  const g: Float32Array = [0.1, 1e21];
  console.log(g);
  console.log({ a: { b: e.clone() } }, { a: { b: { c: e } } });
  const back: Uint8Array = plain(a.clone());
  console.log(back, a);
  const i8s: Int8Array = [-1];
  const u16s: Uint16Array = [65535];
  const i16s: Int16Array = [-2];
  const u32s: Uint32Array = [4294967295];
  console.log(i8s, u16s, i16s, u32s);
}
// case: typed_array_long
// expect: Uint8Array(101) [
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
// expect:   0, 0, 0, 0,
// expect:   ... 1 more item
// expect: ]
function main() {
  const z: Uint8Array = new Array(101).fill(0 as u8);
  console.log(z);
}
// case: array_buffer_print
// expect: ArrayBuffer { [Uint8Contents]: <00 00 00>, byteLength: 3 } ArrayBuffer { [Uint8Contents]: <01 02 ff>, byteLength: 3 }
// expect: ArrayBuffer {
// expect:   [Uint8Contents]: <00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ... 2 more bytes>,
// expect:   byteLength: 102
// expect: }
// expect: [ ArrayBuffer { [Uint8Contents]: <01 02 ff>, byteLength: 3 } ] { x: { y: { z: [ArrayBuffer] } } }
// expect: ArrayBuffer { [Uint8Contents]: <>, byteLength: 0 }
// An ArrayBuffer prints its first 100 bytes in hex, as Node prints one.
function main() {
  const b: ArrayBuffer = [0, 0, 0];
  const c: ArrayBuffer = [1, 2, 255];
  console.log(b, c);
  const big: ArrayBuffer = new Array(102).fill(0 as u8);
  console.log(big);
  console.log([c.clone()], { x: { y: { z: c } } });
  const empty: ArrayBuffer = [];
  console.log(empty);
}
// case: typed_array_type_args
// error: 'Uint8Array' takes no type arguments
function main() {
  const a: Uint8Array<u8> = [1];
}
// case: typed_array_own_class
// expect: mine
// A program's own class of a typed array's name keeps the name.
class Uint8Array { name: string = "mine"; }
function main() {
  const a: Uint8Array = new Uint8Array();
  console.log(a.name);
}
// case: typed_array_constructors
// expect: Uint8Array(4) [ 0, 0, 0, 0 ] Uint8Array(3) [ 1, 2, 255 ] Float64Array(3) [ 0, 0, 0 ] Uint8Array(3) [ 1, 2, 255 ] Int32Array(0) []
// expect: ArrayBuffer { [Uint8Contents]: <00 00 00 00>, byteLength: 4 }
// expect: Uint32Array(2) [ 1, 2 ] Uint16Array(2) [ 1027, 1541 ]
// expect: Uint8Array(2) [ 1, 2 ] Uint8Array(2) [ 3, 4 ] Float64Array(2) [ 2.25, 3.75 ] 4 8
// The forms JavaScript's constructors take: a length, an array to copy, or an ArrayBuffer read in
// the host's byte order, little-endian, from an offset; and from, of and BYTES_PER_ELEMENT.
function main() {
  const a = new Uint8Array(4);
  const b = new Uint8Array([1, 2, 255]);
  const c = new Float64Array(b.length);
  const d = new Uint8Array(b);
  const e = new Int32Array();
  console.log(a, b, c, d, e);
  console.log(new ArrayBuffer(4));
  const raw: ArrayBuffer = [1, 0, 0, 0, 2, 0, 0, 0];
  const raw2: ArrayBuffer = [1, 2, 3, 4, 5, 6, 7, 8];
  console.log(new Uint32Array(raw), new Uint16Array(raw2, 2, 2));
  console.log(Uint8Array.from([1, 2]), Uint8Array.of(3, 4), Float64Array.from([1.5, 2.5], (x) => x * 1.5), Uint32Array.BYTES_PER_ELEMENT, Float64Array.BYTES_PER_ELEMENT);
}
// case: typed_array_members
// expect: 8 0 4 ArrayBuffer {
// expect:   [Uint8Contents]: <01 00 00 00 02 00 00 00>,
// expect:   byteLength: 8
// expect: }
// expect: Uint8Array(8) [
// expect:   2, 255, 0, 1,
// expect:   2,   0, 0, 0
// expect: ] Uint8Array(2) [ 0, 1 ] Uint8Array(2) [ 0, 0 ] false 260
// expect: Uint8Array(8) [
// expect:   2, 255, 0, 1,
// expect:   2,   0, 0, 0
// expect: ] Uint8Array(2) [ 9, 1 ]
// expect: hi 3 ArrayBuffer { [Uint8Contents]: <01 02>, byteLength: 2 }
// subarray copies as slice does, so a write to it leaves the array it came from as it was; set
// copies elements in at an offset.
function main() {
  const w: Uint32Array = [1, 2];
  console.log(w.byteLength, w.byteOffset, w.BYTES_PER_ELEMENT, w.buffer);
  const b = new Uint8Array([1, 2, 255]);
  let h = new Uint8Array(8);
  h.set([1, 2], 3);
  h.set(b.subarray(1));
  console.log(h, h.subarray(2, 4), h.slice(-2), h.every((x) => x === 0), h.reduce((s, x) => s + (x as i64), 0));
  let s = h.subarray(2, 4);
  s[0] = 9;
  console.log(h, s);
  const raw: ArrayBuffer = [1, 2, 3];
  console.log(new TextDecoder().decode(new Uint8Array([104, 105]).subarray(0, 2)), raw.byteLength, raw.slice(0, 2));
}
// case: typed_array_from_buffer_moves
// error: 'buf' was moved, so it can't be used here
// A typed array made over an ArrayBuffer takes it, so a write through one can't go unseen by the other.
function main() {
  let buf = new ArrayBuffer(4);
  const a = new Uint8Array(buf);
  console.log(a, buf);
}
// case: typed_array_element_mismatch
// error: 'new Uint8Array' copies elements of type 'u8', not 'number'; convert them first, as in 'xs.map((x) => x as u8)'
function main() {
  const xs: f64[] = [1, 2];
  const a = new Uint8Array(xs);
}
// case: typed_array_bad_argument
// error: 'new Uint8Array' takes a length, an array to copy, or an ArrayBuffer with an optional byte offset and length
function main() {
  const a = new Uint8Array("x");
}
// case: typed_array_buffer_length
// panic: RangeError: byte length of Uint16Array should be a multiple of 2
function main() {
  const raw: ArrayBuffer = [1, 2, 3];
  const a = new Uint16Array(raw);
  console.log(a);
}
// case: typed_array_set_out_of_bounds
// panic: RangeError: offset is out of bounds
function main() {
  let a = new Uint8Array(2);
  a.set([1, 2, 3], 1);
}
// case: typed_array_negative_length
// panic: RangeError: Invalid typed array length: -1
function main() {
  const n = -1;
  const a = new Uint8Array(n);
  console.log(a);
}
// case: typed_array_property_write
// error: a typed array's 'byteLength' can't be set
function main() {
  let a = new Uint8Array(2);
  a.byteLength = 3;
}
// case: typed_array_static
// error: 'ArrayBuffer' has no static 'isView'
function main() {
  const b = Uint8Array.from([1, 2]);
  console.log(ArrayBuffer.isView(b));
}
// case: typed_array_usize_positions
// expect: Uint8Array(4) [ 0, 104, 105, 0 ] Uint8Array(2) [ 104, 105 ] Uint8Array(2) [ 2, 3 ] Uint8Array(1) [ 0 ]
// Positions may be an i64 or a usize, as the compiler's own byte handling holds them.
function main() {
  const at: usize = 1;
  const n: usize = 2;
  let h = new Uint8Array(4);
  h.set(new TextEncoder().encode("hi"), at);
  const raw: ArrayBuffer = [1, 2, 3, 4];
  console.log(h, h.subarray(at, at + n), new Uint8Array(raw, at, n), h.subarray(-1));
}
