type P = { name: string; age: i64 };
type Outer = { inner: P; note: string };

class Pet {
  name: string;
  constructor(name: string) {
    this.name = name + "!";
  }
  close(this: Own<this>): string {
    return this.name;
  }
  get loud(): string {
    return this.name + "!!";
  }
  set loud(v: string) {
    this.name = v + "";
  }
}

class Oops {
  why: string;
  constructor(why: string) {
    this.why = why + "";
  }
}

function make(n: i64): P {
  return { name: "p" + n, age: n };
}

function maybe(n: i64): P | null {
  if (n > 0) return make(n);
  return null;
}

function id<T>(x: T): T {
  return x;
}

function fail(n: i64): i64 throws Oops {
  const local = make(n);
  if (n > 2) throw new Oops("too big " + n);
  return n;
}

function apply(f: () => string): string {
  return f();
}

function main() throws Oops {
  const o: Outer = { inner: make(1), note: "n" + 1 };
  const taken = o.inner;
  console.log(taken.name, o.note);
  const p: P | null = make(2);
  if (p !== null) console.log(p.name);
  console.log(maybe(3)?.name, maybe(0)?.name, maybe(4)!.name);
  console.log(id("s" + 1), id(make(5)).name);
  try {
    fail(1);
    fail(3);
  } catch (e) {
    console.log(e.why);
  } finally {
    console.log("finally");
  }
  const word = "w" + 1;
  console.log(apply(() => word + "?"));
  const name = "short" + 1;
  const q = { name, age: 1 };
  console.log(q.name, name);
  const u: P | i64 = make(6);
  if (typeof u === "object") {
    const moved = u;
    console.log(moved.name);
  }
  console.log(new Pet("tmp").close(), make(8).name);
  const pet = new Pet("g");
  console.log(pet.loud);
  let pet2 = new Pet("s");
  pet2.loud = "set" + 1;
  console.log(pet2.name);
  let s = make(9);
  for (let i = 0; i < 3; i++) {
    const t = s;
    s = make(i);
    console.log(t.name);
  }
  const pick = s.age > 0 ? make(10) : make(11);
  console.log(pick.name);
  fail(5);
}
// expect: p1 n1
// expect: p2
// expect: p3 null p4
// expect: s1 p5
// expect: too big 3
// expect: finally
// expect: w1?
// expect: short1 short1
// expect: p6
// expect: tmp! p8
// expect: g!!!
// expect: set1
// expect: p9
// expect: p0
// expect: p1
// expect: p10
// fails: Error: Oops
