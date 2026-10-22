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
