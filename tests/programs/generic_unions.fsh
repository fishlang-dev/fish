// case: generic_unions_attempt
class CompileError {
  constructor(public message: string) {}
}

/** @throws {CompileError} */
type Parse<T> = (c: Mut<Cursor>) => T;

type Node = { kind: "num"; n: i64 } | { kind: "list"; items: Node[] };

class Name {
  constructor(public text: string) {}
}

class Cursor {
  pos: usize = 0;

  attempt<T>(this: Mut<this>, parse: Parse<T>): T | undefined {
    const pos = this.pos;
    try {
      return parse(this);
    } catch (e) {
      this.pos = pos;
      return undefined;
    }
  }
}

function show(n: Ref<Node>): string {
  if (n.kind === "num") return `${n.n}`;
  return `[${n.items.map(show).join(",")}]`;
}

function num(c: Mut<Cursor>, ok: boolean): Node throws CompileError {
  c.pos += 1;
  if (!ok) throw new CompileError("no");
  return { kind: "num", n: c.pos as i64 };
}

function main(): void {
  let c = new Cursor();
  const n = c.attempt((c) => c.pos + 1);
  console.log(n === undefined ? 0 : n!);
  const a = c.attempt((c) => num(c, true));
  console.log(a === undefined ? "none" : show(a), c.pos);
  const b = c.attempt((c) => num(c, false));
  console.log(b === undefined ? "none" : show(b), c.pos);
  const l = c.attempt((c): Node[] => [num(c, true), { kind: "list", items: [num(c, true)] }]);
  console.log(l === undefined ? "none" : l.map(show).join(" "), c.pos);
  const lost = c.attempt((c): Node[] => [num(c, true), num(c, false)]);
  console.log(lost === undefined ? "none" : "some", c.pos);
  const t = c.attempt((c): boolean => {
    if (c.pos > 100) throw new CompileError("far");
    return true;
  });
  console.log(t ?? false);
  const name = c.attempt((c): Name => {
    c.pos = 7;
    return new Name("nm");
  });
  console.log(name?.text ?? "none", c.pos);
  const dropped = c.attempt((c): Name => {
    c.pos = 9;
    const x = new Name("lost");
    if (x.text === "lost") throw new CompileError("x");
    return x;
  });
  console.log(dropped?.text ?? "none", c.pos);
  const s = c.attempt((_c): string | undefined => undefined);
  console.log(s ?? "flat");
}
// expect: 1
// expect: 1 1
// expect: none 1
// expect: 2 [3] 3
// expect: none 3
// expect: true
// expect: nm 7
// expect: none 7
// expect: flat
// case: generic_unions_attempt_release
// mode: release
class CompileError {
  constructor(public message: string) {}
}

/** @throws {CompileError} */
type Parse<T> = (c: Mut<Cursor>) => T;

class Cursor {
  pos: usize = 0;

  attempt<T>(this: Mut<this>, parse: Parse<T>): T | undefined {
    const pos = this.pos;
    try {
      return parse(this);
    } catch (e) {
      this.pos = pos;
      return undefined;
    }
  }
}

function word(c: Mut<Cursor>, ok: boolean): string throws CompileError {
  c.pos += 2;
  if (!ok) throw new CompileError("no");
  return `w${c.pos}`;
}

function main(): void {
  let c = new Cursor();
  console.log(c.attempt((c) => word(c, true)) ?? "none", c.pos);
  console.log(c.attempt((c) => word(c, false)) ?? "none", c.pos);
  const words = c.attempt((c): string[] => [word(c, true), word(c, false)]);
  console.log(words === undefined ? 0 : words.length, c.pos);
  const opt = c.attempt((c): string | null => (c.pos > 0 ? null : "x"));
  console.log(opt ?? "flat");
}
// expect: w2 2
// expect: none 2
// expect: 0 2
// expect: flat
// case: generic_unions_forms
class Box {
  constructor(public n: i64) {}
}

class Slot<T> {
  value: T | null = null;

  put(this: Mut<this>, v: T): void {
    this.value = v;
  }

  take(this: Mut<this>): T | null {
    const v = this.value.clone();
    this.value = null;
    return v;
  }

  has(): boolean {
    return this.value !== null;
  }
}

function first<T>(xs: T[]): T | undefined {
  if (xs.length === 0) return undefined;
  return xs[0]!.clone();
}

