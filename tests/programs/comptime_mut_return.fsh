// expect: 11
// expect: 11
// A Mut returned from a function writes through, at comptime too.
function pick(a: Mut<i64>): Mut<i64> { return a; }
function all(): string {
  let x = 1;
  let r = pick(x);
  r += 10;
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
