function main() {
  let n = 0;
  const r = b();
  console.log(r, small(n));
}
function small(x: u8): u8 { return x * 2; }
function b() {
  const f = () => 1;
  return f();
}
// expect: 1 0
