function small(x: u8): u8 {
  return x + 2;
}

function main() {
  let n = 0;
  console.log(small(n), b());
}

function b() {
  const q: boolean = 5;
  return 1;
}
// error: type 'i64' is not assignable to type 'boolean'
