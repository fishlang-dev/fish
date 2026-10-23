// expect: 6 t
// expect: 6 t
// A Mut field bound by a match pattern writes through to what it points at.
type R = { m: Mut<i64>; tag: string };
function all(): string {
  let x = 1;
  let r: R = { m: x, tag: "t" };
  const label = match (r) { case { m, tag } => { m += 5; return tag; } };
  return `${x} ${label}`;
}
function main() { console.log(all()); console.log(comptime all()); }
