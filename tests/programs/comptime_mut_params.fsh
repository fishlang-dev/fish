// expect: 101 hi! 3
// expect: 101 hi! 3
// Writes through Mut parameters reach the caller at comptime as at run time.
function poke(m: Mut<i64>) { m += 100; }
function setS(s: Mut<string>) { s = s + "!"; }
function swapArr(a: Mut<i64[]>) { a = [9, 9, 9]; }
type P = { x: i64 };
function t(): string {
  let n = 1;
  poke(n);
  let s = "hi";
  setS(s);
  let a = [1];
  swapArr(a);
  return `${n} ${s} ${a.length}`;
}
function main() { console.log(t()); console.log(comptime t()); }
