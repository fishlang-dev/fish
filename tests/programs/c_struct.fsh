// `@c` classes laid out as C structs, passed to and returned from C by value and by pointer.
// case: c_struct_returned
@c
class Div {
  quot: i32 = 0;
  rem: i32 = 0;
}

@c
class LongDiv {
  quot: i64 = 0;
  rem: i64 = 0;
}

declare function div(n: i32, d: i32): Div;
declare function lldiv(n: i64, d: i64): LongDiv;

function main() {
  const d = unsafe { div(17, 5) };
  console.log(d.quot, d.rem);
  const l = unsafe { lldiv(-9000000000, 7) };
  console.log(l.quot, l.rem);
}
// expect: 3 2
// expect: -1285714285 -5
// case: c_struct_passed
@c
class InAddr {
  address: u32 = 0;
}

declare function inet_ntoa(a: InAddr): Ptr<u8>;

function main() {
  let a = new InAddr();
  a.address = 16777343;
  console.log(unsafe { fromCString(inet_ntoa(a)) });
}
// expect: 127.0.0.1
// case: c_struct_pointer
@c
class Tm {
  sec: i32 = 0;
  min: i32 = 0;
  hour: i32 = 0;
  mday: i32 = 0;
  mon: i32 = 0;
  year: i32 = 0;
  wday: i32 = 0;
  yday: i32 = 0;
  isdst: i32 = 0;
  gmtoff: i64 = 0;
  zone: Ptr<u8> = unsafe { nullPtr<u8>() };
}

declare function gmtime_r(t: Ptr<i64>, out: MutPtr<Tm>): MutPtr<Tm>;

function main() {
  const t: i64 = 86400 * 365 + 3600 * 5;
  let tm = new Tm();
  unsafe {
    gmtime_r(ptrOf(t), mutPtrOf(tm));
  }
  console.log(tm.year + 1900, tm.mon, tm.mday, tm.hour, tm.yday);
}
// expect: 1971 0 1 5 0
// case: c_struct_fixed_array_field
@c
class Inner {
  x: i16 = 5;
}

@c
class Buf {
  bytes: FixedArray<u8, 4> = [1, 2, 3, 4];
  inner: Inner = new Inner();
  n: i32 = 7;
}

declare function memset(at: MutPtr<Buf>, value: i32, count: usize): MutPtr<Buf>;

function main() {
  let b = new Buf();
  unsafe {
    memset(mutPtrOf(b), 0, 4);
  }
  console.log(b.bytes[0], b.bytes[3], b.inner.x, b.n);
}
// expect: 0 0 5 7
// case: c_struct_string_field
@c
class Named {
  name: string = "";
}

function main() {}
// error: a '@c' struct's field can't be a 'string'; C structs hold numbers, booleans, raw pointers, fixed-size arrays of those and other '@c' structs
// case: c_struct_plain_class_field
class Plain {
  x: i32 = 0;
}

@c
class Holder {
  plain: Plain = new Plain();
}

function main() {}
// error: a '@c' struct's field can't be a 'Plain'
// case: c_struct_extends
class Base {
  x: i32 = 0;
}

@c
class Child extends Base {}

function main() {}
// error: a '@c' struct can't extend a class
// case: c_struct_generic
@c
class Box<T> {
  x: i32 = 0;
}

function main() {}
// error: a '@c' struct can't be generic
// case: c_struct_on_function
@c
function f() {}

function main() {}
// error: '@c' applies to a class
// case: c_struct_plain_class_by_value
class Plain {
  x: i32 = 0;
}

declare function take(p: Plain): void;

function main() {}
// error: a C function's parameter can't be a 'Plain'; C takes numbers, booleans, raw pointers like 'Ptr<u8>' and '@c' structs
