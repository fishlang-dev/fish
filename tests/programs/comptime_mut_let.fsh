// expect: 6
// expect: 6
// A Mut kept in a variable writes through, at comptime too.
function all(): string {
  let x = 1;
  let r: Mut<i64> = x;
  r += 5;
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
