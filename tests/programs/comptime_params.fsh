// expect: ababab ababababab xx yyy
// expect: HI! hi
// expect: 210 315
// expect: zzz
// A comptime parameter is given while compiling: each value makes an instance in which the
// parameter is a constant, that comptime code reads too.
enum Mode { Plain, Loud }
const TIMES = 2;
function repeat(comptime n: i64, s: string): string {
  comptime {
    if (n < 1) throw new IoError("repeat needs at least one");
  }
  let out = "";
  for (let i = 0; i < n; i++) out = out + s;
  return out;
}
function shout(comptime mode: Mode, s: string): string {
  return mode === Mode.Loud ? s.toUpperCase() + "!" : s;
}
function scaled(comptime k: i64, x: i64): i64 {
  const table = comptime k * 100;
  return x * k + table;
}
function count(): i64 { return later() + 1; }
function later(): i64 { return 2; }
function main() {
  console.log(repeat(3, "ab"), repeat(5, "ab"), repeat(TIMES, "x"), repeat(comptime TIMES + 1, "y"));
  console.log(shout(Mode.Loud, "hi"), shout(Mode.Plain, "hi"));
  console.log(scaled(2, 5), scaled(3, 5));
  console.log(repeat(comptime count(), "z"));
}
