// case: string_build
function main() {
  const s: string = "a-b-c";
  const lines: string[] = [
    s.replace("-", "+"), s.replace("x", "+"), s.replace("-", "[$&]"), s.replace("-", "[$`]"), s.replace("-", "[$']"),
    s.replace("-", "$$"), s.replace("-", "$1$"), s.replace("", "<"), "😀x".replace("\uDE00", "!"), s.replace("c", "$"),
    "5".padStart(3, "0"), "5".padEnd(4, "ab"), "abc".padStart(2), "x".padStart(4), "x".padEnd(6, "😀"), "x".padStart(3, ""),
    "ab".repeat(3), "ab".repeat(0), "😀".repeat(2), "\uDE00\uD83D".repeat(2),
  ];
  for (const l of lines) console.log(`[${l}] ${l.length}`);
}
// expect: [a+b-c] 5
// expect: [a-b-c] 5
// expect: [a[-]b-c] 7
// expect: [a[a]b-c] 7
// expect: [a[b-c]b-c] 9
// expect: [a$b-c] 5
// expect: [a$1$b-c] 7
// expect: [<a-b-c] 6
// expect: [�!x] 3
// expect: [a-b-$] 5
// expect: [005] 3
// expect: [5aba] 4
// expect: [abc] 3
// expect: [   x] 4
// expect: [x😀😀�] 6
// expect: [x] 1
// expect: [ababab] 6
// expect: [] 0
// expect: [😀😀] 4
// expect: [�😀�] 4
// case: string_case
function main() {
  const words: string[] = ["Straße", "İstanbul", "ΟΔΥΣΣΕΥΣ", "ΣΑΣ Σ.Σ", "ΑΣ' Σ", "ﬁne ŉ ΐ", "hello World 123", "a😀B", "Σ", "ΑΣ́", "x\uD83Dy", ""];
  for (const w of words) console.log(`${w.toUpperCase()}|${w.toLowerCase()}|${w.toUpperCase().length}`);
}
// expect: STRASSE|straße|7
// expect: İSTANBUL|i̇stanbul|8
// expect: ΟΔΥΣΣΕΥΣ|οδυσσευς|8
// expect: ΣΑΣ Σ.Σ|σας σ.ς|7
// expect: ΑΣ' Σ|ας' σ|5
// expect: FINE ʼN Ϊ́|ﬁne ŉ ΐ|11
// expect: HELLO WORLD 123|hello world 123|15
// expect: A😀B|a😀b|4
// expect: Σ|σ|1
// expect: ΑΣ́|ας́|3
// expect: X�Y|x�y|3
// expect: ||0
// case: string_chain_temporary
class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  greet(s: string): string {
    return this.name + s;
  }
}

function maybe(n: i64): Pet | null {
  if (n > 0) return new Pet("p");
  return null;
}

function main() {
  const p = maybe(1);
  console.log(p?.greet(`n${5}`));
  console.log(maybe(0)?.greet("x" + 1), maybe(2)?.greet("y" + 2));
}
// expect: p!n5
// expect: null p!y2
// case: string_compare
function same(a: string | i64, b: string): boolean {
  return a === b;
}

function kind(s: string): i64 {
  switch (s) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}

function main() {
  const a: string = "hello";
  const c = "lit";
  const s: string = c;
  console.log(a === "hello", a !== "hello", s === c);
  console.log("abc" < "abd", "abd" <= "abc", "b" > "abc", "x" >= "x", "ab" < "abc");
  console.log("é" < "z", "z" < "é");
  console.log(same("q", "q"), same(1, "q"), same("q", "r"));
  console.log(kind("a"), kind("b"), kind("zz"));
}
// expect: true false true
// expect: true false true true true
// expect: false true
// expect: true false false
// expect: 1 2 0
// case: string_conversion
function main() {
  String(5);
  const s = String(1.5) + String("x");
  console.log(s, "abc".indexOf("c") as usize);
}
// expect: 1.5x 2
// case: string_conversion_object
function main() {
  const o = { a: 1 };
  console.log(String(o));
}
// error: 'String' works with strings, numbers and booleans, not '{ a: i64 }'
// case: string_counts
function main() {
  const n: usize = 10000000000;
  const big: usize = 4294967297;
  console.log("".repeat(n).length, "ab".repeat(0).length, "x".padStart(0, "ab"), "a,b,c".split(",", big).length, "a,b,c".split(",", 4294967296).length);
  console.log("\uDE00\uD83D".repeat(3).length, "\u00e9,".repeat(1000).split(",").length);
  const huge: usize = 9223372036854775808;
  console.log("x".padStart(huge, ""));
}
// expect: 0 0 x 1 0
// expect: 6 1001
// expect: x
// case: string_drops
function twice(s: string): string {
  const t = s + s;
  return t;
}

