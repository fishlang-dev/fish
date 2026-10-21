function main() {
  const a: u8 = 1;
  const b: usize = 2;
  let n = 0;
  const x = n + a;
  const y = n + b;
}
// error: operator '+' can't mix 'u8' and 'usize'