function orElse<T>(x: T | null, d: T): T {
  if (x === null) return d;
  return x;
}

function or<T>(x: T | null, d: T): T {
  return x ?? d;
}

function wrap<T>(x: T): T | null {
  let r: T | null = null;
  r = x;
  return r;
}

function nOf<T extends { n: i64 }>(x: T | null): i64 {
  return x?.n ?? -1;
}

function lookup<T>(m: Ref<Map<string, T | null>>, k: string): string {
  return m.get(k) === null ? "missing" : "found";
}

function count<T>(xs: Ref<(T | null)[]>): i64 {
  let n = 0;
  for (const x of xs) if (x !== null) n++;
  return n;
}

function viaClosure<T>(x: T): T | null {
  const f = (y: T): T | null => y;
  return f(x);
}

function main(): void {
  console.log(first([1, 2]) ?? 0, first<string>([]) ?? "empty");
  console.log(orElse(null, "d"), orElse("x", "d"), or<string>(null, "d"));
  const b = wrap(new Box(4));
  console.log(b === null ? -1 : b.n, wrap(true) ?? false);
  const xs = wrap([new Box(1), new Box(2)]);
  console.log(xs === null ? 0 : xs.length);
  console.log(nOf(new Box(3)), nOf<Box>(null));
  let s = new Slot<string>();
  console.log(s.has());
  s.put("one");
  s.put("two");
  console.log(s.has(), s.take() ?? "none", s.take() ?? "none");
  let m = new Map<string, string | null>();
  m.set("a", "A");
  console.log(lookup(m, "a"), lookup(m, "b"));
  const items: (string | null)[] = ["a", null, "b"];
  console.log(count(items));
  console.log(viaClosure([1, 2])?.length ?? 0);
}
// expect: 1 empty
// expect: d x d
// expect: 4 true
// expect: 2
// expect: 3 -1
// expect: false
// expect: true two none
// expect: found missing
// expect: 2
// expect: 2
// case: generic_unions_option_argument
class Box {
  constructor(public n: i64) {}
}

class Slot<T> {
  value: T | null = null;

  put(this: Mut<this>, v: T): void {
    this.value = v;
  }

  has(): boolean {
    return this.value !== null;
  }
}

function orElse<T>(x: T | undefined, d: T): T {
  if (x === undefined) return d;
  return x;
}

function or<T>(x: T | null, d: T): T {
  return x ?? d;
}

function present<T>(x: T | null): boolean {
  return x !== null;
}

function keep<T>(x: T | null): (T | null)[] {
  return [x, null];
}

function main(): void {
  // With T an Option, `T | undefined` is that Option: its empty value is the union's.
  const a: string | null = null;
  console.log(orElse<string | null>(a, "d") ?? "nothing");
  console.log(orElse<string | null>("s", null) ?? "nothing");
  console.log(orElse<string | null>(undefined, null) ?? "nothing");
  console.log(present<string | null>(null), present<i64 | null>(3));
  console.log(or<string | null>(null, "d") ?? "N", or<string | null>(null, null) ?? "N", or<Box | null>(new Box(2), null)?.n ?? 0);
  const k = keep<string | null>("a");
  console.log(k.length, k[0] ?? "N", k[1] ?? "N");
  let o = new Slot<string | null>();
  o.put(null);
  console.log(o.has());
  o.put("x");
  console.log(o.has());
  let u = new Slot<i64 | string>();
  u.put("u");
  console.log(u.has());
}
// expect: d
// expect: s
// expect: nothing
// expect: false true
// expect: d N 2
// expect: 2 a N
// expect: false
// expect: true
// expect: true
// case: generic_unions_option_argument_release
// mode: release
function orElse<T>(x: T | undefined, d: T): T {
  if (x === undefined) return d;
  return x;
}

function main(): void {
  console.log(orElse<string | null>(null, "d") ?? "nothing", orElse<string | null>(undefined, null) ?? "nothing");
  console.log(orElse<i64[]>([1, 2, 3], []).length, orElse<i64[]>(null, [4]).length);
}
// expect: d nothing
// expect: 3 1
// case: generic_unions_concrete_members
class Box {
  constructor(public n: i64) {}
}

type Shape = { kind: "sq"; s: i64 } | { kind: "ci"; r: i64 };

