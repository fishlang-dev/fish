function* words(xs: string[]): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let g = words(["a" + 1]);
  g.next();
  g.loop.b = 4;
  const r = g.next();
  if (r.done === false) console.log(r.value);
}
// error: property 'loop' does not exist on type 'Generator<string>'
