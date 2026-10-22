class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

type Box = { name: string };

async function risky(n: i64): Promise<string> throws Oops {
  const held = "held" + n;
  await yieldNow();
  if (n > 1) throw new Oops("too big " + n);
  return held + "!";
}

async function careful(n: i64): Promise<string> {
  try {
    const s = await risky(n);
    return "ok " + s;
  } catch (e) {
    return "caught " + e.why;
  }
}

async function passes(n: i64): Promise<string> throws Oops {
  const s = await risky(n);
  return "passed " + s;
}

async function borrows(b: Ref<Box>, xs: Ref<string[]>): Promise<string> {
  const name = b.name;
  const first = xs[0];
  await yieldNow();
  const own: Box = { name: "own" + 1 };
  const r: Ref<Box> = own;
  await yieldNow();
  return name + first + r.name;
}

async function main() throws Oops {
  const a = await careful(1);
  const b = await careful(5);
  console.log(a, b);
  const box: Box = { name: "box" + 1 };
  const xs = ["x" + 2];
  const c = await borrows(box, xs);
  console.log(c);
  const unused = risky(7);
  const later = passes(9);
  const d = await passes(1);
  console.log(d);
  const e = await later;
  console.log(e);
}
// expect: ok held1! caught too big 5
// expect: box1x2own1
// expect: passed held1!
// fails: Error: Oops
