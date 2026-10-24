// case: pipe_copy_read_once
function three(a: i64, b: i64, c: i64): string {
  return `${a} ${b} ${c}`;
}

function main() {
  let x = 1;
  console.log(x |> three(%, (x = 2), %));
  const a = [10, 20, 30];
  let i: usize = 0;
  console.log(a[i] |> three(%, (i = i + 1) as i64, %));
}
// expect: 1 2 1
// expect: 10 1 10
// case: pipe_getter_copy
interface Named {
  name: string;
}

class C {
  constructor() {}
  get name(): string {
    return "c";
  }
}

function both(a: Ref<string>, b: Ref<string>): string {
  return a + b;
}

function show(v: Named): string {
  return v.name |> both(%, %);
}

function main() {
  console.log(show(new C()));
}
// error: pipes over a field a getter provides are not supported yet
// case: pipe_getter_field
type Box = { size: i64 };

interface HasBox {
  box: Box;
}

class C {
  constructor() {}
  get box(): Box {
    return { size: 1 };
  }
}

function size(b: Ref<Box>): i64 {
  return b.size;
}

function show(v: HasBox): i64 {
  return v.box |> size(%) + size(%);
}

function main() {
  console.log(show(new C()));
}
// error: pipes over a field a getter provides are not supported yet
// case: pipe_hides_in_arm
function main() {
  const n = 3;
  console.log(n |> match (5) {
    case n => n * 10 + %,
  });
}
// error: this 'n' hides the 'n' the pipe reads for '%'; rename it
// case: pipe_hides_place
function apply(f: (k: i64) => i64): i64 {
  return f(1);
}

function main() {
  const n = 3;
  console.log(n |> apply((n: i64) => n * 100 + %));
}
// error: this 'n' hides the 'n' the pipe reads for '%'; rename it
// case: pipe_match_through_topic
type O = { name: string; tags: string[] };
function main() {
  let o: O = { name: "n" + 1, tags: ["t" + 1] };
  o |> match (%) {
    case { tags } => { o = { name: "z", tags: [] }; console.log(tags[0]); },
  };
}
// error: cannot change 'o' while 'tags' borrows 'o'
// case: pipe_nested_body
type Box = { name: string };

function inc(n: i64): i64 {
  return n + 1;
}

function make(): Box {
  return { name: "made" };
}

function main() {
  const x = 10;
  console.log(x |> (inc(%) |> % * 100), x |> 5 + (inc(%) |> % * 100));
  console.log(make() |> (%.name.length |> % * 100));
  const b = make();
  b |> (%.name |> console.log(%));
}
// expect: 1100 1105
// expect: 400
// expect: made
// case: pipe_place_moved
type Box = { name: string };

function take(b: Box): string {
  return b.name;
}

function main() {
  const box: Box = { name: "crate" };
  console.log(box |> take(%));
  console.log(box.name);
}
// error: 'box.name' can't be used here because 'box' was moved
// case: pipe_place_moved_twice
type Box = { name: string };

function both(a: Box, b: Box): string {
  return a.name + b.name;
}

function main() {
  const box: Box = { name: "crate" };
  console.log(box |> both(%, %));
}
// error: 'box' was moved, so it can't be used here
// case: pipe_places
type Box = { name: string; size: i64 };

class Counter {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }

  doubled(): i64 {
    return this.n |> % * 2;
  }
}

function double(n: i64): i64 {
  return n * 2;
}

function add(a: i64, b: i64): i64 {
  return a + b;
}

function describe(b: Ref<Box>): string {
  return b.name + ":" + b.size;
}

function apply(f: (k: i64) => i64): i64 {
  return f(1);
}

function take(b: Box): string {
  return "took " + b.name;
}

function main() {
  const n = 3;
  console.log(n |> add(double(%), %) + 1);
  const box: Box = { name: "crate", size: 4 };
  console.log(box |> describe(%), box.name |> %.length, box.size |> add(%, n |> % * 10));
  console.log(box |> describe(%));
  const names = ["a", "bc"];
  console.log(names |> %.length, names[1] |> % + "!", names.length);
  console.log(new Counter(21).doubled());
  n |> console.log(%, "as a statement");
  const label = n |> match (%) {
    case 3 => "three",
    case _ => "other",
  };
  console.log(label, n |> apply((k: i64) => k + %));
  console.log(box |> take(%));
}
// expect: 10
// expect: crate:4 5 34
// expect: crate:4
// expect: 2 bc! 2
// expect: 42
// expect: 3 as a statement
// expect: three 4
// expect: took crate
// case: pipe_ref_and_narrow
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
// case: pipe_statement_match
type Box = { name: string; size: i64 };

function make(n: i64): Box {
  return { name: "box" + n, size: n };
}

