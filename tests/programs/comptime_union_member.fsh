// expect: false true true false
// expect: false true true false
// A value entering a union keeps the member its type says, at comptime as at run time.
function mk(): u8 | i64 { const v: u8 = 5; return v; }
function mkf(): f32 | f64 { const v: f32 = 1.5; return v; }
function show(x: u8 | i64): string {
  const big: i64 = 5;
  const small: u8 = 5;
  return `${x === big} ${x === small}`;
}
function showf(x: f32 | f64): string {
  const a: f32 = 1.5;
  const b: f64 = 1.5;
  return `${x === a} ${x === b}`;
}
function main() {
  console.log(show(mk()), showf(mkf()));
  console.log(show(comptime mk()), showf(comptime mkf()));
}
