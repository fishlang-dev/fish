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
