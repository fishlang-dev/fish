// expect: 11
// expect: 11
// A Mut field of a record retagged for a union field keeps writing through.
type R = { m: Mut<i64>; v: u8 | i64 };
function small(): u8 { return 5; }
function all(): string {
  let x = 1;
  let r: R = { m: x, v: small() };
  r.m += 10;
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
