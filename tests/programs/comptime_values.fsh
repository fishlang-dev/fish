// expect: 75025 n5:-------01234 3.75 200 ABC 1024
// expect: 75025 n5:-------01234 3.75 200 ABC 1024
// `comptime` runs ordinary code while compiling and bakes its value; the same code at run time
// gives the same values.
function fib(n: i64): i64 {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

function label(n: i64): string {
  let s = "";
  for (let i = 0; i < n; i++) s = s + String(i);
  return `n${n}:` + s.padStart(12, "-");
}

function main() {
  const f = comptime fib(25);
  const l = comptime label(5);
  const half = comptime 7.5 / 2;
  const big: u8 = comptime 200;
  console.log(f, l, half, big, comptime "abc".toUpperCase(), comptime 1 << 10);
  const small: u8 = 200;
  console.log(fib(25), label(5), 7.5 / 2, small, "abc".toUpperCase(), 1 << 10);
}
