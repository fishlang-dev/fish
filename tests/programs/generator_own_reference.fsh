type Box = { name: string };
function* own(): Generator<string> {
  const b: Box = { name: "box" + 1 };
  const r: Ref<Box> = b;
  yield r.name;
  console.log(r.name);
}
function main() {
  for (const s of own()) console.log(s);
}
// error: a reference into 'b' is still in use at this 'yield'
