// expect: a1
// expect: b2
// expect: a1
// expect: b2
// expect: c1
// A loop over what a call returns a reference to reads it where it lives.
class Box { items: FixedArray<string, 2> = ["a" + 1, "b" + 2]; xs: string[] = ["c" + 1]; }
class H { b: Box = new Box(); get(): Ref<Box> { return this.b; } }
function pick(h: Ref<H>): Ref<Box> { return h.b; }
function main() {
  const h = new H();
  for (const x of h.get().items) console.log(x);
  for (const x of pick(h).items) console.log(x);
  for (const x of pick(h).xs) console.log(x);
}
