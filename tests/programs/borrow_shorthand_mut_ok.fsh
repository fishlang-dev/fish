// expect: 7 3
// A copied Mut used through its holder alone is fine.
function main() {
  let xs: i64[] = [1, 2];
  const m: Mut<i64[]> = xs;
  let r = { m };
  r.m.push(4);
  console.log(r.m[0] + r.m[1] + r.m[2], xs.length);
}
