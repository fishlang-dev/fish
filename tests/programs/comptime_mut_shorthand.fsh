// expect: 6 17
// expect: 6 17
// A Mut given to a field by shorthand keeps writing through, at comptime too.
type H = { m: Mut<i64> };
type X = { x: Mut<i64> };
function viaParam(m: Mut<i64>) { let h: H = { m }; h.m += 5; }
function all(): string {
  let a = 1;
  viaParam(a);
  let x = 10;
  let hx: X = { x: x };
  hx.x += 7;
  return `${a} ${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
