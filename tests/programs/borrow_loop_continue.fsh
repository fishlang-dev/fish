// error: 'x' doesn't live long enough
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  for (let i = 0; i < 3; i++) {
    let junk: string[] = [];
    for (let j = 0; j < 50; j++) junk.push("junk" + j);
    console.log(h.r.length, h.r[0]);
    let x: string[] = ["a" + i, "b"];
    h = { r: x };
    continue;
  }
}