function label(n: i64): string {
  switch ("k" + n) {
    case "k1": {
      const one = "one" + n;
      return one;
    }
    case "k2":
      return "two";
    default:
      return "many";
  }
}

function main() {
  let t = twice("bo");
  t = twice(t);
  console.log(t);
  twice("dropped");
  let k = 0;
  while (twice("k") + k !== "kk3") k++;
  console.log(k);
  const chosen = k > 1 ? twice("big") : "small";
  console.log(chosen, label(1), label(2), label(3));
}
// expect: bobobobo
// expect: 3
// expect: bigbig one1 two many
// case: string_escapes_main
function main() throws string {
  const why = "bad " + 1;
  throw why;
}
// fails: Error: bad 1
// case: string_exits
function find(n: i64): string throws string {
  for (let i = 0; i < 10; i++) {
    const tag = "item" + i;
    if (i === n) return tag;
    if (i > 5) {
      const why = "too far: " + i;
      throw why;
    }
    if (i % 2 === 0) continue;
    const odd = tag + " odd";
    if (i === n + 3) break;
  }
  return "none" + n;
}

function main() throws string {
  console.log(find(2), find(3));
  outer: for (let i = 0; i < 3; i++) {
    const a = "a" + i;
    for (let j = 0; j < 3; j++) {
      const b = a + j;
      if (j === 1) continue outer;
    }
  }
  try {
    console.log(find(8));
  } catch (e) {
    console.log("caught", e);
  }
  try {
    find(9);
  } catch {
    console.log("dropped");
  }
  try {
    const inner = "in" + 1;
    find(7);
  } catch (e) {
    console.log(e);
  } finally {
    const f = "fin" + 2;
    console.log(f);
  }
  console.log(find(-2));
}
// expect: item2 item3
// expect: caught too far: 6
// expect: dropped
// expect: too far: 6
// expect: fin2
// expect: none-2
// case: string_finally_leaves
function f(): string throws string {
  try {
    throw "e" + 1;
  } finally {
    return "r" + 2;
  }
}

function g(): string {
  try {
    return "a" + 1;
  } finally {
    return "b" + 2;
  }
}

function h(): i64 {
  for (let i = 0; i < 3; i++) {
    try {
      return i;
    } finally {
      break;
    }
  }
  return 9;
}

function main() throws string {
  console.log(f(), g(), h());
}
// expect: r2 b2 9
// case: string_held
type P = { name: string; age: i64 };

class Pet {
  name: string;
  tag: string | null;
  constructor(name: string) {
    this.name = name + "!";
    this.tag = null;
  }
  rename(this: Mut<this>, to: string) {
    this.name = to + "?";
  }
  close(this: Own<this>): string {
    return this.name;
  }
}

class Dog extends Pet {
  breed: string;
  constructor(name: string, breed: string) {
    super(name);
    this.breed = breed + "";
  }
}

function make(n: i64): P {
  return { name: "p" + n, age: n };
}

