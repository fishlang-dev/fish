type Box = { name: string };
function* own(): Generator<string> {
  let b: Box = { name: "box" + 1 };
  const r: Ref<Box> = b;
  yield r.name.clone();
  yield "x";
}
function main() {
  for (const s of own()) console.log(s);
}
// expect: box1
// expect: x
