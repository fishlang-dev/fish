declare function strlen(s: Ptr<u8>): usize;

function* lengths(): Generator<usize> {
  yield unsafe { strlen(cString("abc")) };
}

function main() {
  for (const n of lengths()) console.log(n);
}
// error: 'cString' inside generators are not supported yet
