function* names(list: string[]): Generator<string> {
  for (const n of list) yield n + "!";
}
function main() {
  let h = { g: names(["z" + 1]) };
  const r = h.g.next();
  if (r.done === false) console.log(r.value);
  const mk = () => names(["y" + 1]);
}
// expect: z1!