function main() {
  const a = make(1);
  const b = a;
  let c = make(2);
  c = make(3);
  console.log(b.name, c.name);
  let pet = new Pet("rex");
  pet.rename("max" + 1);
  pet.tag = "t" + 1;
  console.log(pet.name, pet.tag);
  const named = pet.close();
  console.log(named);
  const d = new Dog("fido", "lab");
  console.log(d.name, d.breed);
  let u: string | i64 = "x" + 1;
  const u2 = u;
  u = 5;
  console.log(u2, u);
  let o: string | null = "o" + 1;
  const kept = o ?? "none";
  o = null;
  console.log(kept, o);
  console.log(make(4).name, new Pet("tmp").name);
  const label = "cap" + 1;
  const f = () => label + "!";
  console.log(f());
  const moved = make(7);
  const g = move () => moved.name;
  console.log(g());
}
// expect: p1 p3
// expect: max1? t1
// expect: max1?
// expect: fido! lab
// expect: x1 5
// expect: o1 null
// expect: p4 tmp!
// expect: cap1!
// expect: p7
// case: string_held_release
type P = { name: string; age: i64 };

class Pet {
  name: string;
  tag: string | null;
  constructor(name: string) {
    this.name = name + "!";
    this.tag = null;
  }
  rename(this: Mut<this>, to: string) {
    this.name = to + "?";
  }
  close(this: Own<this>): string {
    return this.name;
  }
}

class Dog extends Pet {
  breed: string;
  constructor(name: string, breed: string) {
    super(name);
    this.breed = breed + "";
  }
}

function make(n: i64): P {
  return { name: "p" + n, age: n };
}

function main() {
  const a = make(1);
  const b = a;
  let c = make(2);
  c = make(3);
  console.log(b.name, c.name);
  let pet = new Pet("rex");
  pet.rename("max" + 1);
  pet.tag = "t" + 1;
  console.log(pet.name, pet.tag);
  const named = pet.close();
  console.log(named);
  const d = new Dog("fido", "lab");
  console.log(d.name, d.breed);
  let u: string | i64 = "x" + 1;
  const u2 = u;
  u = 5;
  console.log(u2, u);
  let o: string | null = "o" + 1;
  const kept = o ?? "none";
  o = null;
  console.log(kept, o);
  console.log(make(4).name, new Pet("tmp").name);
  const label = "cap" + 1;
  const f = () => label + "!";
  console.log(f());
  const moved = make(7);
  const g = move () => moved.name;
  console.log(g());
}
// mode: release
// expect: p1 p3
// expect: max1? t1
// expect: max1?
// expect: fido! lab
// expect: x1 5
// expect: o1 null
// expect: p4 tmp!
// expect: cap1!
// expect: p7
// case: string_index
function main() {
  const s = "a😀é";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += `[${c}:${c.length}:${c.charCodeAt(0)}]`;
  }
  console.log(out);
  console.log(s[1] + s[2], s[1] + s[2] === "😀", s[0] === "a", "xyz"[2]);
}
// expect: [a:1:97][�:1:55357][�:1:56832][é:1:233]
// expect: 😀 true true z
// case: string_index_bounds
function main() {
  const s: string = "a😀";
  console.log(s.charCodeAt(2));
  console.log(s.charCodeAt(3));
}
// expect: 56832
// panic: index out of bounds: the len is 3 but the index is 3
// case: string_index_panic
function main() {
  const s = "ab";
  const i: usize = 2;
  console.log(s[1]);
  console.log(s[i]);
}
// expect: b
// panic: index out of bounds: the len is 2 but the index is 2
// case: string_index_type
function main() {
  const s = "ab";
  const i: i32 = 0;
  console.log(s[i]);
}
// error: a string's index is a 'usize', not 'i32'
// case: string_index_write
function main() {
  let s = "abc";
  s[0] = "x";
}
// error: strings can't be changed; build a new one instead, joining parts with '+'
// case: string_join
function greet(name: string): string {
  return "hi " + name;
}

function main() {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += i;
    s = s + ",";
  }
  console.log(s);
  console.log(greet("ann"));
  console.log("x" + 1 + 2, 1 + 2 + "x", "t" + true, (3 as u8) + "u", "f" + 0.1, "g" + (2.5 as f32));
  console.log("a" + "b" === "ab");
}
// expect: 0,1,2,3,4,
// expect: hi ann
// expect: x12 3x ttrue 3u f0.1 g2.5
// expect: true
// case: string_join_object
function main() {
  const p = { x: 1 };
  console.log("p: " + p);
}
// error: '+' works with strings, numbers and booleans, not '{ x: i64 }'
// case: string_length_receivers
function size(s: Ref<string>): usize {
  return s.length;
}