function describe<T>(x: T | string, f: (t: Ref<T>) => string): string {
  if (typeof x === "string") return `text ${x}`;
  return f(x);
}

function orText<T>(x: T | string): T | null {
  if (typeof x === "string") return null;
  return x;
}

function pick<T>(x: T | i64 | null, d: T): T | i64 {
  if (x === null) return d;
  return x;
}

function lit<T>(x: T | "none"): string {
  if (x === "none") return "none";
  return "some";
}

function zero<T>(x: T | 0): string {
  return x === 0 ? "zero" : "T";
}

function holder<T>(v: T): (T | string)[] {
  let xs: (T | string)[] = [];
  xs.push("start");
  xs.push(v);
  return xs;
}

function main(): void {
  console.log(describe(new Box(3), (b) => `box ${b.n}`), describe<Box>("hi", (b) => `box ${b.n}`), describe(5, (n) => `int ${n}`));
  // With T one of the concrete members, the union is just that member.
  console.log(describe<string>("same", (s) => `never ${s}`));
  console.log(orText<string>("s") ?? "null", orText(new Box(2))?.n ?? 0);
  const sh: Shape = { kind: "ci", r: 2 };
  const k = orText(sh);
  console.log(k === null ? "null" : k.kind);
  const p = pick<string>(null, "d");
  console.log(typeof p === "string" ? p : "int", pick<i64>(7, 1));
  const r = pick<boolean>(8, true);
  console.log(typeof r === "boolean" ? "bool" : `${r}`);
  console.log(lit<i64>(3), lit<i64>("none"), lit<string>("none"), lit<string>("x"));
  console.log(zero<i64>(0), zero<i64>(5), zero<string>("a"), zero<string>(0));
  console.log(holder(new Box(1)).length, holder("s").length);
}
// expect: box 3 text hi int 5
// expect: text same
// expect: null 2
// expect: ci
// expect: d 7
// expect: 8
// expect: some none none some
// expect: zero T T zero
// expect: 2 2
// case: generic_unions_concrete_members_release
// mode: release
function lit<T>(x: T | "none"): string {
  if (x === "none") return "none";
  return "some";
}

function orText<T>(x: T | string): T | null {
  if (typeof x === "string") return null;
  return x;
}

function main(): void {
  console.log(lit<i64>(3), lit<i64>("none"), lit<string>("none"), lit<string>("x"));
  console.log(orText<i64>(4) ?? 0, orText<i64>("s") ?? 0, orText<string>("s") ?? "null");
}
// expect: some none none some
// expect: 4 0 null
// case: generic_unions_unwrapped
function bad<T>(x: T | null): T {
  return x;
}

function main(): void {
  console.log(bad<i64>(1));
}
// error: type 'null | T' is not assignable to return type 'T'
// case: generic_unions_narrowed_concrete
function bad<T>(x: T | string): T {
  if (typeof x === "string") return x;
  return x;
}

function main(): void {
  console.log(bad<i64>(1));
}
// error: type 'string' is not assignable to return type 'T'
// case: generic_unions_number_literal
function h<T>(x: T | 0): boolean {
  return x === 0;
}

function sw<T>(x: T | 0 | 1): string {
  switch (x) {
    case 0:
      return "zero";
    case 1:
      return "one";
    default:
      return "T";
  }
}

const folded = comptime h<i32>(0);

function main(): void {
  // A literal meeting `T | 0` with T a number type is that number, as with `i32 | 0`.
  console.log(h<f64>(0), h<u8>(0), h<i32>(0), h<i64>(0), h<i32>(7 as i32), h<string>("x"));
  console.log(sw<i64>(0), sw<i64>(1), sw<i64>(2), sw<i32>(0), sw<i32>(1 as i32), sw<i32>(5 as i32), sw<string>(0), sw<string>("x"));
  console.log(folded);
}
// expect: true true true true false false
// expect: zero one T zero one T zero T
// expect: true
// case: generic_unions_number_literal_release
// mode: release
function h<T>(x: T | 0): boolean {
  return x === 0;
}

function main(): void {
  console.log(h<f64>(0), h<u8>(0), h<i32>(0), h<i64>(0), h<u8>(3 as u8));
}
// expect: true true true true false
// case: generic_unions_awaited
async function get<T>(x: T, ok: boolean): Promise<T | null> {
  if (ok) return x;
  return null;
}

