// case: for
function sum(n: i64): i64 {
  let total = 0
  for (let i = 1; i <= n; i++) total += i
  return total
}

function forever(): i64 {
  for (;;) {}
}

function main() {
  print(sum(10))
  let j = 3
  for (j = 0; j < 2; j += 1) {
    print("j", j)
  }
  print(j)
  for (let i = 0; i < 3; print("update", i++)) {}
  let runs = 0
  do {
    runs++
  } while (false)
  print(runs)
  do runs *= 2; while (runs < 50)
  print(runs)
  const x = 1
  {
    const x = 2
    print(x)
  }
  print(x)
}
// expect: 55
// expect: j 0
// expect: j 1
// expect: 2
// expect: update 0
// expect: update 1
// expect: update 2
// expect: 1
// expect: 64
// expect: 2
// expect: 1
// case: for_of_getter_part
// error: this loop would read from a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'
class G { get nested(): FixedArray<FixedArray<string, 2>, 2> { return [["a" + 1, "b" + 1], ["c" + 1, "d" + 1]]; } get arr(): string[][] { return [["e" + 1, "f" + 1]]; } }
function main() {
  const g = new G();
  for (const x of g.nested[1]) console.log(x);
  for (const y of g.arr[0]) console.log(y);
}
// case: for_of_number
function main() {
  const n = 5;
  for (const x of n) console.log(x);
}
// error: 'for...of' needs an array, a Map, a Set, a string or a generator, not 'i64'
// case: for_of_pattern_array
// error: only tuples, like '[i64, string]', can be destructured so far, not 'i64[]'
function main() { const grid: i64[][] = [[1, 2]]; for (const [a, b] of grid) console.log(a, b); }
// case: for_of_pattern_default
// error: defaults in destructuring patterns are not supported yet
function main() { const ps = [{ x: 1 }]; for (const { x = 5 } of ps) console.log(x); }
// case: for_of_pattern_generic
// expect: a1
// expect: b2
// A loop pattern in a generic body, checked again for each instance.
function show<T>(xs: [string, T][]) {
  for (const [k, v] of xs) console.log(k);
}
function main() {
  const a: [string, i64][] = [["a" + 1, 1]];
  const b: [string, boolean][] = [["b" + 2, true]];
  show(a);
  show(b);
}
// case: for_of_pattern_let
// expect: a1 2
// expect: b 3
// expect: 1
// A let pattern's parts may change, as their own copies.
function main() {
  const xs: [string, i64][] = [["a" + 1, 1], ["b", 2]];
  for (let [k, v] of xs) {
    v = v + 1;
    console.log(k, v);
  }
  console.log(xs[0][1]);
}
// case: for_of_pattern_missing
// error: property 'z' does not exist on type '{ x: i64 }'
function main() { const ps = [{ x: 1 }]; for (const { z } of ps) console.log(z); }
// case: for_of_pattern_nested
// error: nested destructuring patterns are not supported yet
function main() { const ps: [[i64, i64], i64][] = [[[1, 2], 3]]; for (const [[a, b], c] of ps) console.log(a); }
// case: for_of_pattern_rebind
// expect: 5
// expect: 5
// A borrowed let part may be pointed elsewhere, as a let loop variable may.
class Box { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  const other = new Box(5);
  let bs: Box[] = [new Box(7)];
  for (let b of bs) { b = other; console.log(b.n); }
  let ps: [Box, string][] = [[new Box(7), "s" + ""]];
  for (let [b, s] of ps) { b = other; console.log(b.n); }
}
// case: for_of_pattern_shadow
// expect: 1
// The loop's body may declare a name its pattern binds.
function main() {
  const xs: [string, i64][] = [["a" + "", 1]];
  for (const [k, v] of xs) { const k = 1; console.log(k); }
}
// case: for_of_patterns
// expect: x1 3
// expect: y2 4
// expect: 30
// expect: 40
// expect: 14
// expect: p1 1
// expect: q2 5
// expect: a1 1
// expect: b2 2
// expect: 7 seven
// expect: 7 2 2
// Patterns in a for...of head: tuple and object elements taken apart, holes and renames, parts
// of borrowed elements borrowed so the arrays stay usable, and a generator's tuples.
class P { x: i64; y: i64; tag: string; constructor(x: i64, y: i64, tag: string) { this.x = x; this.y = y; this.tag = tag; } }
class Box { n: i64; constructor(n: i64) { this.n = n; } }
function* pairs(): Generator<[string, i64]> { yield ["a" + 1, 1]; yield ["b" + 2, 2]; }
function main() {
  const counts: [string, i64][] = [["x" + 1, 3], ["y" + 2, 4]];
  for (const [name, n] of counts) console.log(name, n);
  for (const [, n] of counts) console.log(n * 10);
  const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  let total = 0;
  for (const { x, y } of points) total += x * y;
  console.log(total);
  const ps = [new P(1, 2, "p" + 1), new P(5, 6, "q" + 2)];
  for (const { tag: label, x } of ps) console.log(label, x);
  for (const [k, v] of pairs()) console.log(k, v);
  const boxes: [Box, string][] = [[new Box(7), "seven"]];
  for (const [b, s] of boxes) console.log(b.n, s);
  console.log(boxes[0][0].n, counts.length, ps.length);
}
// case: for_of_ref_result
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
// case: for_of_string
// expect: [a:1][é:1][€:1][😀:2][!:1] 5
// expect: a
// expect: c
// expect: xx
// expect: yy
// for...of over a string gives each code point as a string, as JavaScript's iterator does;
// break and continue work, and a let variable may change.
function main() {
  const s = "aé€😀" + "!";
  let out = "";
  let n = 0;
  for (const ch of s) {
    out += `[${ch}:${ch.length}]`;
    n++;
  }
  console.log(out, n);
  for (const c of "abc") {
    if (c === "b") continue;
    console.log(c);
  }
  let t = "xyz" + 1;
  for (let c of t) {
    if (c === "z") break;
    c = c + c;
    console.log(c);
  }
}
// case: for_of_string_changed
// expect: abcdabcd
// The loop holds its own string, so its variable may change inside it.
function main() {
  let t = "abc" + "d";
  for (const ch of t) { t = t + ch; }
  console.log(t);
}
// case: for_of_string_ref
// expect: 3
// A loop over a string reached through a reference.
function r(s: Ref<string>): i64 { let n = 0; for (const c of s) n++; return n; }
function main() {
  let t = "abc" + "";
  console.log(r(t));
}
// case: for_of_string_surrogates
// expect: 1,1,1,2,
// A lone surrogate is a code point of its own, and a pair is one character.
function main() {
  const s = "a\uD800b😀" + "";
  let lengths = "";
  for (const ch of s) lengths += `${ch.length},`;
  console.log(lengths);
}
// case: for_of_temporary_part
// error: this loop would read from a value made just for it
function mkArr(): string[][] { return [["e" + 1, "f" + 1]]; }
function main() { for (const y of mkArr()[0]) console.log(y); }
// case: for_scope
function main() {
  for (let i = 0; i < 3; i++) {}
  print(i)
}
// error: cannot find name 'i'