function grow(s: Mut<string>): u16 {
  s += "!";
  return s.charCodeAt(s.length - 1);
}

function main() {
  let t = "ab" + 1;
  const o: string | null = "opt";
  const none: string | null = null;
  console.log("abc".length, (t + "x").length, "é".charCodeAt(0), size(t), grow(t), t);
  console.log(o?.length, none?.length, o?.charCodeAt(0));
}
// expect: 3 4 233 3 33 ab1!
// expect: 3 null 111
// case: string_length_units
function main() {
  const a = "hello";
  const b: string = "héllo wörld";
  const c = "日本語";
  const d = "a😀b";
  console.log(a.length, b.length, c.length, d.length, "".length);
  console.log(a.charCodeAt(1), b.charCodeAt(1), c.charCodeAt(2), d.charCodeAt(1), d.charCodeAt(2), d.charCodeAt(3));
  let long = "";
  for (let i = 0; i < 70; i++) long += "é😀";
  const lit = "ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé😀ééééééééééééééééééééééééééééééééééééééééééééé😀x";
  console.log(long.length, long.charCodeAt(0), long.charCodeAt(129), long.charCodeAt(130), long.charCodeAt(209));
  console.log(lit.length, lit.charCodeAt(72), lit.charCodeAt(73), lit.charCodeAt(74), lit.charCodeAt(lit.length - 1));
  let sum: u32 = 0;
  for (let i = 0; i < d.length; i++) sum += d.charCodeAt(i) as u32;
  console.log(sum);
}
// expect: 5 11 3 4 0
// expect: 101 233 35486 55357 56832 98
// expect: 210 233 233 55357 56832
// expect: 123 233 55357 56832 120
// expect: 112384
// case: string_length_write
function main() {
  let s = "abc" + "d";
  s.length = 3;
}
// error: a string's 'length' can't be changed; strings can't be changed, so build a new one instead
// case: string_literal_option_chain
function main() {
  const o: "a" | "bc" | null = "bc";
  console.log(o?.slice(1));
}
// error: optional chains on string literal types are not supported yet
// case: string_literal_union_join
type Dir = "up" | "down";
function main() {
  const k = 1;
  const s = match (k) {
    case 0 => "zero",
    case _ => "many",
  };
  const d: Dir = "down";
  const t = k > 0 ? "yes" : "no";
  console.log(s + "!", "<" + d, `${t}-${d}`, s + d);
}
// expect: many! <down yes-down manydown
// case: string_literal_union_length
function main() {
  let e: "a" | "bc" = "bc";
  console.log(e.length, e[1], e.slice(1), e.charCodeAt(0));
  e = "a";
  console.log(e.length);
}
// expect: 2 c c 98
// expect: 1
// case: string_literal_union_length_write
function main() {
  let e: "a" | "bc" = "bc";
  e.length = 1;
}
// error: a string's 'length' can't be changed; strings can't be changed, so build a new one instead
// case: string_method_value
function main() {
  const s = "abc";
  const f = s.slice;
}
// error: string methods can only be called, like 's.slice(...)'
// case: string_moves
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
// case: string_mut
function append(s: Mut<string>, more: string) {
  s += more;
  s = s + ".";
}

function main() {
  let s = "a";
  append(s, "b" + 1);
  console.log(s);
}
// expect: ab1.
// case: string_no_property
function main() {
  const s: string = "abc";
  console.log(s.size);
}
// error: property 'size' does not exist on type 'string'
// case: string_not_number
function main() {
  const s: string = "a";
  const n: i64 = s;
}
// error: type 'string' is not assignable to type 'i64'
// case: string_operand_changed
function bump(s: Mut<string>): string {
  s = "new" + 1;
  return "r";
}

