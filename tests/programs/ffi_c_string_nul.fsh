declare function strlen(s: Ptr<u8>): usize;

function main() {
  console.log(unsafe { strlen(cString("fine")) });
  console.log(unsafe { strlen(cString("a\0bc")) });
}
// expect: 4
// panic: a string holding NUL can't cross to C
