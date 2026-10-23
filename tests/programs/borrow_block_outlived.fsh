// error: 'x' doesn't live long enough: 'h' still borrows it after its block ends
// A borrow of a block's local can't be kept by a variable from outside the block past its end.
function main() {
  let outer: string[] = [];
  const o: Mut<string[]> = outer;
  let h = { m: o };
  {
    let x: string[] = ["a"];
    const m: Mut<string[]> = x;
    h = { m: m };
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  for (let i = 0; i < 1000; i++) h.m.push("g" + i);
  console.log(h.m.length, junk.length, outer.length);
}