function main() {
  let s = "old" + 1;
  const t = s + bump(s);
  console.log(t, s);
  let u = "u" + 1;
  console.log(u, (u = "v" + 2));
  let w = "w" + 1;
  console.log(`${w}-${bump(w)}-${w}`, w === bump(w), w);
  let k = "k" + 1;
  k += bump(k);
  console.log(k);
}
// expect: old1r new1
// expect: u1 v2
// expect: w1-r-new1 false new1
// expect: k1r
// case: string_order_utf16
function main() {
  const a: string = "\uFF61";
  const b: string = "\u{1F600}";
  console.log(a < b, b < a, "\u{1F600}" < "\u{1F601}", "\u{1F601}" > "\u{1F600}", "é" < "z", "ab" < "abc", "\u{10000}" < "\u{1F600}", "a\u{1F600}" === "a\u{1F600}");
}
// expect: false true true true false true true true
// case: string_owning_derived
class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  close(this: Own<this>): string {
    return this.name;
  }
}

class Dog extends Pet {
  breed: string;
  constructor(n: string, b: string) {
    super(n);
    this.breed = b + "?";
  }
}

function main() {
  console.log(new Dog("a", "b").close());
  const d = new Dog("c", "d");
  console.log(d.close());
}
// expect: a!
// expect: c!
// case: string_owning_raises
class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  close(this: Own<this>, fail: boolean): string throws string {
    if (fail) throw "closed " + this.name;
    return this.name;
  }
}

class Dog extends Pet {
  breed: string;
  constructor(n: string, b: string) {
    super(n);
    this.breed = b + "?";
  }
}

function no(n: i64): boolean throws string {
  if (n > 0) throw "no" + n;
  return false;
}

function main() {
  try {
    console.log(new Pet("a").close(no(1)));
  } catch (e) {
    console.log(e);
  }
  try {
    console.log(new Dog("a", "b").close(true));
  } catch (e) {
    console.log(e);
  }
  try {
    console.log(new Dog("c", "d").close(false));
  } catch (e) {
    console.log(e);
  }
}
// expect: no1
// expect: closed a!
// expect: c!
// case: string_pad_too_long
function main() {
  const n: usize = 4611686018427387904;
  console.log("x".padStart(n, "a").length);
}
// panic: invalid string length
// case: string_pad_too_long_held
function main() {
  const big: usize = 4611686018427387904;
  const s = "ab" + 1;
  console.log(s.padStart(big, "z").length);
}
// panic: invalid string length
// case: string_print_format
function main() {
  const s: string = "50% %d %s";
  console.log(s, "100%");
  const z: string = "a\0b";
  console.log(z === "a\0b", z === "a");
}
// expect: 50% %d %s 100%
// expect: true false
// case: string_raise_drops
type P = { a: string; b: i64 };

function fail(n: i64): i64 throws string {
  if (n > 0) throw "bad" + n;
  return n;
}

function key(n: i64): string throws string {
  if (n > 0) throw "key" + n;
  return "k";
}

function two(a: string, b: i64): i64 {
  return b;
}

function apply(f: (s: string) => i64): i64 {
  return f("a" + 1);
}

