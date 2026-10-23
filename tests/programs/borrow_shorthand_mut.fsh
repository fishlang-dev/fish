// error: cannot use 'm' while a 'for...of' loop borrows 'm' mutably
// A mutable reference copied into an object by shorthand lends itself, as '{ m: m }' does, so
// the loop's borrow through r.m and a use of m can't overlap.
function main() {
  let xs: string[] = ["a", "b"];
  const m: Mut<string[]> = xs;
  const r = { m };
  for (const s of r.m) {
    for (let i = 0; i < 1000; i++) m.push("g" + i);
    console.log(s);
  }
}
