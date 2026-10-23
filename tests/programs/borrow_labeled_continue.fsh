// error: 'x' doesn't live long enough
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  outerLoop: for (let i = 0; i < 3; i++) {
    console.log(h.r.length, h.r[0]);
    for (let j = 0; j < 2; j++) {
      let x: string[] = ["a" + i, "b"];
      h = { r: x };
      continue outerLoop;
    }
  }
}