async function chain<T>(x: T | null, d: T): Promise<T> {
  const r = await get<T | null>(x, true);
  if (r === null) return d;
  return r;
}

async function main(): Promise<void> {
  const a = await chain<string>(null, `d${0}`);
  const b = await chain<string>(`s${1}`, "d");
  const c = await chain<string | null>(null, `e${0}`);
  const d = await chain<string | null>(null, null);
  console.log(a, b);
  console.log(c ?? "N", d ?? "N");
}
// expect: d0 s1
// expect: e0 N
// case: generic_unions_compare_placeholder
function same<T>(x: T | null, y: T): boolean {
  return x === y;
}

function zero<T>(x: T | 0, y: T): boolean {
  return x === y;
}

function main(): void {
  console.log(same<string>("a", "a"), same<string>("a", "b"), same<i64>(null, 1), same<string | null>(null, null), same<i64 | string>(2, "2"));
  console.log(zero<string>(0, "x"), zero<i64>(0, 0));
}
// expect: true false false true false
// expect: false true
// case: generic_unions_number_literal_union_argument
function h<T>(x: T | 0): boolean {
  return x === 0;
}

function concrete(x: f64 | null | 0): boolean {
  return x === 0;
}

function sw<T>(x: T | 0 | 1): string {
  switch (x) {
    case 0:
    case 1:
      return "small";
    default:
      return "T";
  }
}

function fall<T>(x: T | 0): string {
  let s = "";
  switch (x) {
    case 0:
      s += "z";
    default:
      s += "d";
  }
  return s;
}

const folded = comptime h<f64 | null>(0);

function main(): void {
  // With T a union, `T | 0` is the union it flattens into, read as written out by hand.
  console.log(h<f64 | null>(0), h<f64 | null>(0.0), h<i32 | null>(0), h<f64 | null>(null), concrete(0), concrete(0.0));
  console.log(h<i32 | string>(0), h<i32 | string>(0 as i32), h<i32 | string>("a"));
  console.log(h<5>(0), h<5>(5), h<0>(0), h<bigint>(0), h<bigint>(0n), h<boolean>(0), h<boolean>(true));
  console.log(sw<i32 | string>(1), sw<i32 | string>(1 as i32), sw<i32 | string>(2 as i32), sw<i32 | string>("q"), sw<f64 | null>(1), sw<f64 | null>(null));
  console.log(fall<i32 | string>(0), fall<i32 | string>("a"), fall<f64>(0));
  console.log(folded);
}
// expect: true true true false true true
// expect: true true false
// expect: true false true true false true false
// expect: small small T T small T
// expect: zd d zd
// expect: true
// case: generic_unions_number_literal_union_argument_release
// mode: release
function h<T>(x: T | 0): boolean {
  return x === 0;
}

function main(): void {
  console.log(h<f64 | null>(0), h<i32 | string>(0), h<i32 | string>("a"), h<u8 | null>(null));
}
// expect: true true false false
// case: generic_unions_promise_parameter
async function get<T>(x: T): Promise<T | null> {
  return x;
}

async function none<T>(): Promise<T | null> {
  return null;
}

async function take<T>(p: Promise<T | null>, d: T): Promise<T> {
  const r = await p;
  if (r === null) return d;
  return r;
}

class Box<T> {
  v: T;

  constructor(v: T) {
    this.v = v;
  }

  async refill(this: Mut<this>, p: Promise<T | null>, d: T): Promise<void> {
    const r = await p;
    if (r === null) {
      this.v = d;
      return;
    }
    this.v = r;
  }
}

async function main(): Promise<void> {
  const a = await take<string>(get<string>(`a${1}`), "d");
  const b = await take<string | null>(get<string | null>(`b${1}`), "d");
  const c = await take(get<string>(`c${1}`), "d");
  const n = await take(none<string>(), `n${1}`);
  console.log(a, b ?? "N", c, n);
  let box = new Box<string | null>(null);
  await box.refill(get<string | null>(`z${1}`), "d");
  console.log(box.v ?? "N");
  await box.refill(none<string | null>(), `e${2}`);
  console.log(box.v ?? "N");
  let plain = new Box<string>("s");
  await plain.refill(get<string>(`w${3}`), "d");
  console.log(plain.v);
}
// expect: a1 b1 c1 n1
// expect: z1
// expect: e2
// expect: w3
