// case: ffi_already_defined
declare function abs(n: i32): i32;

function abs(n: i32): i32 {
  return n;
}

function main() {}
// error: 'abs' is already defined
// case: ffi_c_string_block_owns
declare function strlen(s: Ptr<u8>): usize;

function main() {
  const n: i64 = 3;
  const p = match (n) {
    case 1 => cString("one"),
    case _ => cString("other" + n),
  };
  console.log(unsafe { strlen(p) });
  const m = ("x" + 12) |> cString(%) |> unsafe { strlen(%) };
  console.log(m);
  const q = n > 2 ? cString("yes!") : cString("no");
  console.log(unsafe { strlen(q) });
}
// expect: 6
// expect: 3
// expect: 4
// case: ffi_c_string_in_generator
declare function strlen(s: Ptr<u8>): usize;

function* lengths(): Generator<usize> {
  yield unsafe { strlen(cString("abc")) };
}

function main() {
  for (const n of lengths()) console.log(n);
}
// error: 'cString' inside generators are not supported yet
// case: ffi_c_string_loop_exits
declare function strlen(s: Ptr<u8>): usize;

function fail(n: i64): void throws i64 {
  if (n > 0) throw n;
}

function ret(): i64 {
  let i = 0;
  do {
    if (i === 1) return i;
    i++;
  } while (unsafe { strlen(cString("w" + i)) } < 5);
  return -1;
}

function thr(): i64 throws i64 {
  let i = 0;
  do {
    fail(i);
    i++;
  } while (unsafe { strlen(cString("w" + i)) } < 5);
  return -1;
}

function upd(): i64 {
  for (let i = 0; i < 5; i = i + (unsafe { strlen(cString("u")) } as i64)) {
    if (i === 2) return i;
  }
  return -1;
}

function cond(): i64 {
  let i = 0;
  while (unsafe { strlen(cString("w" + i)) } < 5) {
    if (i === 3) return i;
    i++;
  }
  return -1;
}

function main() {
  console.log(ret(), upd(), cond());
  try {
    console.log(thr());
  } catch (e) {
    console.log("caught", e);
  }
}
// expect: 1 2 3
// expect: caught 1
// case: ffi_c_string_nul
declare function strlen(s: Ptr<u8>): usize;

function main() {
  console.log(unsafe { strlen(cString("fine")) });
  console.log(unsafe { strlen(cString("a\0bc")) });
}
// expect: 4
// panic: a string holding NUL can't cross to C
// case: ffi_c_strings
declare function strlen(s: Ptr<u8>): usize;
declare function getenv(name: Ptr<u8>): Ptr<u8>;
declare function strchr(s: Ptr<u8>, c: i32): Ptr<u8>;
declare function setenv(name: Ptr<u8>, value: Ptr<u8>, overwrite: i32): i32;

function length(s: string): usize {
  return unsafe { strlen(cString(s)) };
}

function main() {
  console.log(length("héllo"), length(""), length("a" + "b" + 3));
  const text = "find the comma, here";
  const rest = unsafe { fromCString(strchr(cString(text), 44)) };
  console.log(rest);
  unsafe {
    setenv(cString("FISH_FFI_TEST"), cString("from fish ✓"), 1);
  }
  const value = unsafe { getenv(cString("FISH_FFI_TEST")) };
  console.log(unsafe { fromCString(value) });
  const missing = unsafe { getenv(cString("FISH_FFI_NOT_SET")) };
  console.log(unsafe { missing.isNull() });
  let bad: u8[] = [104, 105, 255, 33, 226, 130, 0];
  console.log(unsafe { fromCString(ptrOf(bad[0])) });
  for (let i = 0; i < 3; i++) {
    const n = unsafe { strlen(cString("x" + i + "!")) };
    console.log(n);
  }
}
// expect: 6 0 3
// expect: , here
// expect: from fish ✓
// expect: true
// expect: hi�!�
// expect: 3
// expect: 3
// expect: 3
// case: ffi_call_c
declare function abs(n: i32): i32;
declare function llabs(n: i64): i64;
declare function sqrt(x: f64): f64;
declare function toupper(c: i32): i32;
declare function memset(at: MutPtr<u8>, value: i32, count: usize): MutPtr<u8>;
declare function adler32(start: u64, data: Ptr<u8>, length: u32): u64;
declare function exit(code: i32): void;
declare function isalpha(c: i32): i32;

function main() {
  const negative: i32 = -7;
  console.log(unsafe { abs(negative) }, unsafe { llabs(-9000000000) }, unsafe { sqrt(2.25) });
  const upper = unsafe { toupper(97) };
  console.log(upper, unsafe { isalpha(upper) } !== 0, unsafe { isalpha(49) } !== 0);
  let bytes: u8[] = [1, 2, 3, 4];
  unsafe {
    memset(mutPtrOf(bytes[1]), 9, 2);
  }
  console.log(bytes[0], bytes[1], bytes[2], bytes[3]);
  const text: u8[] = [87, 105, 107, 105, 112, 101, 100, 105, 97];
  console.log(unsafe { adler32(1, ptrOf(text[0]), 9) });
}
// link: z
// expect: 7 9000000000 1.5
// expect: 65 true false
// expect: 1 9 9 4
// expect: 300286872
// case: ffi_call_outside_unsafe
declare function abs(n: i32): i32;

function main() {
  console.log(abs(-1));
}
// error: calling the C function 'abs' can only happen inside 'unsafe { }': the compiler can't check what C code does
// case: ffi_from_c_string_outside
function main() {
  const p = cString("a");
  console.log(fromCString(p));
}
// error: 'fromCString' can only happen inside 'unsafe { }'
// case: ffi_generator
declare function* abs(n: i32): i32;

function main() {}
// error: a C function can't be a generator
// case: ffi_main
declare function main(): void;
// error: 'main' can't be a C function
// case: ffi_no_return_type
declare function rand();

function main() {}
// error: a C function needs its return type written, 'void' if it returns nothing
// case: ffi_object_result
type P = { x: i64 };
declare function make(): P;

function main() {}
// error: a C function can't return a '{ x: i64 }'; C gives numbers, booleans and raw pointers
// case: ffi_rest_parameter
declare function printf(format: Ptr<u8>, ...rest: i64[]): i32;

function main() {}
// error: variadic C functions are not supported yet
// case: ffi_string_parameter
declare function puts(s: string): i32;

function main() {}
// error: a C function's parameter can't be a 'string'; C takes numbers, booleans and raw pointers like 'Ptr<u8>'
