type Box = { name: string };

function name(b: Ref<Box>): Ref<string> {
  return b.name;
}

function viaRef(r: Ref<Box>): string {
  const n = r |> name(%);
  return n + "";
}

function main() {
  const b: Box = { name: "box" + 1 };
  console.log(viaRef(b));
  const o: string | null = "x" + "y";
  if (o |> % !== null) console.log(o.length);
}
// expect: box1
// expect: 2
