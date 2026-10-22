function* refs(xs: string[]): Generator<Ref<string>> {
  for (const x of xs) yield x;
}
function main() {
  let g = refs(["a" + 1, "b" + 2]);
  const r = g.next();
  g = refs(["c" + 3]);
  if (r.done === false) console.log(r.value);
}
// error: generators yielding references are not supported yet
