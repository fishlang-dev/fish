type Box = { name: string };

function take(b: Box): string {
  return b.name;
}

function* boxes(n: i64): Generator<Box> {
  for (let i = 0; i < n; i++) {
    const b: Box = { name: "box" + i };
    const r: Ref<Box> = b;
    const label = r.name + "?";
    console.log(label);
    yield b;
  }
}

function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}

function main() {
  for (const b of boxes(2)) console.log(take(b));
  let arr = ["a" + 1, "b"];
  for (const s of each(arr)) console.log(s);
  arr.push("c");
  let g = each(arr);
  const r = g.next();
  if (r.done === false) console.log(r.value);
  let moved = g;
  const q = moved.next();
  if (q.done === false) console.log(q.value);
  console.log(arr.length);
}
// expect: box0?
// expect: box0
// expect: box1?
// expect: box1
// expect: a1!
// expect: b!
// expect: a1!
// expect: b!
// expect: 3
