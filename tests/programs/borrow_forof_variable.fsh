// error: 'row' doesn't live long enough
function* rows(): Generator<string[]> {
  yield ["a" + 1, "x"];
  yield ["b" + 2, "y"];
}
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  for (let row of rows()) {
    h = { r: row };
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  console.log(h.r.length, h.r[0], junk.length);
}
