// case: panic_abort
// mode: abort
function main() {
  const big: i64 = 9223372036854775807;
  console.log("before");
  console.log(big + 1);
}
// expect: before
// panic: attempt to add with overflow
// case: panic_abort_bounds
// mode: abort
function main() {
  const s: string = "ab";
  const i: usize = 5;
  console.log(s.charCodeAt(i));
}
// panic: index out of bounds: the len is 2 but the index is 5
// case: panic_abort_option
// mode: abort
function main() {
  const o: string | null = null;
  console.log(o!);
}
// panic: called `Option::unwrap()` on a `None` value
// case: panic_bounds_unwind
function at(s: string, i: usize): string {
  const copy = s + "";
  return copy[i];
}

function main() {
  const s = "ab" + "c";
  const t = { name: s + "!", n: 1 };
  console.log(at(s, 2), t.name);
  console.log(at(s, 3));
}
// expect: c abc!
// panic: index out of bounds: the len is 3 but the index is 3
// case: panic_unwind_constructor
type P = { name: string; n: i64 };

class Box {
  label: string;
  more: string;
  constructor(label: string, fail: boolean) {
    this.label = label + "!";
    const o: string | null = null;
    if (fail) console.log(o!);
    this.more = "m";
  }
}

function deep(n: i64, s: string): string {
  const local = s + n;
  const obj: P = { name: local + "?", n };
  if (n === 0) {
    const nothing: string | null = null;
    return nothing!;
  }
  return deep(n - 1, local);
}

function main() {
  const keep = "k" + 1;
  const f = () => keep + "!";
  for (let i = 0; i < 3; i++) {
    const it = "it" + i;
    try {
      const inner = f() + it;
      if (i === 2) console.log(deep(3, inner));
      if (i === 1) new Box("b" + i, true);
    } finally {
      console.log("finally runs only without a panic", i);
    }
  }
}
// expect: finally runs only without a panic 0
// panic: called `Option::unwrap()` on a `None` value
// case: panic_unwind_drops
type P = { name: string; n: i64 };

class Box {
  label: string;
  more: string;
  constructor(label: string, fail: boolean) {
    this.label = label + "!";
    const o: string | null = null;
    if (fail) console.log(o!);
    this.more = "m";
  }
}

function deep(n: i64, s: string): string {
  const local = s + n;
  const obj: P = { name: local + "?", n };
  if (n === 0) {
    const nothing: string | null = null;
    return nothing!;
  }
  return deep(n - 1, local);
}

function main() {
  const keep = "k" + 1;
  const f = () => keep + "!";
  for (let i = 0; i < 3; i++) {
    const it = "it" + i;
    try {
      const inner = f() + it;
      if (i === 2) console.log(deep(3, inner));
      if (i === 1) new Box("b" + i, false);
    } finally {
      console.log("finally runs only without a panic", i);
    }
  }
}
// expect: finally runs only without a panic 0
// expect: finally runs only without a panic 1
// panic: called `Option::unwrap()` on a `None` value
// case: panic_unwind_drops_release
type P = { name: string; n: i64 };

class Box {
  label: string;
  more: string;
  constructor(label: string, fail: boolean) {
    this.label = label + "!";
    const o: string | null = null;
    if (fail) console.log(o!);
    this.more = "m";
  }
}

function deep(n: i64, s: string): string {
  const local = s + n;
  const obj: P = { name: local + "?", n };
  if (n === 0) {
    const nothing: string | null = null;
    return nothing!;
  }
  return deep(n - 1, local);
}

function main() {
  const keep = "k" + 1;
  const f = () => keep + "!";
  for (let i = 0; i < 3; i++) {
    const it = "it" + i;
    try {
      const inner = f() + it;
      if (i === 2) console.log(deep(3, inner));
      if (i === 1) new Box("b" + i, false);
    } finally {
      console.log("finally runs only without a panic", i);
    }
  }
}
// mode: release
// expect: finally runs only without a panic 0
// expect: finally runs only without a panic 1
// panic: called `Option::unwrap()` on a `None` value
// case: panic_unwind_exit
function main() {
  const big: i64 = 9223372036854775807;
  console.log("before");
  console.log(big + 1);
}
// expect: before
// panic: attempt to add with overflow
// case: panic_unwind_finally_error
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
function g(): i64 throws string { const a = "a" + 1; try { throw a + "e" } finally { const t = "t" + 2; print(t); boom(1) } }
function main() throws string { const k = "k" + 1; print(g()) }
// expect: t2
// panic: attempt to add with overflow
// case: panic_unwind_finally_return
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
function f(): string { const a = "a" + 1; try { return a + "r" } finally { const t = "t" + 2; print(t); boom(1) } }
function main() { const k = "k" + 1; print(f()) }
// expect: t2
// panic: attempt to add with overflow
// case: panic_unwind_object_argument
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
type P = { a: string; b: string }
function take(p: P, n: i64): i64 { return n }
function main() { take({ a: "a" + 1, b: "b" + 2 }, boom(1)) }
// panic: attempt to add with overflow
// case: panic_unwind_optional_chain
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
class C { s: string; constructor(s: string) { this.s = s } m(n: i64): string { return this.s + boom(n) } }
function get(): C | null { return new C("q" + 1) }
function main() {
  print(get()?.m(1))
}
// panic: attempt to add with overflow
// case: panic_unwind_owning_derived
function nil(): string { const o: string | null = null; return o! }
class B {
  s: string
  constructor(s: string) { this.s = s }
  eat(this: Own<this>, f: boolean): string { const t = this.s + "!"; if (f) nil(); return t }
  get g(): string { return this.s + nil() }
}
class D extends B {
  extra: string
  constructor(s: string, e: string) { super(s); this.extra = e }
}
function main() {
  const d = new D("x" + 1, "y" + 2)
  const e = new D("x" + 3, "y" + 4)
  print(e.eat(false))
  print(d.eat(true))
}
// expect: x3!
// panic: called `Option::unwrap()` on a `None` value
// case: panic_unwind_setter
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
class C {
  s: string
  constructor(s: string) { this.s = s }
  set v(x: string) { this.s = x + boom(1) }
}
function main() { let c = new C("x" + 1); c.v = "v" + 2; print(c.s) }
// panic: attempt to add with overflow
// case: panic_unwind_switch_test
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
function main() {
  const s = "s" + 1
  switch (s + "!") {
    case "x" + 1: print("x"); break
    case "y" + boom(1): print("y"); break
    default: print("d")
  }
}
// panic: attempt to add with overflow
// case: panic_unwind_union_argument
function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function take(p: string | i64, n: i64): i64 { return n }
function main() { const s = "s" + 1; take(s + "u", boom(1)) }
// panic: attempt to add with overflow