function main() {
  const b = make(1);
  b |> match (%.size) {
    case 1 => console.log("one"),
    case _ => console.log(%.name),
  };
  make(2) |> match (%.size) {
    case 1 => console.log("one"),
    case _ => console.log(%.name),
  };
  make(3) |> match (%.size) {
    case 3 => {
      console.log("three");
      return;
    },
    case _ => {},
  };
}
// expect: one
// expect: box2
// expect: three
// case: pipe_this_fields
type Box = { name: string; size: i64 };
function make(n: i64): Box { return { name: "box" + n, size: n }; }
class C {
  box: Box;
  n: i64;
  constructor() { this.box = make(3); this.n = 0; }
  set(this: Mut<this>): i64 { this.box |> (this.n = %.size); return this.n; }
}
function main() { let c = new C(); console.log(c.set(), c.box.name); }
// expect: 3 box3
// case: pipe_topic_assign
function main() {
  let x = 1;
  x |> (% = 5);
  console.log(x);
}
// error: '%' can't be assigned; it stands for the pipe's value, so assign to what you piped instead
// case: pipe_topic_moved_twice
type Box = { name: string };

function make(): Box {
  return { name: "made" };
}

function both(a: Box, b: Box): string {
  return a.name + b.name;
}

function main() {
  console.log(make() |> both(%, %));
}
// error: '%' was moved, so it can't be used here
// case: pipe_topic_read_only
type Box = { name: string };

function make(): Box {
  return { name: "made" };
}

function main() {
  make() |> (%.name = "changed");
}
// error: cannot assign to '%.name' because '%' is a constant
// case: pipe_topic_reference
type Box = { name: string };

function make(): Box {
  return { name: "made" };
}

function name(b: Ref<Box>): Ref<string> {
  return b.name;
}

function main() {
  const n = make() |> name(%);
  console.log(n);
}
// error: a pipe over a value can't give a reference yet
// case: pipe_value_loan
function first(a: Ref<string[]>): Ref<string> {
  return a[0];
}

function show(k: usize, s: Ref<string>): string {
  return k + ":" + s;
}

function main() {
  let arr = ["a" + "-long"];
  console.log(first(arr) |> show((arr = ["zz", "q"]).length, %));
}
// error: cannot change 'arr' while
// case: pipe_values
type Box = { name: string; size: i64 };

function make(name: string): Box {
  console.log("made " + name);
  return { name: name, size: name.length as i64 };
}

function double(n: i64): i64 {
  return n * 2;
}

function add(a: i64, b: i64): i64 {
  return a + b;
}

function describe(b: Ref<Box>): string {
  return b.name + ":" + b.size;
}

function apply(f: () => i64): i64 {
  return f();
}

function take(b: Box): string {
  return "took " + b.name;
}

function main() {
  const n = 3;
  console.log(n |> double(%) |> add(%, %) |> % + 1);
  console.log(make("crate") |> describe(%) + " " + %.name + " " + %.size);
  console.log(make("bin") |> take(%));
  const kept = make("keep") |> %;
  console.log(kept.name, ("a" + "b") |> % + % + %, `x${n}` |> %.length);
  let total = "";
  for (let i = 0; i < 3; i++) {
    total = total + (make("p" + i) |> take(%) |> %.length |> `${%}`);
  }
  console.log(total);
  make("drop") |> console.log(%.name);
  const sized = make("sized") |> match (%) {
    case { size: 5 } => "five",
    case _ => "other",
  };
  console.log(sized, make("closure") |> apply(() => %.size * 10));
}
// expect: 13
// expect: made crate
// expect: crate:5 crate 5
// expect: made bin
// expect: took bin
// expect: made keep
// expect: keep ababab 2
// expect: made p0
// expect: made p1
// expect: made p2
// expect: 777
// expect: made drop
// expect: drop
// expect: made sized
// expect: made closure
// expect: five 70
// case: pipe_written_in_loop
type Box = { name: string; size: i64 };

function make(n: i64): Box {
  return { name: "box" + n, size: n };
}

function describe(b: Ref<Box>): string {
  return b.name + ":" + b.size;
}

function main() {
  let box = make(1);
  for (let k = 0; k < 2; k++) {
    console.log(box |> describe(%) + ((box.size = k + 10) + 0));
  }
  let i = 0;
  while (i < 2) {
    const d = box |> match (0) {
      case _ => {
        const d = describe(%);
        box.size = 99;
        return d;
      },
    };
    console.log(d);
    i++;
  }
}
// expect: box1:110
// expect: box1:1011
// expect: box1:11
// expect: box1:99
// case: pipe_written_place
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
// case: pipe_written_while_used
type Box = { name: string };
function both(a: Ref<Box>, k: i64): string { return a.name + k; }
function main() {
  let xs = ["a", "b"];
  console.log(xs |> %.length + (xs = ["c"]).length + %.length);
}
// error: cannot change 'xs' while '%' borrows 'xs' and is used later
