// expect: 3 c
// A holder declared in a block may borrow its locals, and an outer value lent inside a block is
// free again after it.
function main() {
  let outer: string[] = ["a"];
  {
    let x: string[] = ["b"];
    const m: Mut<string[]> = x;
    let inner = { m };
    inner.m.push("c");
    const o: Mut<string[]> = outer;
    o.push(x[1]);
  }
  const p: Mut<string[]> = outer;
  p.push("d");
  console.log(outer.length, outer[1]);
}
