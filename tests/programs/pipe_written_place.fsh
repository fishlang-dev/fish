type Box = { name: string; size: i64 };
function make(n: i64): Box { return { name: "box" + n, size: n }; }
function describe(b: Ref<Box>): string { return b.name + ":" + b.size; }
function apply(f: (k: i64) => i64): i64 { return f(1); }
function main() {
  let box = make(1);
  const s = box |> describe(%) + ((box.size = 5) + 0);
  console.log(s, box.size);
  const n = 3;
  console.log(n |> % + apply((n: i64) => n));
  let xs = ["a", "b"];
  console.log(xs |> %.length + (xs = ["c"]).length);
}
// expect: box1:15 5
// expect: 4
// expect: 3
