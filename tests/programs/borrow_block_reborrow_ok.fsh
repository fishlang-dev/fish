// expect: 2
function main() {
  let outer: string[] = [];
  let x: string[] = ["a"];
  const o: Mut<string[]> = outer;
  let h = { m: o };
  {
    const m: Mut<string[]> = x;
    h = { m: m };
  }
  h.m.push("z");
  console.log(h.m.length);
}
