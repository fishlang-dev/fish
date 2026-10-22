function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let arr = ["a" + 1, "b"];
  let g = each(arr);
  arr.push("c");
  const r = g.next();
  if (r.done === false) console.log(r.value);
}
// error: cannot change 'arr' while 'g' borrows 'arr' and is used later