function main() {
  try {
    two("a" + 1, fail(1));
  } catch (e) {
    console.log(e);
  }
  const moved: P = { a: "m" + 1, b: 1 };
  try {
    const q: P = { a: moved.a + "", b: fail(2) };
  } catch (e) {
    console.log(e);
  }
  try {
    switch ("s" + 1) {
      case key(3):
        console.log("hit");
    }
  } catch (e) {
    console.log(e);
  }
  console.log(apply(() => 7));
}
// expect: bad1
// expect: bad2
// expect: key3
// expect: 7
// case: string_repeat_too_long
function main() {
  const n: usize = 2305843009213693952;
  const s = "ab".repeat(n);
  console.log(s.length);
}
// panic: invalid string length
// case: string_repeat_too_long_held
function main() {
  const big: usize = 2305843009213693952;
  const s = "ab" + 1;
  console.log(s.repeat(big).length);
}
// panic: invalid string length
// case: string_search
function main() {
  const texts: string[] = ["hello world", "héllo wörld", "a😀b😀c", "", "aaa"];
  const needles: string[] = ["o", "wor", "ö", "😀", "\uD83D", "\uDE00", "", "zz", "a", "b😀"];
  const positions: i64[] = [-5, 0, 1, 2, 4, 100];
  let out: string[] = [];
  for (const t of texts) for (const n of needles) {
    let line = `${t.indexOf(n)} ${t.includes(n)} ${t.startsWith(n)} ${t.endsWith(n)}`;
    for (const p of positions) line += ` ${t.indexOf(n, p)}${t.includes(n, p) ? "y" : "n"}${t.startsWith(n, p) ? "y" : "n"}${t.endsWith(n, p) ? "y" : "n"}`;
    out.push(line);
  }
  out.push(`${String(42)} ${String(-1.5)} ${String(true)} ${String("s")} ${String(255)}`);
  for (const l of out) console.log(l);
}
// expect: 4 true false false 4ynn 4ynn 4ynn 4ynn 4yyn -1nnn
// expect: 6 true false false 6ynn 6ynn 6ynn 6ynn 6ynn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 4yyy 11yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 4 true false false 4ynn 4ynn 4ynn 4ynn 4yyn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 7 true false false 7ynn 7ynn 7ynn 7ynn 7ynn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 4yyy 11yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 1 true false false 1ynn 1ynn 1yyn 4ynn 4yyn -1nnn
// expect: 1 true false false 1ynn 1ynn 1yyn 4yny 4yyn -1nnn
// expect: 2 true false false 2ynn 2ynn 2ynn 2yyn 5ynn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 4yyy 7yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true false 0yyn 0yyn -1nny -1nnn -1nnn -1nnn
// expect: 3 true false false 3ynn 3ynn 3ynn 3ynn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 0yyy 0yyy 0yyy 0yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 3yyy 3yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyn 0yyn 1yyy 2yyy -1nny -1nny
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 42 -1.5 true s 255
// case: string_setter_value
class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  get loud(): string {
    return this.name + "!!";
  }
  set loud(v: string) {
    this.name = v + "";
  }
}

function main() {
  let pet = new Pet("a");
  console.log(pet.loud = "set" + 1);
  const t = (pet.loud += "x");
  console.log(t, pet.name);
}
// expect: set1
// expect: set1!!x set1!!x
// case: string_slice
function keep(): string {
  const big = "prefix-" + "é😀x" + "-suffix";
  const mid = big.slice(5, 12);
  return mid.substring(2);
}

