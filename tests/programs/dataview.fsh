// case: dataview_float_bits
// expect: 0x3FF8000000000000 0x3FB999999999999A
// A float's bits read back as an integer, as the compiler writes an LLVM float constant.
function floatConstant(value: f64): string {
  let view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return `0x${view.getBigUint64(0).toString(16).toUpperCase().padStart(16, "0")}`;
}
function main() {
  console.log(floatConstant(1.5), floatConstant(0.1));
}
// case: dataview_widths
// expect: 3452750909 1036831949 -559038737 -2 -2 65279 -1 200 0.10000000149011612
// expect: -5n 18446744073709551611n -288230376151711745n
// expect: -2.5 16 0
// expect: DataView {
// expect:   byteLength: 2,
// expect:   byteOffset: 0,
// expect:   buffer: ArrayBuffer { [Uint8Contents]: <00 00>, byteLength: 2 }
// expect: }
// expect: 3 1 Uint8Array(4) [ 0, 0, 0, 7 ]
// Each width in either byte order, big-endian unless told otherwise, matching Node.
function main() {
  let v = new DataView(new ArrayBuffer(16), 0, 16);
  v.setUint32(0, 0xdeadbeef);
  v.setUint32(4, 0xdeadbeef, true);
  v.setInt16(8, -2);
  v.setInt16(10, -2, true);
  v.setInt8(12, -1);
  v.setUint8(13, 200);
  v.setFloat32(0, 0.1, true);
  console.log(v.getUint32(0), v.getUint32(0, true), v.getInt32(4, true), v.getInt16(8), v.getInt16(10, true), v.getUint16(10), v.getInt8(12), v.getUint8(13), v.getFloat32(0, true));
  v.setBigInt64(8, -5n, true);
  console.log(v.getBigInt64(8, true), v.getBigUint64(8, true), v.getBigInt64(8));
  v.setFloat64(0, -2.5, true);
  console.log(v.getFloat64(0, true), v.byteLength, v.byteOffset);
  console.log(new DataView(new ArrayBuffer(2)));
  let w = new DataView(new ArrayBuffer(4), 1);
  w.setUint8(2, 7);
  console.log(w.byteLength, w.byteOffset, new Uint8Array(w.buffer));
}
// case: dataview_out_of_bounds
// panic: RangeError: Offset is outside the bounds of the DataView
function main() {
  const w = new DataView(new ArrayBuffer(4), 1);
  console.log(w.getUint32(0));
}
// case: dataview_bad_offset
// panic: RangeError: Start offset 5 is outside the bounds of the buffer
function main() {
  const w = new DataView(new ArrayBuffer(4), 5);
  console.log(w.byteLength);
}
