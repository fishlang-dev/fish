function* names(list: string[]): Generator<string> {
  for (const n of list) yield n + "!";
}
function main() {
  let xs = ["a" + 1, "b"];
  let g = names(xs.clone());
  xs.push("c");
  let h = g;
  const r = h.next();
  if (r.done === false) console.log(r.value);
  let arr = [names(["z" + 1])];
  const f = () => 1;
}
// expect: a1!