function main() {
  const s: string = "héllo 😀 wörld";
  console.log(`[${s.slice(1)}][${s.slice(-5)}][${s.slice(2, 5)}][${s.slice(5, 2)}][${s.slice(-100, 3)}][${s.slice(3, 100)}]`);
  console.log(`[${s.substring(1)}][${s.substring(-5)}][${s.substring(2, 5)}][${s.substring(5, 2)}][${s.substring(3, 100)}][${s.substring(4, 4)}]`);
  console.log(`[${s.slice(7, 9)}][${s.slice(7, 8)}][${s.slice(8, 9)}][${s.slice(7, 8).length}][${s.slice(8).charCodeAt(0)}]`);
  console.log(s.slice(6, 8) + s.slice(8, 10) === s.slice(6, 10), s.slice(0, 7) + s.slice(7) === s);
  const t = keep();
  console.log(t, t.length);
  s.slice(1, 2);
  let long = "";
  for (let i = 0; i < 100; i++) long += "é😀";
  console.log(long.slice(129, 133).length, long.slice(129, 133) === "😀é😀".slice(1), long.substring(150, 140).charCodeAt(1));
}
// expect: [éllo 😀 wörld][wörld][llo][][hél][lo 😀 wörld]
// expect: [éllo 😀 wörld][héllo 😀 wörld][llo][llo][lo 😀 wörld][]
// expect: [� ][�][ ][1][32]
// expect: true true
// expect: é😀x- 5
// expect: 4 false 233
// case: string_slice_args
function main() {
  const s = "abc";
  console.log(s.slice());
}
// error: 'slice' takes 1 or 2 arguments
// case: string_split_trim
function main() {
  const texts: string[] = ["a,b,,c", ",a,", "", "a😀b😀c", "no-sep", "😀", "x  y z"];
  const seps: string[] = [",", "", "😀", "\uDE00", "zz", " ", "a,"];
  const limits: usize[] = [0, 1, 2, 100];
  let lines: string[] = [];
  for (const t of texts) {
    let line = `[${t.split().length}]`;
    for (const s of seps) {
      const parts = t.split(s);
      let joined = "";
      for (const p of parts) joined += `<${p}>`;
      line += ` ${parts.length}${joined}`;
      for (const l of limits) line += `/${t.split(s, l).length}`;
    }
    lines.push(line);
  }
  const spaces: string[] = [" \t\n x \r\n", "  y　﻿", "z", "", "   ", " a b "];
  for (const s of spaces) {
    const a = s.trim();
    const b = s.trimStart();
    const c = s.trimEnd();
    lines.push(`${a.length} ${b.length} ${c.length} ${a.length > 0 ? a.charCodeAt(0) : 0} ${b.length > 0 ? b.charCodeAt(b.length - 1) : 0} ${c.length > 0 ? c.charCodeAt(0) : 0}`);
  }
  for (const l of lines) console.log(l);
}
// expect: [1] 4<a><b><><c>/0/1/2/4 6<a><,><b><,><,><c>/0/1/2/6 1<a,b,,c>/0/1/1/1 1<a,b,,c>/0/1/1/1 1<a,b,,c>/0/1/1/1 1<a,b,,c>/0/1/1/1 2<><b,,c>/0/1/2/2
// expect: [1] 3<><a><>/0/1/2/3 3<,><a><,>/0/1/2/3 1<,a,>/0/1/1/1 1<,a,>/0/1/1/1 1<,a,>/0/1/1/1 1<,a,>/0/1/1/1 2<,><>/0/1/2/2
// expect: [1] 1<>/0/1/1/1 0/0/0/0/0 1<>/0/1/1/1 1<>/0/1/1/1 1<>/0/1/1/1 1<>/0/1/1/1 1<>/0/1/1/1
// expect: [1] 1<a😀b😀c>/0/1/1/1 7<a><�><�><b><�><�><c>/0/1/2/7 3<a><b><c>/0/1/2/3 3<a�><b�><c>/0/1/2/3 1<a😀b😀c>/0/1/1/1 1<a😀b😀c>/0/1/1/1 1<a😀b😀c>/0/1/1/1
// expect: [1] 1<no-sep>/0/1/1/1 6<n><o><-><s><e><p>/0/1/2/6 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1
// expect: [1] 1<😀>/0/1/1/1 2<�><�>/0/1/2/2 2<><>/0/1/2/2 2<�><>/0/1/2/2 1<😀>/0/1/1/1 1<😀>/0/1/1/1 1<😀>/0/1/1/1
// expect: [1] 1<x  y z>/0/1/1/1 6<x>< >< ><y>< ><z>/0/1/2/6 1<x  y z>/0/1/1/1 1<x  y z>/0/1/1/1 1<x  y z>/0/1/1/1 4<x><><y><z>/0/1/2/4 1<x  y z>/0/1/1/1
// expect: 1 4 5 120 10 32
// expect: 1 3 3 121 65279 160
// expect: 1 1 1 122 122 122
// expect: 0 0 0 0 0 0
// expect: 0 0 0 0 0 0
// expect: 3 4 4 97 8287 8195
// case: string_surrogates
function main() {
  const high: string = "\uD83D";
  const low: string = "\uDE00";
  const pair = high + low;
  console.log(pair, pair === "\u{1F600}", `${high}${low}` === "\u{1F600}");
  console.log(high, "x\uD83D", high < pair, "\uD83D\uE000" > pair);
  console.log("\uDE00" < "\uE000", "\uE000" > "\u{1F600}", "a\uDC00" < "a\u{10000}");
}
// expect: 😀 true true
// expect: � x� true true
// expect: true true false
// case: string_template
function main() {
  const n: u8 = 200;
  const f = 1.5;
  const s = "mid";
  console.log(`n=${n} f=${f} b=${n > 100} s=${s}!`);
  console.log(`${s}`, `plain`, `${-1}${-2}`);
  const t: string = `fixed`;
  console.log(t === "fixed");
}
// expect: n=200 f=1.5 b=true s=mid!
// expect: mid plain -1-2
// expect: true
// case: string_template_object
function main() {
  const p = { x: 1 };
  console.log(`p: ${p}`);
}
// error: a template works with strings, numbers and booleans, not '{ x: i64 }'
// case: string_typeof
function show(u: string | i64) {
  if (typeof u === "string") console.log("text", u);
  else console.log("number", u + 1);
}

