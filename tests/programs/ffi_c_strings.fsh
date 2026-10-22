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
// expect: hi�!��
// expect: 3
// expect: 3
// expect: 3