function main() {
  show("seven");
  show(7);
}
// expect: text seven
// expect: number 8
// case: string_values
type P = { name: string; age: i64 };

class Pet {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  call(): string {
    return this.name;
  }
}

function pick(n: i64): string {
  if (n > 0) return "positive";
  return "not positive";
}

function main() {
  const a = "hello";
  let b: string = "world";
  console.log(a, b);
  console.log(pick(1), pick(-1));
  const p: P = { name: "Ann", age: 3 };
  console.log(p.name, p.age);
  const pet = new Pet("Rex");
  console.log(pet.call());
  b = "again";
  console.log(b);
  let t = "x";
  t = "y";
  console.log(t);
}
// expect: hello world
// expect: positive not positive
// expect: Ann 3
// expect: Rex
// expect: again
// expect: y
// case: string_reading_methods
// expect: h o e null null
// expect: h l   |
// expect: 104 101 108 null
// expect: -1 -1 5 2 -1 -1 -1 -1
// expect: null null null null null
// expect:     |
// expect: null null null null
// expect: -1 -1 0 0 -1 -1 -1 -1
// expect: h d é é null
// expect: h l   |
// expect: 104 233 108 null
// expect: -1 -1 11 2 -1 -1 -1 -1
// expect: a � � null null
// expect: a �   |
// expect: 97 128512 56832 null
// expect: 3 -1 6 2 3 -1 4 -1
// expect: � � � null null
// expect: �    |
// expect: 128512 56832 null null
// expect: -1 -1 2 2 -1 -1 0 -1
// expect: � � null null null
// expect: �    |
// expect: 55357 null null null
// expect: -1 -1 1 1 -1 -1 -1 -1
// expect: a c b null null
// expect: a c   |
// expect: 97 98 99 null
// expect: 4 3 6 2 1 -1 -1 -1
// `at`, `charAt`, `codePointAt` and `lastIndexOf` as node gives them, null for undefined.
function main(): void {
  const words = ["hello", "", "héllo wörld", "a😀b😀", "😀", "\uD83D", "abcabc"];
  for (const w of words) {
    console.log(w.at(0), w.at(-1), w.at(1), w.at(-10), w.at(99));
    console.log(w.charAt(0), w.charAt(2), w.charAt(-1), w.charAt(99), "|");
    console.log(w.codePointAt(0), w.codePointAt(1), w.codePointAt(2), w.codePointAt(99));
    console.log(w.lastIndexOf("b"), w.lastIndexOf("abc"), w.lastIndexOf(""), w.lastIndexOf("", 2), w.lastIndexOf("b", 3), w.lastIndexOf("b", -5), w.lastIndexOf("😀"), w.lastIndexOf("zz"));
  }
}
// case: string_reading_methods_comptime
// expect: d none o 104 7 128512 empty 2 -1
// The same methods while compiling.
function read(): string {
  const s = "héllo wörld";
  const e = "😀";
  return `${s.at(-1) ?? ""} ${s.at(99) ?? "none"} ${s.charAt(4)} ${s.codePointAt(0) ?? 0} ${s.codePointAt(99) ?? 7} ${e.codePointAt(0) ?? 0} ${"".at(0) ?? "empty"} ${"abcab".lastIndexOf("c")} ${s.lastIndexOf("z")}`;
}
const R = comptime read();
function main(): void { console.log(R); }
