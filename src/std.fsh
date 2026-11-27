import type { Compilation } from "./compilation.fsh";
import type { CompileError, Source } from "./diag.fsh";
import { AST } from "./ast.fsh";
import { nextId, renumberStmts, Rewrites, someNode, walk, type AnyNode } from "./nodes.fsh";
import { rebuiltStmts } from "./rebuild.fsh";
import { parse, type Pattern, type Stmt, type TypeNode } from "./parser.fsh";
import { SIMD_MASKS, SIMD_TYPES, TYPED_ARRAY_NAMES } from "./typing.fsh";

// Fish's std library, as Fish source checked with each program. The prelude goes into every
// program; the HTTP library only into one that names it.

const PRELUDE = `
type TemplateStringsArray = string[];
function* __arrayEntries<T>(xs: Ref<T[]>): Generator<[i64, T]> {
  let i = 0;
  for (const x of xs) {
    yield [i, x.clone()];
    i++;
  }
}
function* __arrayKeys<T>(xs: Ref<T[]>): Generator<i64> {
  for (let i = 0; i < (xs.length as i64); i++) yield i;
}
function* __arrayValues<T>(xs: Ref<T[]>): Generator<T> {
  for (const x of xs) yield x.clone();
}
// Number.isNaN and its siblings, given the number as an f64. They leave Math alone, which a
// program may declare a Math of its own over.
function __numberIsNan(x: f64): boolean {
  return x !== x;
}

function __numberIsFinite(x: f64): boolean {
  return x - x === 0.0;
}

function __numberIsInteger(x: f64): boolean {
  return __numberIsFinite(x) && x % 1.0 === 0.0;
}

function __numberIsSafeInteger(x: f64): boolean {
  return __numberIsInteger(x) && x <= 9007199254740991.0 && x >= -9007199254740991.0;
}

function __arrayChars(s: string): string[] {
  let out: string[] = [];
  for (const c of s) out.push(c);
  return out;
}
function __arrayCollect<T>(g: Generator<T>): T[] {
  let out: T[] = [];
  for (const x of g) out.push(x);
  return out;
}
function* __iterMap<T, U>(g: Generator<T>, f: (value: T, index: i64) => U): Generator<U> {
  let i = 0;
  for (const x of g) {
    yield f(x, i);
    i++;
  }
}
function* __iterFilter<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): Generator<T> {
  let i = 0;
  for (const x of g) {
    if (f(x, i)) yield x;
    i++;
  }
}
function* __iterTake<T>(g: Generator<T>, n: i64): Generator<T> {
  if (n === 0) return;
  let i = 0;
  for (const x of g) {
    yield x;
    i++;
    if (i === n) return;
  }
}
function* __iterDrop<T>(g: Generator<T>, n: i64): Generator<T> {
  let i = 0;
  for (const x of g) {
    if (i < n) i++;
    else yield x;
  }
}
function* __iterFlatMap<T, U>(g: Generator<T>, f: (value: T, index: i64) => U[]): Generator<U> {
  let i = 0;
  for (const x of g) {
    // ponytail: each element is cloned, since a loop over an array lends them; moving them out
    // needs an owning loop over arrays.
    const ys = f(x, i);
    for (const y of ys) yield y.clone();
    i++;
  }
}
function* __iterFlatMapGenerator<T, U, G extends Generator<U>>(g: Generator<T>, f: (value: T, index: i64) => G): Generator<U> {
  let i = 0;
  for (const x of g) {
    const ys = f(x, i);
    yield* ys;
    i++;
  }
}
function __iterReduce<T, A>(g: Generator<T>, f: (accumulator: A, value: T, index: i64) => A, init: A): A {
  let acc = init;
  let i = 0;
  for (const x of g) {
    acc = f(acc, x, i);
    i++;
  }
  return acc;
}
// The fold in a one-element tuple, so a 'T' that may itself be null isn't taken for empty.
function __iterReduceFirst<T>(g: Generator<T>, f: (accumulator: T, value: T, index: i64) => T): [T] | null {
  let it = g;
  const first = it.next();
  if (first.done === true) return null;
  let acc = first.value;
  let i = 1;
  for (const x of it) {
    acc = f(acc, x, i);
    i++;
  }
  return [acc];
}
function __iterForEach<T>(g: Generator<T>, f: (value: T, index: i64) => void) {
  let i = 0;
  for (const x of g) {
    f(x, i);
    i++;
  }
}
function __iterSome<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): boolean {
  let i = 0;
  for (const x of g) {
    if (f(x, i)) return true;
    i++;
  }
  return false;
}
function __iterEvery<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): boolean {
  let i = 0;
  for (const x of g) {
    if (!f(x, i)) return false;
    i++;
  }
  return true;
}
function __iterFind<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): T | null {
  let i = 0;
  for (const x of g) {
    if (f(x, i)) return x;
    i++;
  }
  return null;
}
// The count 'take' or 'drop' was given, or nothing when it is negative, which panics at the call.
function __iterCount(n: i64): i64 | null {
  if (n < 0) return null;
  return n;
}
function __arrayRange(n: i64): i64[] {
  let out: i64[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}
function __arrayFilled<T>(n: i64, x: T): T[] {
  let out: T[] = [];
  if (n === 0) return out;
  out.reserve(n);
  for (let i = 1; i < n; i++) out.push(x.clone());
  out.push(x);
  return out;
}
class AbortError { message: string = "This operation was aborted"; }
// What awaiting 'handle.join()' throws when the task panicked: its panic's reason.
class TaskPanic { message: string; constructor(message: string) { this.message = message; } }
// What a property test draws its inputs from: SplitMix64, seeded by FISH_PROP_SEED when a run
// replays one, else by the clock, so each run tries inputs the last didn't.
class PropRandom {
  state: u64;
  constructor(seed: u64) { this.state = seed; }
  next(this: Mut<this>): u64 {
    this.state = this.state.wrappingAdd(0x9e3779b97f4a7c15);
    let z = this.state;
    z = (z ^ (z >> 30)).wrappingMul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrappingMul(0x94d049bb133111eb);
    return z ^ (z >> 31);
  }
  below(this: Mut<this>, n: i64): i64 {
    return n <= 0 ? 0 : (this.next() % (n as u64)) as i64;
  }
}
declare function fsh_rt_getenv(name: Ptr<u8>): Ptr<u8>;
function __propSeed(): u64 {
  let given = "";
  unsafe {
    const p = fsh_rt_getenv(cString("FISH_PROP_SEED"));
    if (!p.isNull()) given = fromCString(p);
  }
  const parsed = given === "" ? null : parseInt(given);
  return parsed !== null ? parsed as u64 : Date.now() as u64;
}
// The values a property's integers start from, which a wide or narrow type reads as its own.
const __PROP_EDGES: i64[] = [0, 1, -1, 2, 127, -128, 255, 256, 32767, -32768, 65535, 2147483647, -2147483648, 4294967295, 9223372036854775807, -9223372036854775807 - 1];
function __propInteger(r: Mut<PropRandom>, size: i64): i64 {
  if (r.below(8) === 0) return __PROP_EDGES[r.below(__PROP_EDGES.length as i64) as usize];
  const bound = size + 1;
  return r.below(2 * bound + 1) - bound;
}
function __propShrinkInteger(v: i64): i64[] {
  let out: i64[] = [];
  if (v === 0) return out;
  out.push(0);
  if (v < 0 && v > -9223372036854775807) out.push(-v);
  let step = v / 2;
  while (step !== 0 && out.length < 24) {
    out.push(v - step);
    step = step / 2;
  }
  return out;
}
const __PROP_FLOATS: f64[] = [0.0, -0.0, 1.0, -1.0, 0.5, 1e300, -1e-300, 1.0 / 0.0, -1.0 / 0.0, 0.0 / 0.0];
function __propFloat(r: Mut<PropRandom>, size: i64): f64 {
  if (r.below(8) === 0) return __PROP_FLOATS[r.below(__PROP_FLOATS.length as i64) as usize];
  return ((r.below(2000001) - 1000000) as f64) / 1000000.0 * ((size + 1) as f64);
}
function __propShrinkFloat(v: f64): f64[] {
  let out: f64[] = [];
  if (v === 0.0 || v !== v) return out;
  out.push(0.0);
  // Truncated by hand, since a program may declare its own Math; a value this large is already whole.
  const whole = v > -9.0e18 && v < 9.0e18 ? ((v as i64) as f64) : v;
  if (whole !== v && whole - whole === 0.0) out.push(whole);
  if (v - v === 0.0 && v / 2.0 !== v) out.push(v / 2.0);
  return out;
}
function __propBoolean(r: Mut<PropRandom>): boolean {
  return r.below(2) === 1;
}
function __propPick(r: Mut<PropRandom>, n: i64): i64 {
  return r.below(n);
}
function __propLength(r: Mut<PropRandom>, size: i64): i64 {
  return r.below(size / 4 + 2);
}
const __PROP_PIECES: string[] = ["a", "b", "z", "A", "Z", "0", "9", " ", "-", "_", ".", "/", "%", "é", "ß", "中", "😀", "\\u0000", "\\n"];
function __propString(r: Mut<PropRandom>, size: i64): string {
  const n = __propLength(r, size);
  let s = "";
  for (let i = 0; i < n; i++) {
    if (r.below(3) === 0) s += __PROP_PIECES[r.below(__PROP_PIECES.length as i64) as usize];
    else s += String.fromCharCode((32 + r.below(95)) as u16);
  }
  return s;
}
function __propShrinkString(v: Ref<string>): string[] {
  let out: string[] = [];
  const n = v.length as i64;
  if (n === 0) return out;
  out.push("");
  if (n > 1) {
    out.push(v.slice(0, n / 2));
    out.push(v.slice(n / 2));
  }
  for (let i: i64 = 0; i < n && i < 16; i++) out.push(v.slice(0, i) + v.slice(i + 1));
  return out;
}
class IoError {
  message: string;
  code: string = "";
  syscall: string = "";
  path: string | null = null;
  constructor(message: string) { this.message = message; }
}
class JsonError { message: string; constructor(message: string) { this.message = message; } }
interface ErrorLike { name: string; message: string; }
type ErrorOptions = { cause?: Dyn<ErrorLike> };
class Error {
  name: string = "Error";
  message: string;
  cause: Dyn<ErrorLike> | null = null;
  constructor(message?: string, options?: ErrorOptions) {
    this.message = message ?? "";
    this.cause = options?.cause ?? null;
  }
}
// What JavaScript throws for a value of the wrong kind, as 'new URL' does for one that isn't a URL.
class TypeError {
  name: string = "TypeError";
  message: string;
  cause: Dyn<ErrorLike> | null = null;
  constructor(message?: string, options?: ErrorOptions) {
    this.message = message ?? "";
    this.cause = options?.cause ?? null;
  }
}
// Error's fields of its own, printing as an Error does, until a generic class can extend one.
class AggregateError<E> {
  name: string = "AggregateError";
  message: string = "All promises were rejected";
  cause: Dyn<ErrorLike> | null = null;
  errors: E[];
  constructor(errors: E[]) { this.errors = errors; }
}
// new Promise(executor): the executor runs now, given callables that settle a one-value cell,
// which the promise awaits. The first settle closes the cell, so a later one is dropped. A cell
// never settled is never closed, so its promise waits forever, as JavaScript's does.
function __promiseCell<T, E>(executor: (resolve: (value: T) => void, reject: (reason: E) => void) => void): Channel<{ ok: true; value: T } | { ok: false; reason: E }> {
  const cell = new Channel<{ ok: true; value: T } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  executor((value) => { resolved.settle({ ok: true, value }); }, (reason) => { rejected.settle({ ok: false, reason }); });
  return cell;
}
async function __promiseAwait<T, E>(cell: Channel<{ ok: true; value: T } | { ok: false; reason: E }>): Promise<T> throws E {
  // Never empty: the cell closes holding its value.
  while (true) {
    const got = await cell.receive();
    if (got !== null) {
      if (got.ok === true) return got.value;
      throw got.reason;
    }
  }
}
function __promiseCellVoid<E>(executor: (resolve: () => void, reject: (reason: E) => void) => void): Channel<{ ok: true } | { ok: false; reason: E }> {
  const cell = new Channel<{ ok: true } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  executor(() => { resolved.settle({ ok: true }); }, (reason) => { rejected.settle({ ok: false, reason }); });
  return cell;
}
async function __promiseAwaitVoid<E>(cell: Channel<{ ok: true } | { ok: false; reason: E }>): Promise<void> throws E {
  while (true) {
    const got = await cell.receive();
    if (got !== null) {
      if (got.ok === true) return;
      throw got.reason;
    }
  }
}
// One whose executor takes no reject can't fail, so it may be stored as a Promise<T>.
// The value is wrapped, as a Channel can't carry an Option.
function __promiseCellResolve<T>(executor: (resolve: (value: T) => void) => void): Channel<{ value: T }> {
  const cell = new Channel<{ value: T }>(1);
  const resolved = cell.clone();
  executor((value) => { resolved.settle({ value }); });
  return cell;
}
async function __promiseAwaitResolve<T>(cell: Channel<{ value: T }>): Promise<T> {
  while (true) {
    const got = await cell.receive();
    if (got !== null) return got.value;
  }
}
function __promiseCellResolveVoid(executor: (resolve: () => void) => void): Channel<boolean> {
  const cell = new Channel<boolean>(1);
  const resolved = cell.clone();
  executor(() => { resolved.settle(true); });
  return cell;
}
async function __promiseAwaitResolveVoid(cell: Channel<boolean>): Promise<void> {
  while (true) {
    const got = await cell.receive();
    if (got !== null) return;
  }
}
// Promise.withResolvers(): the cell, the promise awaiting it and the closures settling it.
function __promiseWithResolvers<T, E>() {
  const cell = new Channel<{ ok: true; value: T } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  return {
    promise: __promiseAwait<T, E>(cell),
    resolve: (value: T) => { resolved.settle({ ok: true, value }); },
    reject: (reason: E) => { rejected.settle({ ok: false, reason }); },
  };
}
function __promiseWithResolversVoid<E>() {
  const cell = new Channel<{ ok: true } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  return {
    promise: __promiseAwaitVoid<E>(cell),
    resolve: () => { resolved.settle({ ok: true }); },
    reject: (reason: E) => { rejected.settle({ ok: false, reason }); },
  };
}
// A timer's id, which setTimeout and setInterval give and clearTimeout and clearInterval take.
type Timeout = i64;
// The runtime keeps the timers, earliest first, and this one task runs each callback in turn. It
// ends once main has returned and no timer is left.
async function __timerLoop(): Promise<void> {
  while (true) {
    const next = await timerNext();
    if (next !== null) {
      await next();
    } else {
      // An async callback still running may set another timer, so the program waits for it.
      // ponytail: polled every millisecond; wake the loop from the callback's end if that shows up
      if (__timerRunning.load() === 0) return;
      await sleep(1);
    }
  }
}
// An async callback runs as a task of its own, as JavaScript's runs on while later timers fire,
// so one awaiting another timer doesn't stop the timer task that would fire it. Its first part
// runs at once, so timers due together still run in the order they were set.
const __timerRunning = new Atomic(0);
function __timerDetached(callback: () => Promise<void>): () => Promise<void> {
  return async () => {
    __timerRunning.add(1);
    __timerSpawn(__timerRun(callback()));
  };
}
async function __timerRun(running: Promise<void>): Promise<void> {
  await running;
  __timerRunning.sub(1);
}
function __timeoutClear(id: Timeout | null): void {
  if (id !== null) timerClear(id);
}
// Promise.resolve(v) and Promise.reject(e).
async function __promiseResolve<T>(value: T): Promise<T> { return value; }
async function __promiseResolveVoid(): Promise<void> {}
async function __promiseReject<T, E>(reason: E): Promise<T> throws E { throw reason; }
async function __promiseRejectVoid<E>(reason: E): Promise<void> throws E { throw reason; }
class ParseArgsError {
  message: string;
  code: string;
  constructor(code: string, message: string) { this.code = code; this.message = message; }
}
class TextEncoder { encode(input: string): u8[] { return utf8Encode(input); } }
class TextDecoder {
  constructor(_label?: "utf-8" | "utf8", _options?: { fatal?: false }) {}
  decode(input: Ref<u8[]>): string { return utf8Decode(input); }
}
// What the loader makes 'new TextDecoder(label, { fatal: true })', whose decode throws rather than
// give U+FFFD. Only input that isn't UTF-8 changes on its way back to bytes.
class __FatalTextDecoder {
  constructor(_label?: "utf-8" | "utf8", _options?: { fatal: true }) {}
  decode(input: Ref<u8[]>): string throws TypeError {
    const text = new TextDecoder().decode(input);
    const back = new TextEncoder().encode(text);
    const bom: usize = input.length >= 3 && input[0] === 0xEF && input[1] === 0xBB && input[2] === 0xBF ? 3 : 0;
    let same = back.length + bom === input.length;
    for (let i: usize = 0; same && i < back.length; i++) same = back[i] === input[i + bom];
    if (!same) throw new TypeError("The encoded data was not valid for encoding utf-8");
    return text;
  }
}
`;

// The Fetch API's Headers, Request and Response.
const HTTP2 = String.raw`
// HTTP/2, in the server and fetch alike: frames, HPACK and flow control, per RFC 9113 and 7541.
// A HPACK integer, or text, and the index just past it.
type __h2Int = { value: i64; next: usize };
type __h2Text = { value: string; next: usize };
// What a connection's responders share with its reader: the peer's send windows by stream, the
// connection's under 0, the largest frame and the initial window the peer's settings give, and
// how many streams are being answered.
type __h2State = { windows: Lock<Map<i64, i64>>; frame: Atomic<i64>; initial: Atomic<i64>; active: Atomic<i64> };
// A response read from one stream: its status, headers, body and any trailers.
type __h2Reply = { status: i64; headers: Headers; body: u8[]; trailers: Headers };

// One connection's HPACK decoder: the dynamic table, oldest first, and the Huffman code, keyed
// by its length times 2^32 plus its bits.
class Http2Hpack {
  names: string[] = [];
  values: string[] = [];
  sizes: i64[] = [];
  size: i64 = 0;
  max: i64 = 4096;
  statics: string[];
  codes: Map<i64, i64> = new Map();

  constructor() {
    this.statics = Http2.statics();
    const codes = Http2.huffmanCodes();
    const lengths = Http2.huffmanLengths();
    for (let i: usize = 0; i < 256; i++) this.codes.set((lengths[i] << 32) | codes[i], i as i64);
    this.codes.set((30 << 32) | 1073741823, 256);
  }

  // A header block's fields as name then value, or null when it isn't valid HPACK. A table size
  // update may not go past limit, the size this side's settings allow.
  decode(this: Mut<this>, block: Ref<u8[]>, limit: i64): string[] | null {
    let out: string[] = [];
    let at: usize = 0;
    while (at < block.length) {
      const b = block[at] as i64;
      if ((b & 128) !== 0) {
        const n = Http2.integer(block, at, 7);
        if (n === null) return null;
        const f = this.field(n.value);
        if (f === null) return null;
        out.push(f[0]);
        out.push(f[1]);
        at = n.next;
      } else if ((b & 224) === 32) {
        const n = Http2.integer(block, at, 5);
        if (n === null || n.value > limit) return null;
        this.max = n.value;
        this.evict();
        at = n.next;
      } else {
        const indexing = (b & 192) === 64;
        const n = Http2.integer(block, at, indexing ? 6 : 4);
        if (n === null) return null;
        let name = "";
        let next = n.next;
        if (n.value === 0) {
          const s = this.text(block, next);
          if (s === null) return null;
          name = s.value;
          next = s.next;
        } else {
          const f = this.field(n.value);
          if (f === null) return null;
          name = f[0];
        }
        const v = this.text(block, next);
        if (v === null) return null;
        out.push(name);
        out.push(v.value);
        if (indexing) this.add(name, v.value);
        at = v.next;
      }
    }
    return out;
  }

  // The name and value at a table index: the static table's 61, then the dynamic table newest first.
  field(this: Ref<this>, index: i64): string[] | null {
    if (index <= 0) return null;
    if (index <= 61) return [this.statics[((index - 1) * 2) as usize], this.statics[((index - 1) * 2 + 1) as usize]];
    const back = index - 62;
    if (back >= (this.names.length as i64)) return null;
    const at = (this.names.length as i64 - 1 - back) as usize;
    return [this.names[at], this.values[at]];
  }

  add(this: Mut<this>, name: string, value: string) {
    const size = (new TextEncoder().encode(name).length + new TextEncoder().encode(value).length) as i64 + 32;
    this.names.push(name);
    this.values.push(value);
    this.sizes.push(size);
    this.size += size;
    this.evict();
  }

  // Drops the oldest entries until the table fits its size, which empties it for an entry larger
  // than the whole table.
  evict(this: Mut<this>) {
    while (this.size > this.max && this.sizes.length > 0) {
      const gone = this.sizes.shift();
      if (gone !== null) this.size -= gone;
      this.names.shift();
      this.values.shift();
    }
  }

  // A string literal at an index: its length, then its bytes, Huffman-coded when the top bit is set.
  text(this: Ref<this>, block: Ref<u8[]>, at: usize): __h2Text | null {
    if (at >= block.length) return null;
    const huffman = ((block[at] as i64) & 128) !== 0;
    const n = Http2.integer(block, at, 7);
    if (n === null) return null;
    const end = n.next + (n.value as usize);
    if (end > block.length) return null;
    let raw: u8[] = [];
    for (let i = n.next; i < end; i++) raw.push(block[i]);
    if (!huffman) return { value: new TextDecoder().decode(raw), next: end };
    const decoded = this.unhuffman(raw);
    if (decoded === null) return null;
    return { value: new TextDecoder().decode(decoded), next: end };
  }

  // Huffman-coded bytes decoded a bit at a time, or null when they hold the EOS code or end in
  // anything but at most seven bits of its leading ones.
  // ponytail: a map lookup per bit; a table walked a byte at a time would be faster for long values.
  unhuffman(this: Ref<this>, raw: Ref<u8[]>): u8[] | null {
    let out: u8[] = [];
    let code: i64 = 0;
    let length: i64 = 0;
    for (const byte of raw) {
      for (let bit: i64 = 7; bit >= 0; bit--) {
        code = (code << 1) | (((byte as i64) >> bit) & 1);
        length += 1;
        const symbol = this.codes.get((length << 32) | code);
        if (symbol !== null) {
          if (symbol === 256) return null;
          out.push(symbol as u8);
          code = 0;
          length = 0;
        } else if (length >= 30) return null;
      }
    }
    if (length > 7 || code !== (1 << length) - 1) return null;
    return out;
  }
}

// A stream a client opened on a connection the server reads: its header block until it ends,
// then its fields, its body so far, and the signal its request carries.
class Http2Stream {
  id: i64;
  block: u8[] = [];
  fields: string[] = [];
  body: u8[] = [];
  headed: boolean = false;
  ended: boolean = false;
  client: AbortController = new AbortController();

  constructor(id: i64) {
    this.id = id;
  }
}

class Http2 {
  // RFC 7541's static table, name then value.
  static statics(): string[] {
    return [
      ":authority", "", ":method", "GET", ":method", "POST", ":path", "/", ":path", "/index.html",
      ":scheme", "http", ":scheme", "https", ":status", "200", ":status", "204", ":status", "206",
      ":status", "304", ":status", "400", ":status", "404", ":status", "500", "accept-charset", "",
      "accept-encoding", "gzip, deflate", "accept-language", "", "accept-ranges", "", "accept", "",
      "access-control-allow-origin", "", "age", "", "allow", "", "authorization", "",
      "cache-control", "", "content-disposition", "", "content-encoding", "", "content-language", "",
      "content-length", "", "content-location", "", "content-range", "", "content-type", "",
      "cookie", "", "date", "", "etag", "", "expect", "", "expires", "", "from", "", "host", "",
      "if-match", "", "if-modified-since", "", "if-none-match", "", "if-range", "",
      "if-unmodified-since", "", "last-modified", "", "link", "", "location", "", "max-forwards", "",
      "proxy-authenticate", "", "proxy-authorization", "", "range", "", "referer", "", "refresh", "",
      "retry-after", "", "server", "", "set-cookie", "", "strict-transport-security", "",
      "transfer-encoding", "", "user-agent", "", "vary", "", "via", "", "www-authenticate", "",
    ];
  }

  // RFC 7541's Huffman code for each byte, and its length in bits.
  static huffmanCodes(): i64[] {
    return [
      8184, 8388568, 268435426, 268435427, 268435428, 268435429, 268435430, 268435431, 268435432,
      16777194, 1073741820, 268435433, 268435434, 1073741821, 268435435, 268435436, 268435437,
      268435438, 268435439, 268435440, 268435441, 268435442, 1073741822, 268435443, 268435444,
      268435445, 268435446, 268435447, 268435448, 268435449, 268435450, 268435451, 20, 1016, 1017,
      4090, 8185, 21, 248, 2042, 1018, 1019, 249, 2043, 250, 22, 23, 24, 0, 1, 2, 25, 26, 27, 28, 29,
      30, 31, 92, 251, 32764, 32, 4091, 1020, 8186, 33, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102,
      103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 252, 115, 253, 8187, 524272, 8188,
      16380, 34, 32765, 3, 35, 4, 36, 5, 37, 38, 39, 6, 116, 117, 40, 41, 42, 7, 43, 118, 44, 8, 9,
      45, 119, 120, 121, 122, 123, 32766, 2044, 16381, 8189, 268435452, 1048550, 4194258, 1048551,
      1048552, 4194259, 4194260, 4194261, 8388569, 4194262, 8388570, 8388571, 8388572, 8388573,
      8388574, 16777195, 8388575, 16777196, 16777197, 4194263, 8388576, 16777198, 8388577, 8388578,
      8388579, 8388580, 2097116, 4194264, 8388581, 4194265, 8388582, 8388583, 16777199, 4194266,
      2097117, 1048553, 4194267, 4194268, 8388584, 8388585, 2097118, 8388586, 4194269, 4194270,
      16777200, 2097119, 4194271, 8388587, 8388588, 2097120, 2097121, 4194272, 2097122, 8388589,
      4194273, 8388590, 8388591, 1048554, 4194274, 4194275, 4194276, 8388592, 4194277, 4194278,
      8388593, 67108832, 67108833, 1048555, 524273, 4194279, 8388594, 4194280, 33554412, 67108834,
      67108835, 67108836, 134217694, 134217695, 67108837, 16777201, 33554413, 524274, 2097123,
      67108838, 134217696, 134217697, 67108839, 134217698, 16777202, 2097124, 2097125, 67108840,
      67108841, 268435453, 134217699, 134217700, 134217701, 1048556, 16777203, 1048557, 2097126,
      4194281, 2097127, 2097128, 8388595, 4194282, 4194283, 33554414, 33554415, 16777204, 16777205,
      67108842, 8388596, 67108843, 134217702, 67108844, 67108845, 134217703, 134217704, 134217705,
      134217706, 134217707, 268435454, 134217708, 134217709, 134217710, 134217711, 134217712, 67108846
    ];
  }

  static huffmanLengths(): i64[] {
    return [
      13, 23, 28, 28, 28, 28, 28, 28, 28, 24, 30, 28, 28, 30, 28, 28, 28, 28, 28, 28, 28, 28, 30, 28,
      28, 28, 28, 28, 28, 28, 28, 28, 6, 10, 10, 12, 13, 6, 8, 11, 10, 10, 8, 11, 8, 6, 6, 6, 5, 5, 5,
      6, 6, 6, 6, 6, 6, 6, 7, 8, 15, 6, 12, 10, 13, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
      7, 7, 7, 7, 7, 7, 8, 7, 8, 13, 19, 13, 14, 6, 15, 5, 6, 5, 6, 5, 6, 6, 6, 5, 7, 7, 6, 6, 6, 5,
      6, 7, 6, 5, 5, 6, 7, 7, 7, 7, 7, 15, 11, 14, 13, 28, 20, 22, 20, 20, 22, 22, 22, 23, 22, 23, 23,
      23, 23, 23, 24, 23, 24, 24, 22, 23, 24, 23, 23, 23, 23, 21, 22, 23, 22, 23, 23, 24, 22, 21, 20,
      22, 22, 23, 23, 21, 23, 22, 22, 24, 21, 22, 23, 23, 21, 21, 22, 21, 23, 22, 23, 23, 20, 22, 22,
      22, 23, 22, 22, 23, 26, 26, 20, 19, 22, 23, 22, 25, 26, 26, 26, 27, 27, 26, 24, 25, 19, 21, 26,
      27, 27, 26, 27, 24, 21, 21, 26, 26, 28, 27, 27, 27, 20, 24, 20, 21, 22, 21, 21, 23, 22, 22, 25,
      25, 24, 24, 26, 23, 26, 27, 26, 26, 27, 27, 27, 27, 27, 28, 27, 27, 27, 27, 27, 26
    ];
  }

  // A HPACK integer whose first byte keeps prefix bits for it.
  static integer(block: Ref<u8[]>, at: usize, prefix: i64): __h2Int | null {
    if (at >= block.length) return null;
    const mask = (1 << prefix) - 1;
    let value = (block[at] as i64) & mask;
    let i = at + 1;
    if (value < mask) return { value: value, next: i };
    let shift: i64 = 0;
    while (true) {
      if (i >= block.length || shift > 28) return null;
      const c = block[i] as i64;
      value += (c & 127) << shift;
      shift += 7;
      i += 1;
      if ((c & 128) === 0) return { value: value, next: i };
    }
  }

  static putInteger(out: Mut<u8[]>, value: i64, prefix: i64, first: i64) {
    const max = (1 << prefix) - 1;
    if (value < max) {
      out.push((first | value) as u8);
      return;
    }
    out.push((first | max) as u8);
    let left = value - max;
    while (left >= 128) {
      out.push(((left & 127) | 128) as u8);
      left = left >> 7;
    }
    out.push(left as u8);
  }

  // A string literal as sent: never Huffman-coded, which costs a few bytes and no table.
  static putText(out: Mut<u8[]>, text: string) {
    const bytes = new TextEncoder().encode(text);
    Http2.putInteger(out, bytes.length as i64, 7, 0);
    for (const b of bytes) out.push(b);
  }

  // A field as a literal the peer doesn't add to its table, so this side keeps no encoder table.
  static putField(out: Mut<u8[]>, name: string, value: string) {
    out.push(0 as u8);
    Http2.putText(out, name);
    Http2.putText(out, value);
  }

  // :status, from the static table when it is there.
  static putStatus(out: Mut<u8[]>, status: i64) {
    const known = [200, 204, 206, 304, 400, 404, 500];
    for (let i: usize = 0; i < known.length; i++) {
      if (known[i] === status) {
        Http2.putInteger(out, 8 + (i as i64), 7, 128);
        return;
      }
    }
    Http2.putInteger(out, 8, 4, 0);
    Http2.putText(out, String(status));
  }

  // A frame: its 24-bit length, type, flags and stream, then the payload.
  static frame(kind: i64, flags: i64, id: i64, payload: Ref<u8[]>): u8[] {
    const n = payload.length as i64;
    let out: u8[] = [];
    out.reserve(n + 9);
    out.push(((n >> 16) & 255) as u8);
    out.push(((n >> 8) & 255) as u8);
    out.push((n & 255) as u8);
    out.push(kind as u8);
    out.push(flags as u8);
    Http2.putU32(out, id & 2147483647);
    for (const b of payload) out.push(b);
    return out;
  }

  static putU32(out: Mut<u8[]>, n: i64) {
    out.push(((n >> 24) & 255) as u8);
    out.push(((n >> 16) & 255) as u8);
    out.push(((n >> 8) & 255) as u8);
    out.push((n & 255) as u8);
  }

  static u32(b: Ref<u8[]>, at: usize): i64 {
    return ((b[at] as i64) << 24) | ((b[at + 1] as i64) << 16) | ((b[at + 2] as i64) << 8) | (b[at + 3] as i64);
  }

  // A SETTINGS frame of identifier, value pairs.
  static settings(pairs: Ref<i64[]>): u8[] {
    let payload: u8[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      payload.push(((pairs[i] >> 8) & 255) as u8);
      payload.push((pairs[i] & 255) as u8);
      Http2.putU32(payload, pairs[i + 1]);
    }
    return Http2.frame(4, 0, 0, payload);
  }

  static windowUpdate(id: i64, n: i64): u8[] {
    let payload: u8[] = [];
    Http2.putU32(payload, n);
    return Http2.frame(8, 0, id, payload);
  }

  static reset(id: i64, code: i64): u8[] {
    let payload: u8[] = [];
    Http2.putU32(payload, code);
    return Http2.frame(3, 0, id, payload);
  }

  static goaway(last: i64, code: i64): u8[] {
    let payload: u8[] = [];
    Http2.putU32(payload, last);
    Http2.putU32(payload, code);
    return Http2.frame(7, 0, 0, payload);
  }

  // A header block as a HEADERS frame and as many CONTINUATIONs as the peer's frame size needs.
  static headers(id: i64, block: Ref<u8[]>, end: boolean, max: i64): u8[] {
    let out: u8[] = [];
    const n = block.length as i64;
    let at: i64 = 0;
    let first = true;
    while (first || at < n) {
      const take = n - at < max ? n - at : max;
      let piece: u8[] = [];
      for (let i = at; i < at + take; i++) piece.push(block[i as usize]);
      at += take;
      const flags = (at >= n ? 4 : 0) | (first && end ? 1 : 0);
      for (const b of Http2.frame(first ? 1 : 9, flags, id, piece)) out.push(b);
      first = false;
    }
    return out;
  }

  static preface(): u8[] {
    return new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  }

  // Whether what a connection has sent so far is the start of the preface, up to all of it.
  static prefaceSoFar(buffer: Ref<u8[]>): boolean {
    const want = Http2.preface();
    if (buffer.length === 0) return false;
    for (let i: usize = 0; i < buffer.length && i < want.length; i++) if (buffer[i] !== want[i]) return false;
    return true;
  }

  // A DATA or HEADERS payload without its padding, and a HEADERS one without its priority, or
  // null when the padding is longer than the frame.
  static unpadded(payload: u8[], flags: i64, priority: boolean): u8[] | null {
    let from: i64 = 0;
    let pad: i64 = 0;
    if ((flags & 8) !== 0) {
      if (payload.length === 0) return null;
      pad = payload[0] as i64;
      from = 1;
    }
    if (priority && (flags & 32) !== 0) from += 5;
    const end = payload.length as i64 - pad;
    if (end < from) return null;
    if (from === 0 && pad === 0) return payload;
    return payload.slice(from, end);
  }

  // The frame at the front of a buffer holding it whole: its type, flags, stream and payload.
  static take(buffer: Mut<u8[]>): { kind: i64; flags: i64; id: i64; payload: u8[] } {
    const length = Http2.frameLength(buffer);
    const kind = buffer[3] as i64;
    const flags = buffer[4] as i64;
    const id = Http2.u32(buffer, 5) & 2147483647;
    const rest = buffer.splice(9 + length);
    const payload = buffer.splice(9);
    buffer.splice(0);
    for (const b of rest) buffer.push(b);
    return { kind: kind, flags: flags, id: id, payload: payload };
  }

  static frameLength(buffer: Ref<u8[]>): i64 {
    return ((buffer[0] as i64) << 16) | ((buffer[1] as i64) << 8) | (buffer[2] as i64);
  }

  // Writes what a connection's streams queue, in order, so frames never interleave. A write that
  // fails ends the writing, though what is queued is still taken so no sender waits.
  static async writer(conn: TcpStream, out: Channel<u8[]>): Promise<void> {
    let failed = false;
    while (true) {
      const frame = await out.receive();
      if (frame === null) return;
      if (failed) continue;
      try {
        await conn.write(frame, AbortSignal.timeout(30000));
      } catch (e) {
        failed = true;
      }
    }
  }

  // Whether a frame was queued before the connection went.
  static async queue(out: Ref<Channel<u8[]>>, frame: u8[], gone: Ref<AbortSignal>): Promise<boolean> {
    try {
      await out.send(frame, gone.clone());
      return true;
    } catch (e) {
      return false;
    }
  }

  // Sends bytes as DATA frames within the peer's windows for the connection and the stream,
  // waiting while either is shut. False once the stream was reset or the connection went.
  // ponytail: a shut window is polled every millisecond; a waker per stream would wake at once.
  static async data(out: Ref<Channel<u8[]>>, state: Ref<shared<__h2State>>, id: i64, payload: Ref<u8[]>, end: boolean, gone: Ref<AbortSignal>): Promise<boolean> {
    const n = payload.length as i64;
    if (n === 0) {
      if (!end) return true;
      const sent = await Http2.queue(out, Http2.frame(0, 1, id, payload), gone);
      return sent;
    }
    let at: i64 = 0;
    while (at < n) {
      if (gone.aborted) return false;
      const most = state.frame.load();
      const want = n - at < most ? n - at : most;
      const take = state.windows.update((w): i64 => {
        const c = w.get(0);
        const s = w.get(id);
        if (c === null || s === null) return -1;
        let t = want;
        if (c < t) t = c;
        if (s < t) t = s;
        if (t > 0) {
          w.set(0, c - t);
          w.set(id, s - t);
        }
        return t;
      });
      if (take < 0) return false;
      if (take === 0) {
        await sleep(1);
        continue;
      }
      let chunk: u8[] = [];
      chunk.reserve(take);
      for (let i = at; i < at + take; i++) chunk.push(payload[i as usize]);
      at += take;
      const sent = await Http2.queue(out, Http2.frame(0, at === n && end ? 1 : 0, id, chunk), gone);
      if (!sent) return false;
    }
    return true;
  }

  // Ends a stream's response: with its trailers as a last HEADERS when it has them, else an empty DATA.
  static async finish(out: Ref<Channel<u8[]>>, state: Ref<shared<__h2State>>, id: i64, res: Ref<Response>, gone: Ref<AbortSignal>): Promise<void> {
    const trailers = res.__trailers();
    if (trailers === null) {
      const none: u8[] = [];
      await Http2.data(out, state, id, none, true, gone);
      return;
    }
    let block: u8[] = [];
    for (let i: usize = 0; i < trailers.names.length; i++) if (!Http2.connectionField(trailers.names[i])) Http2.putField(block, trailers.names[i], trailers.values[i]);
    await Http2.queue(out, Http2.headers(id, block, true, state.frame.load()), gone);
  }

  // A request from a stream's fields, or null when its pseudo-headers aren't a request's.
  static request(fields: Ref<string[]>, host: string, secure: boolean, signal: AbortSignal): Request | null {
    let method = "";
    let path = "";
    let authority = "";
    let headers = new Headers();
    for (let i: usize = 0; i + 1 < fields.length; i += 2) {
      const name = fields[i];
      const value = fields[i + 1];
      if (Http1.hasBreak(value) || name.length === 0) return null;
      if (name === ":method") method = value;
      else if (name === ":path") path = value;
      else if (name === ":authority") authority = value;
      else if (name === ":scheme") {}
      else if (name.startsWith(":") || name !== name.toLowerCase() || !Http1.isToken(name)) return null;
      else headers.append(name, value);
    }
    if (!Http1.isToken(method) || !path.startsWith("/")) return null;
    if (authority.length === 0) {
      const named = headers.get("host");
      authority = named !== null ? named : host;
    }
    if (!Http1.isHost(authority)) return null;
    return new Request((secure ? "https://" : "http://") + authority + path, { method: method, headers: headers, signal: signal });
  }

  // A response's header block, framing a body of bytes with its length.
  static responseBlock(res: Ref<Response>, streamed: boolean): u8[] {
    let block: u8[] = [];
    Http2.putStatus(block, res.status);
    for (let i: usize = 0; i < res.headers.names.length; i++) {
      const name = res.headers.names[i];
      if (!Http2.connectionField(name) && name !== "content-length" && name !== "date") Http2.putField(block, name, res.headers.values[i]);
    }
    for (const line of res.cookies.toSetCookieHeaders()) Http2.putField(block, "set-cookie", line);
    if (!streamed && res.status !== 204 && res.status !== 304) Http2.putField(block, "content-length", String(res.__bytes().length as i64));
    Http2.putField(block, "date", httpDate());
    return block;
  }

  // The fields HTTP/2 forbids, since they belong to one HTTP/1.1 connection.
  static connectionField(name: string): boolean {
    return name === "connection" || name === "keep-alive" || name === "proxy-connection" || name === "transfer-encoding" || name === "upgrade" || name === "host";
  }

  // Serves one HTTP/2 connection whose client has sent the preface's first bytes: streams are
  // read here and each request answered by a task of its own, through one writer. With no stream
  // open the connection closes after idleTimeout; when the server stops it says GOAWAY, lets the
  // streams being answered finish for a second, and closes.
  static async serve(conn: TcpStream, start: u8[], handler: ServeHandler, host: string, stop: AbortSignal, limits: __serveLimits): Promise<void> throws IoError {
    let buffer = start;
    while ((buffer.length as i64) < 24) {
      const got = await Http1.readBy(conn, stop, Http1.after(limits.headerTimeout));
      if (got === null || got.length === 0) return;
      for (const b of got) buffer.push(b);
    }
    if (!Http2.prefaceSoFar(buffer)) return;
    buffer = buffer.splice(24);
    const out = new Channel<u8[]>(64);
    const writing = spawn(Http2.writer(conn.clone(), out.clone()));
    let windows = new Map<i64, i64>();
    windows.set(0, 65535);
    const state = shared<__h2State>({ windows: new Lock(windows), frame: new Atomic(16384), initial: new Atomic(65535), active: new Atomic(0) });
    const gone = new AbortController();
    const going = gone.signal.clone();
    const settings: i64[] = [3, 100];
    await Http2.queue(out, Http2.settings(settings), going);
    await Http2.read(conn, buffer, handler, host, stop, limits, out.clone(), state.clone(), gone.signal.clone());
    const ended = nowMs();
    while (state.active.load() > 0) {
      if (nowMs() - ended > 1000) gone.abort();
      await sleep(5);
    }
    gone.abort();
    out.close();
    await writing;
  }

  // The frames' loop, until the client goes, breaks the protocol, sits idle, or the server stops.
  static async read(conn: Ref<TcpStream>, start: u8[], handler: ServeHandler, host: string, stop: AbortSignal, limits: __serveLimits, out: Channel<u8[]>, state: shared<__h2State>, gone: AbortSignal): Promise<void> throws IoError {
    let buffer = start;
    let hpack = new Http2Hpack();
    let streams: Http2Stream[] = [];
    let last: i64 = 0;
    // The stream whose header block CONTINUATION frames go on, and whether its HEADERS ended it.
    let continuing: i64 = 0;
    let continuingEnds = false;
    let code: i64 = 0;
    while (true) {
      // Streams answered and gone from the windows are dropped.
      let kept: Http2Stream[] = [];
      while (streams.length > 0) {
        const s = streams.pop()!;
        const id = s.id;
        if (!s.ended || state.windows.update((w) => w.has(id))) kept.push(s);
      }
      streams = kept;
      const idle = streams.length === 0 && state.active.load() === 0;
      const deadline = idle ? Http1.after(limits.idleTimeout) : 0;
      const head = await Http2.fill(conn, buffer, 9, stop, deadline);
      if (head !== 1) break;
      const length = Http2.frameLength(buffer);
      if (length > 16384) {
        code = 6;
        break;
      }
      const whole = await Http2.fill(conn, buffer, 9 + length, stop, Http1.after(limits.idleTimeout));
      if (whole !== 1) break;
      const f = Http2.take(buffer);
      if (continuing !== 0 && (f.kind !== 9 || f.id !== continuing)) {
        code = 1;
        break;
      }
      if (f.kind === 0) {
        // DATA: counted against the windows whether or not its stream still wants it.
        if (length > 0) await Http2.queue(out, Http2.windowUpdate(0, length), gone);
        const at = Http2.find(streams, f.id);
        const data = Http2.unpadded(f.payload, f.flags, false);
        if (data === null) {
          code = 1;
          break;
        }
        if (at < 0 || !streams[at as usize].headed || streams[at as usize].ended) {
          if (f.id > last || f.id === 0) {
            code = 1;
            break;
          }
          continue;
        }
        const end = (f.flags & 1) !== 0;
        if ((streams[at as usize].body.length + data.length) as i64 > limits.maxBodySize) {
          await Http2.refuse(streams, at, out, state, gone, 413);
          continue;
        }
        for (const b of data) streams[at as usize].body.push(b);
        if (end) await Http2.dispatch(streams, at, handler.clone(), host, limits, out, state, gone);
        else if (length > 0) await Http2.queue(out, Http2.windowUpdate(f.id, length), gone);
      } else if (f.kind === 1 || f.kind === 9) {
        const opening = f.kind === 1;
        if (f.id === 0 || (f.id % 2) === 0 || (!opening && continuing === 0)) {
          code = 1;
          break;
        }
        const fragment = opening ? Http2.unpadded(f.payload, f.flags, true) : f.payload;
        if (fragment === null) {
          code = 1;
          break;
        }
        let at = Http2.find(streams, f.id);
        if (opening) {
          if (at < 0) {
            if (f.id <= last) {
              code = 1;
              break;
            }
            last = f.id;
            streams.push(new Http2Stream(f.id));
            at = streams.length as i64 - 1;
            const initial = state.initial.load();
            const id = f.id;
            state.windows.update((w) => { w.set(id, initial); });
          }
          continuingEnds = (f.flags & 1) !== 0;
        }
        for (const b of fragment) streams[at as usize].block.push(b);
        if ((streams[at as usize].block.length as i64) > 65536) {
          code = 11;
          break;
        }
        if ((f.flags & 4) === 0) {
          continuing = f.id;
          continue;
        }
        continuing = 0;
        const block = streams[at as usize].block.splice(0);
        const fields = hpack.decode(block, 4096);
        if (fields === null) {
          code = 9;
          break;
        }
        // A second header block is the request's trailers, which end it.
        if (!streams[at as usize].headed) {
          streams[at as usize].fields = fields;
          streams[at as usize].headed = true;
          if (stop.aborted || state.active.load() >= 100) {
            streams[at as usize].ended = true;
            const id = f.id;
            state.windows.update((w) => { w.delete(id); });
            await Http2.queue(out, Http2.reset(f.id, 7), gone);
            continue;
          }
        } else if (!continuingEnds) {
          code = 1;
          break;
        }
        if (continuingEnds && !streams[at as usize].ended) await Http2.dispatch(streams, at, handler.clone(), host, limits, out, state, gone);
      } else if (f.kind === 3) {
        const at = Http2.find(streams, f.id);
        if (at >= 0) {
          streams[at as usize].client.abort();
          streams[at as usize].ended = true;
        }
        const id = f.id;
        state.windows.update((w) => { w.delete(id); });
      } else if (f.kind === 4) {
        if ((f.flags & 1) !== 0) continue;
        if (f.id !== 0 || (length % 6) !== 0) {
          code = 6;
          break;
        }
        for (let i: usize = 0; i + 5 < f.payload.length; i += 6) {
          const key = ((f.payload[i] as i64) << 8) | (f.payload[i + 1] as i64);
          const value = Http2.u32(f.payload, i + 2);
          if (key === 4) {
            if (value > 2147483647) {
              code = 3;
              break;
            }
            const delta = value - state.initial.exchange(value);
            state.windows.update((w) => {
              for (const k of w.keys()) if (k !== 0) w.set(k, w.get(k)! + delta);
            });
          } else if (key === 5) {
            if (value < 16384 || value > 16777215) {
              code = 1;
              break;
            }
            state.frame.store(value);
          }
        }
        if (code !== 0) break;
        await Http2.queue(out, Http2.frame(4, 1, 0, []), gone);
      } else if (f.kind === 6) {
        if (length !== 8) {
          code = 6;
          break;
        }
        if ((f.flags & 1) === 0) await Http2.queue(out, Http2.frame(6, 1, 0, f.payload), gone);
      } else if (f.kind === 7) {
        break;
      } else if (f.kind === 8) {
        if (length !== 4) {
          code = 6;
          break;
        }
        const n = Http2.u32(f.payload, 0) & 2147483647;
        const id = f.id;
        state.windows.update((w) => {
          const now = w.get(id);
          if (now !== null) w.set(id, now + n);
        });
      } else if (f.kind === 5) {
        code = 1;
        break;
      }
    }
    // A client gone, or a protocol error, ends every stream's request; a server stopping lets
    // those being answered finish.
    if (code !== 0 || !stop.aborted) for (const s of streams) s.client.abort();
    await Http2.queue(out, Http2.goaway(last, code), gone);
  }

  static find(streams: Ref<Http2Stream[]>, id: i64): i64 {
    for (let i: usize = 0; i < streams.length; i++) if (streams[i].id === id) return i as i64;
    return -1;
  }

  // 1 once the buffer holds need bytes, 0 when the connection ends or the server stops, and -1
  // once the deadline passes, where 0 is none.
  static async fill(conn: Ref<TcpStream>, buffer: Mut<u8[]>, need: i64, stop: Ref<AbortSignal>, deadline: i64): Promise<i64> throws IoError {
    while ((buffer.length as i64) < need) {
      const got = await Http1.readBy(conn, stop, deadline);
      if (got === null) return -1;
      if (got.length === 0) return 0;
      for (const b of got) buffer.push(b);
    }
    return 1;
  }

  // Answers a stream at once with a bare status and ends it, as for a body over the limit.
  static async refuse(streams: Mut<Http2Stream[]>, at: i64, out: Ref<Channel<u8[]>>, state: Ref<shared<__h2State>>, gone: Ref<AbortSignal>, status: i64): Promise<void> {
    streams[at as usize].ended = true;
    const id = streams[at as usize].id;
    state.windows.update((w) => { w.delete(id); });
    let block: u8[] = [];
    Http2.putStatus(block, status);
    await Http2.queue(out, Http2.headers(id, block, true, state.frame.load()), gone);
    await Http2.queue(out, Http2.reset(id, 0), gone);
  }

  // Hands a stream whose request has ended to a task that answers it.
  static async dispatch(streams: Mut<Http2Stream[]>, at: i64, handler: ServeHandler, host: string, limits: Ref<__serveLimits>, out: Ref<Channel<u8[]>>, state: Ref<shared<__h2State>>, gone: Ref<AbortSignal>): Promise<void> {
    streams[at as usize].ended = true;
    const id = streams[at as usize].id;
    let req = Http2.request(streams[at as usize].fields, host, limits.secure, streams[at as usize].client.signal.clone());
    if (req === null) {
      state.windows.update((w) => { w.delete(id); });
      await Http2.queue(out, Http2.reset(id, 1), gone);
      return;
    }
    req.__setBody(streams[at as usize].body.splice(0));
    state.active.add(1);
    spawn(Http2.respond(handler, req, id, out.clone(), state.clone(), gone.clone(), limits.trace));
  }

  // Runs a stream's handler on a task of its own, so a panic answers only its stream with a 500,
  // then sends the response within the windows. A streamed body stops when the client resets the
  // stream or the connection goes.
  static async respond(handler: ServeHandler, req: Request, id: i64, out: Channel<u8[]>, state: shared<__h2State>, gone: AbortSignal, trace: boolean): Promise<void> {
    const head = req.method === "HEAD";
    const client = req.signal.clone();
    let traced: __traceRecord[] = [];
    let outer: i64[] = [];
    if (trace && __traceOn()) {
      outer = __traceWords();
      traced.push(__traceRequest(req));
    }
    let res: Response;
    try {
      const running = spawn(Http1.handle(handler, req));
      if (traced.length > 0) __traceEnter(outer);
      res = await running.join();
    } catch (e) {
      res = new Response("", { status: 500 });
    }
    // A response HTTP/2 can't carry, a 101 among them, goes out as a 500.
    if (!Http1.sendable(res)) res = new Response("Internal Server Error\n", { status: 500 });
    if (traced.length > 0) __traceServed(traced, res.status);
    const bodiless = head || res.status === 204 || res.status === 304;
    const byteStream = res.__byteStream();
    const stream = res.__stream();
    const streamed = byteStream !== null || stream !== null;
    const block = Http2.responseBlock(res, streamed);
    const empty = bodiless || (!streamed && res.__bytes().length === 0);
    const started = await Http2.queue(out, Http2.headers(id, block, empty, state.frame.load()), gone);
    if (started && !empty) {
      const either = AbortSignal.any([client, gone.clone()]);
      if (byteStream !== null) {
        let chunks = byteStream.__values();
        let open = true;
        while (open && !either.aborted) {
          const chunk = await Promise.race([Http1.nextBytes(chunks), Http1.abortOfBytes(either)]);
          if (chunk === null) break;
          open = await Http2.data(out, state, id, chunk, false, gone);
        }
        if (open && !either.aborted) await Http2.finish(out, state, id, res, gone);
      } else if (stream !== null) {
        let pieces = stream;
        let open = true;
        while (open && !either.aborted) {
          const piece = await Promise.race([Http1.next(pieces), Http1.abortOf(either)]);
          if (piece === null) break;
          const bytes = new TextEncoder().encode(piece);
          open = await Http2.data(out, state, id, bytes, false, gone);
        }
        if (open && !either.aborted) await Http2.finish(out, state, id, res, gone);
      } else {
        const sent = await Http2.data(out, state, id, res.__bytes(), false, gone);
        if (sent) await Http2.finish(out, state, id, res, gone);
      }
    }
    state.windows.update((w) => { w.delete(id); });
    state.active.sub(1);
  }

  // Sends one request as stream 1 of a connection whose peer chose HTTP/2 and reads the reply
  // whole, its trailers included: within the server's windows going out, and replenishing the
  // windows this side gives as the body comes in.
  static async exchange(conn: Ref<TcpStream>, scheme: string, method: string, authority: string, path: string, headers: Ref<Headers>, body: Ref<u8[]>, signal: AbortSignal): Promise<__h2Reply> throws IoError | AbortError {
    let block: u8[] = [];
    Http2.putField(block, ":method", method);
    Http2.putField(block, ":scheme", scheme);
    Http2.putField(block, ":authority", authority);
    Http2.putField(block, ":path", path);
    for (let i: usize = 0; i < headers.names.length; i++) {
      const name = headers.names[i];
      if (!Http1.isToken(name) || Http1.hasBreak(headers.values[i])) throw new IoError("can't send the request: header '" + name + "' holds a line break or isn't a header name");
      const te = name === "te" && headers.values[i] !== "trailers";
      if (!Http2.connectionField(name) && name !== "content-length" && !te) Http2.putField(block, name, headers.values[i]);
    }
    if (!headers.has("accept")) Http2.putField(block, "accept", "*/*");
    if (!headers.has("user-agent")) Http2.putField(block, "user-agent", "fish");
    const size = body.length as i64;
    if (size > 0 || method === "POST" || method === "PUT" || method === "PATCH") Http2.putField(block, "content-length", String(size));
    let opening = Http2.preface();
    const settings: i64[] = [2, 0];
    for (const b of Http2.settings(settings)) opening.push(b);
    for (const b of Http2.headers(1, block, size === 0, 16384)) opening.push(b);
    await conn.write(opening, signal.clone());
    let sendConnection: i64 = 65535;
    let sendStream: i64 = 65535;
    let frameMost: i64 = 16384;
    let initial: i64 = 65535;
    let sent: i64 = 0;
    let hpack = new Http2Hpack();
    let buffer: u8[] = [];
    let fragments: u8[] = [];
    let status: i64 = 0;
    let fields = new Headers();
    let trailers = new Headers();
    let data: u8[] = [];
    while (true) {
      // As much of the body as the windows allow goes out before the next frame is read.
      while (sent < size && sendConnection > 0 && sendStream > 0) {
        let take = size - sent;
        if (take > frameMost) take = frameMost;
        if (take > sendConnection) take = sendConnection;
        if (take > sendStream) take = sendStream;
        let chunk: u8[] = [];
        for (let i = sent; i < sent + take; i++) chunk.push(body[i as usize]);
        sent += take;
        sendConnection -= take;
        sendStream -= take;
        await conn.write(Http2.frame(0, sent === size ? 1 : 0, 1, chunk), signal.clone());
      }
      await Http2.more(conn, buffer, 9, signal);
      const length = Http2.frameLength(buffer);
      if (length > 16384) throw new IoError("the server sent a frame over 16 KiB, which this side didn't allow");
      await Http2.more(conn, buffer, 9 + length, signal);
      const f = Http2.take(buffer);
      if (f.kind === 4) {
        if ((f.flags & 1) !== 0) continue;
        for (let i: usize = 0; i + 5 < f.payload.length; i += 6) {
          const key = ((f.payload[i] as i64) << 8) | (f.payload[i + 1] as i64);
          const value = Http2.u32(f.payload, i + 2);
          if (key === 4) {
            sendStream += value - initial;
            initial = value;
          }
          else if (key === 5 && value >= 16384 && value <= 16777215) frameMost = value;
        }
        await conn.write(Http2.frame(4, 1, 0, []), signal.clone());
      } else if (f.kind === 6) {
        if ((f.flags & 1) === 0) await conn.write(Http2.frame(6, 1, 0, f.payload), signal.clone());
      } else if (f.kind === 8) {
        const n = Http2.u32(f.payload, 0) & 2147483647;
        if (f.id === 0) sendConnection += n;
        else if (f.id === 1) sendStream += n;
      } else if (f.kind === 7) {
        if ((Http2.u32(f.payload, 0) & 2147483647) < 1) throw new IoError("the server went away before answering, with HTTP/2 error " + String(Http2.u32(f.payload, 4)));
      } else if (f.kind === 3 && f.id === 1) {
        throw new IoError("the server reset the stream with HTTP/2 error " + String(Http2.u32(f.payload, 0)));
      } else if ((f.kind === 1 || f.kind === 9) && f.id === 1) {
        const fragment = f.kind === 1 ? Http2.unpadded(f.payload, f.flags, true) : f.payload;
        if (fragment === null) throw new IoError("the server's HEADERS frame is malformed");
        for (const b of fragment) fragments.push(b);
        if ((f.flags & 4) === 0) continue;
        const decoded = hpack.decode(fragments.splice(0), 4096);
        if (decoded === null) throw new IoError("the server's header block isn't valid HPACK");
        if (status >= 200) {
          for (let i: usize = 0; i + 1 < decoded.length; i += 2) trailers.append(decoded[i], decoded[i + 1]);
        } else {
          let given = new Headers();
          let code: i64 = -1;
          for (let i: usize = 0; i + 1 < decoded.length; i += 2) {
            if (decoded[i] === ":status") code = Http1.digits(decoded[i + 1]);
            else if (!decoded[i].startsWith(":")) given.append(decoded[i], decoded[i + 1]);
          }
          if (code < 100 || code > 999) throw new IoError("the server's response has no :status");
          // An interim 1xx response is skipped, as HTTP/1.1's are.
          if (code >= 200) {
            status = code;
            fields = given;
          }
        }
        if ((f.flags & 1) !== 0) break;
      } else if (f.kind === 0 && f.id === 1) {
        const piece = Http2.unpadded(f.payload, f.flags, false);
        if (piece === null) throw new IoError("the server's DATA frame is malformed");
        for (const b of piece) data.push(b);
        if ((f.flags & 1) !== 0) break;
        if (length > 0) {
          let update = Http2.windowUpdate(0, length);
          for (const b of Http2.windowUpdate(1, length)) update.push(b);
          await conn.write(update, signal.clone());
        }
      }
    }
    if (status < 200) throw new IoError("the server ended the stream before its response's headers");
    return { status: status, headers: fields, body: data, trailers: trailers };
  }

  // Reads until the buffer holds need bytes, which must come before the connection ends.
  static async more(conn: Ref<TcpStream>, buffer: Mut<u8[]>, need: i64, signal: Ref<AbortSignal>): Promise<void> throws IoError | AbortError {
    while ((buffer.length as i64) < need) {
      const got = await Http1.more(conn, signal, "the HTTP/2 response ended");
      for (const b of got) buffer.push(b);
    }
  }
}
`;
const HTTP = HTTP2 + `
class Headers {
  names: string[] = [];
  values: string[] = [];

  get(name: string): string | null {
    const key = name.toLowerCase();
    let found = "";
    let any = false;
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === key) {
        found = any ? found + ", " + this.values[i] : this.values[i];
        any = true;
      }
    }
    if (any) return found;
    return null;
  }

  has(name: string): boolean {
    const key = name.toLowerCase();
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === key) return true;
    }
    return false;
  }

  set(this: Mut<this>, name: string, value: string) {
    this.delete(name);
    this.append(name, value);
  }

  append(this: Mut<this>, name: string, value: string) {
    this.names.push(name.toLowerCase());
    this.values.push(value);
  }

  delete(this: Mut<this>, name: string) {
    const key = name.toLowerCase();
    let names: string[] = [];
    let values: string[] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] !== key) {
        names.push(this.names[i]);
        values.push(this.values[i]);
      }
    }
    this.names = names;
    this.values = values;
  }

  forEach(callback: (value: string, name: string) => void) {
    for (let i = 0; i < this.names.length; i++) callback(this.values[i], this.names[i]);
  }
}

// A cookie's attributes. maxAge is in seconds and expires a Date or milliseconds
// since the epoch, as Date.now() gives.
type CookieInit = { path?: string; domain?: string; maxAge?: i64; expires?: i64 | Date; secure?: boolean; httpOnly?: boolean; sameSite?: "strict" | "lax" | "none"; partitioned?: boolean };

// Cookies by name: read from a Cookie header as RFC 6265 reads one, the
// first of a repeated name kept, and changed by set and delete, each change a Set-Cookie line
// a response sends.
class CookieMap {
  #cookies: Map<string, string> = new Map();
  // The latest Set-Cookie line for each name changed, in the order they were first changed.
  #changed: string[] = [];
  #lines: string[] = [];

  constructor(header?: string) {
    if (header === null) return;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (name.length === 0 || this.#cookies.has(name)) continue;
      let value = part.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith("\\"") && value.endsWith("\\"")) value = value.slice(1, -1);
      const decoded = value.includes("%") ? __urlDecodeStrict(value) : value;
      this.#cookies.set(name, decoded ?? value);
    }
  }

  get(name: string): string | null {
    return this.#cookies.get(name);
  }

  has(name: string): boolean {
    return this.#cookies.has(name);
  }

  get size(): i64 {
    return this.#cookies.size as i64;
  }

  forEach(callback: (value: string, name: string) => void) {
    for (const [name, value] of this.#cookies) callback(value, name);
  }

  // Sets a cookie, by default with path '/' and SameSite=Lax. A name must be an HTTP
  // token and a path or domain printable ASCII without ';'; the value is percent-encoded as
  // encodeURIComponent does, so nothing in it can end the cookie or the header.
  set(this: Mut<this>, name: string, value: string, options?: CookieInit) {
    const line = __cookieLine(name, value, options);
    // Deleted first, so a cookie set again comes last.
    this.#cookies.delete(name);
    this.#cookies.set(name, value);
    this.#change(name, line);
  }

  // Removes a cookie, telling the client to drop its copy at the path and domain given.
  delete(this: Mut<this>, name: string, options?: { path?: string; domain?: string }) {
    let path: string | null = null;
    let domain: string | null = null;
    if (options !== null) {
      path = options.path;
      domain = options.domain;
    }
    const line = __cookieLine(name, "", { path: path, domain: domain, expires: 0, maxAge: 0 });
    this.#cookies.delete(name);
    this.#change(name, line);
  }

  #change(this: Mut<this>, name: string, line: string) {
    for (let i = 0; i < this.#changed.length; i++) {
      if (this.#changed[i] === name) {
        this.#lines[i] = line;
        return;
      }
    }
    this.#changed.push(name);
    this.#lines.push(line);
  }

  // The Set-Cookie header values the changes make, one per cookie.
  toSetCookieHeaders(): string[] {
    return this.#lines.clone();
  }
}

// A request's cookies, which can be read but not changed: a change goes on the response, through
// res.cookies.
class RequestCookies {
  #cookies: CookieMap;
  constructor(header: string) { this.#cookies = new CookieMap(header); }
  get(name: string): string | null { return this.#cookies.get(name); }
  has(name: string): boolean { return this.#cookies.has(name); }
  get size(): i64 { return this.#cookies.size; }
  forEach(callback: (value: string, name: string) => void) { this.#cookies.forEach(callback); }
}

// A Set-Cookie header's value: the cookie, then its attributes in the order Bun writes them.
function __cookieLine(name: string, value: string, options: CookieInit | null): string {
  assert(Http1.isToken(name), "a cookie's name must be an HTTP token, of letters, digits and !#$%&'*+-.^_|~, so '" + name + "' can't be one");
  let out = new TextEncoder().encode(name + "=");
  for (const c of __urlPoints(value)) {
    const kept = __urlAlpha(c) || __urlDigit(c) || c === 33 || (c >= 39 && c <= 42) || c === 45 || c === 46 || c === 95 || c === 126;
    __urlPut(out, c, kept ? "none" : "form");
  }
  let line = new TextDecoder().decode(out);
  let path = "/";
  let sameSite = "Lax";
  if (options !== null) {
    const domain = options.domain;
    if (domain !== null && domain.length > 0) line = line + "; Domain=" + __cookieAttribute(name, "domain", domain);
    const p = options.path;
    if (p !== null) path = __cookieAttribute(name, "path", p);
    const s = options.sameSite;
    if (s !== null) sameSite = s === "strict" ? "Strict" : s === "none" ? "None" : "Lax";
  }
  if (path.length > 0) line = line + "; Path=" + path;
  if (options !== null) {
    const expires = options.expires;
    if (expires !== null) {
      const ms = expires instanceof Date ? expires.getTime() : expires;
      // An HTTP date has a four-digit year, so 0000-01-01 to 9999-12-31 can be written.
      assert(ms >= -62167219200000 && ms <= 253402300799999, "cookie '" + name + "' can't expire at " + String(ms) + "; give a time within the years 0000 to 9999");
      line = line + "; Expires=" + new Date(ms).toUTCString();
    }
    const maxAge = options.maxAge;
    if (maxAge !== null) line = line + "; Max-Age=" + String(maxAge);
    if (options.secure === true) line = line + "; Secure";
    if (options.httpOnly === true) line = line + "; HttpOnly";
    if (options.partitioned === true) line = line + "; Partitioned";
  }
  return line + "; SameSite=" + sameSite;
}

// A path or domain, which a ';' would end and a control character could break out of the header.
function __cookieAttribute(name: string, attribute: string, value: string): string {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i) as i64;
    assert(c >= 32 && c < 127 && c !== 59, "cookie '" + name + "' can't have a " + attribute + " holding ';', a control character or a character outside ASCII");
  }
  return value;
}

// unix is a socket path to send the request over in place of the URL's host and port; tls.ca is
// PEM certificates an https: server's is verified against in place of the system's.
type RequestInit = { method?: string; headers?: Headers; body?: string | u8[] | ReadableStream<u8[]>; signal?: AbortSignal; unix?: string; tls?: { ca?: string } };

// A body given as text or bytes, as the bytes sent.
function __httpBody(body: string | u8[]): u8[] {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

class Request {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  // The body's bytes; read through body, text(), bytes() or json().
  #body: u8[];
  // A body given as a stream, at most one, read into #body when the request is sent or read.
  // Shared, so a request still clones, its copies sharing the one stream. The stream's
  // generator is held rather than the stream, since a class field naming a ReadableStream
  // instance makes it before its type parameter is bound.
  #bytes: shared<{ s: Lock<Dyn<AsyncGenerator<u8[]>>[]> }>;
  signal: AbortSignal;
  // The :params a Router's route took from the path, as name then value.
  params: string[] = [];

  constructor(url: string, init?: RequestInit) {
    this.url = url;
    this.path = __urlRequestPath(url);
    let method = "GET";
    let headers = new Headers();
    let signal = new AbortController().signal;
    let bytes: u8[] = [];
    let streams: Dyn<AsyncGenerator<u8[]>>[] = [];
    if (init !== null) {
      const m = init.method;
      if (m !== null) method = m.toUpperCase();
      const h = init.headers;
      if (h !== null) headers = h;
      const b = init.body;
      if (b instanceof ReadableStream) streams.push(b.__values());
      else if (b !== null) bytes = __httpBody(b);
      const s = init.signal;
      if (s !== null) signal = s;
    }
    this.method = method;
    this.headers = headers;
    this.#body = bytes;
    this.#bytes = shared({ s: new Lock(streams) });
    this.signal = signal;
  }

  __setBody(this: Mut<this>, body: string | u8[] | ReadableStream<u8[]>) {
    if (body instanceof ReadableStream) {
      this.#body = [];
      const chunks = body.__values();
      this.#bytes.s.update((s) => {
        while (s.length > 0) s.pop();
        s.push(chunks);
      });
    } else this.#body = __httpBody(body);
  }

  __bytes(this: Ref<this>): Ref<u8[]> {
    return this.#body;
  }

  // A body given as a stream, read to its end into the bytes, as fetch sends it with a length.
  async __drain(this: Mut<this>) {
    const given = this.#bytes.s.update((s) => s.pop());
    if (given === null) return;
    const bytes = await __streamBytes(ReadableStream.from(__streamDyn(given)));
    this.#body = bytes;
  }

  // The body as a stream of bytes, or null when there is none.
  get body(): ReadableStream<u8[]> | null {
    const given = this.#bytes.s.update((s) => s.pop());
    if (given !== null) return ReadableStream.from(__streamDyn(given));
    if (this.#body.length === 0) return null;
    return ReadableStream.from(__streamOnce(this.#body.clone()));
  }

  // The body as UTF-8 text, each malformed sequence as U+FFFD.
  async text(): Promise<string> {
    const bytes = await this.bytes();
    return new TextDecoder().decode(bytes);
  }

  // The body's bytes as they were sent; a streamed one's read to its end, once.
  async bytes(): Promise<u8[]> {
    const given = this.#bytes.s.update((s) => s.pop());
    if (given !== null) return await __streamBytes(ReadableStream.from(__streamDyn(given)));
    return this.#body.clone();
  }

  // The body read as JSON into a T.
  async json<T>(): Promise<T> throws JsonError {
    const text = await this.text();
    return JSON.parse<T>(text);
  }

  // The cookies of every Cookie header the request has.
  get cookies(): RequestCookies {
    let all: string[] = [];
    for (let i = 0; i < this.headers.names.length; i++) {
      if (this.headers.names[i] === "cookie") all.push(this.headers.values[i]);
    }
    return new RequestCookies(all.join("; "));
  }

  // The path segment a Router's ':name' matched, the last when the name repeats, or "" when its
  // route has no such parameter.
  param(name: string): string {
    let found = "";
    for (let i: usize = 0; i + 1 < this.params.length; i += 2) {
      if (this.params[i] === name) found = this.params[i + 1];
    }
    return found;
  }
}

type ResponseInit = { status?: i64; statusText?: string; headers?: Headers };
// A response's trailers, at most one set, filled by whatever makes its body.
type __trailerBox = { fields: Lock<Headers[]> };
// One server-sent event: its data, and the event type, ID and reconnection delay it may name.
type ServerSentEvent = { data: string; event?: string; id?: string; retry?: i64 };

class Response {
  status: i64;
  statusText: string;
  headers: Headers;
  // The body's bytes, when it isn't streamed; read through body, text(), bytes() or json().
  #body: u8[];
  // A body given as a stream of bytes, in place of #body, at most one, taken out once read.
  // Its generator, not the stream, as Request holds one.
  #bytes: Lock<Dyn<AsyncGenerator<u8[]>>[]>;
  // A body sent in pieces as the generator produces them, in place of #body. Locked, in an
  // array of at most one, so whoever reads it can take it out through a shared borrow; private,
  // so a response prints as it would without one.
  #stream: Lock<Dyn<AsyncGenerator<string>>[]>;
  // 1 once text() has read a streamed body, which no copy can then have.
  #read: Atomic<i64> = new Atomic(0);
  // What takes the connection over once a 101 is sent: a WebSocket route's session, at most one.
  #upgrade: Lock<__wsUpgrade[]>;
  // The URL fetch got it from, or "" for one the program built.
  url: string = "";
  // The cookies it sets and deletes, each sent as a Set-Cookie header of its own.
  cookies: CookieMap = new CookieMap();
  // Trailers sent after the body over HTTP/2, which a streamed body may fill as it ends, as gRPC's
  // status is; HTTP/1.1 sends none.
  #trailers: shared<__trailerBox>;

  // A text or streamed body is typed 'text/plain;charset=UTF-8' unless the headers say
  // otherwise; bytes are given no type.
  constructor(body?: string | u8[] | Dyn<AsyncGenerator<string>> | ReadableStream<u8[]> | null, init?: ResponseInit) {
    let status: i64 = 200;
    let statusText = "";
    let headers = new Headers();
    if (init !== null) {
      const s = init.status;
      if (s !== null) status = s;
      const t = init.statusText;
      if (t !== null) statusText = t;
      const h = init.headers;
      if (h !== null) headers = h;
    }
    let bytes: u8[] = [];
    let stream: Dyn<AsyncGenerator<string>>[] = [];
    let streamed: Dyn<AsyncGenerator<u8[]>>[] = [];
    if (typeof body === "string") {
      bytes = new TextEncoder().encode(body);
      if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    } else if (Array.isArray(body)) bytes = body;
    else if (body instanceof ReadableStream) streamed.push(body.__values());
    else if (body !== null) {
      stream.push(body);
      if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    }
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.#body = bytes;
    this.#bytes = new Lock(streamed);
    this.#stream = new Lock(stream);
    const upgrade: __wsUpgrade[] = [];
    this.#upgrade = new Lock(upgrade);
    const trailers: Headers[] = [];
    this.#trailers = shared<__trailerBox>({ fields: new Lock(trailers) });
  }

  __trailersFrom(this: Mut<this>, from: shared<__trailerBox>) {
    this.#trailers = from;
  }

  // The trailers, once the body has given them, or null.
  __trailers(): Headers | null {
    return this.#trailers.fields.update((f) => f.length > 0 ? f[0].clone() : null);
  }

  // A response whose body is the value as JSON, typed 'application/json' unless the headers
  // given say otherwise.
  static json<T>(data: Ref<T>, init?: ResponseInit): Response {
    let res = new Response(null, init);
    if (!res.headers.has("content-type")) res.headers.set("content-type", "application/json");
    res.#body = new TextEncoder().encode(JSON.stringify(data));
    return res;
  }

  // A response whose body is a page's markup, typed 'text/html; charset=utf-8' unless the headers
  // given say otherwise.
  static html(page: Ref<Html>, init?: ResponseInit): Response {
    let res = new Response(null, init);
    if (!res.headers.has("content-type")) res.headers.set("content-type", "text/html; charset=utf-8");
    res.#body = new TextEncoder().encode(page.toString());
    return res;
  }

  // A response streaming server-sent events as EventSource reads them, each string an event's
  // data, typed 'text/event-stream' and uncached unless the headers given say otherwise.
  static sse(events: AsyncGenerator<string | ServerSentEvent>, init?: ResponseInit): Response {
    let res = new Response(null, init);
    if (!res.headers.has("content-type")) res.headers.set("content-type", "text/event-stream");
    if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-cache");
    return new Response(__sseFrames(events), { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  // A copy of the response. A streamed body runs its generator once, so it can't be copied.
  clone(): Response {
    const streamed = this.#stream.update((s) => s.length > 0) || this.#bytes.update((s) => s.length > 0);
    assert(this.#read.load() === 0, "this Response's streamed body was already read, so it can't be cloned; make each copy from the text it gave");
    assert(!streamed, "a Response with a streamed body can't be cloned, since its generator runs once; read it with 'await res.text()' and make each copy from that text");
    let copy = new Response(null, { status: this.status, statusText: this.statusText, headers: this.headers.clone() });
    copy.#body = this.#body.clone();
    copy.url = this.url;
    copy.cookies = this.cookies.clone();
    return copy;
  }

  // The streamed body, taken out for whoever sends or reads it, or null when there is none.
  __stream(): Dyn<AsyncGenerator<string>> | null {
    return this.#stream.update((s) => s.pop());
  }

  // A body given as a stream of bytes, taken out for whoever sends or reads it, or null.
  __byteStream(): ReadableStream<u8[]> | null {
    const chunks = this.#bytes.update((s) => s.pop());
    if (chunks === null) return null;
    return ReadableStream.from(__streamDyn(chunks));
  }

  // The bytes of a body that isn't streamed.
  __bytes(this: Ref<this>): Ref<u8[]> {
    return this.#body;
  }

  // Whether the body is streamed, in text pieces or bytes.
  __streamed(): boolean {
    return this.#stream.update((s) => s.length > 0) || this.#bytes.update((s) => s.length > 0);
  }

  // Replaces the body, as std:compress does with the body coded.
  __setBody(this: Mut<this>, body: u8[] | ReadableStream<u8[]>) {
    this.#stream.update((s) => { while (s.length > 0) s.pop(); });
    this.#bytes.update((s) => { while (s.length > 0) s.pop(); });
    if (body instanceof ReadableStream) {
      this.#body = [];
      const chunks = body.__values();
      this.#bytes.update((s) => { s.push(chunks); });
    } else this.#body = body;
  }

  // The body as a stream of bytes, or null when there is none. A streamed body is handed over
  // once, as reading it consumes it; its bytes are read from the stream, not kept.
  get body(): ReadableStream<u8[]> | null {
    const given = this.__byteStream();
    if (given !== null) return given;
    const pieces = this.__stream();
    if (pieces !== null) {
      this.#read.store(1);
      return ReadableStream.from(__streamEncoded(pieces));
    }
    if (this.#body.length === 0) return null;
    return ReadableStream.from(__streamOnce(this.#body.clone()));
  }

  // The session a WebSocket route's 101 hands the connection to, taken out, or null.
  __upgrade(): __wsUpgrade | null {
    return this.#upgrade.update((u) => u.pop());
  }

  __upgradeWith(this: Mut<this>, session: __wsUpgrade) {
    const one: __wsUpgrade[] = [session];
    this.#upgrade = new Lock(one);
  }

  // The body as UTF-8 text, each malformed sequence as U+FFFD. A streamed one is read to its
  // end, once: a second read finds it empty.
  async text(): Promise<string> {
    const given = this.__byteStream();
    if (given !== null) {
      this.#read.store(1);
      const bytes = await __streamBytes(given);
      return new TextDecoder().decode(bytes);
    }
    const stream = this.__stream();
    if (stream === null) return new TextDecoder().decode(this.#body);
    this.#read.store(1);
    let pieces = stream;
    let text = "";
    for await (const piece of pieces) text += piece;
    return text;
  }

  // The body's bytes as they were sent; a streamed one's as text() reads it.
  async bytes(): Promise<u8[]> {
    const given = this.__byteStream();
    if (given !== null) {
      this.#read.store(1);
      return await __streamBytes(given);
    }
    if (!this.#stream.update((s) => s.length > 0)) return this.#body.clone();
    const text = await this.text();
    return new TextEncoder().encode(text);
  }

  // The body read as JSON into a T, a streamed one read to its end first.
  async json<T>(): Promise<T> throws JsonError {
    const text = await this.text();
    return JSON.parse<T>(text);
  }
}

// A stream's chunks joined into one array of bytes. A body's readers don't throw, so a source
// that errors ends the body where it failed.
// A byte stream's generator, as a generator a stream can be made from again.
async function* __streamDyn(chunks: Dyn<AsyncGenerator<u8[]>>): AsyncGenerator<u8[]> {
  let source = chunks;
  for await (const chunk of source) yield chunk;
}

async function __streamBytes(stream: ReadableStream<u8[]>): Promise<u8[]> {
  let out: u8[] = [];
  for await (const chunk of stream) for (const b of chunk) out.push(b);
  return out;
}

// Text pieces as the UTF-8 bytes a body stream gives.
async function* __streamEncoded(pieces: Dyn<AsyncGenerator<string>>): AsyncGenerator<u8[]> {
  let source = pieces;
  for await (const piece of source) yield new TextEncoder().encode(piece);
}

async function* __streamOnce(bytes: u8[]): AsyncGenerator<u8[]> {
  yield bytes;
}

// Each event as the event-stream format writes it: a field per line, a data line per line of
// data, and a blank line to end it.
async function* __sseFrames(events: AsyncGenerator<string | ServerSentEvent>): AsyncGenerator<string> {
  let source = events;
  for await (const e of source) {
    let text = "";
    let data = "";
    if (typeof e === "string") data = e;
    else {
      // A line break would end the field and start another, so single-line fields lose theirs.
      const event = e.event;
      if (event !== null) text = text + "event: " + __sseLine(event) + "\\n";
      const id = e.id;
      if (id !== null) text = text + "id: " + __sseLine(id) + "\\n";
      const retry = e.retry;
      if (retry !== null) text = text + "retry: " + String(retry) + "\\n";
      data = e.data;
    }
    // EventSource ends a line at CR LF, at a lone CR and at a lone LF.
    for (const line of data.replaceAll("\\r\\n", "\\n").replaceAll("\\r", "\\n").split("\\n")) text = text + "data: " + line + "\\n";
    yield text + "\\n";
  }
}

function __sseLine(value: string): string {
  return value.replaceAll("\\r", "").replaceAll("\\n", "");
}

type ServeInfo = { hostname: string; port: i64 };
// Body sizes are in bytes and timeouts in milliseconds; a timeout of 0 is none.
// unix is a socket path to serve on in place of a port, removed when serve stops. tls has the
// server speak HTTPS with a PEM certificate chain and its private key. trace: false
// keeps the server's requests out of the program's traces, when tracing is on. restart: true has
// SIGUSR2 start the program again, handing it the listener: once it listens, this one stops
// accepting and drains, and if it fails to, this one keeps serving.
type ServeOptions = { port?: i64; hostname?: string; unix?: string; tls?: { cert: string; key: string }; signal?: AbortSignal; onListen?: (info: ServeInfo) => void; maxBodySize?: i64; headerTimeout?: i64; idleTimeout?: i64; trace?: boolean; restart?: boolean };
type ServeHandler = (req: Request) => Promise<Response>;
// What serve's options settle for each connection, under a name no program can write.
type __serveLimits = { maxBodySize: i64; headerTimeout: i64; idleTimeout: i64; secure: boolean; trace: boolean };
// A router's internal names take forms no program can write, so a program's own never hides
// the HTTP library.
type __routerNext = (req: Request) => Promise<Response>;
type __routerMiddleware = (req: Request, next: __routerNext) => Promise<Response>;
// Each route's method, split path, handler, whether it takes every path below its own, and the
// middleware of the routers mounted around it, outermost first, added together under one lock.
type __routerRoutes = { methods: string[]; paths: string[][]; handlers: ServeHandler[]; prefixes: boolean[]; groups: __routerMiddleware[][] };
// A router's routes and middleware, shared so each middleware's next can hold them.
type __routerTable = { routes: Lock<__routerRoutes>; middleware: Lock<__routerMiddleware[]> };

// Serves HTTP/1.1 on hostname and port, or a socket path, each connection on a task of its own.
async function serve(options: ServeOptions, handler: (req: Request) => Promise<Response>): Promise<void> throws IoError {
  const unix = options.unix;
  if (unix !== null && (options.port !== null || options.hostname !== null)) throw new IoError("serve takes either a 'unix' socket path or a 'port' and 'hostname', not both");
  let hostname = "0.0.0.0";
  const h = options.hostname;
  if (h !== null) hostname = h;
  let port: i64 = 8000;
  const p = options.port;
  if (p !== null) port = p;
  // A 128 MiB body limit, a 10 second idle timeout, and a minute for a request's head.
  const limits: __serveLimits = {
    maxBodySize: Http1.option(options.maxBodySize, 134217728, "maxBodySize", "bytes"),
    headerTimeout: Http1.option(options.headerTimeout, 60000, "headerTimeout", "milliseconds, or 0 for no timeout"),
    idleTimeout: Http1.option(options.idleTimeout, 10000, "idleTimeout", "milliseconds, or 0 for no timeout"),
    secure: options.tls !== null,
    trace: options.trace !== false,
  };
  const restart = options.restart === true;
  if (restart && unix !== null) throw new IoError("serve's restart option hands over a TCP listener; a unix socket can't be restarted yet");
  // With no signal of its own, the server stops at the first SIGINT or SIGTERM, or once a restart
  // has a new process listening.
  const given = options.signal;
  const restarted = new AbortController();
  const stop = AbortSignal.any([given ?? shutdownSignal(), restarted.signal]);
  const live = shared({ count: new Atomic(0) });
  {
    // The listener closes as this block ends, so no one new waits while connections drain.
    let listener: TcpListener;
    if (unix !== null) listener = await TcpListener.unix(unix);
    else listener = await TcpListener.bind(hostname, port);
    // Each connection's handshake runs in its first read, in its own task and within the limits.
    const tls = options.tls;
    if (tls !== null) {
      const why = listener.listenTls(tls.cert, tls.key);
      if (why.length > 0) throw new IoError("serve can't use its tls option: " + why);
    }
    const bound = listener.port;
    const listen = options.onListen;
    if (listen !== null) listen({ hostname: unix ?? hostname, port: bound });
    unsafe { fsh_rt_restart_ready() };
    if (restart) spawn(__serveRestarts(bound, restarted, stop.clone()));
    const boxed: ServeHandler = handler;
    // A request with no Host header gets the server's address, an IPv6 one bracketed as in a URL,
    // or localhost, as curl sends over a socket.
    const host = unix !== null ? "localhost" : (hostname.includes(":") ? "[" + hostname + "]" : hostname) + ":" + String(bound);
    while (true) {
      try {
        const conn = await listener.accept(stop);
        live.count.add(1);
        spawn(Http1.tracked(conn, boxed.clone(), host, stop.clone(), live.clone(), limits.clone()));
      } catch (e) {
        if (e instanceof AbortError) break;
        // Out of file descriptors, say: those in use free up as connections end.
        await sleep(50);
      }
    }
  }
  if (unix !== null) unixUnlink(unix);
  // ponytail: polls until the last connection ends; a wait group would wake at once.
  while (live.count.load() > 0) await sleep(10);
  // The last requests' spans go out before serve returns, since the program may end right after.
  if (limits.trace && __traceOn()) await __traceSend();
}

declare function fsh_rt_restart_ready(): void;
declare function fsh_rt_restart_spawn(port: i64): i64;
declare function fsh_rt_restart_wait(fd: i64, ms: i64): i64;
declare function fsh_rt_signal_listen(n: i64): i64;
declare function fsh_rt_signal_count(n: i64): i64;
declare function fsh_rt_signal_name(n: i64): Ptr<u8>;

// Each SIGUSR2 while the server runs starts the program again on its listener, and once the new
// process listens, stops this one's accepting through done.
// ponytail: looks for the signal every 100 ms; a wake from the signal's thread would be sooner.
async function __serveRestarts(port: i64, done: AbortController, stop: AbortSignal): Promise<void> {
  let usr2: i64 = 0;
  for (let n: i64 = 1; n < 65; n++) if (unsafe { !fsh_rt_signal_name(n).isNull() && fromCString(fsh_rt_signal_name(n)) === "SIGUSR2" }) usr2 = n;
  let seen = unsafe { fsh_rt_signal_listen(usr2) };
  while (true) {
    try {
      await sleep(100, stop);
    } catch (e) {
      return;
    }
    const now = unsafe { fsh_rt_signal_count(usr2) };
    if (now <= seen) continue;
    seen = now;
    const ready = unsafe { fsh_rt_restart_spawn(port) };
    if (ready < 0) {
      console.error("serve: the program couldn't be started again for a restart, so this one keeps serving");
      continue;
    }
    const said = await spawnBlocking(() => unsafe { fsh_rt_restart_wait(ready, 60000) });
    if (said === 1) {
      done.abort();
      return;
    }
    console.error(said === 0 ? "serve: the new process ended before it listened, so this one keeps serving" : "serve: the new process didn't listen within a minute and was stopped, so this one keeps serving");
  }
}

// What a request's head says: its request line and headers.
class HttpHead {
  method: string;
  target: string;
  version: string;
  headers: Headers;
  constructor(method: string, target: string, version: string, headers: Headers) {
    this.method = method;
    this.target = target;
    this.version = version;
    this.headers = headers;
  }
}

// One connection's requests, one after another while both sides keep it open. A request's head
// must arrive within headerTimeout of the connection opening or the last response, and with no
// byte of it yet the connection also closes after idleTimeout; a body must keep arriving, with
// no gap between reads longer than idleTimeout. A request that stalls once begun gets a 408.
async function serveConnection(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal, limits: __serveLimits): Promise<void> {
  let buffer: u8[] = [];
  try {
    // A client speaking HTTP/2, by prior knowledge or once ALPN chose it, opens with its preface.
    const opening = await Http1.readBy(conn, stop, Http1.sooner(Http1.after(limits.headerTimeout), Http1.after(limits.idleTimeout)));
    if (opening === null || opening.length === 0) return;
    buffer = opening;
    if (Http2.prefaceSoFar(buffer)) {
      await Http2.serve(conn, buffer, handler, host, stop, limits);
      return;
    }
    while (true) {
      buffer = Http1.skipBlank(buffer);
      const headBy = Http1.after(limits.headerTimeout);
      const idleBy = Http1.after(limits.idleTimeout);
      let end = Http1.headEnd(buffer, 0);
      while (end < 0) {
        // A head may take 16 KiB.
        if ((buffer.length as i64) > 16384) { await Http1.refuse(conn, 431); return; }
        const started = buffer.length > 0;
        const got = await Http1.readBy(conn, stop, started ? headBy : Http1.sooner(headBy, idleBy));
        if (got === null) {
          if (started) await Http1.refuse(conn, 408);
          return;
        }
        if (got.length === 0) return;
        const from = buffer.length as i64 - 3;
        for (const b of got) buffer.push(b);
        buffer = Http1.skipBlank(buffer);
        end = Http1.headEnd(buffer, from < 0 ? 0 : from);
      }
      if (end > 16384) { await Http1.refuse(conn, 431); return; }
      const head = Http1.parseHead(new TextDecoder().decode(Http1.take(buffer, 0, end)));
      if (head === null) { await Http1.refuse(conn, 400); return; }
      buffer = Http1.take(buffer, end + 4, buffer.length as i64);
      if (head.headers.has("transfer-encoding")) { await Http1.refuse(conn, 501); return; }
      const length = Http1.contentLength(head.headers);
      if (length < 0) { await Http1.refuse(conn, 400); return; }
      if (length > limits.maxBodySize) { await Http1.refuse(conn, 413); return; }
      // The Host header names the server and nothing else, and HTTP/1.1 requires one.
      let authority = host;
      const named = head.headers.get("host");
      if (named !== null) authority = named;
      if ((named === null && head.version === "HTTP/1.1") || !Http1.isHost(authority)) { await Http1.refuse(conn, 400); return; }
      const expect = head.headers.get("expect");
      if (length > 0 && head.version === "HTTP/1.1" && expect !== null && expect.toLowerCase() === "100-continue") {
        await conn.write(new TextEncoder().encode("HTTP/1.1 100 Continue\\r\\n\\r\\n"), AbortSignal.timeout(30000));
      }
      while ((buffer.length as i64) < length) {
        const got = await Http1.readBy(conn, stop, Http1.after(limits.idleTimeout));
        if (got === null) { await Http1.refuse(conn, 408); return; }
        if (got.length === 0) return;
        for (const b of got) buffer.push(b);
      }
      // The buffer becomes the body, so a large one isn't copied; what came after it is kept.
      let body = buffer;
      buffer = body.splice(length);
      const keep = Http1.keepAlive(head);
      const method = head.method;
      const version = head.version;
      // While the handler runs, a watcher aborts the request's signal if the client goes away.
      const client = new AbortController();
      const signal = client.signal;
      const done = new AbortController();
      const watching = spawn(Http1.watch(conn.clone(), client, done.signal));
      // The body is set after, not passed in init, which would copy it.
      let req = new Request((limits.secure ? "https://" : "http://") + authority + head.target, { method: method, headers: head.headers, signal: signal.clone() });
      req.__setBody(body);
      // The request's span is current only while the handler's task is made, which so starts
      // under it: this task goes on to the connection's next request.
      let traced: __traceRecord[] = [];
      let outer: i64[] = [];
      if (limits.trace && __traceOn()) {
        outer = __traceWords();
        traced.push(__traceRequest(req));
      }
      // The handler runs as a task of its own, so a panic in it ends only that task: its client
      // gets a bare 500 and the connection closes, and the server goes on serving.
      let res: Response;
      try {
        const running = spawn(Http1.handle(handler.clone(), req));
        if (traced.length > 0) __traceEnter(outer);
        res = await running.join();
      } catch (e) {
        __traceServed(traced, 500);
        done.abort();
        await watching;
        await Http1.send(conn, new Response("", { status: 500 }), false, true, version);
        return;
      }
      // The span ends here, before the response is written, so one place ends it however the
      // response goes out: its status is the handler's, or the 500 an unsendable one becomes.
      // ponytail: a streamed body's time isn't in the span, and an upgrade refused for its HTTP
      // version is recorded as the handler's 101; end the span where each response is written if
      // either matters.
      if (traced.length > 0) __traceServed(traced, Http1.sendable(res) ? res.status : 500);
      // A WebSocket route's 101 hands the connection to its session, which keeps it to the end.
      // Bytes the client sent past the request go to the session, though it shouldn't send any
      // before the 101.
      const upgrade = res.__upgrade();
      if (upgrade !== null && res.status === 101 && Http1.fieldsSendable(res)) {
        done.abort();
        const early = await watching;
        // RFC 6455 upgrades HTTP/1.1 and later only.
        if (version !== "HTTP/1.1") {
          await Http1.refuse(conn, 400);
          return;
        }
        for (const b of early) buffer.push(b);
        const sent = await Http1.put(conn, Http1.headText(res, "connection: Upgrade\\r\\n", false, "HTTP/1.1"), stop);
        if (sent) await upgrade(conn.clone(), buffer, stop.clone());
        return;
      }
      const said = res.headers.get("connection");
      const close = !keep || stop.aborted || (said !== null && Http1.hasToken(said, "close"));
      // A streamed body is taken out of the response; one that won't be sent is dropped unstarted.
      const byteStream = res.__byteStream();
      if (byteStream !== null && Http1.sendable(res) && res.status !== 204 && res.status !== 304) {
        let chunks = byteStream.__values();
        const open = await Http1.streamBytes(conn, res, chunks, method === "HEAD", close, version, signal, stop);
        done.abort();
        const early = await watching;
        if (!open) return;
        for (const b of early) buffer.push(b);
        continue;
      }
      const stream = res.__stream();
      if (stream !== null && Http1.sendable(res) && res.status !== 204 && res.status !== 304) {
        let pieces = stream;
        const open = await Http1.stream(conn, res, pieces, method === "HEAD", close, version, signal, stop);
        // The watcher holds the connection too, so it is stopped however the stream ended.
        done.abort();
        const early = await watching;
        if (!open) return;
        for (const b of early) buffer.push(b);
        continue;
      }
      done.abort();
      const early = await watching;
      for (const b of early) buffer.push(b);
      // A response that can't be sent as it stands, like a header value holding a line break,
      // goes out as a 500 instead.
      if (Http1.sendable(res)) await Http1.send(conn, res, method === "HEAD", close, version);
      else await Http1.send(conn, new Response("Internal Server Error\\n", { status: 500 }), false, close, version);
      if (close) return;
    }
  } catch (e) {
    return;
  }
}

// Routes requests by method and path, as Hono and Express do: the first route matching both
// runs, ':name' segments match any one segment, and a request no route matches gets a 404.
// ponytail: each request walks every route in order; a tree of segments would scale further.
class Router {
  private table: shared<__routerTable>;
  // The innermost next, which runs the routes. Holding a Dyn also keeps a Router from being
  // cloned, since clones would share one table.
  private inner: __routerNext;

  constructor() {
    // Named first: an empty array literal for a field of callables is typed 'never[]'.
    const handlers: ServeHandler[] = [];
    const groups: __routerMiddleware[][] = [];
    const routes: __routerRoutes = { methods: [], paths: [], handlers: handlers, prefixes: [], groups: groups };
    const middleware: __routerMiddleware[] = [];
    const table = shared<__routerTable>({ routes: new Lock<__routerRoutes>(routes), middleware: new Lock<__routerMiddleware[]>(middleware) });
    const held = table.clone();
    this.table = table;
    this.inner = Router.routing(held, 1);
  }

  // Routes a request from the first route, with no middleware but the routes' own groups', as
  // its depth-th re-route.
  private static routing(table: shared<__routerTable>, depth: i64): __routerNext {
    return async (r: Request) => {
      const res = await Router.dispatch(table.clone(), r, 0, depth);
      return res;
    };
  }

  // Wraps every route and the 404, whenever it is added; the first added runs outermost.
  use(this: Mut<this>, middleware: __routerMiddleware) { this.table.middleware.update((m) => { m.push(middleware); }); }

  get(this: Mut<this>, path: string, handler: ServeHandler) { this.add("GET", path, handler); }
  post(this: Mut<this>, path: string, handler: ServeHandler) { this.add("POST", path, handler); }
  put(this: Mut<this>, path: string, handler: ServeHandler) { this.add("PUT", path, handler); }
  patch(this: Mut<this>, path: string, handler: ServeHandler) { this.add("PATCH", path, handler); }
  delete(this: Mut<this>, path: string, handler: ServeHandler) { this.add("DELETE", path, handler); }
  // A route for every method.
  all(this: Mut<this>, path: string, handler: ServeHandler) { this.add("", path, handler); }

  // A route for a method, in any case, or a router mounted under a path prefix, as Hono's
  // app.route does: its routes join this one's in place, under the prefix, its middleware
  // running inside this one's for its routes alone.
  route(this: Mut<this>, method: string, path: string, handler: ServeHandler): void;
  route(this: Mut<this>, prefix: string, router: Router): void;
  route(this: Mut<this>, a: string, b: string | Router, ...handler: ServeHandler[]): void {
    if (typeof b !== "string") {
      this.mount(a, b);
      return;
    }
    for (const h of handler) this.add(a, b, h.clone());
  }

  // A path without a leading '/' gets one.
  private add(this: Mut<this>, method: string, path: string, handler: ServeHandler) {
    const upper = method.toUpperCase();
    const split = (path.startsWith("/") ? path : "/" + path).split("/");
    const none: __routerMiddleware[] = [];
    this.table.routes.update((t) => {
      t.methods.push(upper);
      t.paths.push(split);
      t.handlers.push(handler);
      t.prefixes.push(false);
      t.groups.push(none);
    });
  }

  // Adds each of a child's routes at its path below the prefix, the child's '/' being the prefix
  // itself. A static route's handler sees the path with the prefix taken off, as it would unmounted.
  private mount(this: Mut<this>, prefix: string, child: Router) {
    let base = (prefix.startsWith("/") ? prefix : "/" + prefix).split("/");
    if (base.length > 1 && base[base.length - 1] === "") base.pop();
    const drop = base.length as i64;
    const outer = child.table.middleware.update((all) => all.map((m) => m.clone()));
    const t = child.table.routes.update((t) => ({ methods: t.methods.clone(), paths: t.paths.clone(), handlers: t.handlers.map((h) => h.clone()), prefixes: t.prefixes.clone(), groups: t.groups.map((g) => g.map((m) => m.clone())) }));
    for (let i = 0; i < t.paths.length; i++) {
      const own = t.paths[i].clone();
      const path = own.length === 2 && own[1] === "" && drop > 1 ? base.clone() : base.concat(own.slice(1));
      let group = outer.map((m) => m.clone());
      for (const m of t.groups[i]) group.push(m.clone());
      let handler = t.handlers[i].clone();
      if (t.prefixes[i]) {
        const inner = handler;
        handler = async (r: Request) => {
          let moved = r;
          moved.path = "/" + moved.path.split("/").slice(drop).join("/");
          const res = await inner(moved);
          return res;
        };
      }
      const method = t.methods[i].clone();
      const prefixed = t.prefixes[i];
      this.table.routes.update((mine) => {
        mine.methods.push(method);
        mine.paths.push(path);
        mine.handlers.push(handler);
        mine.prefixes.push(prefixed);
        mine.groups.push(group);
      });
    }
  }

  // Serves the files under root at the paths below prefix, for GET and HEAD. A path that isn't
  // a readable regular file inside root, after symlinks are resolved, is answered 404.
  static(this: Mut<this>, prefix: string, root: string) {
    let split = (prefix.startsWith("/") ? prefix : "/" + prefix).split("/");
    if (split.length > 1 && split[split.length - 1] === "") split.pop();
    const skip = split.length;
    const none: __routerMiddleware[] = [];
    const handler: ServeHandler = async (req: Request) => {
      const res = await __staticResponse(req, skip, root.clone());
      return res;
    };
    this.table.routes.update((t) => {
      t.methods.push("GET");
      t.paths.push(split);
      t.handlers.push(handler);
      t.prefixes.push(true);
      t.groups.push(none);
    });
  }

  // A WebSocket route at a path, for GET: a request asking to upgrade gets a 101, and the handler
  // then has the connection's messages and sends on it until it returns, which closes it with
  // 1000 unless it was closed already. The route runs inside middleware as any route does, so
  // middleware can refuse a request with an ordinary response before anything is upgraded.
  ws(this: Mut<this>, path: string, handler: (ws: ServerWebSocket, req: Request) => Promise<void>, options?: WebSocketOptions) {
    const limits = __wsLimitsOf(options);
    const route: ServeHandler = async (req: Request) => {
      let res = __wsHandshake(req);
      if (res.status !== 101) return res;
      const run = handler.clone();
      const kept = limits.clone();
      const session: __wsUpgrade = async (conn: TcpStream, start: u8[], stop: AbortSignal) => {
        await __wsSession(conn, start, stop, kept.clone(), run.clone(), req.clone());
      };
      res.__upgradeWith(session);
      return res;
    };
    this.add("GET", path, route);
  }

  // The response the middleware give around the routes. Each next is built from the one inside
  // it, innermost first, so no call of the chain awaits itself.
  async handle(req: Request): Promise<Response> {
    // The route is found and its :params decoded once, before any middleware runs, so one that
    // isn't percent-encoded UTF-8 is refused before middleware sees the request.
    const path = req.path.clone();
    const method = req.method.clone();
    const have = path.split("/");
    const found = this.table.routes.update((t) => Router.find(t, method, have, 0));
    let handler: ServeHandler = async (r: Request) => new Response("Not Found\\n", { status: 404 });
    let params: string[] = [];
    let prefix = false;
    let after: usize = 0;
    let group: __routerMiddleware[] = [];
    if (found !== null) {
      const decoded = Router.decoded(found.params);
      if (decoded === null) return new Response("Bad Request\\n", { status: 400 });
      params = decoded;
      handler = found.handler;
      prefix = found.prefix;
      after = found.next;
      group = found.group;
    }
    const table = this.table.clone();
    // A middleware that changed the path or method has its request routed again.
    const again = this.inner.clone();
    let next: __routerNext = async (r: Request) => {
      if (r.path !== path || r.method !== method) {
        const res = await again(r);
        return res;
      }
      if (!prefix) {
        const res = await Router.run(handler.clone(), group.map((m) => m.clone()), params.clone(), again.clone(), r);
        return res;
      }
      // A static route's 404 is a miss, passed on to the routes after it.
      const res = await Router.run(handler.clone(), group.map((m) => m.clone()), params.clone(), again.clone(), r.clone());
      if (res.status !== 404) return res;
      const rest = await Router.dispatch(table.clone(), r, after, 0);
      return rest;
    };
    let chain = this.table.middleware.update((all) => all.map((m) => m.clone()));
    while (chain.length > 0) {
      const m = chain.pop()!;
      const inner = next;
      next = async (r: Request) => {
        const res = await m(r, inner.clone());
        return res;
      };
    }
    const res = await next(req);
    return res;
  }

  // The response of the first route from index start that matches; a HEAD request may run a GET
  // route, and a static route's 404 is a miss, passed on to the routes after it.
  // Group middleware that keep rewriting each other's paths are stopped with a 500 after a few
  // re-routes, before the recursion overflows the stack and takes the server down.
  private static async dispatch(table: shared<__routerTable>, req: Request, start: usize, depth: i64): Promise<Response> {
    if (depth > 10) return new Response("Internal Server Error\\n", { status: 500 });
    const have = req.path.split("/");
    const method = req.method.clone();
    let from = start;
    while (true) {
      const at = from;
      const found = table.routes.update((t) => Router.find(t, method, have, at));
      if (found === null) return new Response("Not Found\\n", { status: 404 });
      const params = Router.decoded(found.params);
      if (params === null) return new Response("Bad Request\\n", { status: 400 });
      const again = Router.routing(table.clone(), depth + 1);
      if (!found.prefix) {
        const res = await Router.run(found.handler, found.group, params, again, req);
        return res;
      }
      const res = await Router.run(found.handler, found.group, params, again, req.clone());
      if (res.status !== 404) return res;
      from = found.next;
    }
  }

  // The response of a route's handler inside the middleware of the routers mounted around it,
  // the first outermost. One of them that changes the path or method has the request routed again.
  private static async run(handler: ServeHandler, group: __routerMiddleware[], params: string[], again: __routerNext, req: Request): Promise<Response> {
    const path = req.path.clone();
    const method = req.method.clone();
    let next: __routerNext = async (r: Request) => {
      if (r.path !== path || r.method !== method) {
        const res = await again(r);
        return res;
      }
      let routed = r;
      routed.params = params.clone();
      const res = await handler(routed);
      return res;
    };
    let chain = group;
    while (chain.length > 0) {
      const m = chain.pop()!;
      const inner = next;
      next = async (r: Request) => {
        const res = await m(r, inner.clone());
        return res;
      };
    }
    const res = await next(req);
    return res;
  }

  // The first route from index start taking a method and path, its handler cloned, with the
  // :params it reads, whether it is a prefix route, and the index after it.
  private static find(t: Ref<__routerRoutes>, method: string, have: Ref<string[]>, start: usize): { handler: ServeHandler; params: string[]; prefix: boolean; next: usize; group: __routerMiddleware[] } | null {
    const head = method === "HEAD";
    for (let i = start; i < t.paths.length; i++) {
      const want = t.methods[i];
      if (want !== "" && want !== method && !(head && want === "GET")) continue;
      const found = Router.match(t.paths[i], have, t.prefixes[i]);
      if (found !== null) return { handler: t.handlers[i].clone(), params: found, prefix: t.prefixes[i], next: i + 1, group: t.groups[i].map((m) => m.clone()) };
    }
    return null;
  }

  // The router as the handler serve takes; the handler owns it.
  handler(this: Own<this>): ServeHandler {
    const router = this;
    return async (req: Request) => {
      const res = await router.handle(req);
      return res;
    };
  }

  // The :params with their values percent-decoded, or null when one doesn't decode.
  static decoded(params: Ref<string[]>): string[] | null {
    let out: string[] = [];
    for (let i: usize = 0; i + 1 < params.length; i += 2) {
      const value = __urlDecodeStrict(params[i + 1]);
      if (value === null) return null;
      out.push(params[i]);
      out.push(value);
    }
    return out;
  }

  // The :params a route's segments take from a path's, or null when they don't match. A prefix
  // route matches a path with more segments than its own.
  static match(want: Ref<string[]>, have: Ref<string[]>, prefix: boolean): string[] | null {
    if (prefix ? have.length < want.length : want.length !== have.length) return null;
    let params: string[] = [];
    for (let i = 0; i < want.length; i++) {
      if (want[i].startsWith(":")) {
        if (have[i].length === 0) return null;
        params.push(want[i].slice(1));
        params.push(have[i]);
      } else if (want[i] !== have[i]) return null;
    }
    return params;
  }
}

// What the checker writes around a route's handler that says its types: a 400 saying why the
// body isn't the JSON its type reads, a 204 for a handler giving nothing, and what a handler
// gives as JSON.
function __routerRefused(message: string): Response {
  return new Response(message, { status: 400 });
}

function __routerEmpty(): Response {
  return new Response(null, { status: 204 });
}

// The value is written here, not handed on to Response.json: a second generic function would
// write it as the type's layout, an empty optional field as null where the type leaves it out.
function __routerJson<T>(data: Ref<T>): Response {
  let res = new Response(JSON.stringify(data));
  res.headers.set("content-type", "application/json");
  return res;
}

// The response Router.static gives a request: the file below root its path names past the
// route's skip segments, a directory's index.html, or a 404 for anything else. Each segment is
// percent-decoded before it is checked, so an encoded slash, dot or NUL is refused like a plain one.
async function __staticResponse(req: Request, skip: usize, root: string): Promise<Response> {
  const segments = req.path.split("/");
  let parts: string[] = [];
  for (let i = skip; i < segments.length; i++) {
    const part = __urlDecodeStrict(segments[i]);
    if (part === null) return __staticMissing();
    // A trailing slash is kept, so it names only a directory; an empty segment anywhere else is
    // refused.
    if (part === "" && i + 1 === segments.length) {
      parts.push(part);
      continue;
    }
    // A leading dot refuses '.', '..' and hidden files such as '.env'.
    if (part === "" || part.startsWith(".") || part.includes("/") || part.includes("\\\\") || part.includes("\\0")) return __staticMissing();
    parts.push(part);
  }
  const found = await spawnBlocking(() => __staticFind(root, parts));
  if (found === null) return __staticMissing();
  const [path, size, mtime] = found;
  const tag = "W/\\"" + __staticHex(size) + "-" + __staticHex(mtime) + "\\"";
  let headers = new Headers();
  headers.set("etag", tag);
  headers.set("last-modified", new Date(mtime).toUTCString());
  const asked = req.headers.get("if-none-match");
  if (asked !== null && __staticMatches(asked, tag)) return new Response(null, { status: 304, headers: headers });
  headers.set("content-type", __staticType(path));
  try {
    const bytes = await fileRead(path);
    return new Response(bytes, { headers: headers });
  } catch (e) {
    return __staticMissing();
  }
}

function __staticMissing(): Response {
  return new Response("Not Found\\n", { status: 404 });
}

function __staticHex(n: i64): string {
  const digits = "0123456789abcdef";
  let out = "";
  let rest = n < 0 ? 0 : n;
  while (true) {
    out = digits[(rest % 16) as usize] + out;
    rest = rest / 16;
    if (rest === 0) return out;
  }
}

// The real path, size and modification time in milliseconds of the regular file root and parts
// name, or of the index.html of the directory they name, or null when there is none inside root.
// ponytail: the file is checked, then opened by its real path; a symlink swapped in between could
// still be followed, which opening each segment with O_NOFOLLOW would close.
function __staticFind(root: string, parts: Ref<string[]>): [string, i64, i64] | null {
  try {
    const base = pathReal(root);
    const inside = base.endsWith("/") ? base : base + "/";
    let path = inside + parts.join("/");
    let stat = pathStat(path, true);
    if (stat[3] === 2) {
      path = (path.endsWith("/") ? path : path + "/") + "index.html";
      stat = pathStat(path, true);
    }
    if (stat[3] !== 1) return null;
    const real = pathReal(path);
    if (!real.startsWith(inside)) return null;
    return [real, stat[0], Math.floor(stat[2]) as i64];
  } catch (e) {
    return null;
  }
}

// Whether an If-None-Match header names the ETag, compared weakly as RFC 9110 says for GET.
function __staticMatches(asked: string, tag: string): boolean {
  const strong = tag.slice(2);
  for (const each of asked.split(",")) {
    const t = each.trim();
    if (t === "*" || t === tag || t === strong) return true;
  }
  return false;
}

// The Content-Type for a file's extension, text types in UTF-8.
function __staticType(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  const text = "; charset=utf-8";
  if (ext === "html" || ext === "htm") return "text/html" + text;
  if (ext === "css") return "text/css" + text;
  if (ext === "js" || ext === "mjs") return "text/javascript" + text;
  if (ext === "json" || ext === "map") return "application/json" + text;
  if (ext === "txt") return "text/plain" + text;
  if (ext === "md") return "text/markdown" + text;
  if (ext === "csv") return "text/csv" + text;
  if (ext === "xml") return "application/xml" + text;
  if (ext === "svg") return "image/svg+xml" + text;
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "avif") return "image/avif";
  if (ext === "ico") return "image/x-icon";
  if (ext === "woff") return "font/woff";
  if (ext === "woff2") return "font/woff2";
  if (ext === "ttf") return "font/ttf";
  if (ext === "otf") return "font/otf";
  if (ext === "pdf") return "application/pdf";
  if (ext === "wasm") return "application/wasm";
  if (ext === "zip") return "application/zip";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  return "application/octet-stream";
}

// WebSockets over HTTP/1.1, as RFC 6455 has a server speak them: text and binary messages, each
// whole however the client fragmented it, pings answered with pongs, and the close handshake.
// Extensions such as permessage-deflate and subprotocols are never agreed to.

// A WebSocket route's limits. maxMessageSize is the most bytes one message may take, past which
// the connection is closed with 1009; maxBuffered the most bytes sends and pongs may queue for a client
// that reads slowly, past which it is closed with 1013; idleTimeout how long the client may send
// nothing before it is pinged, and as long again before it is dropped, in milliseconds, 0 for
// never. The defaults are 16 MiB, 16 MiB and two minutes.
type WebSocketOptions = { maxMessageSize?: i64; maxBuffered?: i64; idleTimeout?: i64 };
type __wsLimits = { maxMessageSize: i64; maxBuffered: i64; idleTimeout: i64 };
type __wsWhy = { code: i64; reason: string; heard: boolean };
type __wsUpgrade = (conn: TcpStream, start: u8[], stop: AbortSignal) => Promise<void>;
type __wsHandler = (ws: ServerWebSocket, req: Request) => Promise<void>;
// Frames waiting to be written, whether a close frame has been queued or the connection has
// broken, after which nothing more is sent, the bell a send aborts to wake the writer, and the
// code of a close the client sent, or 0.
type __wsOut = { bytes: u8[]; closing: boolean; bell: AbortController; heard: i64 };
// What every handle on one connection shares. The stream is held in an array of at most one, so
// the session can take it out as it ends, and no sender kept elsewhere holds the socket open.
// The writer and the reader end once ending aborts; returned aborts as the handler returns.
type __wsState = { conn: Lock<TcpStream[]>; out: Lock<__wsOut>; writing: Semaphore; ending: AbortController; returned: AbortController; maxBuffered: i64 };

function __wsLimitsOf(options: WebSocketOptions | null): __wsLimits {
  let limits: __wsLimits = { maxMessageSize: 16777216, maxBuffered: 16777216, idleTimeout: 120000 };
  if (options === null) return limits;
  const size = options.maxMessageSize;
  if (size !== null) limits.maxMessageSize = size;
  const buffered = options.maxBuffered;
  if (buffered !== null) limits.maxBuffered = buffered;
  const idle = options.idleTimeout;
  if (idle !== null) limits.idleTimeout = idle;
  assert(limits.maxMessageSize >= 0 && limits.maxBuffered >= 0 && limits.idleTimeout >= 0, "a WebSocket route's maxMessageSize, maxBuffered and idleTimeout can't be negative");
  // A frame's end, its length past a 14-byte head, then stays far from the i64 maximum.
  if (limits.maxMessageSize > 281474976710656) limits.maxMessageSize = 281474976710656;
  return limits;
}

// A connection a WebSocket route's handler has: the messages the client sends, read with
// 'for await (const m of ws)', each a string for a text message and bytes for a binary one, and
// sends and a close back. The loop ends once the connection closes, from either side.
class ServerWebSocket {
  #socket: WebSocketSender;
  #incoming: Channel<string | u8[]>;

  constructor(socket: WebSocketSender, incoming: Channel<string | u8[]>) {
    this.#socket = socket;
    this.#incoming = incoming;
  }

  // Queues a message, text for a string and binary for bytes; one sent after the connection
  // closed is dropped.
  send(data: string | u8[]) {
    this.#socket.send(data);
  }

  // Starts the close handshake with a code, 1000 or one of 3000 to 4999, and a reason of at most
  // 123 bytes. Messages that arrive before the client answers are still read.
  close(code?: i64, reason?: string) {
    this.#socket.close(code, reason);
  }

  // Waits until everything queued so far is written, so a handler sending a lot can keep pace
  // with a client that reads slowly.
  async flush(): Promise<void> {
    await this.#socket.flush();
  }

  // A handle other tasks can send on and close with, kept as long as they like; once the
  // connection closes, what they send is dropped.
  sender(): WebSocketSender {
    return this.#socket.clone();
  }

  // What 'for await' over the socket reads: the messages, until the connection closes.
  __wsMessages(): Channel<string | u8[]> {
    return this.#incoming.clone();
  }
}

// Sends on a WebSocket from any task. A message sent after the connection closed is dropped.
class WebSocketSender {
  #state: shared<__wsState>;

  constructor(state: shared<__wsState>) {
    this.#state = state;
  }

  send(data: string | u8[]) {
    const text = typeof data === "string";
    __wsQueue(this.#state.clone(), text ? 1 : 2, __httpBody(data));
  }

  close(code?: i64, reason?: string) {
    const c = code ?? 1000;
    const r = reason ?? "";
    assert(c === 1000 || (c >= 3000 && c <= 4999), "a WebSocket close code is 1000 or one of 3000 to 4999, not " + String(c));
    assert(new TextEncoder().encode(r).length <= 123, "a WebSocket close reason takes at most 123 bytes of UTF-8");
    __wsQueue(this.#state.clone(), 8, __wsClosing(c, r));
  }

  async flush(): Promise<void> {
    await __wsFlush(this.#state.clone());
  }

  // A close the client or the server's own rules call for, with a code a program can't send.
  __wsEnd(code: i64, reason: string) {
    __wsQueue(this.#state.clone(), 8, __wsClosing(code, reason));
  }

  // The session's close as the handler returns: the client's own code when it closed first.
  __wsFinish(code: i64) {
    this.#state.returned.abort();
    const heard = this.#state.out.update((o) => o.heard);
    this.__wsEnd(heard !== 0 ? heard : code, "");
  }

  __wsHeard(code: i64) {
    this.#state.out.update((o) => {
      o.heard = code;
    });
  }

  __wsReturned(): AbortSignal {
    return this.#state.returned.signal;
  }

  __wsPong(payload: u8[]) {
    __wsQueue(this.#state.clone(), 10, payload);
  }

  __wsPing() {
    __wsQueue(this.#state.clone(), 9, []);
  }

  // Nothing more is sent, as when the client has gone.
  __wsStop() {
    this.#state.out.update((o) => {
      o.closing = true;
    });
  }

  __wsState(): shared<__wsState> {
    return this.#state.clone();
  }

  // The stream given up, so senders kept after the connection ends don't hold it open.
  __wsRelease() {
    this.#state.conn.update((c) => {
      c.pop();
    });
  }
}

// The handshake's answer: a 101 accepting the key, a 405 to a HEAD request, which reaches GET
// routes, a 426 to a request that isn't an upgrade to WebSocket version 13, or a 400 for a key
// that isn't 16 bytes in base64.
function __wsHandshake(req: Ref<Request>): Response {
  if (req.method !== "GET") {
    let allow = new Headers();
    allow.set("allow", "GET");
    return new Response("Method Not Allowed\\n", { status: 405, headers: allow });
  }
  const upgrade = req.headers.get("upgrade");
  const connection = req.headers.get("connection");
  let headers = new Headers();
  if (upgrade === null || connection === null || !Http1.hasToken(upgrade, "websocket") || !Http1.hasToken(connection, "upgrade")) {
    headers.set("upgrade", "websocket");
    return new Response("Upgrade Required\\n", { status: 426, headers: headers });
  }
  if (req.headers.get("sec-websocket-version") !== "13") {
    headers.set("sec-websocket-version", "13");
    return new Response("Upgrade Required\\n", { status: 426, headers: headers });
  }
  const key = req.headers.get("sec-websocket-key");
  if (key === null || !__wsKey(key)) return new Response("Bad Request\\n", { status: 400 });
  const accept = __wsAccept(key);
  if (accept === null) return new Response("Internal Server Error\\n", { status: 500 });
  headers.set("upgrade", "websocket");
  headers.set("sec-websocket-accept", accept);
  return new Response(null, { status: 101, headers: headers });
}

// Whether a Sec-WebSocket-Key is 16 bytes in base64: 22 characters of the alphabet and '=='.
function __wsKey(key: string): boolean {
  if (key.length !== 24 || !key.endsWith("==")) return false;
  for (let i = 0; i < 22; i++) {
    const c = key.charCodeAt(i) as i64;
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;
    if (!ok) return false;
  }
  return true;
}

declare function fsh_rt_crypto_digest(which: i64, key: Ptr<u8>, keyLength: i64, data: Ptr<u8>, length: i64, rounds: i64, out: MutPtr<u8>): i64;

// Sec-WebSocket-Accept for a key: the SHA-1 of the key and the protocol's GUID, in base64, or
// null when OpenSSL, which hashes it, wasn't there to link.
function __wsAccept(key: string): string | null {
  const data = new TextEncoder().encode(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  const none: u8[] = [0 as u8];
  let out: u8[] = new Array(32).fill(0 as u8);
  const ok = unsafe { fsh_rt_crypto_digest(4, ptrOf(none[0]), 0, ptrOf(data[0]), data.length as i64, 0, mutPtrOf(out[0])) };
  if (ok !== 1) return null;
  return __arrayBase64Text(out.slice(0, 20), false, true);
}

// A frame from the server, which is never masked: final, with the opcode and payload.
function __wsFrame(opcode: i64, payload: Ref<u8[]>): u8[] {
  const n = payload.length as i64;
  let out: u8[] = [];
  out.reserve(n + 10);
  out.push((128 | opcode) as u8);
  if (n < 126) out.push(n as u8);
  else if (n < 65536) {
    out.push(126 as u8);
    out.push((n >> 8) as u8);
    out.push((n & 255) as u8);
  } else {
    out.push(127 as u8);
    for (let shift = 56; shift >= 0; shift -= 8) out.push(((n >> shift) & 255) as u8);
  }
  for (const b of payload) out.push(b);
  return out;
}

// A close frame's payload: the code in two bytes, then the reason.
function __wsClosing(code: i64, reason: string): u8[] {
  let out: u8[] = [(code >> 8) as u8, (code & 255) as u8];
  for (const b of new TextEncoder().encode(reason)) out.push(b);
  return out;
}

// Queues a frame and wakes the writer. Nothing is queued once a close has been, and any other
// frame that would take the queue past its limit, pongs to a client that pings and never reads
// included, closes the connection with 1013 instead.
function __wsQueue(state: shared<__wsState>, opcode: i64, payload: u8[]) {
  const frame = __wsFrame(opcode, payload);
  const limit = state.maxBuffered;
  state.out.update((o) => {
    if (o.closing) return;
    if (opcode !== 8 && (o.bytes.length + frame.length) as i64 > limit) {
      o.closing = true;
      for (const b of __wsFrame(8, __wsClosing(1013, "send buffer full"))) o.bytes.push(b);
    } else {
      if (opcode === 8) o.closing = true;
      for (const b of frame) o.bytes.push(b);
    }
    o.bell.abort();
  });
}

// Writes what sends queue, from when the connection opens until the session ends.
async function __wsWriter(state: shared<__wsState>): Promise<void> {
  const ending = state.ending.signal;
  while (!ending.aborted) {
    // The bell is replaced under the queue's lock, so a send can't ring the old one unheard.
    const bell = state.out.update((o): AbortSignal | null => {
      if (o.bytes.length > 0) return null;
      o.bell = new AbortController();
      return o.bell.signal;
    });
    if (bell !== null) {
      const either = AbortSignal.any([bell, ending.clone()]);
      await Http1.abortOf(either);
    } else await __wsFlush(state.clone());
  }
}

// Writes what is queued, by the writer or a handler's flush, one at a time so frames never
// interleave. A write that fails or
// takes over 30 seconds ends the connection.
async function __wsFlush(state: shared<__wsState>): Promise<void> {
  const _turn = await state.writing.acquire();
  while (true) {
    const conn = state.conn.update((c) => c.length > 0 ? c[0].clone() : null);
    if (conn === null) return;
    const bytes = state.out.update((o) => o.bytes.splice(0));
    if (bytes.length === 0) return;
    try {
      await conn.write(bytes, AbortSignal.timeout(30000));
    } catch (e) {
      state.out.update((o) => {
        o.closing = true;
        o.bytes = [];
      });
      state.ending.abort();
      return;
    }
  }
}

// Runs a WebSocket route's handler on an upgraded connection, while a reader takes the client's
// frames, and closes the connection once the handler returns: with 1000, 1011 when it panicked,
// or 1001 when the server stops and it hasn't returned a second later. The client's own close
// is waited for 5 seconds, then the connection ends.
async function __wsSession(conn: TcpStream, start: u8[], stop: AbortSignal, limits: __wsLimits, handler: __wsHandler, req: Request): Promise<void> {
  const incoming = new Channel<string | u8[]>(16);
  const ending = new AbortController();
  const streams: TcpStream[] = [conn.clone()];
  const socket = new WebSocketSender(shared<__wsState>({ conn: new Lock(streams), out: new Lock<__wsOut>({ bytes: [], closing: false, bell: new AbortController(), heard: 0 }), writing: new Semaphore(1), ending: ending.clone(), returned: new AbortController(), maxBuffered: limits.maxBuffered }));
  spawn(__wsWriter(socket.__wsState()));
  const reader = spawn(__wsRead(conn, start, socket.clone(), incoming.clone(), stop.clone(), ending.signal, limits));
  const ws = new ServerWebSocket(socket.clone(), incoming);
  const code = await Promise.race([__wsRun(handler, ws, req), __wsGraced(stop)]);
  socket.__wsFinish(code);
  await socket.flush();
  await Promise.race([__wsJoined(reader), Http1.late(5000)]);
  ending.abort();
  socket.__wsRelease();
}

// 1000 once the handler returns, or 1011 when it panicked: it runs as a task of its own, so a
// panic ends only it.
async function __wsRun(handler: __wsHandler, ws: ServerWebSocket, req: Request): Promise<i64> {
  try {
    await spawn(__wsCall(handler, ws, req)).join();
    return 1000;
  } catch (e) {
    return 1011;
  }
}

async function __wsCall(handler: __wsHandler, ws: ServerWebSocket, req: Request): Promise<void> {
  await handler(ws, req);
}

// 1001, a second after the server stops.
async function __wsGraced(stop: Ref<AbortSignal>): Promise<i64> {
  await Http1.graced(stop);
  return 1001;
}

async function __wsJoined(reader: JoinHandle<void>): Promise<boolean> {
  try {
    await reader.join();
  } catch (e) {}
  return true;
}

// Reads the client's frames until the connection closes: whole messages go to the handler, pings
// are answered, and a frame breaking the protocol closes the connection with the code RFC 6455
// gives for it. Ends with the messages closed, so the handler's loop ends too.
async function __wsRead(conn: TcpStream, start: u8[], socket: WebSocketSender, incoming: Channel<string | u8[]>, stop: AbortSignal, ending: AbortSignal, limits: __wsLimits): Promise<void> {
  const signal = AbortSignal.any([stop.clone(), ending]);
  let buffer = start;
  try {
    const why = await __wsFrames(conn, buffer, socket, incoming, signal, limits);
    // A frame breaking the protocol is answered before the messages end: the handler returns
    // once they do, and the 1000 its return closes with would otherwise race the code it earned.
    if (why !== null && !why.heard) {
      socket.__wsEnd(why.code, why.reason);
      incoming.close();
      return;
    }
    // The client's code is kept before the messages end: the handler returns once they do, on
    // another thread, and closes with the code it finds.
    if (why !== null) socket.__wsHeard(why.code);
    incoming.close();
    if (why === null) {
      if (stop.aborted) socket.__wsEnd(1001, "");
      else socket.__wsStop();
    } else {
      // The client's close is answered once the handler returns, so its replies to what came
      // before go out first, or after a second when it doesn't.
      const either = AbortSignal.any([socket.__wsReturned(), AbortSignal.timeout(1000)]);
      await Http1.abortOf(either);
      socket.__wsEnd(why.code, "");
    }
  } catch (e) {
    incoming.close();
    socket.__wsStop();
  }
}

// The frames' loop: null once the client went, or the code and reason to close with, which the
// client gave when it was heard closing.
async function __wsFrames(conn: Ref<TcpStream>, buffer: Mut<u8[]>, socket: Ref<WebSocketSender>, incoming: Ref<Channel<string | u8[]>>, signal: Ref<AbortSignal>, limits: __wsLimits): Promise<__wsWhy | null> throws IoError | AbortError {
  let message: u8[] = [];
  // The opcode of the message whose frames are arriving, or 0 between messages.
  let kind: i64 = 0;
  while (true) {
    const started = await __wsFill(conn, buffer, 2, socket, signal, limits.idleTimeout);
    if (!started) return null;
    const first = buffer[0] as i64;
    const second = buffer[1] as i64;
    const fin = (first & 128) !== 0;
    const opcode = first & 15;
    if ((first & 112) !== 0) return { code: 1002, reason: "reserved bits are set", heard: false };
    if ((second & 128) === 0) return { code: 1002, reason: "a client's frames must be masked", heard: false };
    if (opcode > 10 || (opcode > 2 && opcode < 8)) return { code: 1002, reason: "unknown opcode", heard: false };
    let length = second & 127;
    let head: i64 = 2;
    if (length >= 126) {
      head = length === 126 ? 4 : 10;
      const sized = await __wsFill(conn, buffer, head, socket, signal, limits.idleTimeout);
      if (!sized) return null;
      // The 8-byte form's top bit must be clear, so the length fits an i64.
      if (head === 10 && ((buffer[2] as i64) & 128) !== 0) return { code: 1009, reason: "message too big", heard: false };
      length = 0;
      for (let i = 2; i < head; i++) length = (length << 8) | (buffer[i as usize] as i64);
    }
    if (opcode >= 8 && (!fin || length > 125)) return { code: 1002, reason: "control frames are whole and at most 125 bytes", heard: false };
    // Compared without adding, since a client's length can be near the i64 maximum.
    if (opcode < 8 && length > limits.maxMessageSize - (message.length as i64)) return { code: 1009, reason: "message too big", heard: false };
    const end = head + 4 + length;
    const whole = await __wsFill(conn, buffer, end, socket, signal, limits.idleTimeout);
    if (!whole) return null;
    let payload: u8[] = [];
    payload.reserve(length);
    for (let i = 0; i < length; i++) payload.push(buffer[(head + 4 + i) as usize] ^ buffer[(head + (i & 3)) as usize]);
    const rest = buffer.splice(end);
    buffer.splice(0);
    for (const b of rest) buffer.push(b);
    if (opcode === 9) socket.__wsPong(payload);
    else if (opcode === 8) {
      if (length === 1) return { code: 1002, reason: "a close frame's code takes two bytes", heard: false };
      if (length === 0) return { code: 1000, reason: "", heard: true };
      const code = ((payload[0] as i64) << 8) | (payload[1] as i64);
      const allowed = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
      if (!allowed) return { code: 1002, reason: "a close code the protocol doesn't allow", heard: false };
      if (!__wsUtf8(payload.slice(2))) return { code: 1007, reason: "a close reason must be UTF-8", heard: false };
      return { code: code, reason: "", heard: true };
    } else if (opcode !== 10) {
      if (opcode === 0 && kind === 0) return { code: 1002, reason: "a continuation frame with no message to continue", heard: false };
      if (opcode !== 0 && kind !== 0) return { code: 1002, reason: "a new message began before the last one ended", heard: false };
      if (opcode !== 0) kind = opcode;
      for (const b of payload) message.push(b);
      if (fin) {
        const done = message.splice(0);
        const text = kind === 1;
        kind = 0;
        if (text && !__wsUtf8(done)) return { code: 1007, reason: "a text message must be UTF-8", heard: false };
        if (text) await incoming.send(new TextDecoder().decode(done), signal.clone());
        else await incoming.send(done, signal.clone());
      }
    }
  }
}

// Whether the buffer holds need bytes, reading more until it does: false once the connection
// ends, or the client sent nothing for two idle timeouts, a ping going out after the first.
async function __wsFill(conn: Ref<TcpStream>, buffer: Mut<u8[]>, need: i64, socket: Ref<WebSocketSender>, signal: Ref<AbortSignal>, idle: i64): Promise<boolean> throws IoError {
  let pinged = false;
  while ((buffer.length as i64) < need) {
    const got = await Http1.readBy(conn, signal, Http1.after(idle));
    if (got === null) {
      if (pinged) return false;
      socket.__wsPing();
      pinged = true;
      continue;
    }
    if (got.length === 0) return false;
    pinged = false;
    for (const b of got) buffer.push(b);
  }
  return true;
}

// Whether bytes are well-formed UTF-8: no overlong forms, surrogates, or code points past U+10FFFF.
function __wsUtf8(bytes: Ref<u8[]>): boolean {
  let i: usize = 0;
  while (i < bytes.length) {
    const c = bytes[i] as i64;
    if (c < 128) {
      i++;
      continue;
    }
    let more: usize = 0;
    let point: i64 = 0;
    let least: i64 = 0;
    if (c >= 194 && c <= 223) {
      more = 1;
      point = c & 31;
      least = 128;
    } else if (c >= 224 && c <= 239) {
      more = 2;
      point = c & 15;
      least = 2048;
    } else if (c >= 240 && c <= 244) {
      more = 3;
      point = c & 7;
      least = 65536;
    } else return false;
    if (i + more >= bytes.length) return false;
    for (let k: usize = 1; k <= more; k++) {
      const d = bytes[i + k] as i64;
      if ((d & 192) !== 128) return false;
      point = (point << 6) | (d & 63);
    }
    if (point < least || point > 1114111 || (point >= 55296 && point <= 57343)) return false;
    i += more + 1;
  }
  return true;
}

// The wire format of HTTP/1.x.
class Http1 {
  // A connection's requests, counted while it is open so the server can wait for it at shutdown.
  static async tracked(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal, live: shared<{ count: Atomic<i64> }>, limits: __serveLimits): Promise<void> {
    await serveConnection(conn, handler, host, stop, limits);
    live.count.sub(1);
  }

  // A serve option's value, or its default when it isn't given; serve refuses a negative one.
  static option(given: i64 | null, fallback: i64, name: string, unit: string): i64 throws IoError {
    if (given === null) return fallback;
    if (given < 0) throw new IoError("serve's " + name + " is " + String(given) + ", but it can't be negative; give it in " + unit);
    return given;
  }

  // The deadline ms from now, or 0, no deadline, for a timeout of 0.
  static after(ms: i64): i64 {
    return ms === 0 ? 0 : nowMs() + ms;
  }

  // The earlier of two deadlines, where 0 is none.
  static sooner(a: i64, b: i64): i64 {
    if (a === 0) return b;
    if (b === 0 || a < b) return a;
    return b;
  }

  static async handle(handler: ServeHandler, req: Request): Promise<Response> {
    return await handler(req);
  }

  // The client's next bytes, nothing once the stream ends or the server stops, or null once the
  // deadline passes. A deadline of 0 is none.
  static async readBy(conn: Ref<TcpStream>, stop: Ref<AbortSignal>, deadline: i64): Promise<u8[] | null> throws IoError {
    if (stop.aborted) return [];
    try {
      if (deadline === 0) return await conn.read(16384, stop.clone());
      const left = deadline - nowMs();
      if (left <= 0) return null;
      return await conn.read(16384, AbortSignal.any([stop.clone(), AbortSignal.timeout(left)]));
    } catch (e) {
      if (e instanceof IoError) throw e;
      if (stop.aborted) return [];
      return null;
    }
  }

  // Reads from the client while its request is handled and its response sent: the end of the
  // stream, or a broken connection, aborts the request's signal. Bytes that arrive are handed
  // back for the next request, and watching goes on past them, up to what one request may take.
  static async watch(conn: TcpStream, client: AbortController, done: AbortSignal): Promise<u8[]> {
    let early: u8[] = [];
    try {
      while ((early.length as i64) <= 16384 + 1048576) {
        const got = await conn.read(16384, done.clone());
        if (got.length === 0) {
          client.abort();
          return early;
        }
        for (const b of got) early.push(b);
      }
      // A client sending more than one request may take while waiting on this one can't be
      // served as it asks, so it is treated as gone, and watching stops.
      client.abort();
      return early;
    } catch (e) {
      if (e instanceof IoError) client.abort();
      return early;
    }
  }

  // Answers a request the server won't serve, and ends the connection.
  static async refuse(conn: Ref<TcpStream>, status: i64): Promise<void> throws IoError | AbortError {
    const res = new Response(Http1.reasonPhrase(status) + "\\n", { status: status });
    await Http1.send(conn, res, false, true, "HTTP/1.1");
  }

  // Writes a response. A small body goes out in one write with its head, since a second small
  // write can wait on the client's delayed ACK; a large one is written as it is, not copied.
  static async send(conn: Ref<TcpStream>, res: Response, head: boolean, close: boolean, version: string): Promise<void> throws IoError | AbortError {
    let out = new TextEncoder().encode(Http1.responseText(res, head, close, version));
    const sends = !head && res.status !== 204 && res.status !== 304;
    const body = res.__bytes();
    if (!sends || body.length <= 16384) {
      if (sends) for (const b of body) out.push(b);
      await conn.write(out, AbortSignal.timeout(30000));
      return;
    }
    await conn.write(out, AbortSignal.timeout(30000));
    // ponytail: the body is private to the response now, so a large one is copied once to write
    // it; handing the bytes over would need the response by value here.
    await conn.write(body.clone(), AbortSignal.timeout(30000));
  }

  // Where a request's head ends: the index of its blank line's CR LF CR LF, or -1. The search
  // starts at from, since what was searched before held no end.
  static headEnd(buffer: Ref<u8[]>, from: i64): i64 {
    for (let i = from as usize; i + 3 < buffer.length; i++) {
      if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) return i as i64;
    }
    return -1;
  }

  // Drops empty lines before a request, which a client may send after a body.
  static skipBlank(buffer: u8[]): u8[] {
    let at: i64 = 0;
    while ((buffer.length as i64) >= at + 2 && buffer[at as usize] === 13 && buffer[(at + 1) as usize] === 10) at += 2;
    if (at === 0) return buffer;
    return Http1.take(buffer, at, buffer.length as i64);
  }

  // The bytes from start to end, as a new array, for heads and other small pieces; a body is
  // split off its buffer with splice instead of copied.
  static take(buffer: Ref<u8[]>, start: i64, end: i64): u8[] {
    let out: u8[] = [];
    for (let i = start as usize; i < (end as usize); i++) out.push(buffer[i]);
    return out;
  }

  // The request line and headers, or null when they aren't HTTP/1.x.
  static parseHead(text: string): HttpHead | null {
    const lines = text.split("\\r\\n");
    // A CR, LF or NUL left after splitting at CR LF is a line break some other server sees.
    if (Http1.hasBreak(lines[0])) return null;
    const parts = lines[0].split(" ");
    if (parts.length !== 3 || !Http1.isToken(parts[0]) || !parts[1].startsWith("/")) return null;
    const version = parts[2];
    if (version !== "HTTP/1.1" && version !== "HTTP/1.0") return null;
    const headers = Http1.parseFields(lines);
    if (headers === null) return null;
    return new HttpHead(parts[0], parts[1], version, headers);
  }

  // The header lines after a head's first, or null when one isn't a header.
  static parseFields(lines: Ref<string[]>): Headers | null {
    let headers = new Headers();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colon = line.indexOf(":");
      if (colon <= 0 || Http1.hasBreak(line)) return null;
      const name = line.slice(0, colon);
      if (!Http1.isToken(name)) return null;
      headers.append(name, line.slice(colon + 1).trim());
    }
    return headers;
  }

  // A request's line, headers and body, as fetch sends it: the caller's headers in their order,
  // the framing and Host its own.
  static requestBytes(req: Ref<Request>, authority: string, path: string): u8[] throws IoError {
    if (!Http1.isToken(req.method)) throw new IoError("can't fetch '" + req.url + "': '" + req.method + "' isn't a method name");
    let text = req.method + " " + path + " HTTP/1.1\\r\\nhost: " + authority + "\\r\\n";
    let bad = "";
    req.headers.forEach((value: string, name: string) => {
      if (!Http1.isToken(name) || Http1.hasBreak(value)) bad = name;
      else if (name !== "host" && name !== "connection" && name !== "content-length" && name !== "transfer-encoding") text = text + name + ": " + value + "\\r\\n";
    });
    if (bad.length > 0) throw new IoError("can't fetch '" + req.url + "': header '" + bad + "' holds a line break or isn't a header name");
    if (!req.headers.has("accept")) text = text + "accept: */*\\r\\n";
    if (!req.headers.has("user-agent")) text = text + "user-agent: fish\\r\\n";
    const size = req.__bytes().length as i64;
    if (size > 0 || req.method === "POST" || req.method === "PUT" || req.method === "PATCH") text = text + "content-length: " + String(size) + "\\r\\n";
    let out = new TextEncoder().encode(text + "connection: close\\r\\n\\r\\n");
    for (const b of req.__bytes()) out.push(b);
    return out;
  }

  // The next bytes of a response, which must come before the connection ends.
  static async more(conn: Ref<TcpStream>, signal: Ref<AbortSignal>, before: string): Promise<u8[]> throws IoError | AbortError {
    const got = await conn.read(16384, signal.clone());
    if (got.length === 0) throw new IoError("the connection closed before " + before);
    return got;
  }

  // A response read whole from a connection that closes after it. Interim 1xx responses are
  // skipped; the body is framed by chunks, by Content-Length, or by the connection's end.
  static async receive(conn: TcpStream, head: boolean, signal: AbortSignal): Promise<Response> throws IoError | AbortError {
    let buffer: u8[] = [];
    while (true) {
      let end = Http1.headEnd(buffer, 0);
      while (end < 0) {
        if ((buffer.length as i64) > 65536) throw new IoError("the response's status line and headers are over 64 KiB");
        const from = buffer.length as i64 - 3;
        const got = await Http1.more(conn, signal, "the response's headers ended");
        for (const b of got) buffer.push(b);
        end = Http1.headEnd(buffer, from < 0 ? 0 : from);
      }
      if (end > 65536) throw new IoError("the response's status line and headers are over 64 KiB");
      const lines = new TextDecoder().decode(Http1.take(buffer, 0, end)).split("\\r\\n");
      buffer = Http1.take(buffer, end + 4, buffer.length as i64);
      const parts = lines[0].split(" ");
      const status = parts.length >= 2 ? Http1.digits(parts[1]) : -1;
      if (!lines[0].startsWith("HTTP/1.") || status < 100 || status > 999 || parts[1].length !== 3 || Http1.hasBreak(lines[0])) {
        throw new IoError("the response's status line '" + lines[0] + "' isn't HTTP/1.x");
      }
      const headers = Http1.parseFields(lines);
      if (headers === null) throw new IoError("the response's headers are malformed");
      if (status < 200 && status !== 101) continue;
      let body: u8[] = [];
      const coding = headers.get("transfer-encoding");
      if (head || status < 200 || status === 204 || status === 304) {
        body = [];
      } else if (coding !== null && Http1.hasToken(coding, "chunked")) {
        body = await Http1.chunked(conn, buffer, signal);
      } else if (coding === null && headers.has("content-length")) {
        const length = Http1.contentLength(headers);
        if (length < 0) throw new IoError("the response's Content-Length isn't a number");
        while ((buffer.length as i64) < length) {
          const got = await Http1.more(conn, signal, "the response's body ended");
          for (const b of got) buffer.push(b);
        }
        body = buffer;
        body.splice(length);
      } else {
        body = buffer;
        while (true) {
          const got = await conn.read(16384, signal.clone());
          if (got.length === 0) break;
          for (const b of got) body.push(b);
        }
      }
      let res = new Response(body, { status: status, statusText: lines[0].split(" ").slice(2).join(" "), headers: headers });
      return res;
    }
  }

  // A chunked body, decoded; trailers after the last chunk are left unread.
  static async chunked(conn: Ref<TcpStream>, start: u8[], signal: Ref<AbortSignal>): Promise<u8[]> throws IoError | AbortError {
    let buffer = start;
    let body: u8[] = [];
    let at: i64 = 0;
    while (true) {
      // The scan goes on from where the last read ended, and a size line may take 1 KiB.
      let line = Http1.lineEnd(buffer, at);
      while (line < 0) {
        if ((buffer.length as i64) - at > 1024) throw new IoError("the response's chunk size line is over 1 KiB");
        const from = buffer.length as i64 - 1;
        const got = await Http1.more(conn, signal, "the response's chunked body ended");
        for (const b of got) buffer.push(b);
        line = Http1.lineEnd(buffer, from < at ? at : from);
      }
      if (line - at > 1024) throw new IoError("the response's chunk size line is over 1 KiB");
      let sizeText = new TextDecoder().decode(Http1.take(buffer, at, line));
      const ext = sizeText.indexOf(";");
      if (ext >= 0) sizeText = sizeText.slice(0, ext);
      const size = Http1.hex(sizeText.trim());
      if (size < 0) throw new IoError("the response's chunk size '" + sizeText + "' isn't a hexadecimal number");
      at = line + 2;
      if (size === 0) return body;
      while ((buffer.length as i64) < at + size + 2) {
        const got = await Http1.more(conn, signal, "the response's chunked body ended");
        for (const b of got) buffer.push(b);
      }
      if (buffer[(at + size) as usize] !== 13 || buffer[(at + size + 1) as usize] !== 10) throw new IoError("the response's chunk of " + String(size) + " bytes isn't followed by CR LF");
      for (let i = at as usize; i < ((at + size) as usize); i++) body.push(buffer[i]);
      at = at + size + 2;
    }
  }

  // Where the line starting at from ends: the index of its CR LF, or -1.
  static lineEnd(buffer: Ref<u8[]>, from: i64): i64 {
    for (let i = from as usize; i + 1 < buffer.length; i++) {
      if (buffer[i] === 13 && buffer[i + 1] === 10) return i as i64;
    }
    return -1;
  }

  // A whole number written in hexadecimal digits, or -1.
  static hex(text: string): i64 {
    if (text.length === 0 || text.length > 15) return -1;
    let n: i64 = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1;
      if (d < 0) return -1;
      n = n * 16 + d;
    }
    return n;
  }

  // The body's length from Content-Length, 0 without one, or -1 when it isn't a number.
  static contentLength(headers: Ref<Headers>): i64 {
    const text = headers.get("content-length");
    if (text === null) return 0;
    return Http1.digits(text);
  }

  // A whole number written in decimal digits, or -1.
  static digits(text: string): i64 {
    if (text.length === 0 || text.length > 15) return -1;
    let n: i64 = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c < 48 || c > 57) return -1;
      n = n * 10 + (c - 48);
    }
    return n;
  }

  // HTTP/1.1 keeps a connection open unless asked not to; HTTP/1.0 closes it unless asked to keep it.
  static keepAlive(head: Ref<HttpHead>): boolean {
    const asked = head.headers.get("connection");
    const said = asked === null ? "" : asked;
    if (head.version === "HTTP/1.0") return Http1.hasToken(said, "keep-alive");
    return !Http1.hasToken(said, "close");
  }

  // Whether a comma-separated header value lists a token, in any case.
  static hasToken(value: string, token: string): boolean {
    for (const part of value.split(",")) {
      if (part.trim().toLowerCase() === token) return true;
    }
    return false;
  }

  // Whether text is an HTTP token: one or more letters, digits or !#$%&'*+-.^_\`|~.
  static isToken(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
      const mark = c === 33 || (c >= 35 && c <= 39) || c === 42 || c === 43 || c === 45 || c === 46 || c === 94 || c === 95 || c === 96 || c === 124 || c === 126;
      if (!alnum && !mark) return false;
    }
    return true;
  }

  // Whether text holds a CR, LF or NUL.
  static hasBreak(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c === 13 || c === 10 || c === 0) return true;
    }
    return false;
  }

  // Whether a Host header names a host and port only: no path, query, fragment, user, space,
  // or list of hosts, and a host and port the URL parser takes, so the request's URL parses.
  static isHost(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c <= 32 || c === 47 || c === 63 || c === 35 || c === 64 || c === 44 || c === 92 || c === 127) return false;
    }
    let url = __urlEmpty();
    return __urlHostPort(__urlPoints(text), url, true).length === 0;
  }

  // Whether a response can go out as it stands: a status the Fetch API allows, and a status
  // text and headers that can't break into lines of their own.
  static sendable(res: Ref<Response>): boolean {
    return res.status >= 200 && res.status <= 599 && Http1.fieldsSendable(res);
  }

  // Whether a response's status text, headers and cookies can't break into lines of their own.
  static fieldsSendable(res: Ref<Response>): boolean {
    if (Http1.hasBreak(res.statusText)) return false;
    let fine = true;
    res.headers.forEach((value: string, name: string) => {
      if (!Http1.isToken(name) || Http1.hasBreak(value)) fine = false;
    });
    for (const line of res.cookies.toSetCookieHeaders()) if (Http1.hasBreak(line)) fine = false;
    return fine;
  }

  // A response's status line and headers, as sent.
  // The server frames the body itself, so a handler's own framing headers are left out; 204
  // and 304 have no body at all.
  static responseText(res: Ref<Response>, head: boolean, close: boolean, version: string): string {
    const bodiless = res.status === 204 || res.status === 304;
    let framing = "";
    if (!bodiless) framing = "content-length: " + String(res.__bytes().length as i64) + "\\r\\n";
    return Http1.headText(res, framing, close, version);
  }

  // A response's status line and headers, framing its body as the framing header says.
  static headText(res: Ref<Response>, framing: string, close: boolean, version: string): string {
    let reason = res.statusText;
    if (reason.length === 0) reason = Http1.reasonPhrase(res.status);
    let text = "HTTP/1.1 " + String(res.status) + " " + reason + "\\r\\n";
    res.headers.forEach((value: string, name: string) => {
      if (name !== "content-length" && name !== "transfer-encoding" && name !== "connection" && name !== "date") text = text + name + ": " + value + "\\r\\n";
    });
    // Never folded into one line, since an Expires date holds a comma.
    for (const line of res.cookies.toSetCookieHeaders()) text = text + "set-cookie: " + line + "\\r\\n";
    text = text + framing + "date: " + httpDate() + "\\r\\n";
    if (close) text = text + "connection: close\\r\\n";
    else if (version === "HTTP/1.0") text = text + "connection: keep-alive\\r\\n";
    return text + "\\r\\n";
  }

  // Sends a response with a streamed body: its head, then each piece as its generator makes it,
  // a chunk apiece to an HTTP/1.1 client and closed-delimited to a 1.0 one, which has no chunks.
  // The server stopping ends the body cleanly at the generator's next await or yield. The
  // client's end of the stream ends it there with nothing more
  // written, as does a write that fails or times out: a half-closed client and one that has gone
  // look the same. Whether the connection may serve another request.
  static async stream(conn: Ref<TcpStream>, res: Ref<Response>, pieces: Mut<Dyn<AsyncGenerator<string>>>, head: boolean, close: boolean, version: string, client: Ref<AbortSignal>, stop: Ref<AbortSignal>): Promise<boolean> {
    const chunked = version === "HTTP/1.1";
    const framing = chunked ? "transfer-encoding: chunked\\r\\n" : "";
    const started = await Http1.put(conn, Http1.headText(res, framing, close || !chunked, version), stop);
    if (!started) return false;
    if (head) return chunked && !close;
    while (!stop.aborted) {
      const piece = await Promise.race([Http1.next(pieces), Http1.abortOf(client), Http1.abortOf(stop)]);
      if (client.aborted) return false;
      if (piece === null) break;
      if (piece.length === 0) continue;
      const size = new TextEncoder().encode(piece).length as i64;
      const framed = chunked ? Http1.hexOf(size) + "\\r\\n" + piece + "\\r\\n" : piece;
      const sent = await Http1.put(conn, framed, stop);
      if (!sent) return false;
    }
    if (!chunked) return false;
    const sent = await Http1.put(conn, "0\\r\\n\\r\\n", stop);
    return sent && !close && !stop.aborted;
  }

  // stream's twin for a body given as a stream of bytes, its chunks framed as they come.
  static async streamBytes(conn: Ref<TcpStream>, res: Ref<Response>, chunks: Mut<Dyn<AsyncGenerator<u8[]>>>, head: boolean, close: boolean, version: string, client: Ref<AbortSignal>, stop: Ref<AbortSignal>): Promise<boolean> {
    const chunked = version === "HTTP/1.1";
    const framing = chunked ? "transfer-encoding: chunked\\r\\n" : "";
    const started = await Http1.put(conn, Http1.headText(res, framing, close || !chunked, version), stop);
    if (!started) return false;
    if (head) return chunked && !close;
    while (!stop.aborted) {
      const chunk = await Promise.race([Http1.nextBytes(chunks), Http1.abortOfBytes(client), Http1.abortOfBytes(stop)]);
      if (client.aborted) return false;
      if (chunk === null) break;
      if (chunk.length === 0) continue;
      let framed: u8[] = chunked ? new TextEncoder().encode(Http1.hexOf(chunk.length as i64) + "\\r\\n") : [];
      for (const b of chunk) framed.push(b);
      if (chunked) {
        framed.push(13);
        framed.push(10);
      }
      const sent = await Http1.putBytes(conn, framed, stop);
      if (!sent) return false;
    }
    if (!chunked) return false;
    const sent = await Http1.put(conn, "0\\r\\n\\r\\n", stop);
    return sent && !close && !stop.aborted;
  }

  // Whether text was written within 30 seconds, and within a second of the server stopping.
  static async put(conn: Ref<TcpStream>, text: string, stop: Ref<AbortSignal>): Promise<boolean> {
    return await Http1.putBytes(conn, new TextEncoder().encode(text), stop);
  }

  static async putBytes(conn: Ref<TcpStream>, bytes: u8[], stop: Ref<AbortSignal>): Promise<boolean> {
    const sent = await Promise.race([Http1.written(conn, bytes), Http1.late(30000), Http1.graced(stop)]);
    return sent;
  }

  static async written(conn: Ref<TcpStream>, bytes: u8[]): Promise<boolean> {
    try {
      await conn.write(bytes);
      return true;
    } catch (e) {
      return false;
    }
  }

  // False, a second after the server stops.
  static async graced(stop: Ref<AbortSignal>): Promise<boolean> {
    await Http1.abortOf(stop);
    await sleep(1000);
    return false;
  }

  // False, once ms have passed.
  static async late(ms: i64): Promise<boolean> {
    await sleep(ms);
    return false;
  }

  // A stream's next piece, or null once it ends.
  static async next(pieces: Mut<Dyn<AsyncGenerator<string>>>): Promise<string | null> {
    const r = await pieces.next();
    if (r.done === false) return r.value;
    return null;
  }

  static async nextBytes(chunks: Mut<Dyn<AsyncGenerator<u8[]>>>): Promise<u8[] | null> {
    const r = await chunks.next();
    if (r.done === false) return r.value;
    return null;
  }

  static async abortOfBytes(signal: Ref<AbortSignal>): Promise<u8[] | null> {
    await Http1.abortOf(signal);
    return null;
  }

  // Null once the signal aborts.
  static async abortOf(signal: Ref<AbortSignal>): Promise<string | null> {
    while (!signal.aborted) {
      try {
        await sleep(86400000, signal.clone());
      } catch (e) {}
    }
    return null;
  }

  // A count in hexadecimal digits, as a chunk's size is written.
  static hexOf(n: i64): string {
    const digits = "0123456789abcdef";
    let text = "";
    let left = n;
    while (true) {
      text = digits.charAt(left & 15) + text;
      left = left >> 4;
      if (left === 0) return text;
    }
  }

  static reasonPhrase(status: i64): string {
    return match (status) {
      case 101 => "Switching Protocols",
      case 200 => "OK",
      case 201 => "Created",
      case 202 => "Accepted",
      case 204 => "No Content",
      case 301 => "Moved Permanently",
      case 302 => "Found",
      case 304 => "Not Modified",
      case 400 => "Bad Request",
      case 401 => "Unauthorized",
      case 403 => "Forbidden",
      case 404 => "Not Found",
      case 405 => "Method Not Allowed",
      case 408 => "Request Timeout",
      case 413 => "Content Too Large",
      case 426 => "Upgrade Required",
      case 431 => "Request Header Fields Too Large",
      case 500 => "Internal Server Error",
      case 501 => "Not Implemented",
      case 503 => "Service Unavailable",
      case _ => "",
    };
  }
}
`;

// Tracing, which comes with the HTTP library: serve opens a span for each request, and spans
// are sent to their collector over HTTP.
const TRACE = String.raw`
// Tracing: the spans serve and the std:trace module record, and their export to an OTLP
// collector. Every name here is one no program writes; the module holds the public ones.
declare function fsh_rt_trace_get(out: MutPtr<i64>): void;
declare function fsh_rt_trace_set(words: Ptr<i64>): void;
declare function fsh_rt_unix_nanos(): i64;
declare function fsh_rt_trace_ids(out: MutPtr<i64>, count: i64): void;
declare function fsh_rt_trace_env(name: Ptr<u8>): Ptr<u8>;

type __traceAttribute = { key: string; value: string | i64 | boolean };
// A span as it is exported: its trace id's two halves, its own id and its parent's, 0 for a
// root, and flags whose low bit says the trace is sampled. Times are Unix nanoseconds.
type __traceRecord = { name: string; hi: i64; lo: i64; id: i64; parent: i64; flags: i64; kind: i64; start: i64; end: i64; attributes: __traceAttribute[] };
type __traceSettings = { endpoint: string; service: string; delay: i64; armed: boolean; timer: i64; spans: __traceRecord[] };
// Where an endpoint's spans are posted.
type __traceTarget = { host: string; port: i64; authority: string; path: string };

// 0 until the settings are first read, then 1 while tracing is off and 2 while it is on, so a
// span site in a program that doesn't trace costs one load.
const __traceMode = new Atomic(0);
// The delay is the OpenTelemetry batch processor's default, five seconds.
const __traceHeld = new Lock<__traceSettings>({ endpoint: "", service: "", delay: 5000, armed: false, timer: 0, spans: [] });

// The current context: a trace id's halves, the current span's id and its flags, all 0 outside
// any span. It belongs to the task, so it follows one through its awaits.
function __traceWords(): i64[] {
  let words: i64[] = [0, 0, 0, 0];
  unsafe { fsh_rt_trace_get(mutPtrOf(words[0])) };
  return words;
}

function __traceEnter(words: Ref<i64[]>): void {
  unsafe { fsh_rt_trace_set(ptrOf(words[0])) };
}

function __traceNow(): i64 {
  return unsafe { fsh_rt_unix_nanos() };
}

function __traceFresh(): i64[] {
  let fresh: i64[] = [0, 0, 0];
  unsafe { fsh_rt_trace_ids(mutPtrOf(fresh[0]), 3) };
  return fresh;
}

function __traceEnv(name: string): string {
  const value = unsafe { fsh_rt_trace_env(cString(name)) };
  if (unsafe { value.isNull() }) return "";
  return unsafe { fromCString(value) };
}

// Each word as sixteen lowercase hex digits, as OTLP and traceparent write ids.
function __traceHex(words: Ref<i64[]>): string {
  const digits = new TextEncoder().encode("0123456789abcdef");
  let out: u8[] = [];
  for (const w of words) for (let shift: i64 = 60; shift >= 0; shift -= 4) out.push(digits[((w >> shift) & 15) as usize]);
  return new TextDecoder().decode(out);
}

// The context a W3C traceparent header carries, "00-<trace id>-<parent id>-<flags>" in
// lowercase hex, or null for anything else, an all-zero id included.
function __traceParent(header: string): i64[] | null {
  if (header.length !== 55) return null;
  // The trace id's halves, the parent id, the flags and the version.
  let words: i64[] = [0, 0, 0, 0, 0];
  for (let i: usize = 0; i < 55; i++) {
    const c = header.charCodeAt(i) as i64;
    if (i === 2 || i === 35 || i === 52) {
      if (c !== 45) return null;
      continue;
    }
    const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : -1;
    if (d < 0) return null;
    const at: usize = i < 2 ? 4 : i < 19 ? 0 : i < 35 ? 1 : i < 52 ? 2 : 3;
    words[at] = (words[at] << 4) | d;
  }
  if (words[4] === 255 || (words[0] === 0 && words[1] === 0) || words[2] === 0) return null;
  return [words[0], words[1], words[2], words[3] & 1];
}

// Where an endpoint's spans go: "<endpoint>/v1/traces" over plain HTTP, or null for an
// endpoint that isn't an http:// URL of a host, an optional port and an optional path.
function __traceTargetOf(endpoint: string): __traceTarget | null {
  if (!endpoint.startsWith("http://")) return null;
  const rest = endpoint.slice(7);
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  let base = slash < 0 ? "" : rest.slice(slash);
  while (base.endsWith("/")) base = base.slice(0, (base.length as i64) - 1);
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i) as i64;
    if (c <= 32 || c === 35 || c === 63 || c >= 127) return null;
  }
  if (!Http1.isHost(authority)) return null;
  let host = authority;
  let port: i64 = 80;
  const colon = authority.lastIndexOf(":");
  if (colon > authority.lastIndexOf("]")) {
    host = authority.slice(0, colon);
    port = Http1.digits(authority.slice(colon + 1));
    if (port < 0 || port > 65535) return null;
  }
  // An IPv6 host connects without the brackets it has in a URL.
  if (host.startsWith("[")) host = host.slice(1, (host.length as i64) - 1);
  return { host: host, port: port, authority: authority, path: base + "/v1/traces" };
}

// Takes the settings, tracing on when they name an endpoint spans can be posted to. The first
// read of the environment gives way to a configureTracing that got there before it.
function __traceApply(endpoint: string, service: string, delay: i64, first: boolean): void {
  const usable = endpoint.length === 0 || __traceTargetOf(endpoint) !== null;
  if (!usable) console.error("tracing is off: its endpoint '" + endpoint + "' isn't an http:// URL of a collector; give one like 'http://localhost:4318' in OTEL_EXPORTER_OTLP_ENDPOINT or configureTracing's 'endpoint'");
  __traceHeld.update((s) => {
    if (first && __traceMode.load() !== 0) return;
    s.endpoint = usable ? endpoint : "";
    s.service = service;
    if (delay >= 0) s.delay = delay;
    __traceMode.store(s.endpoint.length > 0 ? 2 : 1);
  });
}

function __traceConfigure(endpoint: string | null, service: string | null, delay: i64 | null): void {
  __traceApply(endpoint ?? __traceEnv("OTEL_EXPORTER_OTLP_ENDPOINT"), service ?? __traceEnv("OTEL_SERVICE_NAME"), delay ?? -1, false);
}

// Whether tracing is on. The environment is read once, the first time anything asks.
function __traceOn(): boolean {
  const mode = __traceMode.load();
  if (mode !== 0) return mode === 2;
  __traceApply(__traceEnv("OTEL_EXPORTER_OTLP_ENDPOINT"), __traceEnv("OTEL_SERVICE_NAME"), -1, true);
  return __traceMode.load() === 2;
}

// Begins a span under a parent context, a new trace when that names no span, and makes it the
// current one.
function __traceBegin(name: string, kind: i64, parent: Ref<i64[]>): __traceRecord {
  const fresh = __traceFresh();
  const root = parent[2] === 0;
  // An id of 0 stands for no span.
  const id = fresh[2] === 0 ? 1 : fresh[2];
  const record: __traceRecord = { name: name, hi: root ? fresh[0] : parent[0], lo: root ? fresh[1] : parent[1], id: id, parent: parent[2], flags: root ? 1 : parent[3], kind: kind, start: __traceNow(), end: 0, attributes: [] };
  __traceEnter([record.hi, record.lo, record.id, record.flags]);
  return record;
}

// Ends a span: it joins the batch, and a timer is set to send the batch when none is waiting.
// A span of a trace its caller didn't sample is not exported.
function __traceFinish(record: __traceRecord): void {
  if ((record.flags & 1) === 0) return;
  let done = record;
  done.end = __traceNow();
  const delay = __traceHeld.update((s) => {
    // ponytail: a batch holds 2048 spans, the OpenTelemetry queue's default, and drops the rest;
    // send early when it fills if a busy server loses spans between timers.
    if (s.spans.length >= 2048) return -1;
    s.spans.push(done);
    if (s.armed) return -1;
    s.armed = true;
    return s.delay;
  });
  if (delay < 0) return;
  const timer = setTimeout(async () => { await __traceSend(); }, delay);
  __traceHeld.update((s) => { s.timer = timer; });
}

// Ends a span opened by the std:trace module, whose parent becomes current again unless
// another span has taken its place since.
function __traceEnd(record: __traceRecord, prior: Ref<i64[]>): void {
  const now = __traceWords();
  if (now[2] === record.id && now[0] === record.hi && now[1] === record.lo) __traceEnter(prior);
  __traceFinish(record);
}

// A request's server span, current so the handler's task inherits it: under the caller's span
// when a traceparent header names one, a new trace otherwise.
function __traceRequest(req: Ref<Request>): __traceRecord {
  const given = req.headers.get("traceparent");
  const remote = given !== null ? __traceParent(given) : null;
  let record = __traceBegin(req.method, 2, remote ?? [0, 0, 0, 0]);
  record.attributes.push({ key: "http.request.method", value: req.method });
  record.attributes.push({ key: "url.path", value: req.path });
  return record;
}

// Ends a request's span, if it has one, with the status its response goes out with.
function __traceServed(open: Mut<__traceRecord[]>, status: i64): void {
  const record = open.pop();
  if (record === null) return;
  let done = record;
  done.attributes.push({ key: "http.response.status_code", value: status });
  __traceFinish(done);
}

// A batch as OTLP's JSON: ids in hex, times as decimal strings, each attribute by its type.
function __traceJson(spans: Ref<__traceRecord[]>, service: string): string {
  let out = '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":' + JSON.stringify(service.length > 0 ? service : "unknown_service") + '}}]},"scopeSpans":[{"scope":{"name":"fish"},"spans":[';
  for (let i = 0; i < spans.length; i++) {
    const s: Ref<__traceRecord> = spans[i];
    if (i > 0) out += ",";
    out += '{"traceId":"' + __traceHex([s.hi, s.lo]) + '","spanId":"' + __traceHex([s.id]) + '",';
    if (s.parent !== 0) out += '"parentSpanId":"' + __traceHex([s.parent]) + '",';
    out += '"name":' + JSON.stringify(s.name) + ',"kind":' + String(s.kind) + ',"startTimeUnixNano":"' + String(s.start) + '","endTimeUnixNano":"' + String(s.end) + '","attributes":[';
    for (let j = 0; j < s.attributes.length; j++) {
      const a: Ref<__traceAttribute> = s.attributes[j];
      const v = a.value;
      if (j > 0) out += ",";
      out += '{"key":' + JSON.stringify(a.key) + ',"value":';
      if (typeof v === "string") out += '{"stringValue":' + JSON.stringify(v) + "}}";
      else if (typeof v === "boolean") out += '{"boolValue":' + (v ? "true" : "false") + "}}";
      else out += '{"intValue":"' + String(v) + '"}}';
    }
    out += "]}";
  }
  return out + "]}]}]}";
}

// Posts a batch to the collector over HTTP/1.1, giving up after ten seconds.
async function __tracePost(to: __traceTarget, body: string): Promise<void> throws IoError | AbortError {
  const bytes = new TextEncoder().encode(body);
  let sent = new TextEncoder().encode("POST " + to.path + " HTTP/1.1\r\nhost: " + to.authority + "\r\ncontent-type: application/json\r\ncontent-length: " + String(bytes.length) + "\r\nconnection: close\r\n\r\n");
  for (const b of bytes) sent.push(b);
  const signal = AbortSignal.timeout(10000);
  const conn = await TcpStream.connect(to.host, to.port, signal.clone());
  await conn.write(sent, signal.clone());
  await Http1.receive(conn, false, signal);
}

// Sends what is buffered now, as the batch timer does when it fires. A batch that can't be
// delivered is dropped: a collector that is down mustn't make the program hold its spans.
async function __traceSend(): Promise<void> {
  const batch = __traceHeld.update((s) => {
    s.armed = false;
    return { spans: s.spans.splice(0), endpoint: s.endpoint, service: s.service, timer: s.timer };
  });
  // A timer still waiting has nothing left to send, and would keep the program running.
  clearTimeout(batch.timer);
  const to = __traceTargetOf(batch.endpoint);
  if (batch.spans.length === 0 || to === null) return;
  try {
    await __tracePost(to, __traceJson(batch.spans, batch.service));
  } catch (_e) {}
}
`;

// fetch, whose URLs the URL library's parser reads.
const FETCH = `
// Fetches a URL over HTTP/1.1, or HTTPS, one connection per request, as the Fetch API does,
// speaking HTTP/2 when an https: server's ALPN picks it: a
// 4xx or 5xx is a response, not an error, and a redirect is returned rather than followed.
async function fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> throws IoError | AbortError {
  const unix = init !== null ? init.unix : null;
  const ca = init !== null ? init.tls?.ca ?? "" : "";
  let req = __urlFetchRequest(input, init);
  await req.__drain();
  const signal = req.signal.clone();
  const to = __urlFetchAddress(req.url);
  const sent = Http1.requestBytes(req, to.authority, to.path);
  let conn: TcpStream;
  if (unix !== null) conn = await TcpStream.unix(unix, signal.clone());
  else conn = await TcpStream.connect(to.host, to.port, signal.clone());
  if (to.secure) {
    const chosen = await __tlsClientOffering(conn, to.host, ca, "h2,http/1.1", signal.clone());
    if (chosen === "h2") {
      const reply = await Http2.exchange(conn, "https", req.method, to.authority, to.path, req.headers, req.__bytes(), signal.clone());
      let body = reply.body;
      if (req.method === "HEAD") body = [];
      let res = new Response(body, { status: reply.status, headers: reply.headers });
      res.url = to.url;
      return res;
    }
  }
  await conn.write(sent, signal.clone());
  let res = await Http1.receive(conn, req.method === "HEAD", signal);
  res.url = to.url;
  return res;
}

// fetch's request: a Request given, with what init sets in place of its own.
function __urlFetchRequest(input: string | Request | URL, init?: RequestInit): Request {
  if (typeof input === "string") return new Request(input, init);
  if (input instanceof URL) return new Request(input.href, init);
  let req = input;
  if (init !== null) {
    const m = init.method;
    if (m !== null) req.method = m.toUpperCase();
    const h = init.headers;
    if (h !== null) req.headers = h;
    const b = init.body;
    if (b !== null) req.__setBody(b);
    const s = init.signal;
    if (s !== null) req.signal = s;
  }
  return req;
}

// Where an http: or https: URL points: host and port to connect to, the Host header, the path and query
// sent, and the URL without its fragment.
function __urlFetchAddress(url: string): { host: string; port: i64; secure: boolean; authority: string; path: string; url: string } throws IoError {
  const parsed = __urlFetchTarget(url);
  if (typeof parsed === "string") throw new IoError("can't fetch '" + url + "': " + parsed);
  const authority = parsed.port >= 0 ? parsed.host + ":" + String(parsed.port) : parsed.host.clone();
  const query = parsed.hasQuery ? "?" + parsed.query : "";
  // An IPv6 host connects without the brackets it has in the URL and the Host header.
  const host = parsed.host.startsWith("[") ? parsed.host.slice(1, (parsed.host.length as i64) - 1) : parsed.host.clone();
  const secure = parsed.scheme === "https";
  return { host: host, port: parsed.port >= 0 ? parsed.port : secure ? 443 : 80, secure: secure, authority: authority, path: __urlPathText(parsed) + query, url: __urlHref(parsed, parsed.hasQuery ? parsed.query.clone() : null, false) };
}
`;

// A request's path in a program without the URL library, whose requests all come from the server.
const SERVED = String.raw`
// A request's path, read with the parser's path rules from its URL as the server writes it:
// "http://" or "https://", a Host header the server checked, and a target starting with '/'.
function __urlRequestPath(url: string): string {
  const input = __urlInput(url);
  let p: i64 = url.startsWith("https:") ? 8 : 7;
  while (p < (input.length as i64) && input[p as usize] !== 47) p++;
  let record = __urlEmpty();
  record.scheme = "http";
  const begun: u8[] = [];
  __urlReadPath(input, p + 1, record, begun, true);
  return __urlPathText(record);
}
`;

// The URL Standard's pieces the HTTP server reads requests with: hosts, paths and decoding.
const URL_CORE = String.raw`
// The URL Standard's URL record, as the parser builds it. A part that may be missing has a flag
// saying whether it is there; a port of -1 is none.
type __urlRecord = { scheme: string; username: string; password: string; host: string; hasHost: boolean; port: i64; path: string[]; opaque: boolean; query: string; hasQuery: boolean; fragment: string; hasFragment: boolean };

function __urlEmpty(): __urlRecord {
  const path: string[] = [];
  return { scheme: "", username: "", password: "", host: "", hasHost: false, port: -1, path: path, opaque: false, query: "", hasQuery: false, fragment: "", hasFragment: false };
}

// A string's code points, read from its bytes in one pass, a lone surrogate as U+FFFD, as a URL
// reads its input.
function __urlPoints(s: string): i64[] {
  const bytes = new TextEncoder().encode(s);
  const n = bytes.length;
  let out: i64[] = [];
  out.reserve(n as i64);
  let i: usize = 0;
  while (i < n) {
    const b = bytes[i] as i64;
    let c = b;
    let k: usize = 1;
    if (b >= 0xF0 && i + 3 < n) {
      c = ((b & 7) << 18) | (((bytes[i + 1] as i64) & 63) << 12) | (((bytes[i + 2] as i64) & 63) << 6) | ((bytes[i + 3] as i64) & 63);
      k = 4;
    } else if (b >= 0xE0 && i + 2 < n) {
      c = ((b & 15) << 12) | (((bytes[i + 1] as i64) & 63) << 6) | ((bytes[i + 2] as i64) & 63);
      k = 3;
    } else if (b >= 0xC0 && i + 1 < n) {
      c = ((b & 31) << 6) | ((bytes[i + 1] as i64) & 63);
      k = 2;
    }
    out.push(c >= 0xD800 && c <= 0xDFFF ? 0xFFFD : c);
    i += k;
  }
  return out;
}

function __urlAt(points: Ref<i64[]>, i: i64): i64 {
  return i >= 0 && i < (points.length as i64) ? points[i as usize] : -1;
}

function __urlDefaultPort(scheme: string): i64 {
  if (scheme === "http" || scheme === "ws") return 80;
  if (scheme === "https" || scheme === "wss") return 443;
  if (scheme === "ftp") return 21;
  return -1;
}

function __urlAlpha(c: i64): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function __urlDigit(c: i64): boolean {
  return c >= 48 && c <= 57;
}

function __urlHexValue(c: i64): i64 {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

// Whether a percent-encode set of the URL Standard holds a code point.
function __urlInSet(c: i64, set: string): boolean {
  if (set === "none") return false;
  if (set === "form") return true;
  if (c < 32 || c > 126) return true;
  if (set === "c0") return false;
  if (set === "fragment") return c === 32 || c === 34 || c === 60 || c === 62 || c === 96;
  // The query set, then those adding to it.
  if (c === 32 || c === 34 || c === 35 || c === 60 || c === 62) return true;
  if (set === "query") return false;
  if (set === "specialQuery") return c === 39;
  if (c === 63 || c === 94 || c === 96 || c === 123 || c === 125) return true;
  if (set === "path") return false;
  return c === 47 || c === 58 || c === 59 || c === 61 || c === 64 || (c >= 91 && c <= 93) || c === 124;
}

// Appends a code point to UTF-8 bytes, percent-encoded when the set holds it. Output is built
// as bytes and made a string once, so a URL is read in linear time.
function __urlPut(out: Mut<u8[]>, c: i64, set: string) {
  const escape = __urlInSet(c, set);
  if (c < 0x80) __urlPutByte(out, c, escape);
  else if (c < 0x800) {
    __urlPutByte(out, 0xC0 | (c >> 6), escape);
    __urlPutByte(out, 0x80 | (c & 63), escape);
  } else if (c < 0x10000) {
    __urlPutByte(out, 0xE0 | (c >> 12), escape);
    __urlPutByte(out, 0x80 | ((c >> 6) & 63), escape);
    __urlPutByte(out, 0x80 | (c & 63), escape);
  } else {
    __urlPutByte(out, 0xF0 | (c >> 18), escape);
    __urlPutByte(out, 0x80 | ((c >> 12) & 63), escape);
    __urlPutByte(out, 0x80 | ((c >> 6) & 63), escape);
    __urlPutByte(out, 0x80 | (c & 63), escape);
  }
}

function __urlPutByte(out: Mut<u8[]>, b: i64, escape: boolean) {
  if (!escape) {
    out.push(b as u8);
    return;
  }
  const high = b >> 4;
  const low = b & 15;
  out.push(37);
  out.push((high < 10 ? 48 + high : 55 + high) as u8);
  out.push((low < 10 ? 48 + low : 55 + low) as u8);
}

// Bytes with each '%' and two hex digits read as the byte they name.
function __urlPercentDecode(bytes: Ref<u8[]>): u8[] {
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 37 && i + 2 < bytes.length + 0 && __urlHexValue(bytes[i + 1] as i64) >= 0 && __urlHexValue(bytes[i + 2] as i64) >= 0) {
      out.push((__urlHexValue(bytes[i + 1] as i64) * 16 + __urlHexValue(bytes[i + 2] as i64)) as u8);
      i += 3;
    } else {
      out.push(b);
      i += 1;
    }
  }
  return out;
}

// UTF-8 bytes as text, each malformed sequence as U+FFFD, and a leading byte order mark kept.
function __urlText(bytes: Ref<u8[]>): string {
  const bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  const text = new TextDecoder().decode(bytes);
  return bom ? "\u{FEFF}" + text : text;
}

// Whether a string is a Windows drive letter: a letter, then ':' or, unless normalized, '|'.
function __urlDrive(s: string, normalized: boolean): boolean {
  if (s.length !== 2 || !__urlAlpha(s.charCodeAt(0) as i64)) return false;
  const c = s.charCodeAt(1) as i64;
  return c === 58 || (!normalized && c === 124);
}

// Drops a path's last segment, except a file URL's drive letter.
function __urlShorten(url: Mut<__urlRecord>) {
  if (url.scheme === "file" && url.path.length === 1 && __urlDrive(url.path[0], true)) return;
  url.path.pop();
}

function __urlSingleDot(s: string): boolean {
  return s === "." || s.toLowerCase() === "%2e";
}

function __urlDoubleDot(s: string): boolean {
  const l = s.toLowerCase();
  return l === ".." || l === ".%2e" || l === "%2e." || l === "%2e%2e";
}

// A host as the parser makes it, or an error saying why there is none.
type __urlHost = { host: string; error: string };

function __urlHostOf(points: Ref<i64[]>, special: boolean): __urlHost {
  const failed = { host: "", error: "Invalid URL" };
  const n = points.length as i64;
  if (n > 0 && points[0] === 91) {
    if (points[(n - 1) as usize] !== 93) return failed;
    const address = __urlIpv6(points.slice(1, n - 1));
    if (address.length === 0) return failed;
    return { host: "[" + __urlIpv6Text(address) + "]", error: "" };
  }
  let raw: u8[] = [];
  for (const c of points) {
    if (!special && __urlForbiddenHost(c)) return failed;
    __urlPut(raw, c, special ? "none" : "c0");
  }
  if (!special) return { host: __urlText(raw), error: "" };
  const decoded = __urlPercentDecode(raw);
  const domain = __urlText(decoded);
  for (const c of __urlPoints(domain)) {
    if (c > 127) return { host: "", error: "Invalid URL: international domain names aren't supported yet" };
  }
  const ascii = domain.toLowerCase();
  for (const label of ascii.split(".")) {
    if (label.startsWith("xn--")) return { host: "", error: "Invalid URL: international domain names aren't supported yet" };
  }
  if (ascii.length === 0) return failed;
  for (const c of __urlPoints(ascii)) {
    if (__urlForbiddenHost(c) || c <= 31 || c === 37 || c === 127) return failed;
  }
  if (__urlEndsInNumber(ascii)) {
    const v4 = __urlIpv4(ascii);
    if (v4 < 0) return failed;
    return { host: __urlIpv4Text(v4), error: "" };
  }
  return { host: ascii, error: "" };
}

function __urlForbiddenHost(c: i64): boolean {
  return c === 0 || c === 9 || c === 10 || c === 13 || c === 32 || c === 35 || c === 47 || c === 58 || c === 60 || c === 62 || c === 63 || c === 64 || c === 91 || c === 92 || c === 93 || c === 94 || c === 124;
}

// Whether a domain's last label is a number, which makes the domain an IPv4 address.
function __urlEndsInNumber(domain: string): boolean {
  let parts = domain.split(".");
  if (parts[parts.length - 1].length === 0) {
    if (parts.length === 1) return false;
    parts.pop();
  }
  const last = parts[parts.length - 1];
  if (last.length === 0) return false;
  let digits = true;
  for (let i = 0; i < last.length; i++) {
    if (!__urlDigit(last.charCodeAt(i) as i64)) digits = false;
  }
  return digits || __urlIpv4Number(last) >= 0;
}

// A part of an IPv4 address in decimal, octal after '0' or hexadecimal after '0x', or -1.
// Values past 2^40 stay there, as any of them is too large.
function __urlIpv4Number(text: string): i64 {
  if (text.length === 0) return -1;
  let radix: i64 = 10;
  let digits = text;
  if (text.startsWith("0x") || text.startsWith("0X")) {
    radix = 16;
    digits = text.slice(2);
  } else if (text.length >= 2 && text.startsWith("0")) {
    radix = 8;
    digits = text.slice(1);
  }
  let n: i64 = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = __urlHexValue(digits.charCodeAt(i) as i64);
    if (d < 0 || d >= radix) return -1;
    if (n < 1099511627776) n = n * radix + d;
  }
  return n;
}

// An IPv4 address as a number, or -1.
function __urlIpv4(text: string): i64 {
  let parts = text.split(".");
  if (parts[parts.length - 1].length === 0 && parts.length > 1) parts.pop();
  if (parts.length > 4) return -1;
  let numbers: i64[] = [];
  for (const part of parts) {
    const n = __urlIpv4Number(part);
    if (n < 0) return -1;
    numbers.push(n);
  }
  const count = numbers.length as i64;
  for (let i: i64 = 0; i + 1 < count; i++) {
    if (numbers[i as usize] > 255) return -1;
  }
  const last = numbers[(count - 1) as usize];
  let limit: i64 = 1;
  for (let i: i64 = 0; i < 5 - count; i++) limit = limit * 256;
  if (last >= limit) return -1;
  let address = last;
  let scale: i64 = 16777216;
  for (let i: i64 = 0; i + 1 < count; i++) {
    address = address + numbers[i as usize] * scale;
    scale = scale / 256;
  }
  return address;
}

function __urlIpv4Text(address: i64): string {
  return String(address >> 24) + "." + String((address >> 16) & 255) + "." + String((address >> 8) & 255) + "." + String(address & 255);
}

// An IPv6 address's eight pieces, or none when the text isn't one.
function __urlIpv6(input: Ref<i64[]>): i64[] {
  const none: i64[] = [];
  let address: i64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  let piece: i64 = 0;
  let compress: i64 = -1;
  let p: i64 = 0;
  if (__urlAt(input, p) === 58) {
    if (__urlAt(input, p + 1) !== 58) return none;
    p += 2;
    piece++;
    compress = piece;
  }
  while (__urlAt(input, p) !== -1) {
    if (piece === 8) return none;
    if (__urlAt(input, p) === 58) {
      if (compress !== -1) return none;
      p++;
      piece++;
      compress = piece;
      continue;
    }
    let value: i64 = 0;
    let length: i64 = 0;
    while (length < 4 && __urlHexValue(__urlAt(input, p)) >= 0) {
      value = value * 16 + __urlHexValue(__urlAt(input, p));
      p++;
      length++;
    }
    if (__urlAt(input, p) === 46) {
      if (length === 0) return none;
      p -= length;
      if (piece > 6) return none;
      let seen: i64 = 0;
      while (__urlAt(input, p) !== -1) {
        let v4: i64 = -1;
        if (seen > 0) {
          if (__urlAt(input, p) === 46 && seen < 4) p++;
          else return none;
        }
        if (!__urlDigit(__urlAt(input, p))) return none;
        while (__urlDigit(__urlAt(input, p))) {
          const d = __urlAt(input, p) - 48;
          if (v4 === -1) v4 = d;
          else if (v4 === 0) return none;
          else v4 = v4 * 10 + d;
          if (v4 > 255) return none;
          p++;
        }
        address[piece as usize] = address[piece as usize] * 256 + v4;
        seen++;
        if (seen === 2 || seen === 4) piece++;
      }
      if (seen !== 4) return none;
      break;
    } else if (__urlAt(input, p) === 58) {
      p++;
      if (__urlAt(input, p) === -1) return none;
    } else if (__urlAt(input, p) !== -1) return none;
    address[piece as usize] = value;
    piece++;
  }
  if (compress !== -1) {
    let swaps = piece - compress;
    piece = 7;
    while (piece !== 0 && swaps > 0) {
      const held = address[piece as usize];
      address[piece as usize] = address[(compress + swaps - 1) as usize];
      address[(compress + swaps - 1) as usize] = held;
      piece--;
      swaps--;
    }
  } else if (piece !== 8) return none;
  return address;
}

// An IPv6 address written with its longest run of zero pieces, if two or more, as '::'.
function __urlIpv6Text(address: Ref<i64[]>): string {
  let compress: i64 = -1;
  let best: i64 = 1;
  let i: i64 = 0;
  while (i < 8) {
    let j = i;
    while (j < 8 && address[j as usize] === 0) j++;
    if (j - i > best) {
      best = j - i;
      compress = i;
    }
    i = j > i ? j : i + 1;
  }
  const digits = "0123456789abcdef";
  let out = "";
  let skipping = false;
  for (let k: i64 = 0; k < 8; k++) {
    const v = address[k as usize];
    if (skipping && v === 0) continue;
    skipping = false;
    if (compress === k) {
      out = out + (k === 0 ? "::" : ":");
      skipping = true;
      continue;
    }
    let hex = "";
    let n = v;
    while (true) {
      hex = digits.charAt(n & 15) + hex;
      n = n >> 4;
      if (n === 0) break;
    }
    out = out + hex;
    if (k !== 7) out = out + ":";
  }
  return out;
}

// Percent-encoded UTF-8 decoded, as decodeURIComponent does, or null for a '%' without two hex
// digits after it or bytes that aren't UTF-8.
function __urlDecodeStrict(text: string): string | null {
  const bytes = new TextEncoder().encode(text);
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 37) {
      out.push(bytes[i]);
      i += 1;
      continue;
    }
    if (i + 2 >= bytes.length + 0 || __urlHexValue(bytes[i + 1] as i64) < 0 || __urlHexValue(bytes[i + 2] as i64) < 0) return null;
    out.push((__urlHexValue(bytes[i + 1] as i64) * 16 + __urlHexValue(bytes[i + 2] as i64)) as u8);
    i += 3;
  }
  if (!__urlUtf8Valid(out)) return null;
  return new TextDecoder().decode(out);
}

// Whether bytes are well-formed UTF-8: no overlong forms, surrogates or code points past U+10FFFF.
function __urlUtf8Valid(bytes: Ref<u8[]>): boolean {
  const n = bytes.length as i64;
  let i: i64 = 0;
  while (i < n) {
    const b = bytes[i as usize] as i64;
    let need: i64 = 0;
    let low: i64 = 0x80;
    let high: i64 = 0xBF;
    if (b < 0x80) need = 0;
    else if (b >= 0xC2 && b <= 0xDF) need = 1;
    else if (b === 0xE0) { need = 2; low = 0xA0; }
    else if (b === 0xED) { need = 2; high = 0x9F; }
    else if (b >= 0xE1 && b <= 0xEF) need = 2;
    else if (b === 0xF0) { need = 3; low = 0x90; }
    else if (b === 0xF4) { need = 3; high = 0x8F; }
    else if (b >= 0xF1 && b <= 0xF3) need = 3;
    else return false;
    if (i + need >= n) return false;
    for (let k: i64 = 1; k <= need; k++) {
      const c = bytes[(i + k) as usize] as i64;
      if (c < (k === 1 ? low : 0x80) || c > (k === 1 ? high : 0xBF)) return false;
    }
    i += need + 1;
  }
  return true;
}

// A URL's path as its pathname gives it.
function __urlPathText(url: Ref<__urlRecord>): string {
  if (url.opaque) return url.path[0];
  if (url.path.length === 0) return "";
  return "/" + url.path.join("/");
}

// The code points a URL is parsed from: its leading and trailing C0 controls and spaces gone,
// then every tab and newline.
function __urlInput(raw: string): i64[] {
  const all = __urlPoints(raw);
  let first: i64 = 0;
  let end = all.length as i64;
  while (first < end && all[first as usize] <= 32) first++;
  while (end > first && all[(end - 1) as usize] <= 32) end--;
  let input: i64[] = [];
  input.reserve(end - first);
  for (let i = first; i < end; i++) {
    const c = all[i as usize];
    if (c !== 9 && c !== 10 && c !== 13) input.push(c);
  }
  return input;
}

// The parser's path state: reads segments into url from p, the first begun in segment, up to the
// '?', '#' or end that ends the path, and gives where that is.
function __urlReadPath(input: Ref<i64[]>, start: i64, url: Mut<__urlRecord>, begun: u8[], special: boolean): i64 {
  let segment = begun;
  let p = start;
  while (true) {
    const c = __urlAt(input, p);
    // '/', or '\' in a special URL, which the parser takes for one.
    const slash = c === 47 || (special && c === 92);
    if (c === -1 || slash || c === 63 || c === 35) {
      let text = __urlText(segment);
      segment = [];
      if (__urlDoubleDot(text)) {
        __urlShorten(url);
        if (!slash) url.path.push("");
      } else if (__urlSingleDot(text) && !slash) url.path.push("");
      else if (!__urlSingleDot(text)) {
        if (url.scheme === "file" && url.path.length === 0 && __urlDrive(text, false)) text = text.slice(0, 1) + ":";
        url.path.push(text);
      }
      if (!slash) return p;
    } else __urlPut(segment, c, "path");
    p++;
  }
}

// The parser's host and port states over the code points between an authority's user info and
// its end: the URL's host and port set, or the message of the failure.
function __urlHostPort(points: Ref<i64[]>, url: Mut<__urlRecord>, special: boolean): string {
  const failure = "Invalid URL";
  const n = points.length as i64;
  // The host ends at the first ':' outside brackets.
  let end = n;
  let brackets = false;
  for (let i: i64 = 0; i < n && end === n; i++) {
    const c = points[i as usize];
    if (c === 58 && !brackets) end = i;
    else if (c === 91) brackets = true;
    else if (c === 93) brackets = false;
  }
  if (end === 0 && (end < n || special)) return failure;
  const host = __urlHostOf(points.slice(0, end), special);
  if (host.error.length > 0) return host.error;
  url.host = host.host;
  url.hasHost = true;
  if (end + 1 >= n) return "";
  let port: i64 = 0;
  for (let i = end + 1; i < n; i++) {
    const d = points[i as usize];
    if (!__urlDigit(d)) return failure;
    port = port * 10 + (d - 48);
    if (port > 65535) return failure;
  }
  url.port = port === __urlDefaultPort(url.scheme) ? -1 : port;
  return "";
}
`;

// The URL Standard's parser, URL and URLSearchParams.
const URL_LIB = String.raw`
function __urlSpecial(scheme: string): boolean {
  return scheme === "http" || scheme === "https" || scheme === "ws" || scheme === "wss" || scheme === "ftp" || scheme === "file";
}

// Code points as a string.
function __urlString(points: Ref<i64[]>): string {
  let out: u8[] = [];
  for (const c of points) __urlPut(out, c, "none");
  return __urlText(out);
}

// Whether the code points from i start with a Windows drive letter ending there or before a
// '/', '\', '?' or '#'.
function __urlStartsWithDrive(input: Ref<i64[]>, i: i64): boolean {
  const second = __urlAt(input, i + 1);
  if (!__urlAlpha(__urlAt(input, i)) || (second !== 58 && second !== 124)) return false;
  const third = __urlAt(input, i + 2);
  return third === -1 || third === 47 || third === 92 || third === 63 || third === 35;
}

// The URL Standard's basic URL parser, without a state override: a URL record, or the message
// of the TypeError for an input that isn't a URL.
function __urlParse(raw: string, base: __urlRecord | null): __urlRecord | string {
  const failure = "Invalid URL";
  const input = __urlInput(raw);
  const hasBase = base !== null;
  const b = base ?? __urlEmpty();
  let url = __urlEmpty();
  // The parser's states, as the URL Standard names them.
  const SCHEME_START = 0;
  const SCHEME = 1;
  const NO_SCHEME = 2;
  const FILE = 3;
  const SPECIAL_RELATIVE_OR_AUTHORITY = 4;
  const SPECIAL_AUTHORITY_SLASHES = 5;
  const PATH_OR_AUTHORITY = 6;
  const OPAQUE_PATH = 7;
  const FRAGMENT = 8;
  const RELATIVE = 9;
  const SPECIAL_AUTHORITY_IGNORE_SLASHES = 10;
  const AUTHORITY = 11;
  const PATH = 12;
  const RELATIVE_SLASH = 13;
  const QUERY = 14;
  const PATH_START = 17;
  const FILE_SLASH = 18;
  const FILE_HOST = 19;
  let state = SCHEME_START;
  // The code points read for a scheme, authority, host or port.
  let buffer: i64[] = [];
  // What the parser writes, as bytes, made strings at the end: the path segment being read, an
  // opaque path, the query, the fragment, and the user name and password.
  let segment: u8[] = [];
  let opaque: u8[] = [];
  let query: u8[] = [];
  let fragment: u8[] = [];
  let username: u8[] = [];
  let password: u8[] = [];
  let opaqueRead = false;
  let queryRead = false;
  let atSign = false;
  let passwordToken = false;
  let special = false;
  let p: i64 = 0;
  while (true) {
    const c = __urlAt(input, p);
    // '/', or '\' in a special URL, which the parser takes for one.
    const slash = c === 47 || (special && c === 92);
    if (state === SCHEME_START) {
      if (__urlAlpha(c)) {
        buffer.push(c | 32);
        state = SCHEME;
      } else {
        state = NO_SCHEME;
        p--;
      }
    } else if (state === SCHEME) {
      if (__urlAlpha(c) || __urlDigit(c) || c === 43 || c === 45 || c === 46) {
        buffer.push(__urlAlpha(c) ? c | 32 : c);
      } else if (c === 58) {
        url.scheme = __urlString(buffer);
        special = __urlSpecial(url.scheme);
        buffer = [];
        if (url.scheme === "file") state = FILE;
        else if (__urlSpecial(url.scheme) && hasBase && b.scheme === url.scheme) state = SPECIAL_RELATIVE_OR_AUTHORITY;
        else if (__urlSpecial(url.scheme)) state = SPECIAL_AUTHORITY_SLASHES;
        else if (__urlAt(input, p + 1) === 47) {
          state = PATH_OR_AUTHORITY;
          p++;
        } else {
          url.opaque = true;
          opaqueRead = true;
          state = OPAQUE_PATH;
        }
      } else {
        buffer = [];
        state = NO_SCHEME;
        p = -1;
      }
    } else if (state === NO_SCHEME) {
      if (!hasBase || (b.opaque && c !== 35)) return failure;
      if (b.opaque) {
        url.scheme = b.scheme.clone();
      special = __urlSpecial(url.scheme);
        special = __urlSpecial(url.scheme);
        url.path = b.path.clone();
        url.opaque = true;
        url.query = b.query.clone();
        url.hasQuery = b.hasQuery;
        url.hasFragment = true;
        state = FRAGMENT;
      } else {
        state = b.scheme === "file" ? FILE : RELATIVE;
        p--;
      }
    } else if (state === SPECIAL_RELATIVE_OR_AUTHORITY) {
      if (c === 47 && __urlAt(input, p + 1) === 47) {
        state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
        p++;
      } else {
        state = RELATIVE;
        p--;
      }
    } else if (state === PATH_OR_AUTHORITY) {
      if (c === 47) state = AUTHORITY;
      else {
        state = PATH;
        p--;
      }
    } else if (state === RELATIVE) {
      url.scheme = b.scheme.clone();
      special = __urlSpecial(url.scheme);
      if (c === 47 || (__urlSpecial(url.scheme) && c === 92)) state = RELATIVE_SLASH;
      else {
        url.username = b.username.clone();
        url.password = b.password.clone();
        url.host = b.host.clone();
        url.hasHost = b.hasHost;
        url.port = b.port;
        url.path = b.path.clone();
        url.query = b.query.clone();
        url.hasQuery = b.hasQuery;
        if (c === 63) {
          queryRead = true;
          state = QUERY;
        } else if (c === 35) {
          url.hasFragment = true;
          state = FRAGMENT;
        } else if (c !== -1) {
          url.query = "";
          url.hasQuery = false;
          __urlShorten(url);
          state = PATH;
          p--;
        }
      }
    } else if (state === RELATIVE_SLASH) {
      if (special && (c === 47 || c === 92)) state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
      else if (c === 47) state = AUTHORITY;
      else {
        url.username = b.username.clone();
        url.password = b.password.clone();
        url.host = b.host.clone();
        url.hasHost = b.hasHost;
        url.port = b.port;
        state = PATH;
        p--;
      }
    } else if (state === SPECIAL_AUTHORITY_SLASHES) {
      state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
      if (c === 47 && __urlAt(input, p + 1) === 47) p++;
      else p--;
    } else if (state === SPECIAL_AUTHORITY_IGNORE_SLASHES) {
      if (c !== 47 && c !== 92) {
        state = AUTHORITY;
        p--;
      }
    } else if (state === AUTHORITY) {
      if (c === 64) {
        // A second '@' was part of the user info.
        if (atSign) {
          if (passwordToken) __urlPut(password, 64, "userinfo");
          else __urlPut(username, 64, "userinfo");
        }
        atSign = true;
        for (const point of buffer) {
          if (point === 58 && !passwordToken) {
            passwordToken = true;
            continue;
          }
          if (passwordToken) __urlPut(password, point, "userinfo");
          else __urlPut(username, point, "userinfo");
        }
        buffer = [];
      } else if (c === -1 || slash || c === 63 || c === 35) {
        if (atSign && buffer.length === 0) return failure;
        const error = __urlHostPort(buffer, url, special);
        if (error.length > 0) return error;
        buffer = [];
        state = PATH_START;
        p--;
      } else buffer.push(c);
    } else if (state === FILE) {
      url.scheme = "file";
      special = __urlSpecial(url.scheme);
      url.host = "";
      url.hasHost = true;
      if (c === 47 || c === 92) state = FILE_SLASH;
      else if (hasBase && b.scheme === "file") {
        url.host = b.host.clone();
        url.hasHost = b.hasHost;
        url.path = b.path.clone();
        url.query = b.query.clone();
        url.hasQuery = b.hasQuery;
        if (c === 63) {
          queryRead = true;
          state = QUERY;
        } else if (c === 35) {
          url.hasFragment = true;
          state = FRAGMENT;
        } else if (c !== -1) {
          url.query = "";
          url.hasQuery = false;
          if (!__urlStartsWithDrive(input, p)) __urlShorten(url);
          else url.path = [];
          state = PATH;
          p--;
        }
      } else {
        state = PATH;
        p--;
      }
    } else if (state === FILE_SLASH) {
      if (c === 47 || c === 92) state = FILE_HOST;
      else {
        if (hasBase && b.scheme === "file") {
          url.host = b.host.clone();
          url.hasHost = b.hasHost;
          if (!__urlStartsWithDrive(input, p) && b.path.length > 0 && __urlDrive(b.path[0], true)) url.path.push(b.path[0].clone());
        }
        state = PATH;
        p--;
      }
    } else if (state === FILE_HOST) {
      if (c === -1 || c === 47 || c === 92 || c === 63 || c === 35) {
        p--;
        // A drive letter isn't a host: it starts the path.
        if (buffer.length === 2 && __urlAlpha(buffer[0]) && (buffer[1] === 58 || buffer[1] === 124)) {
          for (const d of buffer) segment.push(d as u8);
          buffer = [];
          state = PATH;
        } else if (buffer.length === 0) {
          url.host = "";
          url.hasHost = true;
          state = PATH_START;
        } else {
          const host = __urlHostOf(buffer, true);
          if (host.error.length > 0) return host.error;
          url.host = host.host === "localhost" ? "" : host.host;
          url.hasHost = true;
          buffer = [];
          state = PATH_START;
        }
      } else buffer.push(c);
    } else if (state === PATH_START) {
      if (special) {
        state = PATH;
        if (c !== 47 && c !== 92) p--;
      } else if (c === 63) {
        queryRead = true;
        state = QUERY;
      } else if (c === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      } else if (c !== -1) {
        state = PATH;
        if (c !== 47) p--;
      }
    } else if (state === PATH) {
      p = __urlReadPath(input, p, url, segment, special);
      segment = [];
      const end = __urlAt(input, p);
      if (end === 63) {
        queryRead = true;
        state = QUERY;
      } else if (end === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      }
    } else if (state === OPAQUE_PATH) {
      if (c === 63) {
        queryRead = true;
        state = QUERY;
      } else if (c === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      } else if (c === 32) {
        const next = __urlAt(input, p + 1);
        if (next === 63 || next === 35) __urlPutByte(opaque, 32, true);
        else opaque.push(32);
      } else if (c !== -1) __urlPut(opaque, c, "c0");
    } else if (state === QUERY) {
      if (c === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      } else if (c !== -1) __urlPut(query, c, special ? "specialQuery" : "query");
    } else if (state === FRAGMENT) {
      if (c !== -1) __urlPut(fragment, c, "fragment");
    }
    if (p >= (input.length as i64)) break;
    p++;
  }
  if (opaqueRead) url.path = [__urlText(opaque)];
  if (queryRead) {
    url.query = __urlText(query);
    url.hasQuery = true;
  }
  url.fragment = __urlText(fragment);
  if (atSign) {
    url.username = __urlText(username);
    url.password = __urlText(password);
  }
  return url;
}

// A request's path: its URL's pathname, with a relative URL read against http://localhost. One
// that isn't a URL has the empty path, which no route matches; the server answers such a
// request 400 before making it.
function __urlRequestPath(url: string): string {
  const base = __urlParse("http://localhost/", null);
  const parsed = __urlParse(url, typeof base === "string" ? null : base);
  return typeof parsed === "string" ? "" : __urlPathText(parsed);
}

// Where an http: or https: URL points, for fetch: its record, or why it can't be fetched.
function __urlFetchTarget(url: string): __urlRecord | string {
  const parsed = __urlParse(url, null);
  if (typeof parsed === "string") return parsed.startsWith("Invalid URL: ") ? parsed.slice(13) : "it isn't a valid URL";
  if (parsed.scheme !== "http" && parsed.scheme !== "https") return "only http: and https: URLs are supported";
  if (parsed.username.length > 0 || parsed.password.length > 0) return "a URL can't hold a user name or password";
  if (parsed.port === 0) return "the port isn't a number from 1 to 65535";
  return parsed;
}

// A URL written out, with the query its params hold now.
function __urlHref(url: Ref<__urlRecord>, query: string | null, fragment: boolean): string {
  let out = url.scheme + ":";
  if (url.hasHost) {
    out = out + "//";
    if (url.username.length > 0 || url.password.length > 0) {
      out = out + url.username;
      if (url.password.length > 0) out = out + ":" + url.password;
      out = out + "@";
    }
    out = out + url.host;
    if (url.port >= 0) out = out + ":" + String(url.port);
  } else if (!url.opaque && url.path.length > 1 && url.path[0].length === 0) out = out + "/.";
  out = out + __urlPathText(url);
  if (query !== null) out = out + "?" + query;
  if (fragment && url.hasFragment) out = out + "#" + url.fragment;
  return out;
}

function __urlOrigin(url: Ref<__urlRecord>): string {
  const s = url.scheme;
  if (s === "blob") {
    const inner = __urlParse(__urlPathText(url), null);
    if (typeof inner === "string" || (inner.scheme !== "http" && inner.scheme !== "https")) return "null";
    return __urlOrigin(inner);
  }
  if (s !== "http" && s !== "https" && s !== "ws" && s !== "wss" && s !== "ftp") return "null";
  return s + "://" + url.host + (url.port >= 0 ? ":" + String(url.port) : "");
}

// A WHATWG URL. Its parts are read through getters. Its query is the one parsed until its
// searchParams change, and then theirs, so a change made there shows in search and href.
class URL {
  private url: __urlRecord;
  readonly searchParams: URLSearchParams;

  constructor(url: string, base?: string | URL) throws TypeError {
    let from: __urlRecord | null = null;
    if (base !== null) {
      if (typeof base === "string") {
        const parsed = __urlParse(base, null);
        if (typeof parsed === "string") throw new TypeError(parsed);
        from = parsed;
      } else from = base.record();
    }
    const parsed = __urlParse(url, from);
    if (typeof parsed === "string") throw new TypeError(parsed);
    const params = new URLSearchParams(parsed.query.clone());
    this.url = parsed;
    this.searchParams = params;
  }

  static parse(url: string, base?: string | URL): URL | null {
    try {
      return new URL(url, base);
    } catch (e) {
      return null;
    }
  }

  static canParse(url: string, base?: string | URL): boolean {
    return URL.parse(url, base) !== null;
  }

  // The query now: none once changed params are empty.
  private query(): string | null {
    if (this.searchParams.__urlChanged.get()) {
      const text = this.searchParams.toString();
      return text.length === 0 ? null : text;
    }
    return this.url.hasQuery ? this.url.query.clone() : null;
  }

  // The record with the query it has now.
  private record(): __urlRecord {
    let r = this.url.clone();
    const q = this.query();
    r.hasQuery = q !== null;
    r.query = q ?? "";
    return r;
  }

  get href(): string { return __urlHref(this.url, this.query(), true); }
  get origin(): string { return __urlOrigin(this.url); }
  get protocol(): string { return this.url.scheme + ":"; }
  get username(): string { return this.url.username; }
  get password(): string { return this.url.password; }
  get host(): string { return this.url.port >= 0 ? this.url.host + ":" + String(this.url.port) : this.url.host; }
  get hostname(): string { return this.url.host; }
  get port(): string { return this.url.port >= 0 ? String(this.url.port) : ""; }
  get pathname(): string { return __urlPathText(this.url); }
  get search(): string {
    const q = this.query();
    if (q === null || q.length === 0) return "";
    return "?" + q;
  }
  get hash(): string { return this.url.fragment.length > 0 ? "#" + this.url.fragment : ""; }
  toString(): string { return this.href; }
  toJSON(): string { return this.href; }

  // A copy with params of its own. The standard makes a URL's href parse back to the same URL.
  clone(): URL {
    return URL.parse(this.href)!;
  }
}

// Appends text as application/x-www-form-urlencoded writes a name or value.
function __urlFormPut(out: Mut<u8[]>, text: string) {
  for (const c of __urlPoints(text)) {
    if (c === 32) out.push(43);
    else __urlPut(out, c, __urlAlpha(c) || __urlDigit(c) || c === 42 || c === 45 || c === 46 || c === 95 ? "none" : "form");
  }
}

// A form-urlencoded name or value read back: '+' as a space, then percent escapes as UTF-8.
function __urlFormDecode(text: string): string {
  const bytes = new TextEncoder().encode(text.replaceAll("+", " "));
  return __urlText(__urlPercentDecode(bytes));
}

// Whether a sorts before b by UTF-16 code units, as JavaScript compares strings.
function __urlBefore(a: string, b: string): boolean {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return x < y;
  }
  return a.length < b.length;
}

// A URL's query as name and value pairs, or form data on its own. The pairs sit in a Cell, so
// a URL's searchParams change in place while the URL keeps them read-only.
class URLSearchParams {
  // Each name, then its value.
  private pairs: Cell<string[]> = new Cell<string[]>([]);
  // Whether the pairs have changed, which makes them the query of the URL they belong to.
  __urlChanged: Cell<boolean> = new Cell<boolean>(false);

  constructor(init?: string | [string, string][]) {
    let pairs: string[] = [];
    if (init !== null) {
      if (typeof init === "string") {
        const text = init.startsWith("?") ? init.slice(1) : init;
        for (const pair of text.split("&")) {
          if (pair.length === 0) continue;
          const eq = pair.indexOf("=");
          pairs.push(__urlFormDecode(eq >= 0 ? pair.slice(0, eq) : pair));
          pairs.push(eq >= 0 ? __urlFormDecode(pair.slice(eq + 1)) : "");
        }
      } else {
        for (const [name, value] of init) {
          pairs.push(name);
          pairs.push(value);
        }
      }
    }
    this.pairs.set(pairs);
  }

  get size(): i64 {
    const pairs = this.pairs.replace([]);
    const n = (pairs.length / 2) as i64;
    this.pairs.set(pairs);
    return n;
  }

  append(name: string, value: string) {
    let pairs = this.pairs.replace([]);
    pairs.push(name);
    pairs.push(value);
    this.changed(pairs);
  }

  // Drops every pair with the name, or only those also holding the value given.
  delete(name: string, value?: string) {
    const pairs = this.pairs.replace([]);
    let kept: string[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name && (value === null || pairs[i + 1] === value)) continue;
      kept.push(pairs[i]);
      kept.push(pairs[i + 1]);
    }
    this.changed(kept);
  }

  get(name: string): string | null {
    const pairs = this.pairs.replace([]);
    let found: string | null = null;
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name) {
        found = pairs[i + 1];
        break;
      }
    }
    this.pairs.set(pairs);
    return found;
  }

  getAll(name: string): string[] {
    const pairs = this.pairs.replace([]);
    let out: string[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name) out.push(pairs[i + 1]);
    }
    this.pairs.set(pairs);
    return out;
  }

  has(name: string, value?: string): boolean {
    const pairs = this.pairs.replace([]);
    let found = false;
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name && (value === null || pairs[i + 1] === value)) found = true;
    }
    this.pairs.set(pairs);
    return found;
  }

  // The first pair with the name takes the value, and the rest with it go.
  set(name: string, value: string) {
    const pairs = this.pairs.replace([]);
    let kept: string[] = [];
    let found = false;
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] !== name) {
        kept.push(pairs[i]);
        kept.push(pairs[i + 1]);
      } else if (!found) {
        found = true;
        kept.push(name.clone());
        kept.push(value.clone());
      }
    }
    if (!found) {
      kept.push(name);
      kept.push(value);
    }
    this.changed(kept);
  }

  // Orders the pairs by name, by UTF-16 code units, keeping pairs of one name in their order.
  sort() {
    const pairs = this.pairs.replace([]);
    const count = (pairs.length / 2) as i64;
    let order: i64[] = [];
    for (let i: i64 = 0; i < count; i++) {
      let j = i;
      while (j > 0 && __urlBefore(pairs[(2 * i) as usize], pairs[(2 * order[(j - 1) as usize]) as usize])) j--;
      order.splice(j, 0, i);
    }
    let sorted: string[] = [];
    for (const i of order) {
      sorted.push(pairs[(2 * i) as usize]);
      sorted.push(pairs[(2 * i + 1) as usize]);
    }
    this.changed(sorted);
  }

  toString(): string {
    const pairs = this.pairs.replace([]);
    let out: u8[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (i > 0) out.push(38);
      __urlFormPut(out, pairs[i]);
      out.push(61);
      __urlFormPut(out, pairs[i + 1]);
    }
    this.pairs.set(pairs);
    return __urlText(out);
  }

  forEach(callback: (value: string, name: string) => void) {
    const pairs = this.pairs.replace([]);
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) callback(pairs[i + 1], pairs[i]);
    this.pairs.set(pairs);
  }

  entries(): [string, string][] {
    const pairs = this.pairs.replace([]);
    let out: [string, string][] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) out.push([pairs[i], pairs[i + 1]]);
    this.pairs.set(pairs);
    return out;
  }

  keys(): string[] { return this.every(0); }
  values(): string[] { return this.every(1); }

  // Every name, or every value.
  private every(at: usize): string[] {
    const pairs = this.pairs.replace([]);
    let out: string[] = [];
    for (let i: usize = at; i < pairs.length; i += 2) out.push(pairs[i]);
    this.pairs.set(pairs);
    return out;
  }

  // A copy whose pairs change apart from these.
  clone(): URLSearchParams {
    const pairs = this.pairs.replace([]);
    const copy = new URLSearchParams();
    copy.pairs.set(pairs.clone());
    copy.__urlChanged.set(this.__urlChanged.get());
    this.pairs.set(pairs);
    return copy;
  }

  private changed(pairs: string[]) {
    this.pairs.set(pairs);
    this.__urlChanged.set(true);
  }
}
`;

const BYTE_METHODS = ["toBase64", "toHex"];
const BYTE_STATICS = ["fromBase64", "fromHex"];
const URL_NAMES = ["URL", "URLSearchParams"];
const STREAM_NAMES = ["ReadableStream", "WritableStream", "ReadableStreamDefaultReader", "WritableStreamDefaultWriter", "ReadableStreamDefaultController", "ReadableStreamReadResult", "UnderlyingSource", "UnderlyingSink"];
// std's names a program may declare its own of, which std's own code then reaches under another.
const HIDDEN_NAMES = [...URL_NAMES, "TypeError", "Date", "RangeError", "Html"];
// std's top-level names for its own code: a program can't use them as std means them, so no
// suggestion offers them.
export const STD_INTERNAL = new Set(["Http1", "HttpHead", "serveConnection", "Http2", "Http2Hpack", "Http2Stream"]);
const HTTP_NAMES = ["fetch", "serve", "Router", "ServerWebSocket", "WebSocketSender", "WebSocketOptions", "Request", "Response", "Headers", "CookieMap", "CookieInit", "RequestCookies", "ServeOptions", "ServeInfo", "ServeHandler", "RequestInit", "ResponseInit"];

// The std source sits past every program's files in offsets, so a position says which it is in.
export const STD_BASE: usize = 2 ** 40;
// What a macro builds syntax with besides quotes: `ident("x")`, a name the macro's user sees.
const AST_HELPERS = String.raw`
function ident(name: string): AstExpr {
  return { kind: "ident", name, start: 0, end: 0 };
}
`;

// A JSON value of no particular shape, as untyped `JSON.parse` gives one. The alias the parse
// reads takes a name no program can write, so a program's own `Json` can't change it; `Json`
// names it unless the program declares a `Json` of its own.
const JSON_VALUE = String.raw`
type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;
`;
const JSON_NAME = String.raw`
type Json = JsonValue;
`;
// The name untyped `JSON.parse` reads into.
export const JSON_VALUE_NAME = "json value";

// The encoders and decoders on bytes, in a program that calls one of them or btoa or atob.
const BYTES = `
// bytes.toBase64(options) and bytes.toHex(), as TC39's Uint8Array methods. Text is built as bytes
// and decoded once, since appending to a string copies it.
function __arrayToBase64(bytes: Ref<u8[]>, options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }): string {
  return __arrayBase64Text(bytes, options?.alphabet === "base64url", options?.omitPadding !== true);
}
function __arrayBase64Text(bytes: Ref<u8[]>, url: boolean, pad: boolean): string {
  const table = new TextEncoder().encode(url ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
  const n = bytes.length;
  let out: u8[] = [];
  out.reserve(((n + 2) / 3 * 4) as i64);
  let i: usize = 0;
  while (i + 3 <= n) {
    const v = ((bytes[i] as i64) << 16) | ((bytes[i + 1] as i64) << 8) | (bytes[i + 2] as i64);
    out.push(table[(v >> 18) as usize]);
    out.push(table[((v >> 12) & 63) as usize]);
    out.push(table[((v >> 6) & 63) as usize]);
    out.push(table[(v & 63) as usize]);
    i += 3;
  }
  const left = n - i;
  if (left > 0) {
    const v = ((bytes[i] as i64) << 16) | (left === 2 ? (bytes[i + 1] as i64) << 8 : 0);
    out.push(table[(v >> 18) as usize]);
    out.push(table[((v >> 12) & 63) as usize]);
    if (left === 2) out.push(table[((v >> 6) & 63) as usize]);
    if (pad) {
      if (left === 1) out.push(61);
      out.push(61);
    }
  }
  return new TextDecoder().decode(out);
}
function __arrayToHex(bytes: Ref<u8[]>): string {
  const digits = new TextEncoder().encode("0123456789abcdef");
  let out: u8[] = [];
  out.reserve((bytes.length * 2) as i64);
  for (const b of bytes) {
    out.push(digits[(b >> 4) as usize]);
    out.push(digits[(b & 15) as usize]);
  }
  return new TextDecoder().decode(out);
}
// A base64 character's value, or -1 for one outside the alphabet.
function __arrayBase64Value(c: i64, url: boolean): i64 {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (c >= 48 && c <= 57) return c + 4;
  if (c === (url ? 45 : 43)) return 62;
  if (c === (url ? 95 : 47)) return 63;
  return -1;
}
// ASCII whitespace, as the HTML spec and TC39 skip it.
function __arrayBase64Space(c: i64): boolean {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}
// A chunk of 2, 3 or 4 characters' values as its bytes. A short chunk's bits past its last byte are
// dropped, or refused when they must be zero.
function __arrayBase64Chunk(out: Mut<u8[]>, v: i64, count: i64, strict: boolean): void throws TypeError {
  const bits = v << ((4 - count) * 6);
  if (strict && (bits & (count === 2 ? 0xFFFF : count === 3 ? 0xFF : 0)) !== 0) throw new TypeError("base64 input has bits set past its last byte; fix its last character, or decode with lastChunkHandling: \\"loose\\"");
  out.push((bits >> 16) as u8);
  if (count > 2) out.push(((bits >> 8) & 255) as u8);
  if (count > 3) out.push((bits & 255) as u8);
}
// u8.fromBase64(s, options), TC39's FromBase64 with no length limit.
function __arrayFromBase64(s: string, options?: { alphabet?: "base64" | "base64url"; lastChunkHandling?: "loose" | "strict" | "stop-before-partial" }): u8[] throws TypeError {
  const url = options?.alphabet === "base64url";
  const handling = options?.lastChunkHandling ?? "loose";
  const text = new TextEncoder().encode(s);
  const n = text.length as i64;
  let out: u8[] = [];
  out.reserve(n / 4 * 3);
  let v: i64 = 0;
  let count: i64 = 0;
  let i: i64 = 0;
  while (true) {
    while (i < n && __arrayBase64Space(text[i as usize] as i64)) i++;
    if (i === n) {
      if (count === 0 || handling === "stop-before-partial") return out;
      if (handling === "strict") throw new TypeError("base64 input ends in a chunk without its padding; pad it with '=', or decode with lastChunkHandling: \\"loose\\"");
      if (count === 1) throw new TypeError("base64 input ends in a lone character, which holds no whole byte; check it isn't cut short");
      __arrayBase64Chunk(out, v, count, false);
      return out;
    }
    const c = text[i as usize] as i64;
    i++;
    if (c === 61) {
      if (count < 2) throw new TypeError("base64 padding '=' goes after the second or third character of a chunk of four");
      while (i < n && __arrayBase64Space(text[i as usize] as i64)) i++;
      if (count === 2) {
        if (i === n) {
          if (handling === "stop-before-partial") return out;
          throw new TypeError("base64 padding after two characters is '=='; add the second '='");
        }
        if (text[i as usize] === 61) {
          i++;
          while (i < n && __arrayBase64Space(text[i as usize] as i64)) i++;
        }
      }
      if (i < n) throw new TypeError("base64 input goes on after its padding; '=' only ends it");
      __arrayBase64Chunk(out, v, count, handling === "strict");
      return out;
    }
    const d = __arrayBase64Value(c, url);
    if (d < 0) throw new TypeError(url ? "base64url input holds a character outside A-Z, a-z, 0-9, '-' and '_'; decode standard base64 without alphabet: \\"base64url\\"" : "base64 input holds a character outside A-Z, a-z, 0-9, '+' and '/'; decode base64url with alphabet: \\"base64url\\"");
    v = (v << 6) | d;
    count++;
    if (count === 4) {
      __arrayBase64Chunk(out, v, 4, false);
      v = 0;
      count = 0;
    }
  }
}
function __arrayHexValue(c: i64): i64 {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}
// u8.fromHex(s): two digits a byte, in either case.
function __arrayFromHex(s: string): u8[] throws TypeError {
  const text = new TextEncoder().encode(s);
  if (text.length % 2 !== 0) throw new TypeError("hex input has an odd number of digits; each byte is two");
  let out: u8[] = [];
  out.reserve((text.length / 2) as i64);
  let i: usize = 0;
  while (i < text.length) {
    const high = __arrayHexValue(text[i] as i64);
    const low = __arrayHexValue(text[i + 1] as i64);
    if (high < 0 || low < 0) throw new TypeError("hex input holds a character outside 0-9, a-f and A-F");
    out.push((high * 16 + low) as u8);
    i += 2;
  }
  return out;
}
`;
// The typed arrays' helpers, in a program that names a typed array or DataView. Every typed array
// owns its elements, so one made over an ArrayBuffer takes it and copies out the range it views,
// reading the bytes in the host's order, little-endian on every target Fish builds for.
function typedFunctions(): string {
  const names = ["U8", "I8", "U16", "I16", "U32", "I32", "F32", "F64"];
  let out = "";
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const t = name.toLowerCase();
    if (i > 0) out += "\n";
    out += `function __arrayFromBuffer${name}(buffer: ArrayBuffer, byteOffset: i64, length: i64, size: i64, name: string): ${t}[] {
  const total = buffer.length as i64;
  assert(byteOffset % size === 0, "RangeError: start offset of " + name + " should be a multiple of " + String(size));
  assert(byteOffset >= 0 && byteOffset <= total, "RangeError: Start offset " + String(byteOffset) + " is outside the bounds of the buffer");
  let n = length;
  if (n < 0) {
    assert((total - byteOffset) % size === 0, "RangeError: byte length of " + name + " should be a multiple of " + String(size));
    n = (total - byteOffset) / size;
  }
  assert(byteOffset + n * size <= total, "RangeError: Invalid typed array length: " + String(n));
  let out: ${t}[] = new Array(n).fill(0 as ${t});
  if (n > 0) unsafe { fsh_rt_bytes_copy(mutPtrOf(out[0]) as MutPtr<u8>, ptrOf(buffer[byteOffset as usize]), n * size) };
  return out;
}
function __arrayTypedBuffer${name}(xs: Ref<${t}[]>, size: i64): ArrayBuffer {
  const n = (xs.length as i64) * size;
  let out: ArrayBuffer = new Array(n).fill(0 as u8);
  if (n > 0) unsafe { fsh_rt_bytes_copy(mutPtrOf(out[0]), ptrOf(xs[0]) as Ptr<u8>, n) };
  return out;
}
function __arrayTypedSet${name}(source: Ref<${t}[]>, target: Mut<${t}[]>, offset: i64, size: i64): void {
  const n = source.length as i64;
  assert(offset >= 0 && offset + n <= (target.length as i64), "RangeError: offset is out of bounds");
  if (n > 0) unsafe { fsh_rt_bytes_copy(mutPtrOf(target[offset as usize]) as MutPtr<u8>, ptrOf(source[0]) as Ptr<u8>, n * size) };
}`;
  }
  return out;
}
const TYPED = String.raw`
declare function fsh_rt_bytes_copy(to: MutPtr<u8>, from: Ptr<u8>, count: i64): void;
function __arrayTypedZeros<T>(length: i64, zero: T): T[] {
  assert(length >= 0, "RangeError: Invalid typed array length: " + String(length));
  return new Array(length).fill(zero);
}
${typedFunctions()}
`;

// DataView over an ArrayBuffer it owns, reading and writing numbers of each width in either byte
// order, big-endian unless told otherwise, as JavaScript's does.
const DATA_VIEW = String.raw`
class DataView {
  byteLength: usize;
  byteOffset: usize;
  buffer: ArrayBuffer;
  constructor(buffer: ArrayBuffer, byteOffset?: i64, byteLength?: i64) {
    const total = buffer.length as i64;
    const offset = byteOffset ?? 0;
    assert(offset >= 0 && offset <= total, "RangeError: Start offset " + String(offset) + " is outside the bounds of the buffer");
    const length = byteLength ?? total - offset;
    assert(length >= 0 && offset + length <= total, "RangeError: Invalid DataView length " + String(length));
    this.byteLength = length as usize;
    this.byteOffset = offset as usize;
    this.buffer = buffer;
  }
  #at(offset: i64, size: i64): i64 {
    assert(offset >= 0 && offset + size <= (this.byteLength as i64), "RangeError: Offset is outside the bounds of the DataView");
    return (this.byteOffset as i64) + offset;
  }
  #read(offset: i64, size: i64, little: boolean): u64 {
    const at = this.#at(offset, size);
    let v: u64 = 0;
    for (let i = 0; i < size; i++) v = (v << 8) | (this.buffer[(at + (little ? size - 1 - i : i)) as usize] as u64);
    return v;
  }
  #write(this: Mut<this>, offset: i64, size: i64, little: boolean, value: u64): void {
    const at = this.#at(offset, size);
    for (let i = 0; i < size; i++) this.buffer[(at + (little ? i : size - 1 - i)) as usize] = ((value >> ((8 * i) as u64)) & 255) as u8;
  }
  getUint8(byteOffset: i64): u8 { return this.#read(byteOffset, 1, false) as u8; }
  getInt8(byteOffset: i64): i8 { return this.#read(byteOffset, 1, false) as i8; }
  getUint16(byteOffset: i64, littleEndian?: boolean): u16 { return this.#read(byteOffset, 2, littleEndian === true) as u16; }
  getInt16(byteOffset: i64, littleEndian?: boolean): i16 { return this.#read(byteOffset, 2, littleEndian === true) as i16; }
  getUint32(byteOffset: i64, littleEndian?: boolean): u32 { return this.#read(byteOffset, 4, littleEndian === true) as u32; }
  getInt32(byteOffset: i64, littleEndian?: boolean): i32 { return this.#read(byteOffset, 4, littleEndian === true) as i32; }
  getBigUint64(byteOffset: i64, littleEndian?: boolean): bigint { return BigInt(this.#read(byteOffset, 8, littleEndian === true)); }
  getBigInt64(byteOffset: i64, littleEndian?: boolean): bigint { return BigInt(this.#read(byteOffset, 8, littleEndian === true) as i64); }
  getFloat32(byteOffset: i64, littleEndian?: boolean): f64 {
    const bits = this.#read(byteOffset, 4, littleEndian === true) as u32;
    let x: f32 = 0;
    unsafe { fsh_rt_bytes_copy(mutPtrOf(x) as MutPtr<u8>, ptrOf(bits) as Ptr<u8>, 4) };
    return x as f64;
  }
  getFloat64(byteOffset: i64, littleEndian?: boolean): f64 {
    const bits = this.#read(byteOffset, 8, littleEndian === true);
    let x: f64 = 0;
    unsafe { fsh_rt_bytes_copy(mutPtrOf(x) as MutPtr<u8>, ptrOf(bits) as Ptr<u8>, 8) };
    return x;
  }
  setUint8(this: Mut<this>, byteOffset: i64, value: u8): void { this.#write(byteOffset, 1, false, value as u64); }
  setInt8(this: Mut<this>, byteOffset: i64, value: i8): void { this.#write(byteOffset, 1, false, value as u64); }
  setUint16(this: Mut<this>, byteOffset: i64, value: u16, littleEndian?: boolean): void { this.#write(byteOffset, 2, littleEndian === true, value as u64); }
  setInt16(this: Mut<this>, byteOffset: i64, value: i16, littleEndian?: boolean): void { this.#write(byteOffset, 2, littleEndian === true, value as u64); }
  setUint32(this: Mut<this>, byteOffset: i64, value: u32, littleEndian?: boolean): void { this.#write(byteOffset, 4, littleEndian === true, value as u64); }
  setInt32(this: Mut<this>, byteOffset: i64, value: i32, littleEndian?: boolean): void { this.#write(byteOffset, 4, littleEndian === true, value as u64); }
  setBigUint64(this: Mut<this>, byteOffset: i64, value: bigint, littleEndian?: boolean): void { this.#write(byteOffset, 8, littleEndian === true, value as u64); }
  setBigInt64(this: Mut<this>, byteOffset: i64, value: bigint, littleEndian?: boolean): void { this.#write(byteOffset, 8, littleEndian === true, (value as i64) as u64); }
  setFloat32(this: Mut<this>, byteOffset: i64, value: f64, littleEndian?: boolean): void {
    const x = value as f32;
    let bits: u32 = 0;
    unsafe { fsh_rt_bytes_copy(mutPtrOf(bits) as MutPtr<u8>, ptrOf(x) as Ptr<u8>, 4) };
    this.#write(byteOffset, 4, littleEndian === true, bits as u64);
  }
  setFloat64(this: Mut<this>, byteOffset: i64, value: f64, littleEndian?: boolean): void {
    let bits: u64 = 0;
    unsafe { fsh_rt_bytes_copy(mutPtrOf(bits) as MutPtr<u8>, ptrOf(value) as Ptr<u8>, 8) };
    this.#write(byteOffset, 8, littleEndian === true, bits);
  }
}
`;

// Node's Buffer statics std has.
export const BUFFER_STATICS = ["from", "alloc", "allocUnsafe", "concat", "byteLength", "compare"];
// Node's Buffer reads, each by the helper reading its width.
export const BUFFER_READS: Record<string, string> = {
  readUInt8: "u8", readUint8: "u8", readInt8: "i8",
  readUInt16LE: "u16", readUInt16BE: "u16", readUint16LE: "u16", readUint16BE: "u16", readInt16LE: "i16", readInt16BE: "i16",
  readUInt32LE: "u32", readUInt32BE: "u32", readUint32LE: "u32", readUint32BE: "u32", readInt32LE: "i32", readInt32BE: "i32",
  readBigUInt64LE: "u64", readBigUInt64BE: "u64", readBigUint64LE: "u64", readBigUint64BE: "u64", readBigInt64LE: "i64", readBigInt64BE: "i64",
  readFloatLE: "f32", readFloatBE: "f32", readDoubleLE: "f64", readDoubleBE: "f64",
};
export const BUFFER_ENCODINGS = ["utf8", "utf-8", "hex", "base64", "base64url", "latin1", "binary", "ascii"];
// Node's Buffer methods a Uint8Array lacks and std doesn't have yet, refused by name.
export const BUFFER_REFUSED = new Set([
  "writeUInt8", "writeUint8", "writeInt8", "writeUInt16LE", "writeUInt16BE", "writeUint16LE", "writeUint16BE", "writeInt16LE", "writeInt16BE", "writeUInt32LE", "writeUInt32BE", "writeUint32LE", "writeUint32BE", "writeInt32LE", "writeInt32BE", "writeBigUInt64LE", "writeBigUInt64BE", "writeBigUint64LE", "writeBigUint64BE", "writeBigInt64LE", "writeBigInt64BE", "writeFloatLE", "writeFloatBE", "writeDoubleLE", "writeDoubleBE",
  "readUIntLE", "readUIntBE", "readIntLE", "readIntBE", "writeUIntLE", "writeUIntBE", "writeIntLE", "writeIntBE",
  "write", "copy", "toJSON", "swap16", "swap32", "swap64", "toLocaleString", "inspect",
]);
// Node's Buffer, a Uint8Array whose methods the checker turns into calls of these, in a program
// that names it. Text is built as bytes and decoded once, since appending to a string copies it.
const BUFFER = String.raw`
type BufferEncoding = "utf8" | "utf-8" | "hex" | "base64" | "base64url" | "latin1" | "binary" | "ascii";
// What a Buffer's read throws for an offset outside it, with Node's code and message.
class RangeError {
  name: string = "RangeError";
  message: string;
  code: string = "";
  cause: Dyn<ErrorLike> | null = null;
  constructor(message?: string, options?: ErrorOptions) {
    this.message = message ?? "";
    this.cause = options?.cause ?? null;
  }
}
// Node decodes leniently: hex up to the first pair that isn't hex, and base64 in either alphabet,
// skipping what isn't in it and stopping at padding.
function __arrayBufferFrom(s: string, encoding: BufferEncoding): u8[] {
  if (encoding === "utf8" || encoding === "utf-8") return new TextEncoder().encode(s);
  let out: u8[] = [];
  if (encoding === "latin1" || encoding === "binary" || encoding === "ascii") {
    for (let i: usize = 0; i < s.length; i++) out.push((s.charCodeAt(i) & 255) as u8);
    return out;
  }
  const text = new TextEncoder().encode(s);
  if (encoding === "hex") {
    let i: usize = 0;
    while (i + 1 < text.length) {
      const high = __arrayHexValue(text[i] as i64);
      const low = __arrayHexValue(text[i + 1] as i64);
      if (high < 0 || low < 0) break;
      out.push((high * 16 + low) as u8);
      i += 2;
    }
    return out;
  }
  let bits = 0;
  let count = 0;
  for (const c of text) {
    if (c === 61) break;
    let v = __arrayBase64Value(c as i64, false);
    if (v < 0) v = __arrayBase64Value(c as i64, true);
    if (v < 0) continue;
    bits = (bits << 6) | v;
    count++;
    if (count === 4) {
      __arrayBufferPushBits(out, bits, 4);
      bits = 0;
      count = 0;
    }
  }
  if (count > 1) __arrayBufferPushBits(out, bits << ((4 - count) * 6), count);
  return out;
}
function __arrayBufferPushBits(out: Mut<u8[]>, bits: i64, count: i64): void {
  out.push(((bits >> 16) & 255) as u8);
  if (count > 2) out.push(((bits >> 8) & 255) as u8);
  if (count > 3) out.push((bits & 255) as u8);
}
// buf.toString(encoding, start, end), the range clamped to the buffer as Node clamps it.
function __arrayBufferText(bytes: Ref<u8[]>, encoding: BufferEncoding, start: i64, end: i64): string {
  const n = bytes.length as i64;
  const from = start < 0 ? 0 : start > n ? n : start;
  const to = end > n ? n : end < from ? from : end;
  const part = from === 0 && to === n ? bytes.clone() : bytes.slice(from, to);
  if (encoding === "hex") return part.toHex();
  if (encoding === "base64") return __arrayBase64Text(part, false, true);
  if (encoding === "base64url") return __arrayBase64Text(part, true, false);
  if (encoding === "utf8" || encoding === "utf-8") return new TextDecoder().decode(part);
  let out: u8[] = [];
  out.reserve(part.length as i64);
  for (const b of part) {
    const c = encoding === "ascii" ? b & 127 : b;
    if (c < 128) out.push(c);
    else {
      out.push(192 | (c >> 6));
      out.push(128 | (c & 63));
    }
  }
  return new TextDecoder().decode(out);
}
function __arrayBufferAlloc(size: i64, fill: i64): u8[] {
  return new Array(size).fill((fill & 255) as u8);
}
// Buffer.concat(list, totalLength), cut or padded with zeros to totalLength when it is given.
function __arrayBufferConcat(list: Ref<u8[][]>, total: i64): u8[] {
  let out: u8[] = [];
  for (const b of list) for (const x of b) out.push(x);
  if (total >= 0) {
    while ((out.length as i64) > total) out.pop();
    while ((out.length as i64) < total) out.push(0);
  }
  return out;
}
function __arrayBufferByteLength(s: string): usize {
  return new TextEncoder().encode(s).length;
}
// -1, 0 or 1 as a sorts before, with or after b, byte by byte and then by length.
function __arrayBufferCompare(a: Ref<u8[]>, b: Ref<u8[]>): i64 {
  const n = a.length < b.length ? a.length : b.length;
  for (let i: usize = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
function __arrayBufferEquals(a: Ref<u8[]>, b: Ref<u8[]>): boolean {
  return __arrayBufferCompare(a, b) === 0;
}
// Where the UTF-8 of s first appears in bytes at or after from, which counts from the end when
// negative, or -1.
function __arrayBufferIndexOf(bytes: Ref<u8[]>, s: string, from: i64): i64 {
  const needle = new TextEncoder().encode(s);
  const n = bytes.length as i64;
  const m = needle.length as i64;
  let i = from >= 0 ? from : n + from < 0 ? 0 : n + from;
  for (; i + m <= n; i++) {
    let j = 0;
    while (j < m && bytes[(i + j) as usize] === needle[j as usize]) j++;
    if (j === m) return i;
  }
  return -1;
}
function __arrayBufferIncludes(bytes: Ref<u8[]>, s: string, from: i64): boolean {
  return __arrayBufferIndexOf(bytes, s, from) >= 0;
}
function __arrayBufferRead(bytes: Ref<u8[]>, offset: i64, size: i64, little: boolean): u64 throws RangeError {
  const last = (bytes.length as i64) - size;
  if (last < 0) {
    let e = new RangeError("Attempt to access memory outside buffer bounds");
    e.code = "ERR_BUFFER_OUT_OF_BOUNDS";
    throw e;
  }
  if (offset < 0 || offset > last) {
    let e = new RangeError("The value of \"offset\" is out of range. It must be >= 0 and <= " + String(last) + ". Received " + String(offset));
    e.code = "ERR_OUT_OF_RANGE";
    throw e;
  }
  let v: u64 = 0;
  for (let i = 0; i < size; i++) v = (v << 8) | (bytes[(offset + (little ? size - 1 - i : i)) as usize] as u64);
  return v;
}
function __arrayBufferReadU8(b: Ref<u8[]>, o: i64, little: boolean): u8 throws RangeError { return __arrayBufferRead(b, o, 1, little) as u8; }
function __arrayBufferReadI8(b: Ref<u8[]>, o: i64, little: boolean): i8 throws RangeError { return __arrayBufferRead(b, o, 1, little) as i8; }
function __arrayBufferReadU16(b: Ref<u8[]>, o: i64, little: boolean): u16 throws RangeError { return __arrayBufferRead(b, o, 2, little) as u16; }
function __arrayBufferReadI16(b: Ref<u8[]>, o: i64, little: boolean): i16 throws RangeError { return __arrayBufferRead(b, o, 2, little) as i16; }
function __arrayBufferReadU32(b: Ref<u8[]>, o: i64, little: boolean): u32 throws RangeError { return __arrayBufferRead(b, o, 4, little) as u32; }
function __arrayBufferReadI32(b: Ref<u8[]>, o: i64, little: boolean): i32 throws RangeError { return __arrayBufferRead(b, o, 4, little) as i32; }
function __arrayBufferReadU64(b: Ref<u8[]>, o: i64, little: boolean): bigint throws RangeError { return BigInt(__arrayBufferRead(b, o, 8, little)); }
function __arrayBufferReadI64(b: Ref<u8[]>, o: i64, little: boolean): bigint throws RangeError { return BigInt(__arrayBufferRead(b, o, 8, little) as i64); }
function __arrayBufferReadF32(b: Ref<u8[]>, o: i64, little: boolean): f64 throws RangeError {
  const bits = __arrayBufferRead(b, o, 4, little) as u32;
  let x: f32 = 0;
  unsafe { fsh_rt_bytes_copy(mutPtrOf(x) as MutPtr<u8>, ptrOf(bits) as Ptr<u8>, 4) };
  return x as f64;
}
function __arrayBufferReadF64(b: Ref<u8[]>, o: i64, little: boolean): f64 throws RangeError {
  const bits = __arrayBufferRead(b, o, 8, little);
  let x: f64 = 0;
  unsafe { fsh_rt_bytes_copy(mutPtrOf(x) as MutPtr<u8>, ptrOf(bits) as Ptr<u8>, 8) };
  return x;
}
`;

// btoa and atob, each in a program that names it and doesn't declare it, so a program's own
// polyfill of one keeps its name and std's other stays.
const BTOA = `
// btoa and atob, as the HTML spec has them: base64 of a string's characters as Latin-1 bytes. The
// UTF-8 the string holds is read back as code points up to U+00FF.
function btoa(data: string): string throws TypeError {
  const text = new TextEncoder().encode(data);
  let bytes: u8[] = [];
  bytes.reserve(text.length as i64);
  let i: usize = 0;
  while (i < text.length) {
    const b = text[i];
    if (b < 0x80) {
      bytes.push(b);
      i += 1;
    } else if (b === 0xC2 || b === 0xC3) {
      bytes.push(((b & 3) << 6) | (text[i + 1] & 63));
      i += 2;
    } else {
      throw new TypeError("btoa takes characters up to U+00FF; for other text, encode it as UTF-8 first, as in 'new TextEncoder().encode(s).toBase64()'");
    }
  }
  return __arrayBase64Text(bytes, false, true);
}
`;
const DATE = String.raw`
// A point in time as JavaScript's Date holds one, in milliseconds since 1970-01-01T00:00:00Z,
// read in UTC. A time JavaScript would make an Invalid Date of panics where it is made, as Fish
// panics where JavaScript throws a RangeError, so every Date can be written out.
class Date {
  #time: i64;

  constructor(ms?: i64) {
    const time = ms ?? Date.now();
    assert(time >= -8640000000000000 && time <= 8640000000000000, "a Date holds a time within 8640000000000000 milliseconds of 1970-01-01, so " + String(time) + " can't be one");
    this.#time = time;
  }

  getTime(): i64 { return this.#time; }
  valueOf(): i64 { return this.#time; }
  equals(other: Ref<Date>): boolean { return this.#time === other.getTime(); }

  getUTCFullYear(): i64 { return __dateCivil(this.#time)[0]; }
  getUTCMonth(): i64 { return __dateCivil(this.#time)[1]; }
  getUTCDate(): i64 { return __dateCivil(this.#time)[2]; }
  getUTCDay(): i64 { return __dateCivil(this.#time)[3]; }
  getUTCHours(): i64 { return __dateCivil(this.#time)[4]; }
  getUTCMinutes(): i64 { return __dateCivil(this.#time)[5]; }
  getUTCSeconds(): i64 { return __dateCivil(this.#time)[6]; }
  getUTCMilliseconds(): i64 { return __dateCivil(this.#time)[7]; }

  // Years outside 0000 to 9999 take a sign and six digits, as ECMAScript's expanded years do.
  toISOString(): string {
    const c = __dateCivil(this.#time);
    const y = c[0];
    const year = y >= 0 && y <= 9999 ? __datePad(y, 4) : (y < 0 ? "-" : "+") + __datePad(y < 0 ? -y : y, 6);
    return year + "-" + __datePad(c[1] + 1, 2) + "-" + __datePad(c[2], 2) + "T" + __datePad(c[4], 2) + ":" + __datePad(c[5], 2) + ":" + __datePad(c[6], 2) + "." + __datePad(c[7], 3) + "Z";
  }

  toJSON(): string { return this.toISOString(); }

  // The IMF-fixdate HTTP writes, with a year past four digits or before zero written as
  // ECMAScript's toUTCString writes it.
  toUTCString(): string {
    const c = __dateCivil(this.#time);
    const y = c[0];
    return "Sun,Mon,Tue,Wed,Thu,Fri,Sat".split(",")[c[3] as usize] + ", " + __datePad(c[2], 2) + " " + "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec".split(",")[c[1] as usize] + " " + (y < 0 ? "-" : "") + __datePad(y < 0 ? -y : y, 4) + " " + __datePad(c[4], 2) + ":" + __datePad(c[5], 2) + ":" + __datePad(c[6], 2) + " GMT";
  }
}

function __datePad(n: i64, width: usize): string {
  return String(n).padStart(width, "0");
}

// A time's year, month from 0, day of the month, weekday from Sunday, hours, minutes, seconds
// and milliseconds in UTC.
function __dateCivil(ms: i64): [i64, i64, i64, i64, i64, i64, i64, i64] {
  let days = ms / 86400000;
  let rest = ms % 86400000;
  if (rest < 0) {
    days -= 1;
    rest += 86400000;
  }
  // Howard Hinnant's days_from_civil, run backwards: the date of a day count from 1970-01-01.
  const z = days + 719468;
  const era = (z >= 0 ? z : z - 146096) / 146097;
  const doe = z - era * 146097;
  const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const mp = (5 * doy + 2) / 153;
  const day = doy - (153 * mp + 2) / 5 + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  // 1970-01-01 was a Thursday.
  const weekday = ((days % 7) + 11) % 7;
  const seconds = rest / 1000;
  return [year, month - 1, day, weekday, seconds / 3600, seconds / 60 % 60, seconds % 60, rest % 1000];
}
`;
const ATOB = `
// The HTML spec's forgiving-base64 decode: whitespace is dropped, then up to two '=' that end a
// whole chunk, and what is left must be a whole number of bytes in the standard alphabet.
function atob(data: string): string throws TypeError {
  const text = new TextEncoder().encode(data);
  let chars: u8[] = [];
  chars.reserve(text.length as i64);
  for (const c of text) {
    if (!__arrayBase64Space(c as i64)) chars.push(c);
  }
  let n = chars.length;
  if (n % 4 === 0 && n > 0 && chars[n - 1] === 61) n -= chars[n - 2] === 61 ? 2 : 1;
  const bad = "atob takes base64 in A-Z, a-z, 0-9, '+' and '/', with '=' only as padding; decode base64url with u8.fromBase64(s, { alphabet: \\"base64url\\" })";
  if (n % 4 === 1) throw new TypeError(bad);
  let bytes: u8[] = [];
  bytes.reserve((n / 4 * 3) as i64);
  let v: i64 = 0;
  let count: i64 = 0;
  for (let i: usize = 0; i < n; i++) {
    const d = __arrayBase64Value(chars[i] as i64, false);
    if (d < 0) throw new TypeError(bad);
    v = (v << 6) | d;
    count++;
    if (count === 4) {
      __arrayBase64Chunk(bytes, v, 4, false);
      v = 0;
      count = 0;
    }
  }
  if (count > 0) __arrayBase64Chunk(bytes, v, count, false);
  // Each byte as the code point of the same number, in UTF-8.
  let out: u8[] = [];
  out.reserve((bytes.length * 2) as i64);
  for (const b of bytes) {
    if (b < 0x80) out.push(b);
    else {
      out.push(0xC0 | (b >> 6));
      out.push(0x80 | (b & 63));
    }
  }
  return new TextDecoder().decode(out);
}
`;

// Standard input, in a program that names readLine or the stdin module: each read runs on the
// runtime's blocking pool, so other tasks keep running while it waits.
const STDIN = String.raw`
declare function fsh_rt_stdin_take(at: MutPtr<u8>, cap: i64, whole: i64): i64;
declare function fsh_rt_prompt_write(bytes: Ptr<u8>, length: i64): void;

// The next line's bytes with its newline, with mode 1 all that is left, and with mode 2 what has
// arrived, waiting for some when nothing has; null when nothing is left.
function __stdinTake(mode: i64): u8[] | null {
  let out: u8[] = new Array(256).fill(0 as u8);
  while (true) {
    const n = unsafe { fsh_rt_stdin_take(mutPtrOf(out[0]), out.length as i64, mode) };
    if (n < 0) return null;
    if (n <= (out.length as i64)) return out.slice(0, n);
    out = new Array(n).fill(0 as u8);
  }
}

// A browser's prompt: the message and a space on standard output, then the next line of
// standard input without its line ending, or null once input has ended. It waits on this thread,
// as Bun's does.
function prompt(message?: string): string | null {
  const shown = new TextEncoder().encode((message ?? "") + " ");
  unsafe { fsh_rt_prompt_write(ptrOf(shown[0]), shown.length as i64) };
  const line = __stdinTake(0);
  if (line === null) return null;
  let end = line.length;
  if (end > 0 && line[end - 1] === 10) end--;
  if (end > 0 && line[end - 1] === 13) end--;
  return new TextDecoder().decode(line.slice(0, end as i64));
}

// The next line of standard input without its line ending, or null once input has ended.
async function readLine(): Promise<string | null> {
  const line = await spawnBlocking(() => __stdinTake(0));
  if (line === null) return null;
  let end = line.length;
  if (end > 0 && line[end - 1] === 10) end--;
  if (end > 0 && line[end - 1] === 13) end--;
  return new TextDecoder().decode(line.slice(0, end as i64));
}
`;

// A TLS client on a connected stream, in a program that fetches or names the tls module.
const TLS = String.raw`
// Starts TLS as the client on a connected stream and finishes the handshake, so a server whose
// certificate doesn't verify fails here: an empty write sends nothing past the handshake.
async function __tlsClient(conn: Ref<TcpStream>, serverName: string, ca: string, signal: AbortSignal): Promise<void> throws IoError | AbortError {
  await __tlsClientOffering(conn, serverName, ca, "", signal);
}

// __tlsClient offering ALPN the protocols named, as "h2,http/1.1", and giving the one the server
// chose, or an empty string.
async function __tlsClientOffering(conn: Ref<TcpStream>, serverName: string, ca: string, alpn: string, signal: AbortSignal): Promise<string> throws IoError | AbortError {
  const why = conn.startTls(serverName, ca, alpn);
  if (why.length > 0) throw new IoError(why);
  await conn.write([], signal);
  return conn.protocol();
}
`;

// The std modules a program reaches by a Node specifier, as `node:os` or `os`, or by naming one
// as a global, each Fish source loaded like a file of the program.
// node:fs's Stats and descriptor calls, which fs exports and fs/promises' FileHandle runs on.
const FILES = String.raw`
export class Stats {
  size: i64;
  mode: i64;
  mtimeMs: f64;
  atimeMs: f64;
  ctimeMs: f64;
  birthtimeMs: f64;
  kind: i64;
  nlink: i64;
  dev: u64;
  ino: u64;
  uid: i64;
  gid: i64;
  // The numbers and times in the order the runtime's stat fills them.
  constructor(numbers: Ref<i64[]>, times: Ref<f64[]>) {
    this.size = numbers[0];
    this.mode = numbers[1];
    this.kind = numbers[2];
    this.nlink = numbers[3];
    this.dev = numbers[4] as u64;
    this.ino = numbers[5] as u64;
    this.uid = numbers[6];
    this.gid = numbers[7];
    this.mtimeMs = times[0];
    this.atimeMs = times[1];
    this.ctimeMs = times[2];
    this.birthtimeMs = times[3];
  }
  // Math.round, halves toward +Infinity, written out since a program may declare its own Math.
  get mtime(): Date {
    const half = this.mtimeMs + 0.5;
    const whole = half as i64;
    return new Date((whole as f64) > half ? whole - 1 : whole);
  }
  isFile(): boolean { return this.kind === 1; }
  isDirectory(): boolean { return this.kind === 2; }
  isSymbolicLink(): boolean { return this.kind === 3; }
}

// An entry readdir gives with withFileTypes: its name, the directory read, and its own kind, a
// link's rather than its target's.
export class Dirent {
  name: string;
  parentPath: string;
  path: string;
  kind: i64;
  constructor(name: string, parentPath: string, kind: i64) {
    this.name = name;
    this.parentPath = parentPath;
    this.path = parentPath;
    this.kind = kind;
  }
  isFile(): boolean { return this.kind === 1; }
  isDirectory(): boolean { return this.kind === 2; }
  isSymbolicLink(): boolean { return this.kind === 3; }
}

declare function fsh_rt_errno_words(number: i64, code: MutPtr<u8>, codeSize: i64, text: MutPtr<u8>, textSize: i64): void;
declare function fsh_rt_fd_flags(flags: Ptr<u8>): i64;
declare function fsh_rt_fd_open(path: Ptr<u8>, flags: i64, mode: i64): i64;
declare function fsh_rt_fd_read(fd: i64, at: MutPtr<u8>, length: i64, position: i64): i64;
declare function fsh_rt_fd_write(fd: i64, at: Ptr<u8>, length: i64, position: i64): i64;
declare function fsh_rt_fd_stat(fd: i64, out: MutPtr<i64>, times: MutPtr<f64>): i64;
declare function fsh_rt_path_stat(path: Ptr<u8>, follow: i64, out: MutPtr<i64>, times: MutPtr<f64>): i64;
declare function fsh_rt_fd_open_flag(which: i64): i64;
declare function fsh_rt_fd_call(which: i64, fd: i64, value: i64): i64;

// A failed descriptor call's IoError, from the -errno the runtime gave: its code and words,
// naming the path only for open.
function failed(result: i64, syscall: string, path: string | null): IoError {
  let code: u8[] = new Array(32).fill(0 as u8);
  let text: u8[] = new Array(200).fill(0 as u8);
  unsafe { fsh_rt_errno_words(-result, mutPtrOf(code[0]), 32, mutPtrOf(text[0]), 200) };
  const name = unsafe { fromCString(ptrOf(code[0])) };
  let e = new IoError(name + ": " + unsafe { fromCString(ptrOf(text[0])) } + ", " + syscall + (path === null ? "" : " '" + path + "'"));
  e.code = name;
  e.syscall = syscall;
  e.path = path;
  return e;
}

// The RangeError for a number outside what a call takes, the number grouped by threes past
// 2^32.
// Some checks write it plainly, as given by plain.
function outOfRange(name: string, range: string, n: i64, plain: boolean = false): IoError {
  let shown = String(n);
  if (!plain && (n > 4294967296 || n < -4294967296)) {
    const start = n < 0 ? 1 : 0;
    let grouped = "";
    let i = shown.length as i64;
    for (; i >= start + 4; i -= 3) grouped = "_" + shown.slice(i - 3, i) + grouped;
    shown = shown.slice(0, i) + grouped;
  }
  let e = new IoError("The value of \"" + name + "\" is out of range. It must be " + range + ". Received " + shown);
  e.code = "ERR_OUT_OF_RANGE";
  return e;
}

function invalid(message: string): IoError {
  let e = new IoError(message);
  e.code = "ERR_INVALID_ARG_VALUE";
  return e;
}

const SAFE = 9007199254740991;

function checkFd(fd: i64, plain: boolean = true): void throws IoError {
  if (fd < 0 || fd > 2147483647) throw outOfRange("fd", ">= 0 && <= 2147483647", fd, plain);
}

function checkMode(mode: i64): void throws IoError {
  if (mode < 0 || mode > 4294967295) throw outOfRange("mode", ">= 0 && <= 4294967295", mode);
}

// Node's string flags, as "r" or "wx+", or a number given to open as it is.
function checkPath(path: string): void throws IoError {
  if (path.includes("\0")) throw invalid("The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received '" + path.replaceAll("\0", "\\x00") + "'");
}

export function openSync(path: string, flags: string | i64 = "r", mode: i64 = 0o666): i64 throws IoError {
  checkPath(path);
  let bits = 0;
  if (typeof flags === "string") {
    bits = flags.includes("\0") ? -1 : unsafe { fsh_rt_fd_flags(cString(flags)) };
    if (bits < 0) throw invalid("The argument 'flags' is invalid. Received '" + flags + "'");
  } else {
    bits = flags;
  }
  checkMode(mode);
  const fd = unsafe { fsh_rt_fd_open(cString(path), bits, mode) };
  if (fd < 0) throw failed(fd, "open", path);
  return fd;
}

export function closeSync(fd: i64): void throws IoError {
  checkFd(fd);
  const r = unsafe { fsh_rt_fd_call(3, fd, 0) };
  if (r < 0) throw failed(r, "close", null);
}

// What's read lands at offset; a null or -1 position reads from the file's own, which moves.
export function readSync(fd: i64, buffer: Mut<u8[]>): i64 throws IoError;
export function readSync(fd: i64, buffer: Mut<u8[]>, offset: i64, length: i64, position?: i64 | null): i64 throws IoError;
export function readSync(fd: i64, buffer: Mut<u8[]>, offset: i64 = 0, length?: i64, position?: i64 | null): i64 throws IoError {
  checkFd(fd, false);
  // length |= 0, which FileHandle's read doesn't do.
  const n = ((length ?? (buffer.length as i64) - offset) as i32) as i64;
  return readInto(fd, buffer, offset, n, position ?? -1);
}

// A read's checks, offset, buffer, length then position, then the read.
function readInto(fd: i64, buffer: Mut<u8[]>, offset: i64, n: i64, position: i64): i64 throws IoError {
  if (offset < 0 || offset > SAFE) throw outOfRange("offset", ">= 0 && <= 9007199254740991", offset);
  const size = buffer.length as i64;
  if (n === 0) return 0;
  if (size === 0) throw invalid("The argument 'buffer' is empty and cannot be written. Received Uint8Array(0) []");
  if (n < 0) throw outOfRange("length", ">= 0", n);
  if (offset + n > size) throw outOfRange("length", "<= " + String(size - offset), n);
  if (position < -1 || position > SAFE) throw outOfRange("position", ">= -1 && <= 9007199254740991", position);
  const got = unsafe { fsh_rt_fd_read(fd, mutPtrOf(buffer[offset as usize]), n, position) };
  if (got < 0) throw failed(got, "read", null);
  return got;
}

// A write of length bytes from offset, or of a string's UTF-8; a negative or missing position
// writes at the file's own.
export function writeSync(fd: i64, buffer: Ref<u8[]>, offset?: i64 | null, length?: i64 | null, position?: i64 | null): i64 throws IoError;
export function writeSync(fd: i64, text: string, position?: i64 | null, encoding?: "utf8" | "utf-8"): i64 throws IoError;
export function writeSync(fd: i64, data: Ref<string | u8[]>, second?: i64 | null, third?: i64 | "utf8" | "utf-8" | null, position?: i64 | null): i64 throws IoError {
  checkFd(fd, false);
  if (typeof data === "string") {
    const bytes = new TextEncoder().encode(data);
    return written(fd, bytes, 0, bytes.length as i64, second ?? -1);
  }
  const size = data.length as i64;
  const offset = second ?? 0;
  if (offset < 0 || offset > SAFE) throw outOfRange("offset", ">= 0 && <= 9007199254740991", offset);
  const n = typeof third === "number" ? third : size - offset;
  if (offset > size) throw outOfRange("offset", "<= " + String(size), offset);
  if (n > size - offset) throw outOfRange("length", "<= " + String(size - offset), n);
  if (n < 0) throw outOfRange("length", ">= 0", n);
  return written(fd, data, offset, n, position ?? -1);
}

function written(fd: i64, bytes: Ref<u8[]>, offset: i64, n: i64, position: i64): i64 throws IoError {
  // A pointer for an empty write, which still reaches the system.
  const none: u8[] = [0];
  const r = unsafe { fsh_rt_fd_write(fd, n === 0 ? ptrOf(none[0]) : ptrOf(bytes[offset as usize]), n, position) };
  if (r < 0) throw failed(r, "write", null);
  return r;
}

export function fstatSync(fd: i64): Stats throws IoError {
  checkFd(fd);
  let out: i64[] = new Array(8).fill(0);
  let times: f64[] = new Array(4).fill(0.0);
  const r = unsafe { fsh_rt_fd_stat(fd, mutPtrOf(out[0]), mutPtrOf(times[0])) };
  if (r < 0) throw failed(r, "fstat", null);
  return new Stats(out, times);
}

// A path's Stats, or undefined when it doesn't exist and throwIfNoEntry is false.
function pathStats(path: string, follow: boolean, throwIfNoEntry: boolean): Stats | undefined throws IoError {
  checkPath(path);
  let out: i64[] = new Array(8).fill(0);
  let times: f64[] = new Array(4).fill(0.0);
  const r = unsafe { fsh_rt_path_stat(cString(path), follow ? 1 : 0, mutPtrOf(out[0]), mutPtrOf(times[0])) };
  if (r < 0) {
    const e = failed(r, follow ? "stat" : "lstat", path);
    if (!throwIfNoEntry && (e.code === "ENOENT" || e.code === "ENOTDIR")) return undefined;
    throw e;
  }
  return new Stats(out, times);
}

// The open flags are the host's, which differ between macOS and Linux, so they are read from
// the runtime when used rather than computed while compiling.
class FsConstants {
  F_OK: i64 = 0;
  R_OK: i64 = 4;
  W_OK: i64 = 2;
  X_OK: i64 = 1;
  COPYFILE_EXCL: i64 = 1;
  COPYFILE_FICLONE: i64 = 2;
  COPYFILE_FICLONE_FORCE: i64 = 4;
  get O_RDONLY(): i64 { return unsafe { fsh_rt_fd_open_flag(0) }; }
  get O_WRONLY(): i64 { return unsafe { fsh_rt_fd_open_flag(1) }; }
  get O_RDWR(): i64 { return unsafe { fsh_rt_fd_open_flag(2) }; }
  get O_CREAT(): i64 { return unsafe { fsh_rt_fd_open_flag(3) }; }
  get O_EXCL(): i64 { return unsafe { fsh_rt_fd_open_flag(4) }; }
  get O_TRUNC(): i64 { return unsafe { fsh_rt_fd_open_flag(5) }; }
  get O_APPEND(): i64 { return unsafe { fsh_rt_fd_open_flag(6) }; }
  get O_NOFOLLOW(): i64 { return unsafe { fsh_rt_fd_open_flag(7) }; }
  get O_SYNC(): i64 { return unsafe { fsh_rt_fd_open_flag(8) }; }
}

// A negative length truncates to nothing.
export function ftruncateSync(fd: i64, len: i64 = 0): void throws IoError {
  if (len < -SAFE || len > SAFE) throw outOfRange("len", ">= -9007199254740991 && <= 9007199254740991", len);
  checkFd(fd);
  const r = unsafe { fsh_rt_fd_call(0, fd, len < 0 ? 0 : len) };
  if (r < 0) throw failed(r, "ftruncate", null);
}

export function fchmodSync(fd: i64, mode: i64): void throws IoError {
  checkMode(mode);
  checkFd(fd);
  const r = unsafe { fsh_rt_fd_call(1, fd, mode) };
  if (r < 0) throw failed(r, "fchmod", null);
}

export function fsyncSync(fd: i64): void throws IoError {
  checkFd(fd);
  const r = unsafe { fsh_rt_fd_call(2, fd, 0) };
  if (r < 0) throw failed(r, "fsync", null);
}
`;

// std:grpc, as a template rather than String.raw, since its macros quote with backquotes.
const GRPC = `// gRPC over HTTP/2: messages as classes the @message macro gives protobuf encoders while
// compiling, services as interfaces @service gives a client and a server side.
declare function fsh_rt_bytes_copy(to: MutPtr<u8>, from: Ptr<u8>, n: i64): void;

// What a call's status says went wrong: its gRPC code, as GrpcStatus names them, and its message.
export class GrpcError extends Error {
  code: i64;
  constructor(code: i64, message: string) {
    super(message);
    this.name = "GrpcError";
    this.code = code;
  }
}

function pbVarint(out: Mut<u8[]>, v: u64) {
  let left = v;
  while (left >= 128) {
    out.push(((left & 127) | 128) as u8);
    left = left >> 7;
  }
  out.push(left as u8);
}

function pbKey(out: Mut<u8[]>, field: i64, wire: i64) {
  pbVarint(out, ((field << 3) | wire) as u64);
}

// Each field's encoder writes nothing for proto3's default, unless always: an optional field
// holding one, or an element of a repeated field.
function pbInt(out: Mut<u8[]>, field: i64, v: i64, always: boolean) {
  if (v === 0 && !always) return;
  pbKey(out, field, 0);
  pbVarint(out, v as u64);
}

function pbUint(out: Mut<u8[]>, field: i64, v: u64, always: boolean) {
  if (v === 0 && !always) return;
  pbKey(out, field, 0);
  pbVarint(out, v);
}

function pbBool(out: Mut<u8[]>, field: i64, v: boolean, always: boolean) {
  if (!v && !always) return;
  pbKey(out, field, 0);
  out.push(v ? 1 : 0);
}

function pbDouble(out: Mut<u8[]>, field: i64, v: f64, always: boolean) {
  if (v === 0 && !always) return;
  pbKey(out, field, 1);
  let bits: u64 = 0;
  unsafe { fsh_rt_bytes_copy(mutPtrOf(bits) as MutPtr<u8>, ptrOf(v) as Ptr<u8>, 8) };
  for (let i: u64 = 0; i < 8; i++) out.push(((bits >> (i * 8)) & 255) as u8);
}

function pbFloat(out: Mut<u8[]>, field: i64, v: f32, always: boolean) {
  if (v === 0 && !always) return;
  pbKey(out, field, 5);
  let bits: u32 = 0;
  unsafe { fsh_rt_bytes_copy(mutPtrOf(bits) as MutPtr<u8>, ptrOf(v) as Ptr<u8>, 4) };
  for (let i: u32 = 0; i < 4; i++) out.push(((bits >> (i * 8)) & 255) as u8);
}

function pbBytes(out: Mut<u8[]>, field: i64, v: Ref<u8[]>, always: boolean) {
  if (v.length === 0 && !always) return;
  pbKey(out, field, 2);
  pbVarint(out, v.length as u64);
  for (const b of v) out.push(b);
}

function pbString(out: Mut<u8[]>, field: i64, v: string, always: boolean) {
  if (v.length === 0 && !always) return;
  const bytes = new TextEncoder().encode(v);
  pbBytes(out, field, bytes, true);
}

// Reads a message's fields in order, each a key, then its value as its wire type gives it.
class PbReader {
  bytes: u8[];
  at: usize = 0;

  constructor(bytes: u8[]) {
    this.bytes = bytes;
  }

  more(this: Ref<this>): boolean {
    return this.at < this.bytes.length;
  }

  varint(this: Mut<this>): u64 throws GrpcError {
    let v: u64 = 0;
    let shift: u64 = 0;
    while (true) {
      if (this.at >= this.bytes.length || shift > 63) throw new GrpcError(13, "a protobuf varint runs past the message");
      const b = this.bytes[this.at] as u64;
      this.at += 1;
      v = v | ((b & 127) << shift);
      shift += 7;
      if ((b & 128) === 0) return v;
    }
  }

  int64(this: Mut<this>): i64 throws GrpcError {
    return this.varint() as i64;
  }

  bool(this: Mut<this>): boolean throws GrpcError {
    return this.varint() !== 0;
  }

  fixed(this: Mut<this>, n: usize): u64 throws GrpcError {
    if (this.at + n > this.bytes.length) throw new GrpcError(13, "a protobuf fixed-width value runs past the message");
    let v: u64 = 0;
    for (let i: usize = 0; i < n; i++) v = v | ((this.bytes[this.at + i] as u64) << ((i * 8) as u64));
    this.at += n;
    return v;
  }

  double(this: Mut<this>): f64 throws GrpcError {
    const bits = this.fixed(8);
    let x: f64 = 0;
    unsafe { fsh_rt_bytes_copy(mutPtrOf(x) as MutPtr<u8>, ptrOf(bits) as Ptr<u8>, 8) };
    return x;
  }

  float(this: Mut<this>): f32 throws GrpcError {
    const bits = this.fixed(4) as u32;
    let x: f32 = 0;
    unsafe { fsh_rt_bytes_copy(mutPtrOf(x) as MutPtr<u8>, ptrOf(bits) as Ptr<u8>, 4) };
    return x;
  }

  bytesField(this: Mut<this>): u8[] throws GrpcError {
    const n = this.varint() as usize;
    if (this.at + n > this.bytes.length) throw new GrpcError(13, "a protobuf length-delimited value runs past the message");
    const out = this.bytes.slice(this.at as i64, (this.at + n) as i64);
    this.at += n;
    return out;
  }

  string(this: Mut<this>): string throws GrpcError {
    return new TextDecoder().decode(this.bytesField());
  }

  pb_u64(this: Mut<this>): u64 throws GrpcError { return this.varint(); }
  pb_u32(this: Mut<this>): u32 throws GrpcError { return this.varint() as u32; }
  pb_u16(this: Mut<this>): u16 throws GrpcError { return this.varint() as u16; }
  pb_u8(this: Mut<this>): u8 throws GrpcError { return this.varint() as u8; }
  pb_i64(this: Mut<this>): i64 throws GrpcError { return this.varint() as i64; }
  pb_i32(this: Mut<this>): i32 throws GrpcError { return (this.varint() as i64) as i32; }
  pb_i16(this: Mut<this>): i16 throws GrpcError { return (this.varint() as i64) as i16; }
  pb_i8(this: Mut<this>): i8 throws GrpcError { return (this.varint() as i64) as i8; }
  pb_bool(this: Mut<this>): boolean throws GrpcError { return this.varint() !== 0; }
  pb_f64(this: Mut<this>): f64 throws GrpcError { return this.double(); }
  pb_f32(this: Mut<this>): f32 throws GrpcError { return this.float(); }
  pb_string(this: Mut<this>): string throws GrpcError { return this.string(); }
  pb_bytesField(this: Mut<this>): u8[] throws GrpcError { return this.bytesField(); }

  // A length-delimited value read as a message of its own.
  sub(this: Mut<this>): PbReader throws GrpcError {
    return new PbReader(this.bytesField());
  }

  // Passes over a field this side doesn't know, as protobuf's readers do.
  skip(this: Mut<this>, wire: i64) throws GrpcError {
    if (wire === 0) this.varint();
    else if (wire === 1) this.fixed(8);
    else if (wire === 2) this.bytesField();
    else if (wire === 5) this.fixed(4);
    else throw new GrpcError(13, "a protobuf field has wire type " + String(wire) + ", which proto3 doesn't use");
  }
}

// How a field's type is sent: its scalar's reader method, or "message" with the class's name, and
// whether it repeats or is optional.
type PbShape = { kind: string; name: string; repeated: boolean; optional: boolean };

function pbScalar(name: string): boolean {
  return name === "i64" || name === "i32" || name === "i16" || name === "i8" || name === "u64" || name === "u32" || name === "u16" || name === "u8" || name === "boolean" || name === "f64" || name === "number" || name === "f32" || name === "string";
}

function pbShapeOf(t: Ref<AstType>, field: string): PbShape {
  if (t.kind === "union" && t.types.length === 2) {
    let inner: PbShape | null = null;
    let nulls = 0;
    for (const u of t.types) {
      if (pbIsNull(u)) nulls++;
      else inner = pbShapeOf(u, field);
    }
    if (nulls === 1 && inner !== null && !inner.repeated && !inner.optional) return { kind: inner.kind, name: inner.name, repeated: false, optional: true };
  }
  if (t.kind === "array") {
    const e = t.element.clone();
    if (e.kind === "ref" && e.name === "u8") return { kind: "bytes", name: "", repeated: false, optional: false };
    const inner = pbShapeOf(e, field);
    if (!inner.repeated && !inner.optional) return { kind: inner.kind, name: inner.name, repeated: true, optional: false };
  }
  if (t.kind === "ref" && t.args.length === 0) {
    if (pbScalar(t.name)) return { kind: t.name, name: "", repeated: false, optional: false };
    return { kind: "message", name: t.name, repeated: false, optional: false };
  }
  assert(false, "'" + field + "' has a type protobuf can't carry: a message's fields are sized numbers, booleans, strings, u8[], other messages, arrays of these, or one of these or null");
  return { kind: "", name: "", repeated: false, optional: false };
}

function pbIsNull(t: Ref<AstType>): boolean {
  if (t.kind === "ref") return t.name === "null" || t.name === "undefined";
  if (t.kind === "literal") return t.value.kind === "null";
  return false;
}

function pbNumber(n: i64): AstExpr {
  return { kind: "int", value: n, start: 0, end: 0 };
}

function pbFlag(b: boolean): AstExpr {
  return { kind: "bool", value: b, start: 0, end: 0 };
}

// The statement writing one value of a field.
function pbWriteOne(shape: Ref<PbShape>, n: i64, value: AstExpr, always: boolean): AstStmt {
  const num = pbNumber(n);
  const all = pbFlag(always);
  const k = shape.kind;
  if (k === "i64" || k === "i32" || k === "i16" || k === "i8") return quote\`pbInt(\${ident("pbOut")}, \${num}, \${value} as i64, \${all});\`;
  if (k === "u64" || k === "u32" || k === "u16" || k === "u8") return quote\`pbUint(\${ident("pbOut")}, \${num}, \${value} as u64, \${all});\`;
  if (k === "boolean") return quote\`pbBool(\${ident("pbOut")}, \${num}, \${value}, \${all});\`;
  if (k === "f64" || k === "number") return quote\`pbDouble(\${ident("pbOut")}, \${num}, \${value} as f64, \${all});\`;
  if (k === "f32") return quote\`pbFloat(\${ident("pbOut")}, \${num}, \${value}, \${all});\`;
  if (k === "string") return quote\`pbString(\${ident("pbOut")}, \${num}, \${value}, \${all});\`;
  if (k === "bytes") return quote\`pbBytes(\${ident("pbOut")}, \${num}, \${value}, \${all});\`;
  return quote\`{ let inner: u8[] = []; \${value}.__pbWrite(inner); pbBytes(\${ident("pbOut")}, \${num}, inner, \${all}); }\`;
}

// The expression reading one value of a field from reader r.
function pbReadOne(shape: Ref<PbShape>, r: string): AstExpr {
  const k = shape.kind;
  const reader = ident(r);
  if (k === "message") return quote\`\${ident(shape.name)}.__pbRead(\${reader}.sub())\`;
  const method = k === "boolean" ? "bool" : k === "number" ? "f64" : k === "bytes" ? "bytesField" : k === "string" ? "string" : k;
  return quote\`\${reader}.\${ident("pb_" + method)}()\`;
}

// @message: the class becomes a protobuf message, its fields numbered 1, 2, 3 in the order they
// are declared, or as an @field(n) on one says, with toBinary() and fromBinary(bytes).
export macro function message(input: AstStmt): AstStmt {
  let c = input;
  assert(c.kind === "class", "'@message' applies to a class, whose fields are the message's");
  if (c.kind !== "class") return c;
  const className = c.name;
  assert(className !== null, "'@message' needs a named class");
  if (className === null) return c;
  // The numbers @field pinned, by field name.
  let pinnedNames: string[] = [];
  let pinnedNumbers: i64[] = [];
  let kept: AstClassMember[] = [];
  for (const m of c.members) {
    if (m.kind === "field" && typeof m.name === "string" && m.name.startsWith("__pbField_")) {
      const v = m.init.clone();
      if (v !== null && v.kind === "int") {
        pinnedNames.push(m.name.slice(10));
        pinnedNumbers.push(v.value);
      }
      continue;
    }
    kept.push(m.clone());
  }
  let writes: AstStmt[] = [];
  let reads: AstStmt[] = [];
  let next: i64 = 1;
  let used: i64[] = [];
  for (const m of kept) {
    if (m.kind !== "field" || m.modifiers.length > 0) continue;
    if (typeof m.name !== "string") continue;
    const name = pbText(m.name);
    const t = m.type.clone();
    assert(t !== null, "'" + name + "' needs a written type for '@message' to encode it");
    if (t === null) continue;
    assert(m.init !== null || m.optional, "'" + name + "' needs a default value, as 'fromBinary' starts each field at its default");
    let n = next;
    for (let i: usize = 0; i < pinnedNames.length; i++) if (pinnedNames[i] === name) n = pinnedNumbers[i];
    assert(!pbHas(used, n), "two fields of '" + className + "' have the number " + String(n));
    used.push(n);
    next = n + 1;
    const shape = pbShapeOf(t, name);
    const f = ident(name);
    const num = pbNumber(n);
    if (shape.repeated) {
      writes.push(quote\`for (const \${ident("pbX")} of this.\${f.clone()}) \${pbWriteOne(shape, n, ident("pbX"), true)}\`);
      const packable = shape.kind !== "string" && shape.kind !== "bytes" && shape.kind !== "message";
      if (packable) reads.push(quote\`if (\${ident("pbField")} === \${num.clone()} && \${ident("pbWire")} === 2) { let \${ident("pbPacked")} = \${ident("pbR")}.sub(); while (\${ident("pbPacked")}.more()) \${ident("pbM")}.\${f.clone()}.push(\${pbReadOne(shape, "pbPacked")}); continue; }\`);
      reads.push(quote\`if (\${ident("pbField")} === \${num.clone()}) { \${ident("pbM")}.\${f.clone()}.push(\${pbReadOne(shape, "pbR")}); continue; }\`);
    } else if (shape.optional) {
      const one = pbWriteOne(shape, n, quote\`this.\${f.clone()}\`, true);
      writes.push(quote\`if (this.\${f.clone()} !== null) \${one}\`);
      reads.push(quote\`if (\${ident("pbField")} === \${num.clone()}) { \${ident("pbM")}.\${f.clone()} = \${pbReadOne(shape, "pbR")}; continue; }\`);
    } else {
      writes.push(pbWriteOne(shape, n, quote\`this.\${f.clone()}\`, false));
      reads.push(quote\`if (\${ident("pbField")} === \${num.clone()}) { \${ident("pbM")}.\${f.clone()} = \${pbReadOne(shape, "pbR")}; continue; }\`);
    }
  }
  const self = ident(className);
  const selfType: AstType = { kind: "ref", name: className, args: [], start: 0, end: 0 };
  const k = quote\`class X {
    __pbWrite(this: Ref<this>, \${ident("pbOut")}: Mut<u8[]>) {}
    static __pbRead(reader: PbReader): \${selfType.clone()} throws GrpcError {
      let \${ident("pbR")} = reader;
      let \${ident("pbM")} = new \${self.clone()}();
      while (\${ident("pbR")}.more()) {
        const key = \${ident("pbR")}.pb_u64() as i64;
        const \${ident("pbField")} = key >> 3;
        const \${ident("pbWire")} = key & 7;
        \${ident("pbR")}.skip(\${ident("pbWire")});
      }
      return \${ident("pbM")};
    }
    toBinary(this: Ref<this>): u8[] {
      let out: u8[] = [];
      this.__pbWrite(out);
      return out;
    }
    static fromBinary(bytes: u8[]): \${selfType.clone()} throws GrpcError {
      return \${self.clone()}.__pbRead(new PbReader(bytes));
    }
    static __pbTry(bytes: u8[]): \${selfType.clone()} | GrpcError {
      try {
        return \${self.clone()}.fromBinary(bytes);
      } catch (e) {
        return e;
      }
    }
  }\`;
  if (k.kind === "class") {
    for (const member of k.members) {
      let made = member.clone();
      if (made.kind === "method" && typeof made.name === "string" && made.name === "__pbWrite") made.body = writes.clone();
      if (made.kind === "method" && typeof made.name === "string" && made.name === "__pbRead" && made.body !== null) {
        let body = made.body.clone();
        let loop = body[2].clone();
        if (loop.kind === "while") {
          let inner: AstStmt[] = [loop.body[0].clone(), loop.body[1].clone(), loop.body[2].clone()];
          for (const s of reads) inner.push(s.clone());
          inner.push(loop.body[3].clone());
          loop.body = inner;
        }
        body[2] = loop;
        made.body = body;
      }
      kept.push(made);
    }
  }
  c.members = kept;
  return c;
}

// @field(n) on a message's field: its number on the wire, which stays as fields are added around it.
export macro function field(input: AstStmt, member: usize, n: i64): AstStmt {
  let c = input;
  if (c.kind === "class") {
    const f = c.members[member].clone();
    if (f.kind === "field" && typeof f.name === "string") {
      assert(n >= 1 && n <= 536870911 && (n < 19000 || n > 19999), "a protobuf field number is 1 to 536870911, outside 19000 to 19999, not " + String(n));
      const num = pbNumber(n);
      const k = quote\`class X { static \${ident("__pbField_" + f.name)} = \${num}; }\`;
      if (k.kind === "class") c.members.push(k.members[0].clone());
    }
  }
  return c;
}

function pbText(s: string): string {
  return s;
}

function pbHas(xs: Ref<i64[]>, n: i64): boolean {
  for (const x of xs) if (x === n) return true;
  return false;
}

// A service's methods as a server runs them: its full name, as "helloworld.Greeter", and a call
// giving each reply of a method, by its name, to a request's bytes, or the error that ended it.
export type GrpcCall = (method: string, body: u8[]) => Dyn<AsyncGenerator<u8[] | GrpcError>>;
export type GrpcService = { name: string; call: GrpcCall };

function grpcPascal(name: string): string {
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

function grpcTypeOf(t: Ref<AstType>, what: string): AstType {
  assert(t.kind === "ref" && t.args.length === 0, what + " is a '@message' class, named");
  return t.clone();
}

// The class a method returns from, unwrapped from its Promise or AsyncGenerator, and whether it streams.
// failing says the reply may instead be a GrpcError, the status the call ends with.
type GrpcMethod = { name: string; request: AstType; reply: AstType; streams: boolean; failing: boolean };

function grpcMethodOf(m: Ref<AstTypeMember>, service: string): GrpcMethod {
  assert(m.kind === "method", "a '@service' interface holds methods only, and '" + service + "' holds something else");
  let out: GrpcMethod = { name: "", request: { kind: "ref", name: "", args: [], start: 0, end: 0 }, reply: { kind: "ref", name: "", args: [], start: 0, end: 0 }, streams: false, failing: false };
  if (m.kind !== "method") return out;
  if (typeof m.name !== "string") return out;
  const name = pbText(m.name);
  assert(m.params.length === 1, "'" + name + "' takes one request message, as a gRPC method does");
  const p = m.params[0].type.clone();
  assert(p !== null, "'" + name + "' needs its request's type written");
  if (p === null) return out;
  const r = m.returns.clone();
  assert(r !== null && r.kind === "ref" && (r.name === "Promise" || r.name === "AsyncGenerator") && r.args.length === 1, "'" + name + "' returns a Promise of its reply message, or an AsyncGenerator of them to stream");
  const given = r.args[0].clone();
  let reply = given.clone();
  let failing = false;
  if (given.kind === "union" && given.types.length === 2) {
    for (const u of given.types) {
      if (u.kind === "ref" && u.name === "GrpcError") failing = true;
      else reply = u.clone();
    }
  }
  return { name: name, request: grpcTypeOf(p, "'" + name + "''s request"), reply: grpcTypeOf(reply, "'" + name + "''s reply"), streams: r.name === "AsyncGenerator", failing: failing };
}

// A reply as the bytes sent, or the GrpcError it is when the method may give one.
function grpcEncoded(failing: boolean, value: AstExpr): AstExpr {
  if (failing) return quote\`\${value.clone()} instanceof GrpcError ? \${value.clone()} : \${value}.toBinary()\`;
  return quote\`\${value}.toBinary()\`;
}

function grpcTypeName(t: Ref<AstType>): string {
  if (t.kind === "ref") return pbText(t.name);
  return "";
}

// @service("helloworld.Greeter") on an interface of gRPC methods, each taking a request message
// and giving a Promise of a reply, or an AsyncGenerator of replies for a server stream. It adds
// <Name>Client, whose methods call a server at a URL, and <name>Service(impl), the service for a
// GrpcServer to run on impl.
export macro function service(input: AstStmt, fullName: string): Ast[] {
  assert(input.kind === "interface", "'@service' applies to an interface of the service's methods");
  if (input.kind !== "interface") return [input];
  const name = pbText(input.name);
  let methods: GrpcMethod[] = [];
  for (const m of input.members) methods.push(grpcMethodOf(m, name));
  const client = ident(name + "Client");
  const serviceFn = ident(name.slice(0, 1).toLowerCase() + name.slice(1) + "Service");
  const callFn = ident("__grpcCall" + name);
  const iface: AstType = { kind: "ref", name: name, args: [], start: 0, end: 0 };
  const full: AstExpr = { kind: "string", value: fullName, start: 0, end: 0 };
  let members: AstClassMember[] = [];
  let calls: AstStmt[] = [];
  for (const m of methods) {
    const path: AstExpr = { kind: "string", value: "/" + fullName + "/" + grpcPascal(m.name), start: 0, end: 0 };
    const wire: AstExpr = { kind: "string", value: grpcPascal(m.name), start: 0, end: 0 };
    const method = ident(m.name);
    const replyClass = ident(grpcTypeName(m.reply));
    const requestClass = ident(grpcTypeName(m.request));
    let made: AstStmt = quote\`class X {}\`;
    let call: AstStmt = quote\`{}\`;
    if (m.streams) {
      made = quote\`class X {
        async *\${method.clone()}(this: Ref<this>, request: Ref<\${m.request.clone()}>): AsyncGenerator<\${m.reply.clone()}> throws GrpcError | IoError | AbortError {
          const replies = await grpcServerStream(this.url, \${path.clone()}, request.toBinary());
          for (const bytes of replies.messages) yield \${replyClass.clone()}.fromBinary(bytes.clone());
          const status = replies.status;
          if (status !== null) throw status;
        }
      }\`;
      call = quote\`if (\${ident("grpcMethod")} === \${wire.clone()}) {
        const request = \${requestClass.clone()}.__pbTry(\${ident("grpcBody")});
        if (request instanceof GrpcError) {
          yield request;
          return;
        }
        let replies = \${ident("grpcImpl")}.\${method.clone()}(request);
        while (true) {
          const r = await replies.next();
          if (r.done !== false) return;
          const item: u8[] | GrpcError = \${grpcEncoded(m.failing, quote\`r.value\`)};
          const stop = item instanceof GrpcError;
          yield item;
          if (stop) return;
        }
      }\`;
    } else {
      made = quote\`class X {
        async \${method.clone()}(this: Ref<this>, request: Ref<\${m.request.clone()}>): Promise<\${m.reply.clone()}> throws GrpcError | IoError | AbortError {
          const bytes = await grpcUnary(this.url, \${path.clone()}, request.toBinary());
          return \${replyClass.clone()}.fromBinary(bytes);
        }
      }\`;
      call = quote\`if (\${ident("grpcMethod")} === \${wire.clone()}) {
        const request = \${requestClass.clone()}.__pbTry(\${ident("grpcBody")});
        if (request instanceof GrpcError) {
          yield request;
          return;
        }
        const answered = await \${ident("grpcImpl")}.\${method.clone()}(request);
        const reply: u8[] | GrpcError = \${grpcEncoded(m.failing, quote\`answered\`)};
        yield reply;
        return;
      }\`;
    }
    if (made.kind === "class") members.push(made.members[0].clone());
    calls.push(call);
  }
  let clientClass = quote\`export class \${client.clone()} {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  }\`;
  if (clientClass.kind === "export") {
    let d = clientClass.body.clone();
    if (d.kind === "class") {
      for (const m of members) d.members.push(m.clone());
      clientClass.body = d;
    }
  }
  const serviceDecl = quote\`export function \${serviceFn}(impl: \${iface.clone()}): GrpcService {
    return { name: \${full}, call: (method: string, body: u8[]): Dyn<AsyncGenerator<u8[] | GrpcError>> => \${callFn.clone()}(impl.clone(), method, body) };
  }\`;
  let callDecl = quote\`async function* \${callFn.clone()}(\${ident("grpcImpl")}: \${iface.clone()}, \${ident("grpcMethod")}: string, \${ident("grpcBody")}: u8[]): AsyncGenerator<u8[] | GrpcError> {
    yield new GrpcError(12, "the service has no method " + \${ident("grpcMethod")});
  }\`;
  if (callDecl.kind === "function" && callDecl.body !== null) {
    let body: AstStmt[] = [];
    for (const s of calls) body.push(s.clone());
    for (const s of callDecl.body) body.push(s.clone());
    callDecl.body = body;
  }
  return [input, clientClass, serviceDecl, callDecl];
}

// GrpcError's codes, as gRPC numbers them.
export const GrpcStatus = { OK: 0, CANCELLED: 1, UNKNOWN: 2, INVALID_ARGUMENT: 3, DEADLINE_EXCEEDED: 4, NOT_FOUND: 5, ALREADY_EXISTS: 6, PERMISSION_DENIED: 7, RESOURCE_EXHAUSTED: 8, FAILED_PRECONDITION: 9, ABORTED: 10, OUT_OF_RANGE: 11, UNIMPLEMENTED: 12, INTERNAL: 13, UNAVAILABLE: 14, DATA_LOSS: 15, UNAUTHENTICATED: 16 };

// A message as gRPC frames it: uncompressed, its length, then its bytes.
function grpcFrame(message: Ref<u8[]>): u8[] {
  let out: u8[] = [0 as u8];
  const n = message.length as i64;
  out.push(((n >> 24) & 255) as u8);
  out.push(((n >> 16) & 255) as u8);
  out.push(((n >> 8) & 255) as u8);
  out.push((n & 255) as u8);
  for (const b of message) out.push(b);
  return out;
}

// The messages a body holds, or why it can't be read: compression isn't offered, so a
// compressed message is refused.
function grpcFrames(body: Ref<u8[]>): u8[][] | GrpcError {
  let out: u8[][] = [];
  let at: usize = 0;
  while (at < body.length) {
    if (at + 5 > body.length) return new GrpcError(13, "a gRPC message's frame is cut short");
    if (body[at] !== 0) return new GrpcError(12, "compressed gRPC messages aren't supported");
    const n = (((body[at + 1] as i64) << 24) | ((body[at + 2] as i64) << 16) | ((body[at + 3] as i64) << 8) | (body[at + 4] as i64)) as usize;
    if (at + 5 + n > body.length) return new GrpcError(13, "a gRPC message is cut short");
    out.push(body.slice((at + 5) as i64, (at + 5 + n) as i64));
    at += 5 + n;
  }
  return out;
}

// grpc-message's text, percent-decoded as gRPC sends it.
function grpcUnescape(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    if (bytes[i] === 37 && i + 2 < bytes.length) {
      const n = parseInt(new TextDecoder().decode(bytes.slice((i + 1) as i64, (i + 3) as i64)), 16);
      if (n !== null) {
        out.push(n as u8);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  return new TextDecoder().decode(out);
}

// grpc-message's text percent-encoded, past printable ASCII and '%'.
function grpcEscape(text: string): string {
  const digits = "0123456789ABCDEF";
  let out = "";
  for (const b of new TextEncoder().encode(text)) {
    if (b >= 32 && b <= 126 && b !== 37) out += String.fromCharCode(b as u16);
    else out += "%" + digits[(b >> 4) as usize] + digits[(b & 15) as usize];
  }
  return out;
}

// One call to a server: the request message out, the reply messages back, and the status the
// trailers end it with, any but OK thrown. The URL is http:// for HTTP/2 by prior knowledge or
// https:// for TLS agreeing to h2. A connection per call.
// ponytail: a connection per call and a stream read whole before its first message is given; a
// pooled connection and replies handed over as their frames arrive would scale further.
async function grpcCall(url: string, path: string, message: u8[]): Promise<GrpcReplies> throws GrpcError | IoError | AbortError {
  const u = grpcURL(url);
  if (u instanceof GrpcError) throw u;
  const secure = u.protocol === "https:";
  if (!secure && u.protocol !== "http:") throw new GrpcError(3, "a gRPC URL starts with http:// or https://, not " + u.protocol);
  const host = u.hostname.startsWith("[") ? u.hostname.slice(1, (u.hostname.length as i64) - 1) : u.hostname;
  const port = u.port.length === 0 ? (secure ? 443 : 80) : parseInt(u.port) ?? 80;
  const signal = new AbortController().signal;
  const conn = await TcpStream.connect(host, port, signal.clone());
  if (secure) {
    const chosen = await __tlsClientOffering(conn, host, "", "h2", signal.clone());
    if (chosen !== "h2") throw new GrpcError(14, "the server at " + u.host + " didn't agree to HTTP/2, which gRPC needs");
  }
  let headers = new Headers();
  headers.set("content-type", "application/grpc");
  headers.set("te", "trailers");
  const body = grpcFrame(message);
  const reply = await Http2.exchange(conn, secure ? "https" : "http", "POST", u.host, path, headers, body, signal);
  if (reply.status !== 200) throw new GrpcError(reply.status === 404 ? 12 : 14, "the server answered " + path + " with HTTP status " + String(reply.status));
  const said = reply.trailers.get("grpc-status") ?? reply.headers.get("grpc-status");
  if (said === null) throw new GrpcError(13, "the server's reply to " + path + " has no grpc-status");
  const code = parseInt(said) ?? 2;
  const status = code === 0 ? null : new GrpcError(code, grpcUnescape(reply.trailers.get("grpc-message") ?? reply.headers.get("grpc-message") ?? ""));
  const frames = grpcFrames(reply.body);
  if (frames instanceof GrpcError) throw frames;
  return { messages: frames, status: status };
}

// A call's replies, and the status it ended with when that isn't OK.
type GrpcReplies = { messages: u8[][]; status: GrpcError | null };

function grpcURL(url: string): URL | GrpcError {
  try {
    return new URL(url);
  } catch (e) {
    return new GrpcError(3, "the gRPC URL can't be read as a URL: " + e.message);
  }
}

async function grpcUnary(url: string, path: string, message: u8[]): Promise<u8[]> throws GrpcError | IoError | AbortError {
  const got = await grpcCall(url, path, message);
  const status = got.status;
  if (status !== null) throw status;
  let replies = got.messages;
  if (replies.length !== 1) throw new GrpcError(13, path + " gave " + String(replies.length as i64) + " replies to a call taking one");
  const first = replies.pop();
  if (first === null) throw new GrpcError(13, path + " gave no reply");
  return first;
}

async function grpcServerStream(url: string, path: string, message: u8[]): Promise<GrpcReplies> throws GrpcError | IoError | AbortError {
  const replies = await grpcCall(url, path, message);
  return replies;
}

type GrpcTable = { services: Lock<GrpcService[]> };

// Services by their full names, served through a handler serve runs over HTTP/2. A call to a
// method a service doesn't have, or to a service not added, ends with UNIMPLEMENTED.
export class GrpcServer {
  #table: shared<GrpcTable>;

  constructor() {
    const none: GrpcService[] = [];
    this.#table = shared<GrpcTable>({ services: new Lock(none) });
  }

  add(this: Ref<this>, service: GrpcService) {
    this.#table.services.update((s) => { s.push(service); });
  }

  // The handler for serve, sharing this server's services.
  handler(this: Ref<this>): ServeHandler {
    const table = this.#table.clone();
    return async (req: Request) => {
      const res = await grpcHandle(table.clone(), req);
      return res;
    };
  }
}

function grpcFind(services: Ref<GrpcService[]>, name: string): GrpcCall | null {
  for (const s of services) if (s.name === name) return s.call.clone();
  return null;
}

async function grpcHandle(table: shared<GrpcTable>, req: Request): Promise<Response> {
  const parts = req.path.split("/");
  if (req.method !== "POST" || parts.length !== 3) return new Response("Not Found\\n", { status: 404 });
  const kind = req.headers.get("content-type") ?? "";
  if (!kind.startsWith("application/grpc")) return new Response("Unsupported Media Type\\n", { status: 415 });
  const name = parts[1];
  const call = table.services.update((s) => grpcFind(s, name));
  const body = await req.bytes();
  const none: Headers[] = [];
  const box = shared<__trailerBox>({ fields: new Lock(none) });
  let headers = new Headers();
  headers.set("content-type", "application/grpc");
  let res = new Response(ReadableStream.from(grpcReplies(call, parts[2], name, body, box.clone())), { status: 200, headers: headers });
  res.__trailersFrom(box);
  return res;
}

// A call's replies as frames, then its status in the trailers.
async function* grpcReplies(call: GrpcCall | null, method: string, service: string, body: u8[], box: shared<__trailerBox>): AsyncGenerator<u8[]> {
  let code: i64 = 0;
  let message = "";
  const frames = grpcFrames(body);
  if (call === null) {
    code = 12;
    message = "the server has no service " + service;
  } else if (frames instanceof GrpcError) {
    code = frames.code;
    message = frames.message;
  } else if (frames.length !== 1) {
    code = 12;
    message = "a call takes one request message, as client streaming isn't supported";
  } else {
    let replies = call(method, frames[0].clone());
    for await (const r of replies) {
      if (r instanceof GrpcError) {
        code = r.code;
        message = r.message;
        break;
      }
      yield grpcFrame(r);
    }
  }
  let trailers = new Headers();
  trailers.set("grpc-status", String(code));
  if (message.length > 0) trailers.set("grpc-message", grpcEscape(message));
  box.fields.update((f) => { f.push(trailers); });
}
`;

export const STD_MODULES: Record<string, string> = {
  grpc: GRPC,
  // What a build is for, made per build from its target, release mode and flags by the loader.
  build: "",
  // Node's assert and assert.ok, whose calls the checker gives the global assert's meaning, so
  // they panic where they are made.
  assert: String.raw`
export function ok(_value: boolean, _message?: string): void {}
`,
  // Buffer is a global the checker knows, which an import of it from here names.
  buffer: String.raw`
export { Buffer };
`,
  os: String.raw`
declare function fsh_rt_os_hostname(): Ptr<u8>;
declare function fsh_rt_signal_name(number: i64): Ptr<u8>;
declare function fsh_rt_os_tmpdir(): Ptr<u8>;
declare function fsh_rt_os_homedir(): Ptr<u8>;
declare function fsh_rt_os_platform(): Ptr<u8>;
declare function fsh_rt_os_parallelism(): i64;

export function hostname(): string {
  return unsafe { fromCString(fsh_rt_os_hostname()) };
}

export function tmpdir(): string {
  return unsafe { fromCString(fsh_rt_os_tmpdir()) };
}

// os.constants, of which Fish has signals: each signal's number by name, as this platform numbers
// them.
class OsConstants {
  signals: Record<string, i64>;
  constructor(signals: Record<string, i64>) {
    this.signals = signals;
  }
}

function osConstants(): OsConstants {
  let signals: Record<string, i64> = {};
  for (let n: i64 = 1; n < 65; n++) {
    const name = unsafe { fsh_rt_signal_name(n).isNull() ? "" : fromCString(fsh_rt_signal_name(n)) };
    if (name !== "") signals[name] = n;
  }
  return new OsConstants(signals);
}

export { osConstants as constants };

export function homedir(): string {
  return unsafe { fromCString(fsh_rt_os_homedir()) };
}

export function platform(): string {
  return unsafe { fromCString(fsh_rt_os_platform()) };
}

export function availableParallelism(): i64 {
  return unsafe { fsh_rt_os_parallelism() };
}
`,
  // Web Crypto's random functions, and Node's randomBytes, from the OS's secure random source. A
  // u8[] stands in for Uint8Array.
  crypto: String.raw`
declare function fsh_rt_random_fill(at: MutPtr<u8>, count: usize): void;

// Fills the array in place and gives it back. Web Crypto fills at most 65536 bytes a call.
export function getRandomValues(array: Mut<u8[]>): Mut<u8[]> {
  const n = array.length;
  assert(n <= 65536, "QuotaExceededError: getRandomValues fills at most 65536 bytes a call, not " + String(n) + "; fill a larger array in pieces");
  if (n > 0) unsafe { fsh_rt_random_fill(mutPtrOf(array[0]), n) };
  return array;
}

export function randomBytes(size: i64): Buffer {
  assert(size >= 0, "randomBytes takes a size of 0 or more, not " + String(size));
  let out: u8[] = new Array(size).fill(0 as u8);
  if (size > 0) unsafe { fsh_rt_random_fill(mutPtrOf(out[0]), size as usize) };
  return out;
}

// A version 4 UUID, RFC 9562's: 122 random bits, then the version and variant in lowercase hex.
export function randomUUID(): string {
  let b = randomBytes(16);
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  const digits = new TextEncoder().encode("0123456789abcdef");
  let out: u8[] = [];
  out.reserve(36);
  for (let i: usize = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out.push(45);
    out.push(digits[(b[i] >> 4) as usize]);
    out.push(digits[(b[i] & 15) as usize]);
  }
  return new TextDecoder().decode(out);
}

declare function fsh_rt_sha(which: i64, data: Ptr<u8>, length: i64, out: MutPtr<u8>): void;

// SHA-1 when which is 1, SHA-256 when it's 256.
function shaOf(which: i64, data: Ref<u8[]>): u8[] {
  let out: u8[] = new Array(which === 1 ? 20 : 32).fill(0 as u8);
  if (data.length > 0) {
    unsafe { fsh_rt_sha(which, ptrOf(data[0]), data.length as i64, mutPtrOf(out[0])) };
  } else {
    // A pointer is taken to an element, so empty input is one byte of length 0.
    const none: u8[] = [0 as u8];
    unsafe { fsh_rt_sha(which, ptrOf(none[0]), 0, mutPtrOf(out[0])) };
  }
  return out;
}

function bytesOf(data: string | u8[]): u8[] {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

// A string is hashed as its UTF-8 bytes.
export function sha1(data: string | u8[]): u8[] {
  return shaOf(1, bytesOf(data));
}

export function sha256(data: string | u8[]): u8[] {
  return shaOf(256, bytesOf(data));
}

// RFC 2104's HMAC over either hash, both of which take 64-byte blocks.
export function hmac(algorithm: "sha1" | "sha256", key: string | u8[], data: string | u8[]): u8[] {
  const which: i64 = algorithm === "sha1" ? 1 : 256;
  let k = bytesOf(key);
  if (k.length > 64) k = shaOf(which, k);
  let inner: u8[] = [];
  let outer: u8[] = [];
  for (let i: usize = 0; i < 64; i++) {
    const b: u8 = i < k.length ? k[i] : 0;
    inner.push(b ^ 0x36);
    outer.push(b ^ 0x5C);
  }
  for (const b of bytesOf(data)) inner.push(b);
  for (const b of shaOf(which, inner)) outer.push(b);
  return shaOf(which, outer);
}

// Node's one-shot crypto.hash, in the text encodings it gives; base64url is unpadded.
export function hash(algorithm: "sha1" | "sha256", data: string | u8[], encoding: "hex" | "base64" | "base64url" = "hex"): string {
  return encoded(shaOf(algorithm === "sha1" ? 1 : 256, bytesOf(data)), encoding);
}

function encoded(digest: Ref<u8[]>, encoding: "hex" | "base64" | "base64url"): string {
  if (encoding === "hex") return digest.toHex();
  return encoding === "base64" ? digest.toBase64() : digest.toBase64({ alphabet: "base64url", omitPadding: true });
}

// Node's createHash and createHmac: input taken in pieces, as update(a).update(b), then hashed
// whole by digest, which gives text in one of hash's encodings.
export class Hash {
  #algorithm: "sha1" | "sha256";
  #key: u8[] | null;
  #data: u8[];

  constructor(algorithm: "sha1" | "sha256", key: u8[] | null) {
    this.#algorithm = algorithm;
    this.#key = key;
    this.#data = [];
  }

  update(this: Mut<this>, data: string | u8[]): Mut<this> {
    for (const b of bytesOf(data)) this.#data.push(b);
    return this;
  }

  digest(encoding: "hex" | "base64" | "base64url"): string {
    const key: Ref<u8[] | null> = this.#key;
    if (key !== null) return encoded(hmac(this.#algorithm, key.clone(), this.#data.clone()), encoding);
    return encoded(shaOf(this.#algorithm === "sha1" ? 1 : 256, this.#data.clone()), encoding);
  }
}

export function createHash(algorithm: "sha1" | "sha256"): Hash {
  return new Hash(algorithm, null);
}

export function createHmac(algorithm: "sha1" | "sha256", key: string | u8[]): Hash {
  return new Hash(algorithm, bytesOf(key));
}
`,
  // The checker gives these their meaning, as each takes values of any type; a rest parameter
  // keeps them from being used as values.
  util: String.raw`
export function format(...args: string[]): string {
  return args.join(" ");
}

export function inspect(...args: string[]): string {
  return args.join(" ");
}

export function isDeepStrictEqual(...args: string[]): boolean {
  return args.length === 0;
}

declare function fsh_rt_argc(): i64;
declare function fsh_rt_arg(i: i64): Ptr<u8>;

// An option of the call's literal, as the checker gives it: its long name, its short one or "",
// whether it takes a string, and whether it may be given more than once.
type ParseArgsSpec = { name: string; short: string; text: boolean; multiple: boolean };

// What the arguments gave each option, by its place among the specs, for the checker's builder
// of the typed values to read.
class ParsedArgs {
  strings: string[][] = [];
  flags: boolean[][] = [];
  positionals: string[] = [];

  text(i: i64): string | null {
    const given: Ref<string[]> = this.strings[i as usize];
    return given.length === 0 ? null : given[given.length - 1];
  }

  texts(i: i64): string[] | null {
    return this.strings[i as usize].length === 0 ? null : this.strings[i as usize].clone();
  }

  flag(i: i64): boolean | null {
    const given: Ref<boolean[]> = this.flags[i as usize];
    return given.length === 0 ? null : given[given.length - 1];
  }

  flagList(i: i64): boolean[] | null {
    return this.flags[i as usize].length === 0 ? null : this.flags[i as usize].clone();
  }

  textOr(i: i64, fallback: string): string {
    return this.text(i) ?? fallback;
  }

  textsOr(i: i64, fallback: string[]): string[] {
    return this.texts(i) ?? fallback;
  }

  flagOr(i: i64, fallback: boolean): boolean {
    return this.flag(i) ?? fallback;
  }

  flagListOr(i: i64, fallback: boolean[]): boolean[] {
    return this.flagList(i) ?? fallback;
  }

  // parseArgs<T>()'s reads, which end the program with the usage on a missing or bad value.
  textGiven(i: i64, flag: string, usage: string): string {
    const given = this.text(i);
    if (given === null) __argsFailed("missing " + flag, usage);
    return given!;
  }

  // An integer option's value, in the field's type's range, written in decimal.
  integer(i: i64, flag: string, usage: string, required: boolean, min: i64, max: i64): i64 | null {
    return __argInteger(this.text(i), flag, usage, required, min, max);
  }

  integers(i: i64, flag: string, usage: string, min: i64, max: i64): i64[] {
    let out: i64[] = [];
    for (const g of this.strings[i as usize]) out.push(__argInteger(g, flag, usage, true, min, max)!);
    return out;
  }

  float(i: i64, flag: string, usage: string, required: boolean): f64 | null {
    return __argFloat(this.text(i), flag, usage, required);
  }

  floats(i: i64, flag: string, usage: string): f64[] {
    let out: f64[] = [];
    for (const g of this.strings[i as usize]) out.push(__argFloat(g, flag, usage, true)!);
    return out;
  }
}

function __argInteger(given: string | null, flag: string, usage: string, required: boolean, min: i64, max: i64): i64 | null {
  if (given === null) {
    if (required) __argsFailed("missing " + flag, usage);
    return null;
  }
  const text = given!;
  const n = /^[+-]?[0-9]+$/.test(text) ? parseInt(text) : null;
  if (n === null || n! < min || n! > max) __argsFailed(flag + " takes an integer from " + String(min) + " to " + String(max) + ", not '" + text + "'", usage);
  return n;
}

function __argFloat(given: string | null, flag: string, usage: string, required: boolean): f64 | null {
  if (given === null) {
    if (required) __argsFailed("missing " + flag, usage);
    return null;
  }
  const text = given!;
  const n = text.trim() === "" ? null : Number(text);
  if (n === null || Number.isNaN(n!)) __argsFailed(flag + " takes a number, not '" + text + "'", usage);
  return n;
}

function size(s: string): i64 {
  return s.length as i64;
}

function specAt(name: string, specs: Ref<ParseArgsSpec[]>): i64 {
  for (let i: usize = 0; i < specs.length; i++) if (specs[i].name === name) return i as i64;
  return -1;
}

function longFor(short: string, specs: Ref<ParseArgsSpec[]>): string {
  for (const s of specs) if (s.short === short) return s.name;
  return short;
}

function takesText(name: string, specs: Ref<ParseArgsSpec[]>): boolean {
  const i = specAt(name, specs);
  return i >= 0 && specs[i as usize].text;
}

// The program's arguments, process.argv after the two paths it starts with: the runtime's
// and the script's.
function programArgs(): string[] {
  let all: string[] = [];
  const n = unsafe { fsh_rt_argc() };
  for (let i: i64 = 2; i < n; i++) all.push(unsafe { fromCString(fsh_rt_arg(i)) });
  return all;
}

// A JSON string of text with no control characters, as a message quotes an option.
function quoted(s: string): string {
  return "\"" + s.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"") + "\"";
}

// The message, which leaves its last quote open.
function unknown(raw: string, allowPositionals: boolean): ParseArgsError {
  const hint = allowPositionals ? ". To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- " + quoted(raw) : "";
  return new ParseArgsError("ERR_PARSE_ARGS_UNKNOWN_OPTION", "Unknown option '" + raw + "'" + hint);
}

// One option met in the arguments, checked as strict mode checks it, then stored.
function option(p: Mut<ParsedArgs>, specs: Ref<ParseArgsSpec[]>, given: string, raw: string, value: string | null, inline: boolean, allowPositionals: boolean, allowNegative: boolean): void throws ParseArgsError {
  let name = given;
  let negated = false;
  if (allowNegative && name.startsWith("no-")) {
    const i = specAt(name.slice(3), specs);
    if (i >= 0 && !specs[i as usize].text) {
      name = name.slice(3);
      negated = true;
    }
  }
  const i = specAt(name, specs);
  if (i < 0) throw unknown(raw, allowPositionals);
  const spec: Ref<ParseArgsSpec> = specs[i as usize];
  const both = (spec.short === "" ? "" : "-" + spec.short + ", ") + "--" + name;
  if (spec.text && value === null) throw new ParseArgsError("ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "Option '" + both + " <value>' argument missing");
  if (!spec.text && value !== null) throw new ParseArgsError("ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "Option '" + both + "' does not take an argument");
  if (value !== null && !inline && size(value) > 1 && value.startsWith("-")) {
    const example = raw.startsWith("--") ? "'" + raw + "=-XYZ'" : "'--" + name + "=-XYZ' or '" + raw + "-XYZ'";
    throw new ParseArgsError("ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "Option '" + raw + "' argument is ambiguous.\nDid you forget to specify the option argument for '" + raw + "'?\nTo specify an option argument starting with a dash use " + example + ".");
  }
  // A value given again replaces the last unless the option takes several.
  if (value !== null && spec.multiple) p.strings[i as usize].push(value);
  else if (value !== null) p.strings[i as usize] = [value];
  else if (spec.multiple) p.flags[i as usize].push(!negated);
  else p.flags[i as usize] = [!negated];
}

function positional(p: Mut<ParsedArgs>, arg: string, allowPositionals: boolean): void throws ParseArgsError {
  if (!allowPositionals) throw new ParseArgsError("ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL", "Unexpected argument '" + arg + "'. This command does not take positional arguments");
  p.positionals.push(arg);
}

// A port of Node's parseArgs in strict mode. The checker writes each call's arguments from its
// options literal: the specs, and a builder giving the values typed from them.
export function parseArgs<V>(given: string[] | null, specs: ParseArgsSpec[], allowPositionals: boolean, allowNegative: boolean, build: (p: Ref<ParsedArgs>) => V): { values: V; positionals: string[] } throws ParseArgsError {
  let p = new ParsedArgs();
  for (const _ of specs) {
    p.strings.push([]);
    p.flags.push([]);
  }
  let rest = given ?? programArgs();
  let at: usize = 0;
  while (at < rest.length) {
    const arg = rest[at];
    at++;
    const next: string | null = at < rest.length ? rest[at] : null;
    const n = size(arg);
    if (arg === "--") {
      for (; at < rest.length; at++) positional(p, rest[at], allowPositionals);
      break;
    }
    const short = n >= 2 && arg.charAt(0) === "-" && arg.charAt(1) !== "-";
    if (short && n === 2) {
      const name = longFor(arg.charAt(1), specs);
      let value: string | null = null;
      if (takesText(name, specs) && next !== null) {
        value = next;
        at++;
      }
      option(p, specs, name, arg, value, false, allowPositionals, allowNegative);
      continue;
    }
    if (short && !takesText(longFor(arg.charAt(1), specs), specs)) {
      // -abc is -a -b -c, and a string option in it takes the rest, as -abfFILE is -a -b -fFILE.
      let expanded: string[] = [];
      for (let k: i64 = 1; k < n; k++) {
        const one = arg.charAt(k);
        if (!takesText(longFor(one, specs), specs) || k === n - 1) expanded.push("-" + one);
        else {
          expanded.push("-" + arg.slice(k));
          break;
        }
      }
      for (; at < rest.length; at++) expanded.push(rest[at]);
      rest = expanded;
      at = 0;
      continue;
    }
    if (short) {
      const one = arg.charAt(1);
      option(p, specs, longFor(one, specs), "-" + one, arg.slice(2), true, allowPositionals, allowNegative);
      continue;
    }
    if (n > 2 && arg.startsWith("--")) {
      // An "=" past the third character marks a value, which starts after the first.
      if (arg.indexOf("=", 3) < 0) {
        const name = arg.slice(2);
        let value: string | null = null;
        if (takesText(name, specs) && next !== null) {
          value = next;
          at++;
        }
        option(p, specs, name, arg, value, false, allowPositionals, allowNegative);
      } else {
        const eq = arg.indexOf("=");
        const name = arg.slice(2, eq);
        option(p, specs, name, "--" + name, arg.slice(eq + 1), true, allowPositionals, allowNegative);
      }
      continue;
    }
    positional(p, arg, allowPositionals);
  }
  const values = build(p);
  return { values, positionals: p.positionals };
}

declare function fsh_rt_exit(code: i64): void;

function __argsExit(code: i64): never {
  unsafe { fsh_rt_exit(code) };
  // The C call never returns.
  while (true) {}
}

// parseArgs<T>(): the usage line and its options, as the checker wrote them, after the program's name.
function __argsUsage(usage: string): string {
  const n = unsafe { fsh_rt_argc() };
  const path = n > 1 ? unsafe { fromCString(fsh_rt_arg(1)) } : "program";
  return "Usage: " + path.slice(path.lastIndexOf("/") + 1) + usage;
}

function __argsFailed(message: string, usage: string): never {
  console.error("error: " + message + "\n\n" + __argsUsage(usage));
  unsafe { fsh_rt_exit(2) };
  // The C call never returns.
  while (true) {}
}

// What parseArgs<T>() is rewritten to: -h or --help before any "--" prints the usage and ends the
// program with 0, and an argument the options don't take, its message and the usage, with 2.
function __typedArgs<V>(usage: string, run: () => V throws ParseArgsError): V {
  for (const a of programArgs()) {
    if (a === "--") break;
    if (a === "-h" || a === "--help") {
      console.log(__argsUsage(usage));
      __argsExit(0);
    }
  }
  let message = "";
  try {
    return run();
  } catch (e) {
    message = e.message;
  }
  console.error("error: " + message + "\n\n" + __argsUsage(usage));
  unsafe { fsh_rt_exit(2) };
  // The C call never returns.
  while (true) {}
}

`,
  // A port of Node's path.posix for the functions Fish has.
  path: String.raw`
declare function fsh_rt_cwd(): Ptr<u8>;

// A string's length and the UTF-16 unit at an index, in i64.
function size(s: string): i64 {
  return s.length as i64;
}

// Past the end there is no unit, as a working directory the system couldn't give is empty.
function at(s: string, i: i64): i64 {
  return i >= 0 && i < size(s) ? s.charCodeAt(i as usize) as i64 : -1;
}

function lastSlashOf(s: string): i64 {
  for (let i = size(s) - 1; i >= 0; i--) if (at(s, i) === 47) return i;
  return -1;
}

export const sep = "/";
export const delimiter = ":";

// Node's normalizeString: a path's segments with "." dropped and ".." taken back, above the root
// too when it is relative.
function normalizeString(path: string, allowAboveRoot: boolean): string {
  let res = "";
  let lastSegmentLength: i64 = 0;
  let lastSlash: i64 = -1;
  let dots: i64 = 0;
  let code: i64 = 0;
  for (let i: i64 = 0; i <= size(path); ++i) {
    if (i < size(path)) code = at(path, i);
    else if (code === 47) break;
    else code = 47;
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (size(res) < 2 || lastSegmentLength !== 2 || at(res, size(res) - 1) !== 46 || at(res, size(res) - 2) !== 46) {
          if (size(res) > 2) {
            const lastSlashIndex = size(res) - lastSegmentLength - 1;
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = size(res) - 1 - lastSlashOf(res);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (size(res) !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res = size(res) > 0 ? res + "/.." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (size(res) > 0) res = res + "/" + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function cwd(): string {
  return unsafe { fromCString(fsh_rt_cwd()) };
}

export function resolve(...args: string[]): string {
  if (args.length === 0 || (args.length === 1 && (args[0] === "" || args[0] === "."))) {
    const here = cwd();
    if (at(here, 0) === 47) return here;
  }
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i: i64 = (args.length as i64) - 1; i >= 0 && !resolvedAbsolute; i--) {
    const path = args[i as usize];
    if (size(path) === 0) continue;
    resolvedPath = path + "/" + resolvedPath;
    resolvedAbsolute = at(path, 0) === 47;
  }
  if (!resolvedAbsolute) {
    const here = cwd();
    resolvedPath = here + "/" + resolvedPath;
    resolvedAbsolute = at(here, 0) === 47;
  }
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute);
  if (resolvedAbsolute) return "/" + resolvedPath;
  return resolvedPath.length > 0 ? resolvedPath : ".";
}

export function normalize(path: string): string {
  if (size(path) === 0) return ".";
  const isAbsolute = at(path, 0) === 47;
  const trailingSeparator = at(path, size(path) - 1) === 47;
  let out = normalizeString(path, !isAbsolute);
  if (size(out) === 0) {
    if (isAbsolute) return "/";
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) out = out + "/";
  return isAbsolute ? "/" + out : out;
}

export function join(...args: string[]): string {
  let parts: string[] = [];
  for (const arg of args) if (size(arg) > 0) parts.push(arg);
  if (parts.length === 0) return ".";
  return normalize(parts.join("/"));
}

export function relative(from: string, to: string): string {
  if (from === to) return "";
  const a = resolve(from);
  const b = resolve(to);
  if (a === b) return "";
  const fromStart: i64 = 1;
  const fromEnd = size(a);
  const fromLen = fromEnd - fromStart;
  const toStart: i64 = 1;
  const toLen = size(b) - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep: i64 = -1;
  let i: i64 = 0;
  for (; i < length; i++) {
    const fromCode = at(a, fromStart + i);
    if (fromCode !== at(b, toStart + i)) break;
    else if (fromCode === 47) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) {
      if (at(b, toStart + i) === 47) return b.slice(toStart + i + 1);
      if (i === 0) return b.slice(toStart + i);
    } else if (fromLen > length) {
      if (at(a, fromStart + i) === 47) lastCommonSep = i;
      else if (i === 0) lastCommonSep = 0;
    }
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || at(a, i) === 47) out = out + (size(out) === 0 ? ".." : "/..");
  }
  return out + b.slice(toStart + lastCommonSep);
}

export function dirname(path: string): string {
  if (size(path) === 0) return ".";
  const hasRoot = at(path, 0) === 47;
  let end: i64 = -1;
  let matchedSlash = true;
  for (let i: i64 = size(path) - 1; i >= 1; --i) {
    if (at(path, i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}

export function basename(path: string, suffix?: string): string {
  let start: i64 = 0;
  let end: i64 = -1;
  let matchedSlash = true;
  if (suffix !== null && size(suffix) > 0 && size(suffix) <= size(path)) {
    if (suffix === path) return "";
    let extIdx: i64 = size(suffix) - 1;
    let firstNonSlashEnd: i64 = -1;
    for (let i: i64 = size(path) - 1; i >= 0; --i) {
      const code = at(path, i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === at(suffix, extIdx)) {
            if (--extIdx === -1) end = i;
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }
    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = size(path);
    return path.slice(start, end);
  }
  for (let i: i64 = size(path) - 1; i >= 0; --i) {
    if (at(path, i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return "";
  return path.slice(start, end);
}

export function extname(path: string): string {
  let startDot: i64 = -1;
  let startPart: i64 = 0;
  let end: i64 = -1;
  let matchedSlash = true;
  let preDotState: i64 = 0;
  for (let i: i64 = size(path) - 1; i >= 0; --i) {
    const code = at(path, i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return path.slice(startDot, end);
}

export function isAbsolute(path: string): boolean {
  return at(path, 0) === 47;
}

export type ParsedPath = { root: string; dir: string; base: string; ext: string; name: string };

export function parse(path: string): ParsedPath {
  let root = "";
  let dir = "";
  let base = "";
  let ext = "";
  let name = "";
  if (size(path) === 0) return { root, dir, base, ext, name };
  const absolute = at(path, 0) === 47;
  if (absolute) root = "/";
  let startDot: i64 = -1;
  let startPart: i64 = 0;
  let end: i64 = -1;
  let matchedSlash = true;
  let preDotState: i64 = 0;
  for (let i: i64 = size(path) - 1; i >= (absolute ? 1 : 0); --i) {
    const code = at(path, i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (end !== -1) {
    const start = startPart === 0 && absolute ? 1 : startPart;
    base = path.slice(start, end);
    if (startDot === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
      name = base;
    } else {
      name = path.slice(start, startDot);
      ext = path.slice(startDot, end);
    }
  }
  if (startPart > 0) dir = path.slice(0, startPart - 1);
  else if (absolute) dir = "/";
  return { root, dir, base, ext, name };
}

export type FormatInputPathObject = { root?: string; dir?: string; base?: string; ext?: string; name?: string };

// The precedence: dir over root, base over name and ext, and an ext given without its dot gets one.
export function format(pathObject: FormatInputPathObject): string {
  const root = pathObject.root ?? "";
  const given = pathObject.dir ?? "";
  const dir = size(given) > 0 ? given : root;
  let base = pathObject.base ?? "";
  if (size(base) === 0) {
    const ext = pathObject.ext ?? "";
    base = (pathObject.name ?? "") + (size(ext) === 0 || at(ext, 0) === 46 ? ext : "." + ext);
  }
  if (size(dir) === 0) return base;
  return dir === root ? dir + base : dir + "/" + base;
}
`,
  // Files read and written on the runtime's blocking pool. A call naming an encoding, as
  // readFile(path, "utf8"), is linked to readFileText, which gives a string.
  "fs/promises": String.raw`
import { chmodSync } from "std:fs";

export async function readFile(path: string): Promise<u8[]> throws IoError {
  return await fileRead(path);
}

export async function readFileText(path: string): Promise<string> throws IoError {
  const bytes = await fileRead(path);
  return new TextDecoder().decode(bytes);
}

export async function writeFile(path: string, data: string | u8[]): Promise<void> throws IoError {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  await fileWrite(path, bytes);
}

${FILES.replaceAll("export ", "")}
declare function fsh_rt_fd_hold(fd: i64): __FileDescriptor;
declare function fsh_rt_fd_of(held: Ref<__FileDescriptor>): i64;
declare function fsh_rt_fd_begin(held: Ref<__FileDescriptor>): i64;
declare function fsh_rt_fd_end(held: Ref<__FileDescriptor>): void;
declare function fsh_rt_fd_take(held: Ref<__FileDescriptor>): i64;

// The error for a call on a closed handle.
function closed(syscall: string): IoError {
  let e = new IoError("file closed");
  e.code = "EBADF";
  e.syscall = syscall;
  return e;
}

// A call's descriptor, held in flight until fsh_rt_fd_end, so a close from another task waits for
// the call rather than letting the number be reused under it.
function begin(held: Ref<__FileDescriptor>, syscall: string): i64 throws IoError {
  const fd = unsafe { fsh_rt_fd_begin(held) };
  if (fd < 0) throw closed(syscall);
  return fd;
}

// An open file, from open(). Its calls run on the blocking pool; dropped without close, it still
// closes its file. Its descriptor is the handle's: closing it with closeSync, rather than through
// close(), leaves the handle to close whatever file reuses the number.
export class FileHandle {
  #held: __FileDescriptor;
  constructor(held: __FileDescriptor) {
    this.#held = held;
  }

  // The descriptor, or -1 once closed.
  get fd(): i64 {
    return unsafe { fsh_rt_fd_of(this.#held) };
  }

  // The error for a closed handle, before a call's arguments are looked at.
  #open(syscall: string): void throws IoError {
    if (this.fd < 0) throw closed(syscall);
  }

  // What's read lands at offset; a null or -1 position reads from the file's own.
  async read(buffer: Mut<u8[]>, offset?: i64 | null, length?: i64 | null, position?: i64 | null): Promise<{ bytesRead: i64 }> throws IoError {
    this.#open("read");
    const held = this.#held.clone();
    const size = buffer.length as i64;
    const from = offset ?? 0;
    const n = length ?? size - from;
    const at = position ?? -1;
    // The read fills a copy of its own, since the buffer stays here, then lands in the buffer.
    const done = await spawnBlocking(() => {
      const fd = begin(held, "read");
      let copy: u8[] = new Array(size).fill(0 as u8);
      try {
        const got = readInto(fd, copy, from, n, at);
        return { got, copy };
      } finally {
        unsafe { fsh_rt_fd_end(held) };
      }
    });
    for (let i = from; i < from + done.got; i++) buffer[i as usize] = done.copy[i as usize];
    return { bytesRead: done.got };
  }

  // write(buffer, offset?, length?, position?), or write(text, position?, encoding?) for a
  // string's UTF-8, the arguments read by what is given; a null position writes at the
  // file's own. The bytes are taken, as the write runs on the blocking pool; one signature, since
  // async methods can't be overloaded yet.
  async write(data: string | u8[], second?: i64 | null, third?: i64 | "utf8" | "utf-8" | null, position?: i64 | null): Promise<{ bytesWritten: i64 }> throws IoError {
    this.#open("write");
    if (typeof data !== "string" && data.length === 0) return { bytesWritten: 0 };
    const held = this.#held.clone();
    const length = typeof third === "number" ? third : null;
    const wrote = await spawnBlocking(() => {
      const fd = begin(held, "write");
      try {
        if (typeof data === "string") return writeSync(fd, data, second);
        return writeSync(fd, data, second, length, position);
      } finally {
        unsafe { fsh_rt_fd_end(held) };
      }
    });
    return { bytesWritten: wrote };
  }

  async stat(): Promise<Stats> throws IoError {
    this.#open("fstat");
    const held = this.#held.clone();
    return await spawnBlocking(() => {
      const fd = begin(held, "fstat");
      try {
        return fstatSync(fd);
      } finally {
        unsafe { fsh_rt_fd_end(held) };
      }
    });
  }

  async truncate(len: i64 = 0): Promise<void> throws IoError {
    this.#open("ftruncate");
    const held = this.#held.clone();
    await spawnBlocking(() => {
      const fd = begin(held, "ftruncate");
      try {
        ftruncateSync(fd, len);
      } finally {
        unsafe { fsh_rt_fd_end(held) };
      }
    });
  }

  async sync(): Promise<void> throws IoError {
    this.#open("fsync");
    const held = this.#held.clone();
    await spawnBlocking(() => {
      const fd = begin(held, "fsync");
      try {
        fsyncSync(fd);
      } finally {
        unsafe { fsh_rt_fd_end(held) };
      }
    });
  }

  async chmod(mode: i64): Promise<void> throws IoError {
    this.#open("fchmod");
    const held = this.#held.clone();
    await spawnBlocking(() => {
      const fd = begin(held, "fchmod");
      try {
        fchmodSync(fd, mode);
      } finally {
        unsafe { fsh_rt_fd_end(held) };
      }
    });
  }

  // Closing a closed handle does nothing. With calls in flight, the last of them
  // closes the file as it finishes; later calls throw "file closed" at once.
  async close(): Promise<void> throws IoError {
    const fd = unsafe { fsh_rt_fd_take(this.#held) };
    if (fd >= 0) closeSync(fd);
  }
}

// The string flags, as "r" or "a+", or a number given to open as it is. The handle is made in
// the same job as the descriptor, so a caller that stops waiting still has it closed.
export async function open(path: string, flags: string | i64 = "r", mode: i64 = 0o666): Promise<FileHandle> throws IoError {
  return await spawnBlocking(() => {
    const fd = openSync(path, flags, mode);
    return new FileHandle(unsafe { fsh_rt_fd_hold(fd) });
  });
}

export const constants = new FsConstants();

export async function access(path: string, mode: i64 = 0): Promise<void> throws IoError {
  await spawnBlocking(() => pathAccess(path, mode));
}

// A time as utimes takes it: a Date's seconds, and a
// negative finite number now; NaN and the infinities pass on to be refused.
function seconds(time: f64 | Date): f64 {
  if (time instanceof Date) return (time.getTime() as f64) / 1000;
  return time < 0 && time - time === 0 ? (Date.now() as f64) / 1000 : time;
}

export async function utimes(path: string, atime: f64 | Date, mtime: f64 | Date): Promise<void> throws IoError {
  const [a, m] = [seconds(atime), seconds(mtime)];
  await spawnBlocking(() => pathUtimes(path, a, m, true));
}

export async function lutimes(path: string, atime: f64 | Date, mtime: f64 | Date): Promise<void> throws IoError {
  const [a, m] = [seconds(atime), seconds(mtime)];
  await spawnBlocking(() => pathUtimes(path, a, m, false));
}

export async function chmod(path: string, mode: i64 | string): Promise<void> throws IoError {
  await spawnBlocking(() => chmodSync(path, mode));
}

export async function symlink(target: string, path: string, _type: "dir" | "file" | "junction" | null = null): Promise<void> throws IoError {
  await spawnBlocking(() => pathLink(target, path, true));
}

export async function link(existingPath: string, newPath: string): Promise<void> throws IoError {
  await spawnBlocking(() => pathLink(existingPath, newPath, false));
}

export async function readlink(path: string): Promise<string> throws IoError {
  return await spawnBlocking(() => pathReadLink(path));
}

export async function realpath(path: string): Promise<string> throws IoError {
  return await spawnBlocking(() => pathRealNative(path));
}

export type FileChangeInfo = { eventType: "rename" | "change"; filename: string | null };

declare function fsh_rt_watch_open(path: Ptr<u8>, recursive: i64): i64;
declare function fsh_rt_watch_hold(handle: i64): void;
declare function fsh_rt_watch_wait(handle: i64, out: MutPtr<u8>, size: i64): i64;
declare function fsh_rt_watch_close(handle: i64): void;

// Changes under a path as they happen. The watcher starts here, so a
// missing path throws at the call. Where an iterator throws an AbortError once
// the signal aborts, this one ends: a generator that throws has a type no parameter can name, so
// it couldn't be handed to a function that races its next() against a timer.
export function watch(path: string, options: { recursive?: boolean; signal?: AbortSignal } = {}): AsyncGenerator<FileChangeInfo> throws IoError {
  if (path.includes("\0")) throw invalid("The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received \"" + path.replaceAll("\0", "\\u0000") + "\"");
  const handle = unsafe { fsh_rt_watch_open(cString(path), options.recursive === true ? 1 : 0) };
  if (handle < 0) throw failed(handle, "watch", path);
  return watchChanges(handle, options.signal ?? new AbortController().signal);
}

// A wait the iterator stops awaiting stays in its frame and is resumed by the next call, so racing
// next() against something else loses nothing.
async function* watchChanges(handle: i64, signal: AbortSignal): AsyncGenerator<FileChangeInfo> {
  while (true) {
    let got: string | null = null;
    if (!signal.aborted) got = await Promise.race([watchWaited(handle), watchAborted(signal.clone())]);
    if (got === null) {
      unsafe { fsh_rt_watch_close(handle) };
      return;
    }
    for (const line of got.split("\0")) {
      if (line === "") continue;
      const eventType: "rename" | "change" = line.startsWith("c") ? "change" : "rename";
      yield { eventType, filename: line.slice(1) };
    }
  }
}

// The hold comes before the job reaches the pool, so a close racing it can't free the watcher first.
async function watchWaited(handle: i64): Promise<string | null> {
  unsafe { fsh_rt_watch_hold(handle) };
  const got = await spawnBlocking(() => {
    let out: u8[] = new Array(65536).fill(0 as u8);
    const n = unsafe { fsh_rt_watch_wait(handle, mutPtrOf(out[0]), 65536) };
    return new TextDecoder().decode(out.slice(0, n));
  });
  return got === "" ? null : got;
}

async function watchAborted(signal: AbortSignal): Promise<string | null> {
  while (!signal.aborted) {
    try {
      await sleep(86400000, signal.clone());
    } catch (_e) {}
  }
  return null;
}
`,
  fs: String.raw`
// A descriptor is read to its end from where it is. Standard input goes through readLine's
// buffer, so what a line read took is still read here.
export function readFileSync(path: string | i64): u8[] throws IoError {
  if (typeof path === "string") return fileReadSync(path);
  if (path === 0) {
    const taken = __stdinTake(1);
    if (taken === null) return [];
    return taken;
  }
  let all: u8[] = [];
  let chunk: u8[] = new Array(65536).fill(0 as u8);
  while (true) {
    const n = readSync(path, chunk);
    if (n === 0) return all;
    for (let i: i64 = 0; i < n; i++) all.push(chunk[i as usize]);
  }
}

export function readFileSyncText(path: string | i64): string throws IoError {
  const bytes = readFileSync(path);
  return new TextDecoder().decode(bytes);
}

export function writeFileSync(path: string, data: string | u8[]): void throws IoError {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  fileWriteSync(path, bytes);
}

export function existsSync(path: string): boolean {
  return pathExists(path);
}

export function statSync(path: string, options?: { throwIfNoEntry?: true }): Stats throws IoError;
export function statSync(path: string, options: { throwIfNoEntry: false }): Stats | undefined throws IoError;
export function statSync(path: string, options?: { throwIfNoEntry?: boolean }): Stats | undefined throws IoError {
  return pathStats(path, true, options?.throwIfNoEntry ?? true);
}

export function lstatSync(path: string, options?: { throwIfNoEntry?: true }): Stats throws IoError;
export function lstatSync(path: string, options: { throwIfNoEntry: false }): Stats | undefined throws IoError;
export function lstatSync(path: string, options?: { throwIfNoEntry?: boolean }): Stats | undefined throws IoError {
  return pathStats(path, false, options?.throwIfNoEntry ?? true);
}

export function readdirSync(path: string): string[] throws IoError;
export function readdirSync(path: string, options: { withFileTypes?: false }): string[] throws IoError;
export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[] throws IoError;
export function readdirSync(path: string, options?: { withFileTypes?: boolean }): string[] | Dirent[] throws IoError {
  const names = dirRead(path);
  if (!(options?.withFileTypes ?? false)) return names;
  let entries: Dirent[] = [];
  for (const name of names) {
    // An entry removed since the directory was read has no kind, as one of an unknown type has none.
    let kind: i64 = 0;
    try {
      kind = pathStat(path + "/" + name, false)[3];
    } catch {}
    entries.push(new Dirent(name, path, kind));
  }
  return entries;
}

export function realpathSync(path: string): string throws IoError {
  return pathReal(path);
}

export function mkdtempSync(prefix: string): string throws IoError {
  return dirTemp(prefix);
}

export type RmOptions = { recursive?: boolean; force?: boolean };

export function rmSync(path: string, options: RmOptions = {}): void throws IoError {
  pathRemove(path, options.recursive ?? false, options.force ?? false);
}

export type MakeDirectoryOptions = { recursive?: boolean; mode?: i64 };

// The first directory made with recursive, as the prefix of path spells it; otherwise undefined.
export function mkdirSync(path: string, options: MakeDirectoryOptions | i64 = {}): string | undefined throws IoError {
  if (typeof options === "number") return dirMake(path, false, options);
  return dirMake(path, options.recursive ?? false, options.mode ?? 0o777);
}

export function renameSync(oldPath: string, newPath: string): void throws IoError {
  pathRename(oldPath, newPath);
}

export const constants = new FsConstants();

export function copyFileSync(src: string, dest: string, mode: i64 = 0): void throws IoError {
  fileCopy(src, dest, mode);
}

export function unlinkSync(path: string): void throws IoError {
  pathUnlink(path);
}

${FILES}

export function accessSync(path: string, mode: i64 = 0): void throws IoError {
  pathAccess(path, mode);
}

// A time as utimes takes it: a Date's seconds, and a
// negative finite number now; NaN and the infinities pass on to be refused.
function seconds(time: f64 | Date): f64 {
  if (time instanceof Date) return (time.getTime() as f64) / 1000;
  return time < 0 && time - time === 0 ? (Date.now() as f64) / 1000 : time;
}

export function utimesSync(path: string, atime: f64 | Date, mtime: f64 | Date): void throws IoError {
  pathUtimes(path, seconds(atime), seconds(mtime), true);
}

// A link's own times, not its target's.
export function lutimesSync(path: string, atime: f64 | Date, mtime: f64 | Date): void throws IoError {
  pathUtimes(path, seconds(atime), seconds(mtime), false);
}

// A string as an argument error quotes it, cut at 128 characters: in single
// quotes, unless it holds one and another quote kind is free; with all taken, its ' escaped.
function quoted(text: string): string {
  const backtick = !text.includes("${"`"}") && !text.includes("$" + "{");
  const quote = !text.includes("'") ? "'" : !text.includes("\"") ? "\"" : backtick ? "${"`"}" : "'";
  const shown = quote + (quote === "'" ? text.replaceAll("'", "\\'") : text) + quote;
  return shown.length > 128 ? shown.slice(0, 128) + "..." : shown;
}

// A number as a range error prints it: grouped by threes with _ above 2 ** 32.
function grouped(n: f64): string {
  const text = String(n);
  if (n <= 4294967296 && n >= -4294967296) return text;
  const start = text.startsWith("-") ? 1 : 0;
  let rest = "";
  let i = text.length as i64;
  for (; i >= start + 4; i -= 3) rest = "_" + text.slice(i - 3, i) + rest;
  return text.slice(0, i) + rest;
}

// The mode as chmod reads it: a number as given, a string as octal digits, then
// checked as a 32-bit unsigned integer.
function fileMode(mode: i64 | string): i64 throws IoError {
  let n: f64 = 0;
  if (typeof mode === "string") {
    let octal = mode.length > 0;
    for (const d of mode) {
      octal = octal && d >= "0" && d <= "7";
      n = n * 8 + ((d.charCodeAt(0) as f64) - 48);
    }
    if (!octal) {
      let e = new IoError("The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received " + quoted(mode));
      e.code = "ERR_INVALID_ARG_VALUE";
      throw e;
    }
  } else n = mode as f64;
  if (n < 0 || n > 4294967295) {
    let e = new IoError("The value of \"mode\" is out of range. It must be >= 0 && <= 4294967295. Received " + grouped(n));
    e.code = "ERR_OUT_OF_RANGE";
    throw e;
  }
  return n as i64;
}

export function chmodSync(path: string, mode: i64 | string): void throws IoError {
  pathChmod(path, fileMode(mode));
}

// The link type matters only on Windows, so it is checked and then unused.
export function symlinkSync(target: string, path: string, _type: "dir" | "file" | "junction" | null = null): void throws IoError {
  pathLink(target, path, true);
}

export function linkSync(existingPath: string, newPath: string): void throws IoError {
  pathLink(existingPath, newPath, false);
}

export function readlinkSync(path: string): string throws IoError {
  return pathReadLink(path);
}
`,
  // Whole-buffer compression and decompression over the system zlib, which links into a program
  // only when it calls these. The async forms run the sync ones on the blocking pool.
  zlib: String.raw`
declare function fsh_rt_zlib_run(inflating: i64, bits: i64, level: i64, data: Ptr<u8>, length: i64, limit: i64, result: MutPtr<i64>): Ptr<u8>;
declare function fsh_rt_zlib_take(run: Ptr<u8>, out: MutPtr<u8>): void;

// What a compression or decompression throws, carrying zlib's: the message, zlib's
// error number and its name. A level out of range is a RangeError, with no errno.
export class ZlibError extends Error {
  errno: i64 | null;
  code: string;
  constructor(message: string, errno: i64 | null, code: string) {
    super(message);
    this.errno = errno;
    this.code = code;
  }
}

// maxOutputLength caps what a call may give, refusing it past the cap.
export type ZlibOptions = { level?: i64; maxOutputLength?: i64 };

export const constants = { Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1 };

function codeOf(errno: i64): string {
  switch (errno) {
    case 2: return "Z_NEED_DICT";
    case -2: return "Z_STREAM_ERROR";
    case -3: return "Z_DATA_ERROR";
    case -4: return "Z_MEM_ERROR";
    case -5: return "Z_BUF_ERROR";
    case -6: return "Z_VERSION_ERROR";
  }
  return "Z_ERRNO";
}

// A number as range errors show it, grouped by underscores beyond 2 ** 32.
function shown(n: i64): string {
  const text = String(n);
  if (n <= 4294967296 && n >= -4294967296) return text;
  const start = n < 0 ? 1 : 0;
  let i = text.length as i64;
  let grouped = "";
  for (; i >= start + 4; i -= 3) grouped = "_" + text.slice(i - 3, i) + grouped;
  return text.slice(0, i) + grouped;
}

// Runs zlib over the whole of data; bits picks the format as windowBits does.
function run(inflating: boolean, bits: i64, data: string | u8[], options: ZlibOptions): u8[] throws ZlibError {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return checked(inflating, bits, options.level ?? -1, input, options.maxOutputLength ?? -1);
}

function checked(inflating: boolean, bits: i64, level: i64, input: Ref<u8[]>, limit: i64): u8[] throws ZlibError {
  if (level < -1 || level > 9) {
    let e = new ZlibError("The value of \"options.level\" is out of range. It must be >= -1 and <= 9. Received " + shown(level), null, "ERR_OUT_OF_RANGE");
    e.name = "RangeError";
    throw e;
  }
  // A pointer is taken to an element, so empty input is passed as one byte of length 0.
  const none: u8[] = [0 as u8];
  let result: i64[] = [0, 0, 0];
  const done = input.length === 0
    ? unsafe { fsh_rt_zlib_run(inflating ? 1 : 0, bits, level, ptrOf(none[0]), 0, limit, mutPtrOf(result[0])) }
    : unsafe { fsh_rt_zlib_run(inflating ? 1 : 0, bits, level, ptrOf(input[0]), input.length as i64, limit, mutPtrOf(result[0])) };
  let out: u8[] = new Array(result[2] === 0 ? 1 : result[2]).fill(0 as u8);
  unsafe { fsh_rt_zlib_take(done, mutPtrOf(out[0])) };
  if (result[2] === 0) out = [];
  if (result[0] === 2) {
    let e = new ZlibError("Cannot create a Buffer larger than " + String(limit) + " bytes", null, "ERR_BUFFER_TOO_LARGE");
    e.name = "RangeError";
    throw e;
  }
  if (result[0] !== 0) throw new ZlibError(new TextDecoder().decode(out), result[1], codeOf(result[1]));
  return out;
}

export function gzipSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(false, 31, data, options);
}

export function gunzipSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(true, 31, data, options);
}

export function deflateSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(false, 15, data, options);
}

export function inflateSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(true, 15, data, options);
}

export function deflateRawSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(false, -15, data, options);
}

export function inflateRawSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(true, -15, data, options);
}

// Gzip or zlib, whichever the input's header says.
export function unzipSync(data: string | u8[], options: ZlibOptions = {}): u8[] throws ZlibError {
  return run(true, 47, data, options);
}

// These give a promise where a callback API would take a callback, as promisify would.
// The closure borrows the input rather than moving it into the call: a blocking task that moves
// an array it captured frees it twice.
async function runAsync(inflating: boolean, bits: i64, data: string | u8[], options: ZlibOptions): Promise<u8[]> throws ZlibError {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const level = options.level ?? -1;
  const limit = options.maxOutputLength ?? -1;
  return await spawnBlocking(() => checked(inflating, bits, level, input, limit));
}

export async function gzip(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(false, 31, data, options);
}

export async function gunzip(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(true, 31, data, options);
}

export async function deflate(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(false, 15, data, options);
}

export async function inflate(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(true, 15, data, options);
}

export async function deflateRaw(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(false, -15, data, options);
}

export async function inflateRaw(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(true, -15, data, options);
}

export async function unzip(data: string | u8[], options: ZlibOptions = {}): Promise<u8[]> throws ZlibError {
  return await runAsync(true, 47, data, options);
}
`,
  // Response compression for a Router, imported as std:compress: br, gzip or deflate as a
  // request's Accept-Encoding prefers, over the system zlib and libbrotlienc.
  compress: String.raw`
declare function fsh_rt_zlib_open(bits: i64, level: i64): Ptr<u8>;
declare function fsh_rt_zlib_push(stream: Ptr<u8>, data: Ptr<u8>, length: i64, finish: i64, result: MutPtr<i64>): Ptr<u8>;
declare function fsh_rt_zlib_take(run: Ptr<u8>, out: MutPtr<u8>): void;
declare function fsh_rt_zlib_close(stream: Ptr<u8>): void;
declare function fsh_rt_brotli_open(quality: i64): Ptr<u8>;
declare function fsh_rt_brotli_push(stream: Ptr<u8>, data: Ptr<u8>, length: i64, finish: i64, result: MutPtr<i64>): Ptr<u8>;
declare function fsh_rt_brotli_take(run: Ptr<u8>, out: MutPtr<u8>): void;
declare function fsh_rt_brotli_close(stream: Ptr<u8>): void;

// threshold is the fewest bytes a body that isn't streamed needs to be compressed; a streamed
// body's size isn't known, so it always is.
export type CompressOptions = { threshold?: i64 };

// The coding an Accept-Encoding value prefers of br, gzip and deflate, or "" for none of them:
// the highest q above 0, a tie going to the first of those, and * giving its q to any not named.
export function negotiate(accept: string): string {
  const offered = ["br", "gzip", "deflate"];
  let named: f64[] = [-1.0, -1.0, -1.0];
  let any: f64 = -1.0;
  for (const part of accept.split(",")) {
    const fields = part.split(";");
    const name = fields[0].trim().toLowerCase();
    let q: f64 = 1.0;
    for (let i: usize = 1; i < fields.length; i++) {
      const field = fields[i].trim().toLowerCase();
      if (field.startsWith("q=")) q = parseFloat(field.slice(2)) ?? 0.0;
    }
    if (name === "*") any = q;
    for (let i: usize = 0; i < offered.length; i++) if (offered[i] === name) named[i] = q;
  }
  let best = "";
  let top: f64 = 0.0;
  for (let i: usize = 0; i < offered.length; i++) {
    const q = named[i] < 0.0 ? any : named[i];
    if (q > top) {
      top = q;
      best = offered[i];
    }
  }
  return best;
}

// A type whose bodies come compressed already: images but SVG, audio, video, archives, web fonts
// and PDF.
function packedType(type: string): boolean {
  const t = type.split(";")[0].trim().toLowerCase();
  if (t.startsWith("image/")) return t !== "image/svg+xml";
  if (t.startsWith("audio/") || t.startsWith("video/")) return true;
  switch (t) {
    case "application/zip":
    case "application/gzip":
    case "application/x-gzip":
    case "application/x-bzip2":
    case "application/x-xz":
    case "application/x-7z-compressed":
    case "application/vnd.rar":
    case "application/zstd":
    case "application/pdf":
    case "font/woff":
    case "font/woff2":
      return true;
  }
  return false;
}

// Whether a response may be coded at all, whatever the request accepts.
function codable(res: Ref<Response>): boolean {
  if (res.status < 200 || res.status === 204 || res.status === 304) return false;
  if (res.headers.has("content-encoding")) return false;
  const cache = res.headers.get("cache-control");
  if (cache !== null && cache.toLowerCase().includes("no-transform")) return false;
  const type = res.headers.get("content-type");
  return type === null || !packedType(type);
}

// Whether a Vary value already names Accept-Encoding, or every header.
function varies(value: string): boolean {
  for (const name of value.split(",")) {
    const n = name.trim().toLowerCase();
    if (n === "accept-encoding" || n === "*") return true;
  }
  return false;
}

// An open deflate stream or brotli encoder.
class Coder {
  #brotli: boolean;
  #state: Ptr<u8>;

  // gzip and deflate as HTTP names them, deflate being zlib's format; zlib's default level, and
  // brotli's quality 4, which compresses about as well as gzip's default but faster, as dynamic
  // responses want.
  constructor(coding: string) {
    this.#brotli = coding === "br";
    this.#state = coding === "br" ? unsafe { fsh_rt_brotli_open(4) } : unsafe { fsh_rt_zlib_open(coding === "gzip" ? 31 : 15, -1) };
  }

  // The coded bytes of the next chunk, flushed so they can be sent at once, or with finish of
  // the last, ending the stream.
  push(this: Ref<this>, data: Ref<u8[]>, finish: boolean): u8[] {
    if (data.length > 0) return this.feed(data, data.length as i64, finish);
    // A pointer is taken to an element, so no input is passed as one byte of length 0.
    const none: u8[] = [0 as u8];
    return this.feed(none, 0, finish);
  }

  feed(this: Ref<this>, input: Ref<u8[]>, length: i64, finish: boolean): u8[] {
    let result: i64[] = [0, 0, 0];
    const last = finish ? 1 : 0;
    const done = this.#brotli
      ? unsafe { fsh_rt_brotli_push(this.#state, ptrOf(input[0]), length, last, mutPtrOf(result[0])) }
      : unsafe { fsh_rt_zlib_push(this.#state, ptrOf(input[0]), length, last, mutPtrOf(result[0])) };
    let out: u8[] = new Array(result[2] === 0 ? 1 : result[2]).fill(0 as u8);
    if (this.#brotli) {
      unsafe { fsh_rt_brotli_take(done, mutPtrOf(out[0])) };
    } else {
      unsafe { fsh_rt_zlib_take(done, mutPtrOf(out[0])) };
    }
    if (result[2] === 0) out = [];
    assert(result[0] === 0, "compressing a response body failed");
    return out;
  }

  // Frees the stream or encoder; nothing may be pushed after.
  close(this: Ref<this>): void {
    if (this.#brotli) {
      unsafe { fsh_rt_brotli_close(this.#state) };
    } else {
      unsafe { fsh_rt_zlib_close(this.#state) };
    }
  }
}

// A streamed body's chunks coded as they come, each flushed so a stream of events still
// reaches the client an event at a time.
// ponytail: the coder is closed when the body ends; a body dropped part way, as when the client
// goes, leaks it, since a generator held in a Dyn can't own a value with a drop yet.
async function* coded(coding: string, source: ReadableStream<u8[]>): AsyncGenerator<u8[]> {
  const coder = new Coder(coding);
  let chunks = source;
  for await (const chunk of chunks) {
    const out = coder.push(chunk, false);
    if (out.length > 0) yield out;
  }
  const none: u8[] = [];
  const last = coder.push(none, true);
  coder.close();
  yield last;
}

// A Router middleware compressing responses with the coding the request's Accept-Encoding
// prefers. A response already coded, marked no-transform, of a type that comes compressed, with
// no body, or with a whole body under the threshold is sent as it is. Every response it could
// code says Vary: Accept-Encoding, so a cache keeps each coding apart.
export function compress(options: CompressOptions = {}): (req: Request, next: (req: Request) => Promise<Response>) => Promise<Response> {
  const threshold = options.threshold ?? 1024;
  return async (req, next) => {
    const coding = req.method === "HEAD" ? "" : negotiate(req.headers.get("accept-encoding") ?? "");
    let res = await next(req);
    if (!codable(res)) return res;
    const vary = res.headers.get("vary");
    if (vary === null) res.headers.set("vary", "Accept-Encoding");
    else if (!varies(vary)) res.headers.set("vary", vary + ", Accept-Encoding");
    if (coding === "") return res;
    if (res.__streamed()) {
      const source = res.body;
      if (source === null) return res;
      res.__setBody(ReadableStream.from(coded(coding, source)));
    } else {
      if ((res.__bytes().length as i64) < threshold) return res;
      const coder = new Coder(coding);
      const packed = coder.push(res.__bytes(), true);
      coder.close();
      res.__setBody(packed);
    }
    res.headers.set("content-encoding", coding);
    res.headers.delete("content-length");
    return res;
  };
}
`,
  child_process: String.raw`
declare function fsh_rt_signal_name(n: i64): Ptr<u8>;
declare function write(fd: i32, data: Ptr<u8>, length: usize): isize;

// A "utf8" encoding is read from the call's literal, which then gives text; an options value held
// elsewhere can't ask for text, its encoding only null.
export type SpawnSyncOptions = { cwd?: string; input?: string | u8[]; encoding?: "buffer" | null };

export class SpawnSyncReturns<T> {
  pid: i64;
  status: i64 | null;
  signal: string | null;
  stdout: T;
  stderr: T;
  error: IoError | null;
  constructor(pid: i64, status: i64 | null, signal: string | null, stdout: T, stderr: T, error: IoError | null) {
    this.pid = pid;
    this.status = status;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
    this.error = error;
  }
}

export function spawnSync(command: string, args: string[] = [], options: SpawnSyncOptions = {}): SpawnSyncReturns<u8[]> {
  const input = options.input ?? "";
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  try {
    const [pid, status, signo, stdout, stderr] = processSpawn(command, args, options.cwd ?? "", bytes, 0, []);
    const name = signo === 0 ? null : unsafe { fsh_rt_signal_name(signo).isNull() ? "SIG" + signo : fromCString(fsh_rt_signal_name(signo)) };
    return new SpawnSyncReturns<u8[]>(pid, status < 0 ? null : status, name, stdout, stderr, null);
  } catch (e) {
    return new SpawnSyncReturns<u8[]>(0, null, null, [], [], e);
  }
}

// A command that ran but exited with a code other than 0, or was ended by a signal.
export class ExecError extends Error {
  status: i64 | null;
  signal: string | null;
  stdout: u8[];
  stderr: u8[];
  constructor(message: string, status: i64 | null, signal: string | null, stdout: u8[], stderr: u8[]) {
    super(message);
    this.status = status;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// What the exec calls give: the child's stdout, after its stderr has gone on to this process's;
// or the error, its message naming the command as it was given.
function executed(r: SpawnSyncReturns<u8[]>, command: string): u8[] throws IoError | ExecError {
  if (r.stderr.length > 0) unsafe { write(2, ptrOf(r.stderr[0]), r.stderr.length as usize) };
  const failed = r.error;
  if (failed !== null) throw failed;
  if (r.status === 0) return r.stdout;
  const text = new TextDecoder();
  const message = r.stderr.length > 0 ? "Command failed: " + command + "\n" + text.decode(r.stderr) : "Command failed: " + command;
  throw new ExecError(message, r.status, r.signal, r.stdout, r.stderr);
}

export function execFileSync(file: string, args: string[] = [], options: SpawnSyncOptions = {}): u8[] throws IoError | ExecError {
  const named = [file, ...args].join(" ");
  return executed(spawnSync(file, args, options), named);
}

export function execFileSyncText(file: string, args: string[] = [], options: SpawnSyncOptions = {}): string throws IoError | ExecError {
  return new TextDecoder().decode(execFileSync(file, args, options));
}

export function execSync(command: string, options: SpawnSyncOptions = {}): u8[] throws IoError | ExecError {
  return executed(spawnSync("/bin/sh", ["-c", command], options), command);
}

export function execSyncText(command: string, options: SpawnSyncOptions = {}): string throws IoError | ExecError {
  return new TextDecoder().decode(execSync(command, options));
}

export function spawnSyncText(command: string, args: string[] = [], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> {
  const r = spawnSync(command, args, options);
  const text = new TextDecoder();
  return new SpawnSyncReturns<string>(r.pid, r.status, r.signal, text.decode(r.stdout), text.decode(r.stderr), r.error);
}
`,
  // TLS client streams as a global module: tls.connect gives a TcpStream whose bytes are
  // encrypted, once the handshake has verified the server's certificate.
  tls: String.raw`
// serverName is the name the certificate must be for, when it isn't host; ca is PEM certificates
// trusted in place of the system's.
export type ConnectOptions = { serverName?: string; ca?: string; signal?: AbortSignal };

export async function connect(host: string, port: i64, options: ConnectOptions = {}): Promise<TcpStream> throws IoError | AbortError {
  const given = options.signal;
  const signal = given ?? new AbortController().signal;
  const conn = await TcpStream.connect(host, port, signal.clone());
  await __tlsClient(conn, options.serverName ?? host, options.ca ?? "", signal);
  return conn;
}
`,
  // Postgres over its wire protocol: a pool of connections, statements with parameters sent apart from
  // their text, and rows read by column name into a type.
  postgres: String.raw`
declare function fsh_rt_crypto_digest(which: i64, key: Ptr<u8>, keyLength: i64, data: Ptr<u8>, length: i64, rounds: i64, out: MutPtr<u8>): i64;
declare function fsh_rt_crypto_missing(): Ptr<u8>;
declare function fsh_rt_random_fill(at: MutPtr<u8>, count: usize): void;

// A value a query's $1, $2 and the rest can take, sent as text: bytes as bytea's hex form, a Date
// as its ISO string.
export type SqlValue = null | boolean | i64 | f64 | string | u8[] | Date;

// What the server said went wrong: SQLSTATE's five-character code, its message, and its detail
// when it gave one.
export class PostgresError extends Error {
  code: string;
  detail: string | null;
  severity: string;
  constructor(message: string, code: string, detail: string | null, severity: string) {
    super(message);
    this.name = "PostgresError";
    this.code = code;
    this.detail = detail;
    this.severity = severity;
  }
}

// A row that can't be read as the type asked for: a column it needs is missing, null where the
// field can't be, or of another type.
export class RowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowError";
  }
}

// What a URL asks for; ca is PEM certificates to trust in place of the system's, from sslrootcert.
type Config = { host: string; port: i64; user: string; password: string; database: string; tls: boolean; ca: string; max: i64 };

// One message from the server: its type byte and its body.
type Message = { kind: u8; body: u8[] };

// What a statement gave back: its columns' names and type OIDs, each row's values as the server's
// text, null for SQL's NULL, and the command's tag.
type Outcome = { names: string[]; types: i64[]; rows: (u8[] | null)[][]; tag: string };

function put32(out: Mut<u8[]>, n: i64) {
  out.push(((n >> 24) & 255) as u8);
  out.push(((n >> 16) & 255) as u8);
  out.push(((n >> 8) & 255) as u8);
  out.push((n & 255) as u8);
}

function put16(out: Mut<u8[]>, n: i64) {
  out.push(((n >> 8) & 255) as u8);
  out.push((n & 255) as u8);
}

function putText(out: Mut<u8[]>, s: string) {
  for (const b of new TextEncoder().encode(s)) out.push(b);
}

function putCString(out: Mut<u8[]>, s: string) {
  putText(out, s);
  out.push(0);
}

// A message of kind, or the untyped startup ones when kind is 0, with its length in front.
function framed(kind: u8, body: Ref<u8[]>): u8[] {
  let out: u8[] = [];
  if (kind !== 0) out.push(kind);
  put32(out, (body.length as i64) + 4);
  for (const b of body) out.push(b);
  return out;
}

function get32(bytes: Ref<u8[]>, at: i64): i64 {
  const i = at as usize;
  const n = ((bytes[i] as i64) << 24) | ((bytes[i + 1] as i64) << 16) | ((bytes[i + 2] as i64) << 8) | (bytes[i + 3] as i64);
  return n >= 2147483648 ? n - 4294967296 : n;
}

function get16(bytes: Ref<u8[]>, at: i64): i64 {
  const i = at as usize;
  return ((bytes[i] as i64) << 8) | (bytes[i + 1] as i64);
}

// The NUL-terminated string starting at an index, and where the next field starts.
function getCString(bytes: Ref<u8[]>, at: i64): [string, i64] {
  let end = at;
  while (end < (bytes.length as i64) && bytes[end as usize] !== 0) end++;
  return [new TextDecoder().decode(bytes.slice(at, end)), end + 1];
}

// An ErrorResponse's fields as the error it reports.
function serverError(body: Ref<u8[]>): PostgresError {
  let at: i64 = 0;
  let code = "";
  let message = "";
  let severity = "";
  let detail: string | null = null;
  while (at < (body.length as i64) && body[at as usize] !== 0) {
    const field = body[at as usize];
    const [value, next] = getCString(body, at + 1);
    if (field === 67) code = value;
    else if (field === 77) message = value;
    else if (field === 86) severity = value;
    else if (field === 68) detail = value;
    at = next;
  }
  return new PostgresError(message, code, detail, severity);
}

function digest(which: i64, key: Ref<u8[]>, data: Ref<u8[]>, rounds: i64): u8[] throws IoError {
  // A pointer is taken to an element, so an empty input is passed as one byte of length 0.
  const k: u8[] = key.length === 0 ? [0 as u8] : key.clone();
  const d: u8[] = data.length === 0 ? [0 as u8] : data.clone();
  let out: u8[] = new Array(32).fill(0 as u8);
  const ok = unsafe { fsh_rt_crypto_digest(which, ptrOf(k[0]), key.length as i64, ptrOf(d[0]), data.length as i64, rounds, mutPtrOf(out[0])) };
  if (ok !== 1) {
    const why = unsafe { fromCString(fsh_rt_crypto_missing()) };
    throw new IoError(why.length > 0 ? "Postgres's password authentication hashes with OpenSSL: " + why : "OpenSSL couldn't hash the password for Postgres's authentication");
  }
  return which === 3 ? out.slice(0, 16) : out;
}

function hmac(key: Ref<u8[]>, data: string): u8[] throws IoError {
  return digest(1, key, new TextEncoder().encode(data), 0);
}

// Throws unless what a message's body holds is what its type promises.
function wellFormed(ok: boolean): void throws IoError {
  if (!ok) throw new IoError("the Postgres server sent a malformed message");
}

class Conn {
  stream: TcpStream;
  // What has been read and not yet taken, from start on.
  buffer: u8[] = [];
  start: i64 = 0;
  // The transaction status of the last ReadyForQuery: idle, in a transaction, or in a failed one.
  status: u8 = 73;

  constructor(stream: TcpStream) {
    this.stream = stream;
  }

  async send(this: Ref<this>, bytes: u8[]): Promise<void> throws IoError | AbortError {
    await this.stream.write(bytes);
  }

  // The next message, past the notices and parameter changes the server sends whenever it likes.
  async next(this: Mut<this>): Promise<Message> throws IoError | AbortError {
    while (true) {
      while (!this.whole()) {
        if (this.start > 0) {
          this.buffer.splice(0, this.start);
          this.start = 0;
        }
        const got = await this.stream.read(65536);
        if (got.length === 0) throw new IoError("the Postgres server closed the connection");
        for (const b of got) this.buffer.push(b);
      }
      const at = this.start;
      const length = get32(this.buffer, at + 1);
      const kind = this.buffer[at as usize];
      this.start = at + 1 + length;
      if (kind === 78 || kind === 83 || kind === 65) continue;
      return { kind: kind, body: this.buffer.slice(at + 5, at + 1 + length) };
    }
  }

  // Whether the buffer holds a whole message from start.
  whole(this: Ref<this>): boolean throws IoError {
    const held = (this.buffer.length as i64) - this.start;
    if (held < 5) return false;
    const length = get32(this.buffer, this.start + 1);
    if (length < 4) throw new IoError("the Postgres server sent a malformed message");
    // Postgres builds no message past MaxAllocSize, 1 GiB, so a longer one isn't Postgres's.
    if (length > 1073741824) throw new IoError("the Postgres server sent a message of " + String(length + 1) + " bytes, more than the 1 GiB Postgres itself can send");
    return held >= 1 + length;
  }

  static async open(config: Ref<Config>): Promise<Conn> throws PostgresError | IoError | AbortError {
    const stream = await TcpStream.connect(config.host, config.port);
    if (config.tls) {
      let request: u8[] = [];
      put32(request, 80877103);
      await stream.write(framed(0, request));
      const answer = await stream.read(1);
      if (answer.length === 0 || answer[0] !== 83) throw new IoError("the Postgres server doesn't take TLS connections, which sslmode=require asks for");
      await __tlsClient(stream, config.host, config.ca, new AbortController().signal);
    }
    let conn = new Conn(stream);
    let start: u8[] = [];
    put32(start, 196608);
    putCString(start, "user");
    putCString(start, config.user);
    putCString(start, "database");
    putCString(start, config.database);
    putCString(start, "client_encoding");
    putCString(start, "UTF8");
    start.push(0);
    await conn.send(framed(0, start));
    await conn.authenticate(config);
    while (true) {
      const m = await conn.next();
      if (m.kind === 90) {
        wellFormed(m.body.length === 1);
        conn.status = m.body[0];
        return conn;
      }
      if (m.kind === 69) throw serverError(m.body);
    }
  }

  async authenticate(this: Mut<this>, config: Ref<Config>): Promise<void> throws PostgresError | IoError | AbortError {
    while (true) {
      const m = await this.next();
      if (m.kind === 69) throw serverError(m.body);
      if (m.kind !== 82) throw new IoError("the Postgres server sent an unexpected message while authenticating");
      wellFormed(m.body.length >= 4);
      const code = get32(m.body, 0);
      if (code === 0) return;
      if (code === 3) await this.password(config.password);
      else if (code === 5) {
        wellFormed(m.body.length >= 8);
        const none: u8[] = [];
        const inner = digest(3, none, new TextEncoder().encode(config.password + config.user), 0).toHex();
        let salted = new TextEncoder().encode(inner);
        for (const b of m.body.slice(4, 8)) salted.push(b);
        await this.password("md5" + digest(3, none, salted, 0).toHex());
      } else if (code === 10) {
        await this.scram(config.password, m.body);
        return;
      } else throw new IoError("the Postgres server asked for an authentication method Fish doesn't support (code " + String(code) + ")");
    }
  }

  async password(this: Ref<this>, text: string): Promise<void> throws IoError | AbortError {
    let body: u8[] = [];
    putCString(body, text);
    await this.send(framed(112, body));
  }

  // SCRAM-SHA-256, RFC 5802 and 7677, without channel binding.
  async scram(this: Mut<this>, password: string, offer: u8[]): Promise<void> throws PostgresError | IoError | AbortError {
    let mechanisms: string[] = [];
    let at: i64 = 4;
    while (at < (offer.length as i64) && offer[at as usize] !== 0) {
      const [name, next] = getCString(offer, at);
      mechanisms.push(name);
      at = next;
    }
    if (!mechanisms.includes("SCRAM-SHA-256")) throw new IoError("the Postgres server offers no SASL mechanism Fish supports, only " + mechanisms.join(", "));
    let random: u8[] = new Array(18).fill(0 as u8);
    unsafe { fsh_rt_random_fill(mutPtrOf(random[0]), 18) };
    const nonce = random.toBase64();
    const first = "n=,r=" + nonce;
    let initial: u8[] = [];
    putCString(initial, "SCRAM-SHA-256");
    const firstBytes = new TextEncoder().encode("n,," + first);
    put32(initial, firstBytes.length as i64);
    for (const b of firstBytes) initial.push(b);
    await this.send(framed(112, initial));

    const challenge = await this.saslStep(11);
    let serverNonce = "";
    let salt = "";
    let rounds: i64 = 0;
    for (const part of challenge.split(",")) {
      if (part.startsWith("r=")) serverNonce = part.slice(2);
      else if (part.startsWith("s=")) salt = part.slice(2);
      else if (part.startsWith("i=")) rounds = parseInt(part.slice(2)) ?? 0;
    }
    let saltBytes: u8[] = [];
    try {
      saltBytes = u8.fromBase64(salt);
    } catch (e) {
      saltBytes = [];
    }
    if (!serverNonce.startsWith(nonce) || saltBytes.length === 0 || rounds <= 0) throw new IoError("the Postgres server sent a malformed SCRAM challenge");
    // Postgres's default is 4096. Ten million is far above any server's setting yet still under a
    // second of hashing; a count near INT_MAX would hold a worker thread for minutes, uncancellably.
    if (rounds > 10000000) throw new IoError("the Postgres server asks for " + String(rounds) + " SCRAM iterations, more than the 10000000 Fish allows, as hashing that many would hold a thread for minutes");
    const salted = digest(2, new TextEncoder().encode(password), saltBytes, rounds);
    const clientKey = hmac(salted, "Client Key");
    const none: u8[] = [];
    const storedKey = digest(0, none, clientKey, 0);
    const final = "c=biws,r=" + serverNonce;
    const message = first + "," + challenge + "," + final;
    const signature = hmac(storedKey, message);
    let proof: u8[] = [];
    for (let i: usize = 0; i < 32; i++) proof.push(clientKey[i] ^ signature[i]);
    let response: u8[] = [];
    putText(response, final + ",p=" + proof.toBase64());
    await this.send(framed(112, response));

    const verdict = await this.saslStep(12);
    const expected = "v=" + hmac(hmac(salted, "Server Key"), message).toBase64();
    if (verdict.split(",")[0] !== expected) throw new IoError("the Postgres server's SCRAM signature doesn't match: it may not know the password");
    const done = await this.next();
    if (done.kind === 69) throw serverError(done.body);
    if (done.kind !== 82 || done.body.length < 4 || get32(done.body, 0) !== 0) throw new IoError("the Postgres server didn't finish SCRAM authentication");
  }

  // The data of the SASL message of the code expected.
  async saslStep(this: Mut<this>, code: i64): Promise<string> throws PostgresError | IoError | AbortError {
    const m = await this.next();
    if (m.kind === 69) throw serverError(m.body);
    if (m.kind !== 82 || m.body.length < 4 || get32(m.body, 0) !== code) throw new IoError("the Postgres server sent an unexpected message during SCRAM authentication");
    return new TextDecoder().decode(m.body.slice(4, m.body.length as i64));
  }

  // Runs sql with params through Parse, Bind, Describe, Execute and Sync, reading every reply up
  // to ReadyForQuery, so the connection is ready for the next even when the server refused it.
  async run(this: Mut<this>, sql: string, params: Ref<SqlValue[]>): Promise<Outcome | PostgresError> throws IoError | AbortError {
    let out: u8[] = [];
    let parse: u8[] = [];
    putCString(parse, "");
    putCString(parse, sql);
    put16(parse, 0);
    for (const b of framed(80, parse)) out.push(b);
    let bind: u8[] = [];
    putCString(bind, "");
    putCString(bind, "");
    put16(bind, 0);
    put16(bind, params.length as i64);
    for (const p of params) {
      const text = sqlText(p);
      if (text === null) put32(bind, -1);
      else {
        const bytes = new TextEncoder().encode(text);
        put32(bind, bytes.length as i64);
        for (const b of bytes) bind.push(b);
      }
    }
    put16(bind, 0);
    for (const b of framed(66, bind)) out.push(b);
    let describe: u8[] = [80, 0];
    for (const b of framed(68, describe)) out.push(b);
    let execute: u8[] = [0];
    put32(execute, 0);
    for (const b of framed(69, execute)) out.push(b);
    const sync: u8[] = [];
    for (const b of framed(83, sync)) out.push(b);
    await this.send(out);

    let outcome: Outcome = { names: [], types: [], rows: [], tag: "" };
    let failed: PostgresError | null = null;
    while (true) {
      const m = await this.next();
      if (m.kind === 90) {
        wellFormed(m.body.length === 1);
        this.status = m.body[0];
        const refused = failed;
        if (refused !== null) return refused;
        return outcome;
      }
      if (m.kind === 69) failed = serverError(m.body);
      else if (m.kind === 84) {
        const size = m.body.length as i64;
        wellFormed(size >= 2);
        const count = get16(m.body, 0);
        let at: i64 = 2;
        for (let i: i64 = 0; i < count; i++) {
          const [name, next] = getCString(m.body, at);
          wellFormed(next + 18 <= size);
          outcome.names.push(name);
          outcome.types.push(get32(m.body, next + 6));
          at = next + 18;
        }
      } else if (m.kind === 68) {
        const size = m.body.length as i64;
        wellFormed(size >= 2 && get16(m.body, 0) === (outcome.names.length as i64));
        let at: i64 = 2;
        let row: (u8[] | null)[] = [];
        for (let i: usize = 0; i < outcome.names.length; i++) {
          wellFormed(at + 4 <= size);
          const length = get32(m.body, at);
          at += 4;
          if (length < 0) row.push(null);
          else {
            wellFormed(at + length <= size);
            row.push(m.body.slice(at, at + length));
            at += length;
          }
        }
        outcome.rows.push(row);
      } else if (m.kind === 67) {
        const [tag, _] = getCString(m.body, 0);
        outcome.tag = tag;
      } else if (m.kind === 71) {
        // COPY FROM STDIN waits for data no query gives, so it is refused, and the server goes on.
        let body: u8[] = [];
        putCString(body, "COPY FROM STDIN isn't supported by Fish's postgres module");
        await this.send(framed(102, body));
      }
    }
  }

  // Ends a transaction left open, or failed, by a statement run on the pool.
  async rollback(this: Mut<this>): Promise<void> throws IoError | AbortError {
    let body: u8[] = [];
    putCString(body, "ROLLBACK");
    await this.send(framed(81, body));
    while (true) {
      const m = await this.next();
      if (m.kind === 90) {
        wellFormed(m.body.length === 1);
        this.status = m.body[0];
        return;
      }
    }
  }
}

// A parameter as the text Postgres reads it from, or null for SQL's NULL.
function sqlText(p: Ref<SqlValue>): string | null {
  if (p === null) return null;
  if (typeof p === "boolean") return p ? "true" : "false";
  if (typeof p === "string") return p;
  if (typeof p === "number") {
    // An i64 or an f64, which JSON writes as they are, but for the floats it has no number for.
    const text = JSON.stringify(p);
    if (text !== "null") return text;
    const infinity: f64 = 1e300 * 1e300;
    return p === infinity ? "Infinity" : p === -infinity ? "-Infinity" : "NaN";
  }
  if (p instanceof Date) return p.toISOString();
  return "\\x" + p.toHex();
}

// A column's text as the JSON a row is read through, by its type's OID.
function columnJson(type: i64, value: Ref<u8[] | null>): string {
  if (value === null) return "null";
  const text = new TextDecoder().decode(value);
  if (type === 16) return text === "t" ? "true" : "false";
  if (type === 20 || type === 21 || type === 23 || type === 26) return text;
  if (type === 700 || type === 701) return text === "NaN" || text.endsWith("Infinity") ? JSON.stringify(text) : text;
  if (type === 114 || type === 3802) return text;
  if (type === 17) {
    try {
      return JSON.stringify(u8.fromHex(text.slice(2)));
    } catch (e) {
      return JSON.stringify(text);
    }
  }
  return JSON.stringify(text);
}

function rowsAs<T>(outcome: Ref<Outcome>): T[] throws RowError {
  let rows: T[] = [];
  for (const row of outcome.rows) {
    let json = "{";
    for (let i: usize = 0; i < outcome.names.length; i++) {
      if (i > 0) json += ",";
      json += JSON.stringify(outcome.names[i]) + ":" + columnJson(outcome.types[i], row[i]);
    }
    json += "}";
    try {
      rows.push(JSON.parse<T>(json));
    } catch (e) {
      throw new RowError(rowMessage(e.message, outcome.names, row));
    }
  }
  return rows;
}

// A JSON reading error put in terms of columns: "missing field 'x' at $" is column x missing,
// and "... at $.x" is about column x, which may be a null its field can't hold.
function rowMessage(message: string, names: Ref<string[]>, row: Ref<(u8[] | null)[]>): string {
  if (message.startsWith("missing field ")) {
    const end = message.lastIndexOf(" at ");
    return "the row has no column " + message.slice("missing field ".length as i64, end) + ", which the type reads";
  }
  const at = message.indexOf(" at $.");
  if (at < 0) return "the row can't be read: " + message;
  const column = message.slice(at + 6);
  const i = names.indexOf(column);
  if (i >= 0 && row[i as usize] === null) return "column '" + column + "' is null, which its field can't hold; type it 'T | null'";
  return "column '" + column + "': " + message.slice(0, at);
}

// The affected-row count at the end of a command tag, as in "UPDATE 3", or 0.
function affected(tag: string): i64 {
  const parts = tag.split(" ");
  return parseInt(parts[parts.length - 1]) ?? 0;
}

// A URL's percent-encoded user, password or database name, decoded as a query's values are, but
// for '+', which stays itself.
function decoded(text: string): string {
  return new URLSearchParams("v=" + text.replaceAll("+", "%2B")).get("v") ?? "";
}

// A postgres:// URL read as what to connect to and how: user, password, host, port and database,
// then sslmode, sslrootcert and max, the pool's size, from its query.
function config(url: string): Config throws TypeError | IoError {
  let u = new URL("postgres://localhost");
  try {
    u = new URL(url);
  } catch (e) {
    // The URL itself isn't repeated, as it may hold a password.
    throw new TypeError("the Postgres URL can't be read as a URL: " + e.message);
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new TypeError("a Postgres URL starts with postgres:// or postgresql://, not " + u.protocol);
  const port = u.port.length === 0 ? 5432 : parseInt(u.port) ?? 5432;
  const user = decoded(u.username);
  const password = decoded(u.password);
  const database = decoded(u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname);
  const sslmode = u.searchParams.get("sslmode") ?? "disable";
  if (sslmode !== "disable" && sslmode !== "require" && sslmode !== "verify-full") throw new TypeError("sslmode is 'disable', 'require' or 'verify-full', not '" + sslmode + "'");
  const root = u.searchParams.get("sslrootcert");
  const ca = root === null ? "" : new TextDecoder().decode(fileReadSync(root));
  const maxText = u.searchParams.get("max") ?? "10";
  const max = parseInt(maxText) ?? 0;
  if (max < 1) throw new TypeError("max, the pool's size, is a whole number of at least 1, not '" + maxText + "'");
  const host = u.hostname.startsWith("[") ? u.hostname.slice(1, (u.hostname.length as i64) - 1) : u.hostname;
  return { host: host.length === 0 ? "localhost" : host, port: port, user: user, password: password, database: database.length === 0 ? user : database, tls: sslmode !== "disable", ca: ca, max: max };
}

type Shared = { gate: Semaphore; idle: Lock<Conn[]> };

// Connections to one server, at most max of them, each running one statement at a time. A caller
// takes an idle one or opens one, and waits in turn when all max are busy; a connection that breaks
// is dropped, and the next caller opens a new one. Clones share the connections.
export class Pool {
  private config: Config;
  private state: shared<Shared>;

  private constructor(config: Config, state: shared<Shared>) {
    this.config = config;
    this.state = state;
  }

  // A pool for the server url names, with one connection opened now, so a wrong address or
  // password fails here.
  static async connect(url: string): Promise<Pool> throws PostgresError | IoError | AbortError | TypeError {
    const c = config(url);
    const conn = await Conn.open(c);
    const idle: Conn[] = [conn];
    const gate = new Semaphore(c.max);
    return new Pool(c, shared<Shared>({ gate: gate, idle: new Lock<Conn[]>(idle) }));
  }

  // The rows sql gives, each read by column name into a T.
  async query<T>(this: Ref<this>, sql: string, params: SqlValue[] = []): Promise<T[]> throws PostgresError | RowError | IoError | AbortError {
    const outcome = await this.run(sql, params);
    return rowsAs<T>(outcome);
  }

  // The first row sql gives as a T, or null when it gives none.
  async queryOne<T>(this: Ref<this>, sql: string, params: SqlValue[] = []): Promise<T | null> throws PostgresError | RowError | IoError | AbortError {
    let rows = await this.query<T>(sql, params);
    let first = rows.splice(0, 1);
    return first.pop();
  }

  // How many rows sql inserted, updated, deleted or gave.
  async execute(this: Ref<this>, sql: string, params: SqlValue[] = []): Promise<i64> throws PostgresError | IoError | AbortError {
    const outcome = await this.run(sql, params);
    return affected(outcome.tag);
  }

  private async run(this: Ref<this>, sql: string, params: Ref<SqlValue[]>): Promise<Outcome> throws PostgresError | IoError | AbortError {
    const state = this.state.clone();
    const _permit = await state.gate.acquire();
    const idle = state.idle.update((cs) => cs.pop());
    let conn: Conn;
    if (idle === null) conn = await Conn.open(this.config);
    else conn = idle;
    const result = await conn.run(sql, params);
    // The server answered, so the connection is whole: it goes back once it is idle again. A
    // transaction the statement began, or one it failed, is rolled back, since the pool's next
    // statement may run on another connection.
    if (conn.status !== 73) await conn.rollback();
    if (conn.status === 73) state.idle.update((cs) => cs.push(conn));
    if (result instanceof PostgresError) throw result;
    return result;
  }
}
`,
  // Redis over RESP2, as node-redis's createClient shapes it: commands on a pool of connections,
  // and publish and subscribe.
  // JSON Web Tokens and password hashes over OpenSSL, whose calls live in the TLS half of the
  // runtime: signJwt, verifyJwt, hashPassword and verifyPassword, with sync forms of the last two.
  auth: String.raw`import { randomBytes } from "crypto";

declare function fsh_rt_crypto_sign(which: i64, key: Ptr<u8>, keyLength: i64, data: Ptr<u8>, length: i64, out: MutPtr<u8>): i64;
declare function fsh_rt_crypto_verify(which: i64, key: Ptr<u8>, keyLength: i64, data: Ptr<u8>, length: i64, sig: Ptr<u8>, sigLength: i64): i64;
declare function fsh_rt_crypto_kdf(kind: i64, password: Ptr<u8>, passwordLength: i64, salt: Ptr<u8>, saltLength: i64, a: i64, b: i64, c: i64, out: MutPtr<u8>, outLength: i64): i64;
declare function fsh_rt_crypto_missing(): Ptr<u8>;

export type JwtAlgorithm = "HS256" | "HS384" | "HS512" | "RS256" | "ES256" | "EdDSA";

// Why a token was refused, with a code to branch on: "malformed", "algorithm", "key",
// "signature", "expired", "notBefore", "audience", "issuer" or "claims".
export class JwtError {
  name: string = "JwtError";
  message: string;
  code: string;
  constructor(code: string, message: string) {
    this.code = code;
    this.message = message;
  }
}

// A stored password hash that can't be read, or a hash this OpenSSL can't make.
export class PasswordError {
  name: string = "PasswordError";
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export type SignJwtOptions = { alg?: JwtAlgorithm; expiresIn?: i64; notBefore?: i64; audience?: string; issuer?: string; subject?: string };
export type VerifyJwtOptions = { algorithms: JwtAlgorithm[]; audience?: string; issuer?: string; clockTolerance?: i64 };

const __JWT_ALGORITHMS: JwtAlgorithm[] = ["HS256", "HS384", "HS512", "RS256", "ES256", "EdDSA"];

function __jwtNumber(alg: JwtAlgorithm): i64 {
  return __JWT_ALGORITHMS.indexOf(alg);
}

function __b64url(bytes: Ref<u8[]>): string {
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

function __unb64url(text: string, what: string): u8[] throws JwtError {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new JwtError("malformed", "the token's " + what + " isn't base64url");
  try {
    return u8.fromBase64(text, { alphabet: "base64url" });
  } catch (e) {
    throw new JwtError("malformed", "the token's " + what + " isn't base64url");
  }
}

// A pointer is taken to an element, so an empty input is passed as one byte of length 0.
function __bytesOrOne(b: Ref<u8[]>): u8[] {
  return b.length === 0 ? [0 as u8] : b.clone();
}

function __cryptoMissing(): string {
  return unsafe { fromCString(fsh_rt_crypto_missing()) };
}

function __objectOf(text: string, what: string): Map<string, Json> throws JwtError {
  let v: Json = null;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new JwtError(what === "claims" ? "claims" : "malformed", "the token's " + what + " isn't JSON: " + e.message);
  }
  if (v instanceof Map) return v;
  throw new JwtError(what === "claims" ? "claims" : "malformed", "the token's " + what + " must be a JSON object");
}

// Each claim the options give, set where the claims don't already have it.
function __withClaim(m: Mut<Map<string, Json>>, name: string, value: Json): void throws JwtError {
  if (m.has(name)) throw new JwtError("claims", "the claims already hold '" + name + "', which the options set too; give it in one place");
  m.set(name, value);
}

// A signed token for the claims, which serialize as a JSON object. HS algorithms take the shared
// secret; RS256, ES256 and EdDSA take a PEM private key.
export function signJwt<T>(claims: Ref<T>, key: string | u8[], options?: SignJwtOptions): string throws JwtError {
  const alg: JwtAlgorithm = options?.alg ?? "HS256";
  let m = __objectOf(JSON.stringify(claims), "claims");
  const now = Date.now() / 1000;
  if (!m.has("iat")) m.set("iat", now as f64);
  const expiresIn = options?.expiresIn;
  if (expiresIn !== undefined) __withClaim(m, "exp", (now + expiresIn) as f64);
  const notBefore = options?.notBefore;
  if (notBefore !== undefined) __withClaim(m, "nbf", (now + notBefore) as f64);
  const audience = options?.audience;
  if (audience !== undefined) __withClaim(m, "aud", audience);
  const issuer = options?.issuer;
  if (issuer !== undefined) __withClaim(m, "iss", issuer);
  const subject = options?.subject;
  if (subject !== undefined) __withClaim(m, "sub", subject);
  const enc = new TextEncoder();
  const input = __b64url(enc.encode('{"alg":"' + alg + '","typ":"JWT"}')) + "." + __b64url(enc.encode(JSON.stringify(m)));
  const k: u8[] = typeof key === "string" ? enc.encode(key) : key;
  if (k.length === 0) throw new JwtError("key", "signJwt needs a non-empty key");
  const data = enc.encode(input);
  let out: u8[] = new Array(1024).fill(0 as u8);
  const n = unsafe { fsh_rt_crypto_sign(__jwtNumber(alg), ptrOf(k[0]), k.length as i64, ptrOf(data[0]), data.length as i64, mutPtrOf(out[0])) };
  if (n === -2) throw new JwtError("key", "JWT signing needs OpenSSL: " + __cryptoMissing());
  if (n < 0) throw new JwtError("key", alg.startsWith("HS") ? "OpenSSL couldn't sign with the secret" : "the key isn't a PEM private key " + alg + " signs with (" + (alg === "RS256" ? "RSA of 2048 bits or more" : alg === "ES256" ? "EC on P-256" : "Ed25519") + ")");
  return input + "." + __b64url(out.slice(0, n));
}

function __numberClaim(m: Ref<Map<string, Json>>, name: string): f64 | null throws JwtError {
  const v = m.get(name);
  if (v === null) return null;
  if (typeof v === "number") return v;
  throw new JwtError("claims", "the token's '" + name + "' claim isn't a number of seconds");
}

// The token's claims as T, once its signature checks under the key with one of the algorithms
// given, it hasn't expired, and its audience and issuer are the ones asked for. HS algorithms
// take the shared secret; RS256, ES256 and EdDSA a PEM public key.
export function verifyJwt<T>(token: string, key: string | u8[], options: VerifyJwtOptions): T throws JwtError {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed", "a JWT has three parts separated by '.', this has " + String(parts.length));
  const dec = new TextDecoder();
  const header = __objectOf(dec.decode(__unb64url(parts[0], "header")), "header");
  const named = header.get("alg");
  if (typeof named !== "string") throw new JwtError("malformed", "the token's header names no 'alg'");
  let alg: JwtAlgorithm | null = null;
  for (const a of options.algorithms) if (a === named) alg = a;
  if (alg === null) throw new JwtError("algorithm", "the token is signed with '" + named + "', which isn't one of the algorithms allowed: " + options.algorithms.join(", "));
  if (header.has("crit")) throw new JwtError("malformed", "the token's header has critical extensions, which verifyJwt doesn't know");
  const enc = new TextEncoder();
  const k: u8[] = typeof key === "string" ? enc.encode(key) : key;
  if (k.length === 0) throw new JwtError("key", "verifyJwt needs a non-empty key");
  const data = enc.encode(parts[0] + "." + parts[1]);
  const raw = __unb64url(parts[2], "signature");
  const sig = __bytesOrOne(raw);
  const ok = unsafe { fsh_rt_crypto_verify(__jwtNumber(alg!), ptrOf(k[0]), k.length as i64, ptrOf(data[0]), data.length as i64, ptrOf(sig[0]), raw.length as i64) };
  if (ok === -2) throw new JwtError("key", "JWT verification needs OpenSSL: " + __cryptoMissing());
  if (ok === -1) throw new JwtError("key", "the key isn't a PEM public key " + alg! + " verifies with");
  if (ok !== 1) throw new JwtError("signature", "the token's signature doesn't match");
  const payload = dec.decode(__unb64url(parts[1], "payload"));
  const claims = __objectOf(payload, "claims");
  const now = (Date.now() as f64) / 1000.0;
  const tolerance = (options.clockTolerance ?? 0) as f64;
  const exp = __numberClaim(claims, "exp");
  if (exp !== null && now >= exp + tolerance) throw new JwtError("expired", "the token expired at " + String(exp));
  const nbf = __numberClaim(claims, "nbf");
  if (nbf !== null && now + tolerance < nbf) throw new JwtError("notBefore", "the token isn't valid before " + String(nbf));
  const audience = options.audience;
  if (audience !== undefined) {
    const aud = claims.get("aud");
    let found = false;
    if (typeof aud === "string") found = aud === audience;
    else if (Array.isArray(aud)) for (const a of aud) if (typeof a === "string" && a === audience) found = true;
    if (!found) throw new JwtError("audience", "the token isn't for the audience '" + audience + "'");
  }
  const issuer = options.issuer;
  if (issuer !== undefined) {
    const iss = claims.get("iss");
    if (typeof iss !== "string" || iss !== issuer) throw new JwtError("issuer", "the token wasn't issued by '" + issuer + "'");
  }
  try {
    return JSON.parse<T>(payload);
  } catch (e) {
    throw new JwtError("claims", "the token's claims don't fit the type asked for: " + e.message);
  }
}

function __kdf(kind: i64, password: string, salt: Ref<u8[]>, a: i64, b: i64, c: i64, length: i64): u8[] throws PasswordError {
  const pw = new TextEncoder().encode(password);
  const p = __bytesOrOne(pw);
  let out: u8[] = new Array(length).fill(0 as u8);
  const ok = unsafe { fsh_rt_crypto_kdf(kind, ptrOf(p[0]), pw.length as i64, ptrOf(salt[0]), salt.length as i64, a, b, c, mutPtrOf(out[0]), length) };
  if (ok === -2) throw new PasswordError("password hashing needs OpenSSL: " + __cryptoMissing());
  if (ok === -1) throw new PasswordError("argon2id needs OpenSSL 3.2 or newer; upgrade it and build the program again");
  if (ok !== 1) throw new PasswordError("OpenSSL refused the hash's parameters");
  return out;
}

// An argon2id hash of the password as a PHC string, with OWASP's minimum parameters (19 MiB, two
// passes, one lane) and a random 16-byte salt. It runs on the blocking pool.
export async function hashPassword(password: string): Promise<string> throws PasswordError {
  const made = await spawnBlocking(() => __hashPassword(password));
  return made;
}

// The same hash made on the calling thread, for code with no runtime running, such as a CLI tool;
// in an async function it holds its worker for the whole hash, so use hashPassword there.
export function hashPasswordSync(password: string): string throws PasswordError {
  return __hashPassword(password);
}

function __hashPassword(password: string): string throws PasswordError {
  const salt = randomBytes(16);
  const hash = __kdf(0, password, salt, 19456, 2, 1, 32);
  return "$argon2id$v=19$m=19456,t=2,p=1$" + salt.toBase64({ omitPadding: true }) + "$" + hash.toBase64({ omitPadding: true });
}

// Whether the password is the one hashed, for argon2id and scrypt PHC strings. Run on the
// blocking pool, the comparison taking the same time wherever the bytes differ.
export async function verifyPassword(password: string, hash: string): Promise<boolean> throws PasswordError {
  const same = await spawnBlocking(() => __verifyPassword(password, hash));
  return same;
}

// The same check made on the calling thread, for code with no runtime running; in an async
// function use verifyPassword.
export function verifyPasswordSync(password: string, hash: string): boolean throws PasswordError {
  return __verifyPassword(password, hash);
}

function __phcParams(text: string, names: string[]): i64[] throws PasswordError {
  let out: i64[] = [];
  const parts = text.split(",");
  if (parts.length !== names.length) throw new PasswordError("the hash's parameters aren't " + names.join(", "));
  for (let i: usize = 0; i < names.length; i++) {
    const kv = parts[i].split("=");
    const n = kv.length === 2 && kv[0] === names[i] && /^[0-9]{1,10}$/.test(kv[1]) ? parseInt(kv[1]) : null;
    if (n === null) throw new PasswordError("the hash's parameters aren't " + names.join(", "));
    out.push(n);
  }
  return out;
}

function __phcBytes(text: string): u8[] throws PasswordError {
  if (!/^[A-Za-z0-9+/]+$/.test(text)) throw new PasswordError("the hash's salt or digest isn't base64");
  try {
    return u8.fromBase64(text);
  } catch (e) {
    throw new PasswordError("the hash's salt or digest isn't base64");
  }
}

function __verifyPassword(password: string, hash: string): boolean throws PasswordError {
  const f = hash.split("$");
  let kind: i64 = 0;
  let a: i64 = 0;
  let b: i64 = 0;
  let c: i64 = 0;
  let salt: u8[] = [];
  let want: u8[] = [];
  if (f.length === 6 && f[0] === "" && f[1] === "argon2id" && f[2] === "v=19") {
    const p = __phcParams(f[3], ["m", "t", "p"]);
    if (p[0] < 8 || p[0] > 4194304 || p[1] < 1 || p[1] > 1000 || p[2] < 1 || p[2] > 255) throw new PasswordError("the argon2id hash's parameters are out of range");
    a = p[0];
    b = p[1];
    c = p[2];
    salt = __phcBytes(f[4]);
    want = __phcBytes(f[5]);
  } else if (f.length === 5 && f[0] === "" && f[1] === "scrypt") {
    kind = 1;
    const p = __phcParams(f[2], ["ln", "r", "p"]);
    if (p[0] < 1 || p[0] > 24 || p[1] < 1 || p[1] > 64 || p[2] < 1 || p[2] > 64) throw new PasswordError("the scrypt hash's parameters are out of range");
    a = 1 << p[0];
    b = p[1];
    c = p[2];
    salt = __phcBytes(f[3]);
    want = __phcBytes(f[4]);
  } else throw new PasswordError("the hash isn't an argon2id or scrypt PHC string");
  if (salt.length < 8 || want.length < 16 || want.length > 128) throw new PasswordError("the hash's salt or digest is too short");
  const got = __kdf(kind, password, salt, a, b, c, want.length as i64);
  let diff: u8 = 0;
  for (let i: usize = 0; i < want.length; i++) diff = diff | (got[i] ^ want[i]);
  return diff === 0;
}
`,
  redis: String.raw`// A reply as the server gives it: a status or bulk string, an integer, an array, or nil.
export type RedisReply = null | string | i64 | RedisReply[];

// An error reply from the server, as "WRONGTYPE Operation against a key ...": its message, and its
// first word as the code.
export class RedisError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = "RedisError";
    const space = message.indexOf(" ");
    this.code = space < 0 ? message : message.slice(0, space);
  }
}

// url is redis://[user:password@]host[:port][/database], or rediss:// over TLS; poolSize is how
// many connections the client keeps at most.
export type RedisClientOptions = { url?: string; poolSize?: i64 };
// SET's options: a lifetime in seconds or milliseconds, and setting only when the key is missing
// or only when it is there.
export type SetOptions = { EX?: i64; PX?: i64; NX?: boolean; XX?: boolean };
// A message published to a channel the subscriber listens on.
export type RedisMessage = { channel: string; message: string };

type Config = { host: string; port: i64; user: string; password: string; database: i64; tls: boolean; max: i64 };

// One connection, holding what it read past the last reply.
class Conn {
  stream: TcpStream;
  buffer: u8[] = [];

  constructor(stream: TcpStream) {
    this.stream = stream;
  }

  // A connection to the server, signed in and on its database.
  static async open(c: Ref<Config>): Promise<Conn> throws RedisError | IoError | AbortError {
    const stream = await TcpStream.connect(c.host, c.port);
    if (c.tls) await __tlsClient(stream, c.host, "", new AbortController().signal);
    let conn = new Conn(stream);
    if (c.password.length > 0) {
      const auth: string[] = c.user.length > 0 ? ["AUTH", c.user, c.password] : ["AUTH", c.password];
      await conn.call(auth);
    }
    if (c.database !== 0) {
      const select: string[] = ["SELECT", String(c.database)];
      await conn.call(select);
    }
    return conn;
  }

  // Sends a command and reads its reply, an error reply thrown.
  async call(this: Mut<this>, args: Ref<string[]>): Promise<RedisReply> throws RedisError | IoError | AbortError {
    await this.stream.write(encode(args));
    const reply = await this.reply();
    if (reply instanceof RedisError) throw reply;
    return reply;
  }

  // The next reply, an error reply given rather than thrown.
  async reply(this: Mut<this>): Promise<RedisReply | RedisError> throws IoError | AbortError {
    while (true) {
      const parsed = parse(this.buffer, 0);
      if (parsed !== null) {
        const rest = this.buffer.splice(parsed.next);
        this.buffer = rest;
        return parsed.value;
      }
      const got = await this.stream.read(65536);
      if (got.length === 0) throw new IoError("the Redis server closed the connection");
      for (const b of got) this.buffer.push(b);
    }
  }
}

// A command as RESP sends it: an array of bulk strings.
function encode(args: Ref<string[]>): u8[] {
  let out = new TextEncoder().encode("*" + String(args.length as i64) + "\r\n");
  for (const arg of args) {
    const bytes = new TextEncoder().encode(arg);
    for (const b of new TextEncoder().encode("$" + String(bytes.length as i64) + "\r\n")) out.push(b);
    for (const b of bytes) out.push(b);
    out.push(13);
    out.push(10);
  }
  return out;
}

type Parsed = { value: RedisReply | RedisError; next: i64 };

// Where the line starting at an index ends, at its CR, or -1 when its CR LF hasn't come yet.
function lineEnd(b: Ref<u8[]>, at: i64): i64 {
  for (let i = at; i + 1 < (b.length as i64); i++) if (b[i as usize] === 13 && b[(i + 1) as usize] === 10) return i;
  return -1;
}

// The reply starting at an index and where the next one starts, or null when it hasn't all come.
// An error inside an array stands for the whole reply, as the client only gives it to throw.
// ponytail: a reply is parsed again from its start after each read; a parser keeping its place
// would read a large reply in one pass.
function parse(b: Ref<u8[]>, at: i64): Parsed | null {
  const end = lineEnd(b, at);
  if (end < 0) return null;
  const kind = b[at as usize];
  const line = new TextDecoder().decode(b.slice(at + 1, end));
  const next = end + 2;
  if (kind === 43) return { value: line, next: next };
  if (kind === 45) return { value: new RedisError(line), next: next };
  if (kind === 58) return { value: parseInt(line) ?? 0, next: next };
  if (kind === 36) {
    const n = parseInt(line) ?? -1;
    if (n < 0) return { value: null, next: next };
    if ((b.length as i64) < next + n + 2) return null;
    return { value: new TextDecoder().decode(b.slice(next, next + n)), next: next + n + 2 };
  }
  if (kind === 42) {
    const n = parseInt(line) ?? -1;
    if (n < 0) return { value: null, next: next };
    let items: RedisReply[] = [];
    let failed: RedisError | null = null;
    let at2 = next;
    for (let i = 0; i < n; i++) {
      const item = parse(b, at2);
      if (item === null) return null;
      at2 = item.next;
      const v = item.value;
      if (v instanceof RedisError) failed = v;
      else items.push(v);
    }
    if (failed !== null) return { value: failed, next: at2 };
    return { value: items, next: at2 };
  }
  return { value: new RedisError("ERR the server sent a reply this client can't read, starting with byte " + String(kind as i64)), next: next };
}

// A redis:// or rediss:// URL as what to connect to.
function config(url: string, max: i64): Config throws TypeError {
  let u = new URL("redis://localhost");
  try {
    u = new URL(url);
  } catch (e) {
    // The URL itself isn't repeated, as it may hold a password.
    throw new TypeError("the Redis URL can't be read as a URL: " + e.message);
  }
  if (u.protocol !== "redis:" && u.protocol !== "rediss:") throw new TypeError("a Redis URL starts with redis:// or rediss://, not " + u.protocol);
  const port = u.port.length === 0 ? 6379 : parseInt(u.port) ?? 6379;
  const path = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
  const database = path.length === 0 ? 0 : parseInt(path) ?? -1;
  if (database < 0) throw new TypeError("a Redis URL's path is the database's number, not '" + path + "'");
  if (max < 1) throw new TypeError("poolSize is a whole number of at least 1, not " + String(max));
  const host = u.hostname.startsWith("[") ? u.hostname.slice(1, (u.hostname.length as i64) - 1) : u.hostname;
  return { host: host.length === 0 ? "localhost" : host, port: port, user: unescaped(u.username), password: unescaped(u.password), database: database, tls: u.protocol === "rediss:", max: max };
}

type Shared = { gate: Semaphore; idle: Lock<Conn[]> };

// A client of one server, as node-redis's createClient gives: commands run on a pool of
// connections, at most poolSize, each running one command at a time; a connection that breaks is
// dropped and the next command opens another. Clones share the pool.
export class RedisClient {
  private config: Config;
  private state: shared<Shared>;

  constructor(config: Config) {
    const idle: Conn[] = [];
    this.state = shared<Shared>({ gate: new Semaphore(config.max), idle: new Lock<Conn[]>(idle) });
    this.config = config;
  }

  // Opens a connection now, so a wrong address or password fails here rather than at the first command.
  async connect(this: Ref<this>): Promise<void> throws RedisError | IoError | AbortError {
    const conn = await Conn.open(this.config);
    this.state.idle.update((cs) => cs.push(conn));
  }

  // Any command, as its words, and the reply the server gives.
  async sendCommand(this: Ref<this>, args: string[]): Promise<RedisReply> throws RedisError | IoError | AbortError {
    const state = this.state.clone();
    const _permit = await state.gate.acquire();
    const idle = state.idle.update((cs) => cs.pop());
    let conn: Conn;
    if (idle === null) conn = await Conn.open(this.config);
    else conn = idle;
    await conn.stream.write(encode(args));
    const reply = await conn.reply();
    // The server answered, so the connection is whole and goes back to the pool.
    state.idle.update((cs) => cs.push(conn));
    if (reply instanceof RedisError) throw reply;
    return reply;
  }

  async ping(this: Ref<this>): Promise<string> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["PING"]);
    return asText(reply);
  }

  // The string at a key, or null when there is none.
  async get(this: Ref<this>, key: string): Promise<string | null> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["GET", key]);
    if (reply === null) return null;
    return asText(reply);
  }

  // "OK", or null when NX or XX kept it from setting.
  async set(this: Ref<this>, key: string, value: string, options: SetOptions = {}): Promise<string | null> throws RedisError | IoError | AbortError {
    let args: string[] = ["SET", key, value];
    const ex = options.EX;
    if (ex !== null) {
      args.push("EX");
      args.push(String(ex));
    }
    const px = options.PX;
    if (px !== null) {
      args.push("PX");
      args.push(String(px));
    }
    if (options.NX === true) args.push("NX");
    if (options.XX === true) args.push("XX");
    const reply = await this.sendCommand(args);
    if (reply === null) return null;
    return asText(reply);
  }

  async incr(this: Ref<this>, key: string): Promise<i64> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["INCR", key]);
    return asInteger(reply);
  }

  async incrBy(this: Ref<this>, key: string, by: i64): Promise<i64> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["INCRBY", key, String(by)]);
    return asInteger(reply);
  }

  async decr(this: Ref<this>, key: string): Promise<i64> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["DECR", key]);
    return asInteger(reply);
  }

  // How many of the keys there were to delete.
  async del(this: Ref<this>, keys: string | string[]): Promise<i64> throws RedisError | IoError | AbortError {
    let args: string[] = ["DEL"];
    if (typeof keys === "string") args.push(keys);
    else for (const k of keys) args.push(k);
    const reply = await this.sendCommand(args);
    return asInteger(reply);
  }

  async exists(this: Ref<this>, key: string): Promise<boolean> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["EXISTS", key]);
    return asInteger(reply) === 1;
  }

  // Whether the key was there to be given a lifetime of seconds.
  async expire(this: Ref<this>, key: string, seconds: i64): Promise<boolean> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["EXPIRE", key, String(seconds)]);
    return asInteger(reply) === 1;
  }

  // Seconds the key has left, -1 when it has no lifetime and -2 when it isn't there.
  async ttl(this: Ref<this>, key: string): Promise<i64> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["TTL", key]);
    return asInteger(reply);
  }

  // How many subscribers got the message.
  async publish(this: Ref<this>, channel: string, message: string): Promise<i64> throws RedisError | IoError | AbortError {
    const reply = await this.sendCommand(["PUBLISH", channel, message]);
    return asInteger(reply);
  }

  // The messages published to the channels, on a connection of their own that stays subscribed
  // until the loop over them ends.
  async *subscribe(this: Ref<this>, channels: string | string[]): AsyncGenerator<RedisMessage> throws RedisError | IoError | AbortError {
    let conn = await Conn.open(this.config);
    let args: string[] = ["SUBSCRIBE"];
    if (typeof channels === "string") args.push(channels);
    else for (const c of channels) args.push(c);
    await conn.stream.write(encode(args));
    while (true) {
      const reply = await conn.reply();
      if (reply instanceof RedisError) throw reply;
      if (!Array.isArray(reply) || reply.length !== 3) continue;
      const kind = reply[0].clone();
      const channel = reply[1].clone();
      const message = reply[2].clone();
      if (kind === "message" && typeof channel === "string" && typeof message === "string") yield { channel: channel, message: message };
    }
  }

  // Closes the idle connections; a command after this opens new ones.
  close(this: Ref<this>) {
    this.state.idle.update((cs) => { while (cs.length > 0) cs.pop(); });
  }
}

export function createClient(options: RedisClientOptions = {}): RedisClient throws TypeError {
  return new RedisClient(config(options.url ?? "redis://localhost:6379", options.poolSize ?? 10));
}

// A URL's user or password with its percent escapes decoded.
function unescaped(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    if (bytes[i] === 37 && i + 2 < bytes.length) {
      const n = parseInt(new TextDecoder().decode(bytes.slice((i + 1) as i64, (i + 3) as i64)), 16);
      if (n !== null) {
        out.push(n as u8);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  return new TextDecoder().decode(out);
}

function asText(reply: RedisReply): string throws RedisError {
  if (typeof reply === "string") return reply;
  throw new RedisError("ERR the server's reply isn't a string");
}

function asInteger(reply: RedisReply): i64 throws RedisError {
  if (typeof reply === "number") return reply;
  throw new RedisError("ERR the server's reply isn't an integer");
}
`,
  // SQLite through the system's library, which links into a program only when it imports this:
  // statements with parameters bound apart from their text, and rows read by column name into a
  // type, as the postgres module reads them.
  sqlite: String.raw`
declare function fsh_rt_sqlite_database(): i64;
declare function fsh_rt_sqlite_open(db: i64, path: Ptr<u8>): i64;
declare function fsh_rt_sqlite_error(db: i64): Ptr<u8>;
declare function fsh_rt_sqlite_retain(db: i64): void;
declare function fsh_rt_sqlite_release(db: i64): void;
declare function fsh_rt_sqlite_close(db: i64): void;
declare function fsh_rt_sqlite_statement(db: i64): i64;
declare function fsh_rt_sqlite_statement_retain(statement: i64): void;
declare function fsh_rt_sqlite_statement_release(statement: i64): void;
declare function fsh_rt_sqlite_finalize(statement: i64): void;
declare function fsh_rt_sqlite_lock(statement: i64): i64;
declare function fsh_rt_sqlite_unlock(statement: i64, finalize: i64): void;
declare function fsh_rt_sqlite_prepare(statement: i64, sql: Ptr<u8>, length: i64): i64;
declare function fsh_rt_sqlite_reset(statement: i64): i64;
declare function fsh_rt_sqlite_parameters(statement: i64): i64;
declare function fsh_rt_sqlite_bind_null(statement: i64, at: i64): i64;
declare function fsh_rt_sqlite_bind_integer(statement: i64, at: i64, value: i64): i64;
declare function fsh_rt_sqlite_bind_double(statement: i64, at: i64, value: f64): i64;
declare function fsh_rt_sqlite_bind_text(statement: i64, at: i64, text: Ptr<u8>, length: i64): i64;
declare function fsh_rt_sqlite_bind_blob(statement: i64, at: i64, data: Ptr<u8>, length: i64): i64;
declare function fsh_rt_sqlite_step(statement: i64): i64;
declare function fsh_rt_sqlite_row(statement: i64): Ptr<u8>;
declare function fsh_rt_sqlite_changes(statement: i64): i64;
declare function fsh_rt_sqlite_last_insert_rowid(statement: i64): i64;

// A value a statement's ?, ?1 or :name can take: a boolean is bound as 0 or 1, bytes as a BLOB.
export type SqlValue = null | boolean | i64 | f64 | string | u8[];

// What SQLite said went wrong, with its primary result code: 1 for bad SQL, 19 for a constraint.
export class SqliteError extends Error {
  code: i64;
  constructor(message: string, code: i64) {
    super(message);
    this.name = "SqliteError";
    this.code = code;
  }
}

// A row that can't be read as the type asked for: a column it needs is missing, null where the
// field can't be, or of another type.
export class RowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowError";
  }
}

// What a statement that reads no rows did: how many rows it inserted, updated or deleted, and the
// rowid of the connection's last insert.
export type RunResult = { changes: i64; lastInsertRowid: i64 };

// A run's rows, each as the JSON the runtime wrote it as, and its counts.
type Outcome = { rows: string[]; changes: i64; lastInsertRowid: i64 };

// The handles a Statement is made from. A class of this module's own, so that only prepare can
// make a Statement: a number passed for a handle would be read as an address.
class Prepared {
  db: i64;
  statement: i64;
  constructor(db: i64, statement: i64) {
    this.db = db;
    this.statement = statement;
  }
}

function failure(db: i64, code: i64): SqliteError {
  return new SqliteError(unsafe { fromCString(fsh_rt_sqlite_error(db)) }, code);
}

// Text as bytes with a NUL after them, so a pointer can be taken to empty text too.
function terminated(text: string): u8[] {
  let bytes = new TextEncoder().encode(text);
  bytes.push(0);
  return bytes;
}

function bind(statement: i64, at: i64, p: Ref<SqlValue>): i64 {
  if (p === null) return unsafe { fsh_rt_sqlite_bind_null(statement, at) };
  if (typeof p === "boolean") return unsafe { fsh_rt_sqlite_bind_integer(statement, at, p ? 1 : 0) };
  if (typeof p === "string") {
    const bytes = terminated(p);
    return unsafe { fsh_rt_sqlite_bind_text(statement, at, ptrOf(bytes[0]), (bytes.length as i64) - 1) };
  }
  if (typeof p === "number") {
    // A union says whether it holds an i64 or an f64 only by comparing equal to one, so the
    // number's text is read back as an i64: a float is never equal to it.
    const text = JSON.stringify(p);
    const whole = parseInt(text);
    if (whole !== null && p === whole) return unsafe { fsh_rt_sqlite_bind_integer(statement, at, whole) };
    const real = parseFloat(text);
    if (real !== null) return unsafe { fsh_rt_sqlite_bind_double(statement, at, real) };
    // JSON has no text for an infinity or NaN; SQLite stores NaN as NULL.
    const infinity: f64 = 1e300 * 1e300;
    if (p === infinity) return unsafe { fsh_rt_sqlite_bind_double(statement, at, infinity) };
    if (p === -infinity) return unsafe { fsh_rt_sqlite_bind_double(statement, at, -infinity) };
    return unsafe { fsh_rt_sqlite_bind_null(statement, at) };
  }
  const none: u8[] = [0 as u8];
  return p.length === 0
    ? unsafe { fsh_rt_sqlite_bind_blob(statement, at, ptrOf(none[0]), 0) }
    : unsafe { fsh_rt_sqlite_bind_blob(statement, at, ptrOf(p[0]), p.length as i64) };
}

// Binds params and steps the statement to its end, or to its first row when one is wanted,
// keeping the rows wanted: -1 for all, 0 for none. It holds the connection's lock, so it gives
// its failure back rather than throwing past the unlock.
function stepped(db: i64, statement: i64, params: Ref<SqlValue[]>, wanted: i64, out: Mut<Outcome>): SqliteError | null {
  const takes = unsafe { fsh_rt_sqlite_parameters(statement) };
  const given = params.length as i64;
  if (takes !== given) return new SqliteError("the statement takes " + String(takes) + (takes === 1 ? " parameter" : " parameters") + ", but " + String(given) + (given === 1 ? " was" : " were") + " given", 25);
  let at: i64 = 1;
  for (const p of params) {
    const code = bind(statement, at, p);
    if (code !== 0) return failure(db, code);
    at += 1;
  }
  while (true) {
    const code = unsafe { fsh_rt_sqlite_step(statement) };
    if (code === 101) break;
    if (code !== 100) return failure(db, code);
    if (wanted === 0) continue;
    out.rows.push(unsafe { fromCString(fsh_rt_sqlite_row(statement)) });
    if (wanted === 1) break;
  }
  out.changes = unsafe { fsh_rt_sqlite_changes(statement) };
  out.lastInsertRowid = unsafe { fsh_rt_sqlite_last_insert_rowid(statement) };
  return null;
}

// One run, on the blocking pool: the statement is compiled from sql first, and finalized after,
// when it is given, and otherwise is one prepared before. The job holds a count of the statement,
// released here, so a caller that stops waiting can't close the connection under it.
function work(db: i64, statement: i64, sql: string | null, params: Ref<SqlValue[]>, wanted: i64): Outcome throws SqliteError {
  let out: Outcome = { rows: [], changes: 0, lastInsertRowid: 0 };
  let code = unsafe { fsh_rt_sqlite_lock(statement) };
  if (code === 0) {
    if (sql === null) code = unsafe { fsh_rt_sqlite_reset(statement) };
    else {
      const text = terminated(sql);
      code = unsafe { fsh_rt_sqlite_prepare(statement, ptrOf(text[0]), (text.length as i64) - 1) };
    }
  }
  const failed = code !== 0 ? failure(db, code) : stepped(db, statement, params, wanted, out);
  unsafe { fsh_rt_sqlite_unlock(statement, sql === null ? 0 : 1) };
  unsafe { fsh_rt_sqlite_statement_release(statement) };
  if (failed !== null) throw failed;
  return out;
}

function compile(db: i64, statement: i64, sql: string): void throws SqliteError {
  let code = unsafe { fsh_rt_sqlite_lock(statement) };
  if (code === 0) {
    const text = terminated(sql);
    code = unsafe { fsh_rt_sqlite_prepare(statement, ptrOf(text[0]), (text.length as i64) - 1) };
  }
  const failed = code !== 0 ? failure(db, code) : null;
  unsafe { fsh_rt_sqlite_unlock(statement, 0) };
  unsafe { fsh_rt_sqlite_statement_release(statement) };
  if (failed !== null) throw failed;
}

function connect(db: i64, path: string): void throws SqliteError {
  const name = terminated(path);
  const code = unsafe { fsh_rt_sqlite_open(db, ptrOf(name[0])) };
  const failed = code !== 0 ? failure(db, code) : null;
  unsafe { fsh_rt_sqlite_release(db) };
  if (failed !== null) throw failed;
}

function disconnect(db: i64): void {
  unsafe { fsh_rt_sqlite_close(db) };
  unsafe { fsh_rt_sqlite_release(db) };
}

function finalize(statement: i64): void {
  unsafe { fsh_rt_sqlite_finalize(statement) };
  unsafe { fsh_rt_sqlite_statement_release(statement) };
}

// Runs sql once, on a statement of its own that the job finalizes and frees.
async function once(db: i64, sql: string, params: SqlValue[], wanted: i64): Promise<Outcome> throws SqliteError {
  const statement = unsafe { fsh_rt_sqlite_statement(db) };
  return await spawnBlocking(() => work(db, statement, sql, params, wanted));
}

// Runs a prepared statement again, the job holding a count of it while it runs.
async function again(db: i64, statement: i64, params: SqlValue[], wanted: i64): Promise<Outcome> throws SqliteError {
  unsafe { fsh_rt_sqlite_statement_retain(statement) };
  return await spawnBlocking(() => work(db, statement, null, params, wanted));
}

function rowsAs<T>(rows: Ref<string[]>): T[] throws RowError {
  let out: T[] = [];
  for (const json of rows) {
    try {
      out.push(JSON.parse<T>(json));
    } catch (e) {
      throw new RowError(rowMessage(e.message, json));
    }
  }
  return out;
}

// A JSON reading error put in terms of columns: "missing field 'x' at $" is column x missing,
// and "... at $.x" is about column x, which may be a null its field can't hold.
function rowMessage(message: string, json: string): string {
  if (message.startsWith("missing field ")) {
    const end = message.lastIndexOf(" at ");
    return "the row has no column " + message.slice("missing field ".length as i64, end) + ", which the type reads";
  }
  const at = message.indexOf(" at $.");
  if (at < 0) return "the row can't be read: " + message;
  const column = message.slice(at + 6);
  if (json.includes(JSON.stringify(column) + ":null")) return "column '" + column + "' is null, which its field can't hold; type it 'T | null'";
  return "column '" + column + "': " + message.slice(0, at);
}

// A connection to one database, running one statement at a time. Each call runs on the blocking
// pool, so a slow statement holds no worker. Clones share the connection, which closes when the
// last of them is dropped, or at close().
export class Database {
  private handle: i64;

  private constructor(handle: i64) {
    this.handle = handle;
  }

  // The database in the file at path, made when it isn't there, or one in memory for ":memory:".
  static async open(path: string): Promise<Database> throws SqliteError {
    if (path.includes("\0")) throw new SqliteError("a database's path can't hold a NUL character", 14);
    const handle = unsafe { fsh_rt_sqlite_database() };
    const db = new Database(handle);
    unsafe { fsh_rt_sqlite_retain(handle) };
    await spawnBlocking(() => connect(handle, path));
    return db;
  }

  // The rows sql gives, each read by column name into a T.
  async query<T>(this: Ref<this>, sql: string, params: SqlValue[] = []): Promise<T[]> throws SqliteError | RowError {
    const out = await once(this.handle, sql, params, -1);
    return rowsAs<T>(out.rows);
  }

  // The first row sql gives as a T, or null when it gives none.
  async queryOne<T>(this: Ref<this>, sql: string, params: SqlValue[] = []): Promise<T | null> throws SqliteError | RowError {
    const out = await once(this.handle, sql, params, 1);
    let rows = rowsAs<T>(out.rows);
    return rows.pop();
  }

  // Runs sql for what it changes; rows it gives are dropped.
  async run(this: Ref<this>, sql: string, params: SqlValue[] = []): Promise<RunResult> throws SqliteError {
    const out = await once(this.handle, sql, params, 0);
    return { changes: out.changes, lastInsertRowid: out.lastInsertRowid };
  }

  // sql compiled once, to run many times with new parameters.
  async prepare(this: Ref<this>, sql: string): Promise<Statement> throws SqliteError {
    const db = this.handle;
    const statement = unsafe { fsh_rt_sqlite_statement(db) };
    const made = new Statement(new Prepared(db, statement));
    unsafe { fsh_rt_sqlite_statement_retain(statement) };
    await spawnBlocking(() => compile(db, statement, sql));
    return made;
  }

  // Closes the connection for every clone; a call on any of them after this throws.
  async close(this: Ref<this>): Promise<void> {
    const db = this.handle;
    unsafe { fsh_rt_sqlite_retain(db) };
    await spawnBlocking(() => disconnect(db));
  }

  clone(): Database {
    unsafe { fsh_rt_sqlite_retain(this.handle) };
    return new Database(this.handle);
  }

  [Symbol.dispose](this: Mut<this>): void {
    unsafe { fsh_rt_sqlite_release(this.handle) };
  }
}

// A statement compiled by prepare, run with all, get or run as often as wanted.
export class Statement {
  private db: i64;
  private handle: i64;

  constructor(from: Prepared) {
    this.db = from.db;
    this.handle = from.statement;
  }

  // Every row the statement gives with params, each read by column name into a T.
  async all<T>(this: Ref<this>, params: SqlValue[] = []): Promise<T[]> throws SqliteError | RowError {
    const out = await again(this.db, this.handle, params, -1);
    return rowsAs<T>(out.rows);
  }

  // The first row the statement gives with params as a T, or null when it gives none.
  async get<T>(this: Ref<this>, params: SqlValue[] = []): Promise<T | null> throws SqliteError | RowError {
    const out = await again(this.db, this.handle, params, 1);
    let rows = rowsAs<T>(out.rows);
    return rows.pop();
  }

  // Runs the statement with params for what it changes; rows it gives are dropped.
  async run(this: Ref<this>, params: SqlValue[] = []): Promise<RunResult> throws SqliteError {
    const out = await again(this.db, this.handle, params, 0);
    return { changes: out.changes, lastInsertRowid: out.lastInsertRowid };
  }

  // Frees the compiled statement; a call on it after this throws.
  async close(this: Ref<this>): Promise<void> {
    const statement = this.handle;
    unsafe { fsh_rt_sqlite_statement_retain(statement) };
    await spawnBlocking(() => finalize(statement));
  }

  [Symbol.dispose](this: Mut<this>): void {
    unsafe { fsh_rt_sqlite_statement_release(this.handle) };
  }
}
`,
  // Tar archives, read an entry at a time and written from files, imported as std:tar.
  tar: String.raw`
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, symlinkSync, linkSync, utimesSync, chmodSync, writeFileSync } from "std:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "std:path";
import { gunzipSync, gzipSync, ZlibError } from "zlib";
import { open } from "fs/promises";

// What reading, extracting or writing an archive refuses, naming the entry where it can.
export class TarError extends Error {
  path: string;
  constructor(message: string, path: string = "") {
    super(message);
    this.path = path;
  }
}

export type TarEntryType = "file" | "directory" | "symlink" | "link";
// An entry's header: its path inside the archive, what it is, its data's size, its mode's
// permission bits, its time in seconds since the epoch, and a link's target.
export type TarHeader = { path: string; type: TarEntryType; size: i64; mode: i64; mtime: i64; target: string };
export type TarEntry = { path: string; type: TarEntryType; size: i64; mode: i64; mtime: i64; target: string; data: u8[] };
// An archive given as a path, its bytes, or a stream of its chunks.
export type TarSource = string | u8[] | ReadableStream<u8[]>;
// How much an archive may hold before it is refused: entries, bytes of entry data in all, and
// for a gzip archive bytes unpacked per byte packed.
export type TarLimits = { maxEntries?: i64; maxBytes?: i64; maxRatio?: i64 };

const MAX_ENTRIES = 10000;
const MAX_BYTES = 1073741824;
const MAX_RATIO = 100;

// A source's bytes as chunks, read a block at a time from a path.
async function* chunksOf(source: TarSource): AsyncGenerator<u8[]> throws IoError {
  if (typeof source === "string") {
    // ponytail: a generator can't yield inside try...finally yet, so a reader that stops early
    // leaves the descriptor open until the program ends.
    const fd = openSync(source, "r");
    while (true) {
      let buffer: u8[] = new Array<u8>(65536).fill(0);
      const n = readSync(fd, buffer, 0, 65536, null);
      if (n === 0) break;
      yield buffer.slice(0, n);
    }
    closeSync(fd);
  } else if (Array.isArray(source)) yield source;
  else for await (const chunk of source) yield chunk;
}

// A field of a header: ASCII up to its first NUL.
function text(block: Ref<u8[]>, at: i64, length: i64): string {
  let end = at;
  while (end < at + length && block[end as usize]! !== 0) end++;
  return new TextDecoder().decode(block.slice(at, end));
}

// A numeric field: octal digits, or, with its top bit set, a big-endian binary number, as GNU
// tar writes sizes past octal's reach.
function number(block: Ref<u8[]>, at: i64, length: i64): i64 {
  if (((block[at as usize]! as i64) & 0x80) !== 0) {
    let n = 0;
    for (let i = at + 1; i < at + length; i++) n = n * 256 + (block[i as usize]! as i64);
    return n;
  }
  let n = 0;
  for (let i = at; i < at + length; i++) {
    const c = block[i as usize]! as i64;
    if (c >= 48 && c <= 55) n = n * 8 + (c - 48);
    else if (n > 0 || (c !== 32 && c !== 0)) break;
  }
  return n;
}

// Whether a block's checksum, its bytes summed with the checksum field read as spaces, matches.
function checked(block: Ref<u8[]>): boolean {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : (block[i as usize]! as i64);
  return sum === number(block, 148, 8);
}

function zeros(block: Ref<u8[]>): boolean {
  for (const b of block) if (b !== 0) return false;
  return true;
}

// A PAX header's records, "length key=value\n" each, as their keys and values.
function paxRecords(data: Ref<u8[]>): Map<string, string> {
  let out = new Map<string, string>();
  const all = new TextDecoder().decode(data);
  let at = 0;
  while (at < (all.length as i64)) {
    const space = all.indexOf(" ", at);
    if (space < 0) break;
    const length = parseInt(all.slice(at, space)) ?? 0;
    if (length <= 0) break;
    const record = all.slice(space + 1, at + length - 1);
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1, record.length as i64));
    at += length;
  }
  return out;
}

function typeOf(flag: i64, path: string): TarEntryType | null {
  // '0' and NUL are files, as is '7', a contiguous file; '5' a directory, '2' a symlink and '1'
  // a hard link. A name ending in '/' is an old-style directory.
  if (flag === 48 || flag === 0 || flag === 55) return path.endsWith("/") ? "directory" : "file";
  if (flag === 53) return "directory";
  if (flag === 50) return "symlink";
  if (flag === 49) return "link";
  return null;
}

// The archive's raw chunks, inflated first when they start as gzip does, within the limits.
async function* inflated(source: TarSource, maxBytes: i64, maxEntries: i64, ratio: i64): AsyncGenerator<u8[]> throws IoError | TarError {
  let first = true;
  let packed: u8[] = [];
  let gzip = false;
  let chunks = chunksOf(source);
  for await (const chunk of chunks) {
    if (first) {
      gzip = chunk.length >= 2 && chunk[0]! === 0x1f && chunk[1]! === 0x8b;
      first = false;
    }
    if (!gzip) {
      yield chunk;
      continue;
    }
    // ponytail: zlib in std inflates whole buffers, so a gzip archive is held packed and then
    // unpacked; a streaming inflate would hold a window instead.
    for (const b of chunk) packed.push(b);
  }
  if (!gzip) return;
  // The headers come on top of the entries' data, up to three blocks an entry with long names.
  const headers = maxBytes + 512 * 3 * maxEntries;
  const cap = headers < (packed.length as i64) * ratio ? headers : (packed.length as i64) * ratio;
  let unpacked: u8[] = [];
  try {
    unpacked = gunzipSync(packed, { maxOutputLength: cap });
  } catch (e) {
    throw new TarError("this gzip archive unpacks past its limits, or isn't gzip: " + e.message + "; raise maxBytes or maxRatio if it is trusted");
  }
  yield unpacked;
}

// The archive's entries, one at a time, each read whole. Throws TarError on a corrupt header or
// past a limit.
export async function* entries(source: TarSource, limits: TarLimits = {}): AsyncGenerator<TarEntry> throws IoError | TarError {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const maxBytes = limits.maxBytes ?? MAX_BYTES;
  let chunks = inflated(source, maxBytes, maxEntries, limits.maxRatio ?? MAX_RATIO);
  // What has arrived and not been read, and whether the input has ended.
  let held: u8[] = [];
  let ended = false;
  let count = 0;
  let total = 0;
  // A GNU long name or PAX header before an entry, for that entry alone.
  let longPath = "";
  let longTarget = "";
  let paxSize = -1;
  while (true) {
    while ((held.length as i64) < 512 && !ended) {
      const step = await chunks.next();
      if (step.done === true) ended = true;
      else for (const b of step.value) held.push(b);
    }
    const block = held.slice(0, 512);
    held = held.slice(block.length as i64, held.length as i64);
    if (block.length === 0 || zeros(block)) return;
    if (block.length < 512) throw new TarError("this tar archive ends inside a header");
    if (!checked(block)) throw new TarError("a tar header's checksum doesn't match; the archive is corrupt or isn't tar");
    const name = text(block, 0, 100);
    const prefix = text(block, 345, 155);
    const magic = text(block, 257, 6);
    let path = magic.startsWith("ustar") && prefix.length > 0 ? prefix + "/" + name : name;
    const flag = block[156]! as i64;
    let size = number(block, 124, 12);
    if (paxSize >= 0) size = paxSize;
    if (size < 0 || total + size > maxBytes) throw new TarError("this tar archive holds more than " + String(maxBytes) + " bytes; raise maxBytes if it is trusted", path);
    const padded = (size + 511) / 512 * 512;
    while ((held.length as i64) < padded && !ended) {
      const step = await chunks.next();
      if (step.done === true) ended = true;
      else for (const b of step.value) held.push(b);
    }
    const data = held.slice(0, padded);
    held = held.slice(data.length as i64, held.length as i64);
    if ((data.length as i64) < size) throw new TarError("this tar archive ends inside an entry's data", path);
    const body = data.slice(0, size);
    // 'L' and 'K' are GNU's long name and long link target; 'x' a PAX header for the next
    // entry, 'g' one for every entry, which nothing here reads.
    if (flag === 76) {
      longPath = text(body, 0, size);
      continue;
    }
    if (flag === 75) {
      longTarget = text(body, 0, size);
      continue;
    }
    if (flag === 120) {
      const records = paxRecords(body);
      longPath = records.get("path") ?? longPath;
      longTarget = records.get("linkpath") ?? longTarget;
      const s = records.get("size");
      if (s !== undefined) paxSize = parseInt(s) ?? -1;
      continue;
    }
    if (flag === 103) continue;
    if (longPath.length > 0) path = longPath;
    const target = longTarget.length > 0 ? longTarget : text(block, 157, 100);
    longPath = "";
    longTarget = "";
    paxSize = -1;
    const type = typeOf(flag, path);
    if (type === null) throw new TarError("'" + path + "' is a device, FIFO or another special entry, which isn't read", path);
    count++;
    if (count > maxEntries) throw new TarError("this tar archive holds more than " + String(maxEntries) + " entries; raise maxEntries if it is trusted", path);
    total += size;
    const none: u8[] = [];
    yield { path, type, size: type === "file" ? size : 0, mode: number(block, 100, 8) & 0o7777, mtime: number(block, 136, 12), target, data: type === "file" ? body : none };
  }
}

// The headers of the archive's entries, its data read past.
export async function list(source: TarSource, limits: TarLimits = {}): Promise<TarHeader[]> throws IoError | TarError {
  let out: TarHeader[] = [];
  let all = entries(source, limits);
  for await (const e of all) out.push({ path: e.path, type: e.type, size: e.size, mode: e.mode, mtime: e.mtime, target: e.target });
  return out;
}

// Where an entry's path lands under root, refusing an absolute path or one that climbs out.
function landing(root: string, path: string): string throws TarError {
  if (isAbsolute(path)) throw new TarError("'" + path + "' is an absolute path, which extract refuses; an entry lands inside the target", path);
  const to = resolve(root, path);
  const rel = relative(root, to);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new TarError("'" + path + "' climbs out of the target, which extract refuses", path);
  return to;
}

// Refuses a landing reached through a symlink, which an earlier entry may have made to point
// anywhere: every directory between root and the landing, and the landing itself, must be real.
function throughLinks(root: string, to: string, path: string): void throws IoError | TarError {
  let at = to;
  while (at !== root && at.length > root.length) {
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (st !== undefined && st.isSymbolicLink()) throw new TarError("'" + path + "' would be written through the symlink '" + relative(root, at) + "', which extract refuses", path);
    at = dirname(at);
  }
}

// Writes the archive's entries under dir, made if it isn't there, and gives the paths written.
// Nothing lands outside dir: absolute paths, climbing paths, links pointing out and paths
// through symlinks are refused with TarError, as are devices and FIFOs.
export async function extract(source: TarSource, dir: string, limits: TarLimits = {}): Promise<string[]> throws IoError | TarError {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  let written: string[] = [];
  let all = entries(source, limits);
  for await (const e of all) {
    const to = landing(root, e.path);
    throughLinks(root, to, e.path);
    if (e.type === "directory") {
      mkdirSync(to, { recursive: true });
      if (e.mode !== 0) chmodSync(to, e.mode & 0o777);
      written.push(to);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    if (e.type === "symlink") {
      if (isAbsolute(e.target)) throw new TarError("'" + e.path + "' is a symlink to the absolute path '" + e.target + "', which extract refuses", e.path);
      landing(root, join(dirname(relative(root, to)), e.target));
      symlinkSync(e.target, to);
    } else if (e.type === "link") {
      const from = landing(root, e.target);
      throughLinks(root, from, e.path);
      linkSync(from, to);
    } else {
      writeFileSync(to, e.data);
      chmodSync(to, e.mode !== 0 ? e.mode & 0o777 : 0o644);
      utimesSync(to, e.mtime as f64, e.mtime as f64);
    }
    written.push(to);
  }
  return written;
}

export type TarPackOptions = { cwd?: string; gzip?: boolean };

// A field of a header written as ASCII, cut to its length.
function put(block: Mut<u8[]>, at: i64, length: i64, value: string) {
  const bytes = new TextEncoder().encode(value);
  for (let i = 0; i < length && i < (bytes.length as i64); i++) block[(at + i) as usize] = bytes[i as usize]!;
}

function octalDigits(n: i64): string {
  if (n === 0) return "0";
  let digits = "";
  let left = n;
  while (left > 0) {
    digits = String(left % 8) + digits;
    left = left / 8;
  }
  return digits;
}

// A numeric field as zero-padded octal digits and a NUL.
function octal(block: Mut<u8[]>, at: i64, length: i64, n: i64) {
  let digits = octalDigits(n);
  while ((digits.length as i64) < length - 1) digits = "0" + digits;
  put(block, at, length - 1, digits);
}

// A PAX record, "length key=value\n", whose length counts its own digits.
function paxRecord(key: string, value: string): string {
  // The record past its length's digits: a space, key=value, and a newline.
  const rest = (new TextEncoder().encode(key + "=" + value).length as i64) + 2;
  let length = rest + (String(rest).length as i64);
  if ((String(length).length as i64) !== (String(rest).length as i64)) length = rest + (String(length).length as i64);
  return String(length) + " " + key + "=" + value + "\n";
}

// A header block for one entry, with a PAX header before it when its path, target or size don't
// fit ustar's fields.
function headerBlocks(path: string, flag: i64, size: i64, mode: i64, mtime: i64, target: string): u8[] {
  let out: u8[] = [];
  const pathBytes = new TextEncoder().encode(path).length as i64;
  const targetBytes = new TextEncoder().encode(target).length as i64;
  let name = path;
  let prefix = "";
  if (pathBytes > 100) {
    // ustar splits a long path at a slash into a prefix of up to 155 bytes and a name of 100.
    let slash = -1;
    for (let i = 0; i < (path.length as i64) && i <= 155; i++) if (path.slice(i, i + 1) === "/") slash = i;
    if (slash > 0 && (new TextEncoder().encode(path.slice(slash + 1, path.length as i64)).length as i64) <= 100) {
      prefix = path.slice(0, slash);
      name = path.slice(slash + 1, path.length as i64);
    }
  }
  const big = size > 8589934591;
  const pax = (prefix === "" && pathBytes > 100) || targetBytes > 100 || big;
  if (pax) {
    let records = "";
    if (prefix === "" && pathBytes > 100) records += paxRecord("path", path);
    if (targetBytes > 100) records += paxRecord("linkpath", target);
    if (big) records += paxRecord("size", String(size));
    const data = new TextEncoder().encode(records);
    for (const b of ustarBlock("PaxHeader", "", 120, data.length as i64, 0o644, mtime, "")) out.push(b);
    for (const b of data) out.push(b);
    for (let i = data.length as i64; i % 512 !== 0; i++) out.push(0);
  }
  for (const b of ustarBlock(name.slice(0, 100), prefix, flag, big ? 0 : size, mode, mtime, target.slice(0, 100))) out.push(b);
  return out;
}

function ustarBlock(name: string, prefix: string, flag: i64, size: i64, mode: i64, mtime: i64, target: string): u8[] {
  let block: u8[] = new Array<u8>(512).fill(0);
  put(block, 0, 100, name);
  octal(block, 100, 8, mode);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, size);
  octal(block, 136, 12, mtime);
  put(block, 148, 8, "        ");
  block[156] = flag as u8;
  put(block, 157, 100, target);
  put(block, 257, 6, "ustar");
  put(block, 263, 2, "00");
  put(block, 345, 155, prefix);
  let sum = 0;
  for (const b of block) sum += b as i64;
  let digits = octalDigits(sum);
  while ((digits.length as i64) < 6) digits = "0" + digits;
  put(block, 148, 6, digits);
  block[154] = 0;
  block[155] = 32;
  return block;
}

// path and, for a directory, everything under it in sorted order, added to out.
function walked(cwd: string, path: string, out: Mut<string[]>): void throws IoError {
  out.push(path);
  const st = lstatSync(join(cwd, path));
  if (!st.isDirectory()) return;
  let names = readdirSync(join(cwd, path));
  names.sort();
  for (const n of names) walked(cwd, join(path, n), out);
}

// An archive of the paths, each relative to cwd, and everything under each directory, as its
// chunks; gzipped with gzip.
export async function* pack(paths: string[], options: TarPackOptions = {}): AsyncGenerator<u8[]> throws IoError | ZlibError {
  const cwd = options.cwd ?? ".";
  const gzip = options.gzip === true;
  // ponytail: zlib in std deflates whole buffers, so a gzipped archive is gathered first.
  let gathered: u8[] = [];
  for (const given of paths) {
    let found: string[] = [];
    walked(cwd, given, found);
    for (const path of found) {
      const full = join(cwd, path);
      const st = lstatSync(full);
      const mtime = Math.floor(st.mtimeMs / 1000.0) as i64;
      const mode = st.mode & 0o7777;
      if (st.isSymbolicLink() || st.isDirectory()) {
        const out = st.isSymbolicLink() ? headerBlocks(path, 50, 0, mode, mtime, readlinkSync(full)) : headerBlocks(path.endsWith("/") ? path : path + "/", 53, 0, mode, mtime, "");
        if (gzip) for (const b of out) gathered.push(b);
        else yield out;
      } else if (st.isFile()) {
        let data = readFileSync(full);
        let out = headerBlocks(path, 48, data.length as i64, mode, mtime, "");
        for (const b of data) out.push(b);
        for (let i = data.length as i64; i % 512 !== 0; i++) out.push(0);
        if (gzip) for (const b of out) gathered.push(b);
        else yield out;
      }
    }
  }
  // Two zero blocks end an archive.
  const end = new Array<u8>(1024).fill(0);
  if (!gzip) {
    yield end;
    return;
  }
  for (const b of end) gathered.push(b);
  yield gzipSync(gathered);
}

// The archive pack makes, written to file.
export async function create(file: string, paths: string[], options: TarPackOptions = {}): Promise<void> throws IoError | ZlibError {
  let out = await open(file, "w");
  let chunks = pack(paths, options);
  for await (const chunk of chunks) {
    const _n = await out.write(chunk);
  }
  await out.close();
}
`,
  // Zip archives, read through their central directory and written deflated, as std:zip.
  zip: String.raw`
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, utimesSync, chmodSync, writeFileSync } from "std:fs";
import { dirname, isAbsolute, join, relative, resolve } from "std:path";
import { deflateRawSync, inflateRawSync, ZlibError } from "zlib";
import { open } from "fs/promises";

// What reading, extracting or writing an archive refuses, naming the entry where it can.
export class ZipError extends Error {
  path: string;
  constructor(message: string, path: string = "") {
    super(message);
    this.path = path;
  }
}

export type ZipEntryType = "file" | "directory" | "symlink";
// As std:tar's: an entry's path, what it is, its unpacked size, its mode's permission bits, its
// time in seconds since the epoch, and a symlink's target.
export type ZipHeader = { path: string; type: ZipEntryType; size: i64; mode: i64; mtime: i64; target: string };
export type ZipEntry = { path: string; type: ZipEntryType; size: i64; mode: i64; mtime: i64; target: string; data: u8[] };
export type ZipSource = string | u8[] | ReadableStream<u8[]>;
export type ZipLimits = { maxEntries?: i64; maxBytes?: i64; maxRatio?: i64 };
export type ZipPackOptions = { cwd?: string; level?: i64 };

const MAX_ENTRIES = 10000;
const MAX_BYTES = 1073741824;
const MAX_RATIO = 100;
const ALL32 = 4294967295;

function le(b: Ref<u8[]>, at: i64, size: i64): i64 {
  let n = 0;
  for (let i = size - 1; i >= 0; i--) n = n * 256 + (b[(at + i) as usize]! as i64);
  return n;
}

function put(out: Mut<u8[]>, n: i64, size: i64) {
  let left = n;
  for (let i = 0; i < size; i++) {
    out.push((left % 256) as u8);
    left = left / 256;
  }
}

// CRC-32 as zip and gzip compute it, over the reflected polynomial 0xEDB88320.
export function crc32(data: Ref<u8[]>): i64 {
  let table: i64[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >> 1) : c >> 1;
    table.push(c);
  }
  let crc = ALL32;
  for (const b of data) crc = table[((crc ^ (b as i64)) & 255) as usize]! ^ (crc >> 8);
  return crc ^ ALL32;
}

// A source's bytes, whole, refused past maxBytes.
async function whole(source: ZipSource, maxBytes: i64): Promise<u8[]> throws IoError | ZipError {
  if (typeof source === "string") {
    const st = lstatSync(source);
    if (st.size > maxBytes) throw new ZipError("this zip archive is larger than " + String(maxBytes) + " bytes; raise maxBytes if it is trusted");
    return readFileSync(source);
  }
  if (Array.isArray(source)) return source;
  let out: u8[] = [];
  for await (const chunk of source) {
    for (const b of chunk) out.push(b);
    if ((out.length as i64) > maxBytes) throw new ZipError("this zip archive is larger than " + String(maxBytes) + " bytes; raise maxBytes if it is trusted");
  }
  return out;
}

// Days since 1970-01-01 for a civil date, and back, as Howard Hinnant's algorithms give them.
function daysFrom(y: i64, m: i64, d: i64): i64 {
  const year = m <= 2 ? y - 1 : y;
  const era = (year >= 0 ? year : year - 399) / 400;
  const yoe = year - era * 400;
  const doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

function civil(days: i64): [i64, i64, i64] {
  const z = days + 719468;
  const era = (z >= 0 ? z : z - 146096) / 146097;
  const doe = z - era * 146097;
  const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const mp = (5 * doy + 2) / 153;
  const d = doy - (153 * mp + 2) / 5 + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, m, d];
}

// A DOS date and time, read as UTC, in seconds since the epoch.
function dosTime(date: i64, time: i64): i64 {
  const days = daysFrom((date >> 9) + 1980, (date >> 5) & 15, date & 31);
  return days * 86400 + (time >> 11) * 3600 + ((time >> 5) & 63) * 60 + (time & 31) * 2;
}

// The archive's entries from its central directory, each read and checked whole. Throws
// ZipError on a corrupt archive, an entry it can't read, or past a limit.
export async function* entries(source: ZipSource, limits: ZipLimits = {}): AsyncGenerator<ZipEntry> throws IoError | ZipError {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const maxBytes = limits.maxBytes ?? MAX_BYTES;
  const maxRatio = limits.maxRatio ?? MAX_RATIO;
  const z = await whole(source, maxBytes);
  const size = z.length as i64;
  // The end of central directory record is the last 22 bytes, before a comment of up to 65535.
  let end = -1;
  for (let at = size - 22; at >= 0 && at >= size - 22 - 65535; at--) {
    if (le(z, at, 4) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("this isn't a zip archive: it has no end of central directory record");
  let count = le(z, end + 10, 2);
  let cdSize = le(z, end + 12, 4);
  let cdAt = le(z, end + 16, 4);
  // ZIP64 keeps the counts and offsets that overflow in a record its locator points at.
  if (end >= 20 && le(z, end - 20, 4) === 0x07064b50) {
    const at = le(z, end - 12, 8);
    if (at + 56 > size || le(z, at, 4) !== 0x06064b50) throw new ZipError("this zip archive's ZIP64 end record is missing or corrupt");
    count = le(z, at + 32, 8);
    cdSize = le(z, at + 40, 8);
    cdAt = le(z, at + 48, 8);
  }
  if (count > maxEntries) throw new ZipError("this zip archive holds more than " + String(maxEntries) + " entries; raise maxEntries if it is trusted");
  if (cdAt + cdSize > size) throw new ZipError("this zip archive's central directory runs past its end");
  let at = cdAt;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > size || le(z, at, 4) !== 0x02014b50) throw new ZipError("this zip archive's central directory is corrupt");
    const madeBy = le(z, at + 4, 2);
    const flags = le(z, at + 8, 2);
    const method = le(z, at + 10, 2);
    const time = le(z, at + 12, 2);
    const date = le(z, at + 14, 2);
    const crc = le(z, at + 16, 4);
    let packed = le(z, at + 20, 4);
    let unpacked = le(z, at + 24, 4);
    const nameLength = le(z, at + 28, 2);
    const extraLength = le(z, at + 30, 2);
    const commentLength = le(z, at + 32, 2);
    const external = le(z, at + 38, 4);
    let local = le(z, at + 42, 4);
    const path = new TextDecoder().decode(z.slice(at + 46, at + 46 + nameLength));
    let mtime = dosTime(date, time);
    // Extra fields: ZIP64's sizes and offset where the 32-bit fields are all ones, and the
    // extended timestamp's modification time.
    let e = at + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = le(z, e, 2);
      const length = le(z, e + 2, 2);
      let v = e + 4;
      if (id === 1) {
        if (unpacked === ALL32) {
          unpacked = le(z, v, 8);
          v += 8;
        }
        if (packed === ALL32) {
          packed = le(z, v, 8);
          v += 8;
        }
        if (local === ALL32) local = le(z, v, 8);
      } else if (id === 0x5455 && length >= 5 && (le(z, v, 1) & 1) !== 0) mtime = le(z, v + 1, 4);
      e += 4 + length;
    }
    at = extraEnd + commentLength;
    if ((flags & 1) !== 0) throw new ZipError("'" + path + "' is encrypted, which isn't read", path);
    if (method !== 0 && method !== 8) throw new ZipError("'" + path + "' uses compression method " + String(method) + "; only stored and deflate are read", path);
    if (total + unpacked > maxBytes) throw new ZipError("this zip archive unpacks to more than " + String(maxBytes) + " bytes; raise maxBytes if it is trusted", path);
    if (packed > 0 && unpacked > packed * maxRatio) throw new ZipError("'" + path + "' unpacks more than " + String(maxRatio) + " bytes per byte packed; raise maxRatio if it is trusted", path);
    if (local + 30 > size || le(z, local, 4) !== 0x04034b50) throw new ZipError("'" + path + "' has no local header where the central directory says", path);
    const dataAt = local + 30 + le(z, local + 26, 2) + le(z, local + 28, 2);
    if (dataAt + packed > size) throw new ZipError("'" + path + "' runs past the archive's end", path);
    const raw = z.slice(dataAt, dataAt + packed);
    let data: u8[] = [];
    if (method === 0) data = raw;
    else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: unpacked > 0 ? unpacked : 1 });
      } catch (err) {
        throw new ZipError("'" + path + "' doesn't inflate to the size its header gives: " + err.message, path);
      }
    }
    if ((data.length as i64) !== unpacked) throw new ZipError("'" + path + "' unpacks to " + String(data.length) + " bytes where its header says " + String(unpacked), path);
    if (crc32(data) !== crc) throw new ZipError("'" + path + "' fails its CRC-32 check; the archive is corrupt", path);
    total += unpacked;
    // A Unix maker keeps the mode in the external attributes' top half.
    const mode = (madeBy >> 8) === 3 ? external >> 16 : 0;
    const kind = mode & 0o170000;
    const type: ZipEntryType = path.endsWith("/") || kind === 0o040000 ? "directory" : kind === 0o120000 ? "symlink" : "file";
    if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000 && kind !== 0o120000) throw new ZipError("'" + path + "' is a device, FIFO or another special entry, which isn't read", path);
    const target = type === "symlink" ? new TextDecoder().decode(data) : "";
    const none: u8[] = [];
    yield { path, type, size: type === "file" ? unpacked : 0, mode: mode & 0o7777, mtime, target, data: type === "file" ? data : none };
  }
}

// The headers of the archive's entries.
export async function list(source: ZipSource, limits: ZipLimits = {}): Promise<ZipHeader[]> throws IoError | ZipError {
  let out: ZipHeader[] = [];
  let all = entries(source, limits);
  for await (const e of all) out.push({ path: e.path, type: e.type, size: e.size, mode: e.mode, mtime: e.mtime, target: e.target });
  return out;
}

function landing(root: string, path: string): string throws ZipError {
  if (isAbsolute(path)) throw new ZipError("'" + path + "' is an absolute path, which extract refuses; an entry lands inside the target", path);
  const to = resolve(root, path);
  const rel = relative(root, to);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new ZipError("'" + path + "' climbs out of the target, which extract refuses", path);
  return to;
}

function throughLinks(root: string, to: string, path: string): void throws IoError | ZipError {
  let at = to;
  while (at !== root && at.length > root.length) {
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (st !== undefined && st.isSymbolicLink()) throw new ZipError("'" + path + "' would be written through the symlink '" + relative(root, at) + "', which extract refuses", path);
    at = dirname(at);
  }
}

// Writes the archive's entries under dir and gives the paths written, refusing as std:tar's
// extract does anything that would land outside dir.
export async function extract(source: ZipSource, dir: string, limits: ZipLimits = {}): Promise<string[]> throws IoError | ZipError {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  let written: string[] = [];
  let all = entries(source, limits);
  for await (const e of all) {
    const to = landing(root, e.path);
    throughLinks(root, to, e.path);
    if (e.type === "directory") {
      mkdirSync(to, { recursive: true });
      if (e.mode !== 0) chmodSync(to, e.mode & 0o777);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      if (e.type === "symlink") {
        if (isAbsolute(e.target)) throw new ZipError("'" + e.path + "' is a symlink to the absolute path '" + e.target + "', which extract refuses", e.path);
        landing(root, join(dirname(relative(root, to)), e.target));
        symlinkSync(e.target, to);
      } else {
        writeFileSync(to, e.data);
        chmodSync(to, e.mode !== 0 ? e.mode & 0o777 : 0o644);
        utimesSync(to, e.mtime as f64, e.mtime as f64);
      }
    }
    written.push(to);
  }
  return written;
}

// path and, for a directory, everything under it in sorted order, added to out.
function walked(cwd: string, path: string, out: Mut<string[]>): void throws IoError {
  out.push(path);
  const st = lstatSync(join(cwd, path));
  if (!st.isDirectory()) return;
  let names = readdirSync(join(cwd, path));
  names.sort();
  for (const n of names) walked(cwd, join(path, n), out);
}

// A time in seconds since the epoch as a DOS date and time, in UTC, clamped to DOS's 1980.
function dosParts(seconds: i64): [i64, i64] {
  const days = seconds / 86400;
  const left = seconds % 86400;
  const [y, m, d] = civil(days);
  if (y < 1980) return [(0 << 9) | (1 << 5) | 1, 0];
  return [((y - 1980) << 9) | (m << 5) | d, ((left / 3600) << 11) | (((left % 3600) / 60) << 5) | ((left % 60) / 2)];
}

type __zipRecord = { name: u8[]; method: i64; crc: i64; packed: i64; unpacked: i64; date: i64; time: i64; mtime: i64; external: i64; offset: i64 };

// A zip archive of the paths, each relative to cwd, and everything under each directory, as its
// chunks, each file deflated at level unless storing it is smaller.
export async function* pack(paths: string[], options: ZipPackOptions = {}): AsyncGenerator<u8[]> throws IoError | ZlibError {
  const cwd = options.cwd ?? ".";
  const level = options.level ?? 6;
  let records: __zipRecord[] = [];
  let offset = 0;
  for (const given of paths) {
    let found: string[] = [];
    walked(cwd, given, found);
    for (const path of found) {
      const full = join(cwd, path);
      const st = lstatSync(full);
      const mtime = Math.floor(st.mtimeMs / 1000.0) as i64;
      const directory = st.isDirectory();
      const link = st.isSymbolicLink();
      if (!directory && !link && !st.isFile()) continue;
      const name = new TextEncoder().encode(directory && !path.endsWith("/") ? path + "/" : path);
      let data: u8[] = link ? new TextEncoder().encode(readlinkSync(full)) : directory ? [] : readFileSync(full);
      const crc = crc32(data);
      const unpacked = data.length as i64;
      let method = 0;
      if (!directory && !link && unpacked > 0) {
        const deflated = deflateRawSync(data.clone(), { level });
        if ((deflated.length as i64) < unpacked) {
          data = deflated;
          method = 8;
        }
      }
      const [date, time] = dosParts(mtime);
      const kind = directory ? 0o040000 : link ? 0o120000 : 0o100000;
      const external = (kind | (st.mode & 0o7777)) * 65536 + (directory ? 16 : 0);
      const big = unpacked >= ALL32 || (data.length as i64) >= ALL32;
      let out: u8[] = [];
      put(out, 0x04034b50, 4);
      put(out, big ? 45 : 20, 2);
      // Bit 11 marks names as UTF-8.
      put(out, 0x0800, 2);
      put(out, method, 2);
      put(out, time, 2);
      put(out, date, 2);
      put(out, crc, 4);
      put(out, big ? ALL32 : data.length as i64, 4);
      put(out, big ? ALL32 : unpacked, 4);
      put(out, name.length as i64, 2);
      put(out, big ? 29 : 9, 2);
      for (const b of name) out.push(b);
      if (big) {
        put(out, 1, 2);
        put(out, 16, 2);
        put(out, unpacked, 8);
        put(out, data.length as i64, 8);
      }
      // The extended timestamp: its modification time to the second.
      put(out, 0x5455, 2);
      put(out, 5, 2);
      out.push(1);
      put(out, mtime, 4);
      for (const b of data) out.push(b);
      records.push({ name, method, crc, packed: data.length as i64, unpacked, date, time, mtime, external, offset });
      offset += out.length as i64;
      yield out;
    }
  }
  let central: u8[] = [];
  for (const r of records) {
    const wide = r.unpacked >= ALL32 || r.packed >= ALL32 || r.offset >= ALL32;
    put(central, 0x02014b50, 4);
    // Made by Unix, so readers take the mode from the external attributes.
    put(central, 3 * 256 + (wide ? 45 : 20), 2);
    put(central, wide ? 45 : 20, 2);
    put(central, 0x0800, 2);
    put(central, r.method, 2);
    put(central, r.time, 2);
    put(central, r.date, 2);
    put(central, r.crc, 4);
    put(central, wide ? ALL32 : r.packed, 4);
    put(central, wide ? ALL32 : r.unpacked, 4);
    put(central, r.name.length as i64, 2);
    put(central, wide ? 37 : 9, 2);
    put(central, 0, 2);
    put(central, 0, 2);
    put(central, 0, 2);
    put(central, r.external, 4);
    put(central, wide ? ALL32 : r.offset, 4);
    for (const b of r.name) central.push(b);
    if (wide) {
      put(central, 1, 2);
      put(central, 24, 2);
      put(central, r.unpacked, 8);
      put(central, r.packed, 8);
      put(central, r.offset, 8);
    }
    put(central, 0x5455, 2);
    put(central, 5, 2);
    central.push(1);
    put(central, r.mtime, 4);
  }
  const count = records.length as i64;
  const cdSize = central.length as i64;
  if (count >= 65535 || offset >= ALL32 || cdSize >= ALL32) {
    // ZIP64's end record, then its locator, before the classic record pointing past them.
    const at = offset + cdSize;
    put(central, 0x06064b50, 4);
    put(central, 44, 8);
    put(central, 3 * 256 + 45, 2);
    put(central, 45, 2);
    put(central, 0, 4);
    put(central, 0, 4);
    put(central, count, 8);
    put(central, count, 8);
    put(central, cdSize, 8);
    put(central, offset, 8);
    put(central, 0x07064b50, 4);
    put(central, 0, 4);
    put(central, at, 8);
    put(central, 1, 4);
  }
  put(central, 0x06054b50, 4);
  put(central, 0, 2);
  put(central, 0, 2);
  put(central, count >= 65535 ? 65535 : count, 2);
  put(central, count >= 65535 ? 65535 : count, 2);
  put(central, cdSize >= ALL32 ? ALL32 : cdSize, 4);
  put(central, offset >= ALL32 ? ALL32 : offset, 4);
  put(central, 0, 2);
  yield central;
}

// The archive pack makes, written to file.
export async function create(file: string, paths: string[], options: ZipPackOptions = {}): Promise<void> throws IoError | ZlibError {
  let out = await open(file, "w");
  let chunks = pack(paths, options);
  for await (const chunk of chunks) {
    const _n = await out.write(chunk);
  }
  await out.close();
}
`,
  // Spans in a program's own code, imported as std:trace. Their state is std's own, which serve
  // shares, so what is here only wraps it.
  trace: String.raw`
// endpoint is the collector's base URL, as OTEL_EXPORTER_OTLP_ENDPOINT is, and "" turns tracing
// off whatever the environment says; serviceName is the service the spans are from; batchDelay
// is the milliseconds finished spans wait to be sent together. What isn't given is read from
// the environment, or left as it is for batchDelay.
export type TracingOptions = { endpoint?: string; serviceName?: string; batchDelay?: i64 };

// One timed piece of work in a trace. It ends at end(), or where its scope does when it is
// bound with 'using', and is then sent to the collector with the batch it joins.
export class Span {
  #record: __traceRecord;
  // The context this span took over, to put back when it ends.
  #prior: i64[];
  #open: boolean;

  constructor(record: __traceRecord, prior: i64[], open: boolean) {
    this.#record = record;
    this.#prior = prior;
    this.#open = open;
  }

  // The ids as OTLP writes them, in lowercase hex, or "" where there is none: every id of a
  // span made while tracing is off, and a root span's parent.
  get traceId(): string {
    return this.#record.id === 0 ? "" : __traceHex([this.#record.hi, this.#record.lo]);
  }

  get spanId(): string {
    return this.#record.id === 0 ? "" : __traceHex([this.#record.id]);
  }

  get parentSpanId(): string {
    return this.#record.parent === 0 ? "" : __traceHex([this.#record.parent]);
  }

  // Adds an attribute; one set after the span ended is dropped.
  set(this: Mut<this>, key: string, value: string | i64 | boolean): void {
    if (this.#open) this.#record.attributes.push({ key: key, value: value });
  }

  // Ends the span, once: its parent is the current span again.
  end(this: Mut<this>): void {
    if (!this.#open) return;
    this.#open = false;
    __traceEnd(this.#record.clone(), this.#prior);
  }

  [Symbol.dispose](this: Mut<this>): void {
    this.end();
  }
}

// Begins a span under the current one, a new trace when there is none, and makes it current
// for this task and the tasks it spawns. With tracing off it records nothing.
export function span(name: string): Span {
  if (!__traceOn()) return new Span({ name: "", hi: 0, lo: 0, id: 0, parent: 0, flags: 0, kind: 0, start: 0, end: 0, attributes: [] }, [], false);
  const prior = __traceWords();
  return new Span(__traceBegin(name, 1, prior), prior, true);
}

// Sets where spans go, in place of what the environment says.
export function configureTracing(options: TracingOptions): void {
  __traceConfigure(options.endpoint, options.serviceName, options.batchDelay);
}

// Sends the spans that have ended so far, without waiting for their batch's timer. A program
// about to return awaits this, or it runs on until the timer has sent them.
export async function flushTraces(): Promise<void> {
  await __traceSend();
}
`,
  // Live snapshot of active async tasks, imported as std:inspect.
  inspect: String.raw`
declare function fsh_rt_tasks_json(): Ptr<u8>;
declare function fsh_rt_tasks_table(): Ptr<u8>;
declare function fsh_rt_tasks_free(p: Ptr<u8>): void;

// One active task in the async runtime at the moment of the snapshot.
export type TaskInfo = {
  id: i64;
  name: string;
  state: string;
  awaiting: string;
  awaitSite: string;
  ageMs: i64;
  spawnSite: string;
  blocking: boolean;
  polls: i64;
};

// A JSON array of every live task, matching TaskInfo[].
export function tasksJson(): string {
  let text = "[]";
  unsafe {
    const p = fsh_rt_tasks_json();
    if (!p.isNull()) {
      text = fromCString(p);
      fsh_rt_tasks_free(p);
    }
  }
  return text;
}

// A human-readable table of every live task for logging or terminal output.
export function formatTasks(): string {
  let text = "";
  unsafe {
    const p = fsh_rt_tasks_table();
    if (!p.isNull()) {
      text = fromCString(p);
      fsh_rt_tasks_free(p);
    }
  }
  return text;
}

// Live snapshot of every active task, sorted by task id.
export function tasks(): TaskInfo[] {
  const raw = tasksJson();
  try {
    return JSON.parse<TaskInfo[]>(raw);
  } catch (_e) {
    return [];
  }
}
`,
  // Deterministic simulation controls, imported as std:sim. Active when FISH_SIM_SEED is set.
  sim: String.raw`
declare function fsh_rt_sim_enabled(): i32;
declare function fsh_rt_sim_seed(): u64;
declare function fsh_rt_sim_now(): i64;
declare function fsh_rt_sim_advance(ms: i64): void;
declare function fsh_rt_sim_partition(a: Ptr<u8>, b: Ptr<u8>): void;
declare function fsh_rt_sim_heal(a: Ptr<u8>, b: Ptr<u8>): void;
declare function fsh_rt_sim_set_delay(minMs: i64, maxMs: i64): void;
declare function fsh_rt_sim_set_drop_rate(rate: f64): void;
declare function fsh_rt_sim_reset_faults(): void;

// Whether the runtime is executing in deterministic simulation mode (FISH_SIM_SEED set).
export function enabled(): boolean {
  return unsafe { fsh_rt_sim_enabled() !== 0 };
}

// The active simulation seed (0 when simulation mode is not enabled).
export function seed(): u64 {
  return unsafe { fsh_rt_sim_seed() };
}

// Current virtual monotonic clock in milliseconds (or real monotonic ms outside sim mode).
export function now(): i64 {
  return unsafe { fsh_rt_sim_now() };
}

// Advances the virtual clock by ms milliseconds and fires any newly due timers and network events.
export function advance(ms: i64): void {
  unsafe { fsh_rt_sim_advance(ms) };
}

// Injects a symmetric network partition between endpoints a and b (host, host:port, or "*").
export function partition(a: string, b: string): void {
  unsafe { fsh_rt_sim_partition(cString(a), cString(b)) };
}

// Removes a symmetric network partition between endpoints a and b.
export function heal(a: string, b: string): void {
  unsafe { fsh_rt_sim_heal(cString(a), cString(b)) };
}

// Sets simulated network latency range in milliseconds for virtual TCP delivery.
export function setDelay(minMs: i64, maxMs: i64 = minMs): void {
  unsafe { fsh_rt_sim_set_delay(minMs, maxMs) };
}

// Sets simulated network drop/reset probability in [0.0, 1.0] for virtual TCP operations.
export function setDropRate(rate: f64): void {
  unsafe { fsh_rt_sim_set_drop_rate(rate) };
}

// Clears all partitions, delays, and drop-rate faults.
export function resetFaults(): void {
  unsafe { fsh_rt_sim_reset_faults() };
}
`,
  // Standard input as a global module, stdin.lines() and the rest, reading through readLine's
  // buffer so readers can be mixed.
  stdin: String.raw`
export async function* lines(): AsyncGenerator<string> {
  while (true) {
    const line = await readLine();
    if (line === null) return;
    yield line;
  }
}

export async function bytes(): Promise<u8[]> {
  const all = await spawnBlocking(() => __stdinTake(1));
  if (all === null) return [];
  return all;
}

export async function text(): Promise<string> {
  const all = await bytes();
  return new TextDecoder().decode(all);
}
`,
  process: String.raw`
declare function fsh_rt_argc(): i64;
declare function fsh_rt_arg(i: i64): Ptr<u8>;
declare function fsh_rt_getenv(name: Ptr<u8>): Ptr<u8>;
declare function fsh_rt_exit(code: i64): void;
declare function fsh_rt_os_platform(): Ptr<u8>;
declare function fsh_rt_os_arch(): Ptr<u8>;
declare function fsh_rt_signal_name(n: i64): Ptr<u8>;
declare function fsh_rt_signal_listen(n: i64): i64;
declare function fsh_rt_signal_count(n: i64): i64;
declare function fsh_rt_timeout_unref(id: i64): void;
declare function fsh_rt_kill(pid: i64, signal: i64): i64;
declare function getpid(): i32;
declare function fsh_rt_env_count(): i64;
declare function fsh_rt_env_at(i: i64): Ptr<u8>;

export function argv(): string[] {
  let all: string[] = [];
  const n = unsafe { fsh_rt_argc() };
  for (let i: i64 = 0; i < n; i++) all.push(unsafe { fromCString(fsh_rt_arg(i)) });
  return all;
}

export function env(name: string): string | null {
  const value = unsafe { fsh_rt_getenv(cString(name)) };
  if (unsafe { value.isNull() }) return null;
  return unsafe { fromCString(value) };
}

// As Node names them: "darwin" or "linux", and "arm64" or "x64", for the target built for.
export function platform(): string {
  return unsafe { fromCString(fsh_rt_os_platform()) };
}

export function arch(): string {
  return unsafe { fromCString(fsh_rt_os_arch()) };
}

// The running program's absolute path, which process.argv also starts with.
export function execPath(): string {
  return unsafe { fromCString(fsh_rt_arg(0)) };
}

declare function fsh_rt_cwd(): Ptr<u8>;
declare function fsh_rt_chdir(path: Ptr<u8>): i64;
declare function fsh_rt_errno_words(number: i64, code: MutPtr<u8>, codeSize: i64, text: MutPtr<u8>, textSize: i64): void;

export function cwd(): string {
  return unsafe { fromCString(fsh_rt_cwd()) };
}

// The working directory of every task and thread at once, as it is one per process. The
// error names the directory left and the one asked for, with path the one left.
export function chdir(directory: string): void throws IoError {
  const from = cwd();
  const result = unsafe { fsh_rt_chdir(cString(directory)) };
  if (result === 0) return;
  let code: u8[] = new Array(32).fill(0 as u8);
  let text: u8[] = new Array(200).fill(0 as u8);
  unsafe { fsh_rt_errno_words(-result, mutPtrOf(code[0]), 32, mutPtrOf(text[0]), 200) };
  const name = unsafe { fromCString(ptrOf(code[0])) };
  let e = new IoError(name + ": " + unsafe { fromCString(ptrOf(text[0])) } + ", chdir '" + from + "' -> '" + directory + "'");
  e.code = name;
  e.syscall = "chdir";
  e.path = from;
  throw e;
}

// The whole environment, as Object.entries(process.env) and Object.keys(process.env) give it,
// which the loader turns into calls of these. An entry with no '=', or no name before it, isn't
// a variable.
export function __envEntries(): [string, string][] {
  let all: [string, string][] = [];
  const n = unsafe { fsh_rt_env_count() };
  for (let i: i64 = 0; i < n; i++) {
    const entry = unsafe { fromCString(fsh_rt_env_at(i)) };
    const at = entry.indexOf("=");
    if (at > 0) all.push([entry.slice(0, at), entry.slice(at + 1)]);
  }
  return all;
}

export function __envKeys(): string[] {
  let keys: string[] = [];
  for (const [k, _v] of __envEntries()) keys.push(k);
  return keys;
}

// A signal's number from its name, as "SIGHUP", or a number given as it is.
function signalNumberOf(signal: string | i64): i64 {
  if (typeof signal !== "string") return signal;
  for (let n: i64 = 1; n < 65; n++) {
    const named = unsafe { fsh_rt_signal_name(n).isNull() ? "" : fromCString(fsh_rt_signal_name(n)) };
    if (named === signal) return n;
  }
  assert(false, "Unknown signal: " + signal);
  return 0;
}

// Counts a signal from now on, giving how many had arrived already.
function listened(n: i64): i64 {
  const before = unsafe { fsh_rt_signal_listen(n) };
  assert(before >= 0, "the signal " + String(n) + " can't be listened for");
  return before;
}

// Node's process.on: listener runs on every delivery of the signal from now on, which no longer
// ends the program. It doesn't keep the program running. The listener is optional only so that
// an arrow written for it is stored, owning what it captures; none listens for nothing.
// ponytail: deliveries are seen by a 10 ms interval; wake it from the signal's thread if latency matters
export function on(signal: string | i64, listener?: () => void): void {
  if (listener === undefined) return;
  const run: () => void = listener;
  const n = signalNumberOf(signal);
  const state = shared({ seen: new Atomic(listened(n)) });
  const id = setInterval(() => {
    const now = unsafe { fsh_rt_signal_count(n) };
    while (state.seen.load() < now) {
      state.seen.add(1);
      run();
    }
  }, 10);
  unsafe { fsh_rt_timeout_unref(id) };
}

// Node's process.once: listener runs on the next delivery only.
export function once(signal: string | i64, listener?: () => void): void {
  if (listener === undefined) return;
  const run: () => void = listener;
  const n = signalNumberOf(signal);
  const seen = listened(n);
  const state = shared({ id: new Atomic(-1), done: new Atomic(false) });
  const held = state.clone();
  const id = setInterval(() => {
    if (held.done.load() || unsafe { fsh_rt_signal_count(n) } <= seen) return;
    held.done.store(true);
    clearInterval(held.id.load());
    run();
  }, 10);
  state.id.store(id);
  unsafe { fsh_rt_timeout_unref(id) };
}

// Each delivery of the signals named, by name, as they arrive. Listening starts at the call, not
// at the first next(), so a signal sent between the two isn't lost to its default action.
export function signals(...names: string[]): AsyncGenerator<string> {
  let numbers: i64[] = [];
  let seen: i64[] = [];
  for (const name of names) {
    const n = signalNumberOf(name);
    numbers.push(n);
    seen.push(listened(n));
  }
  return deliveries(names, numbers, seen);
}

async function* deliveries(names: string[], numbers: i64[], seen: i64[]): AsyncGenerator<string> {
  while (true) {
    for (let i: usize = 0; i < numbers.length; i++) {
      const now = unsafe { fsh_rt_signal_count(numbers[i]) };
      while (seen[i] < now) {
        seen[i] = seen[i] + 1;
        yield names[i];
      }
    }
    await sleep(10);
  }
}

export function pid(): i64 {
  return unsafe { getpid() } as i64;
}

declare function fsh_rt_stream_write(stream: i32, bytes: Ptr<u8>, length: i64): void;
declare function isatty(fd: i32): i32;

// process.stdout and process.stderr, of which Fish has isTTY and write: the chunk as it is, with no
// newline added, giving true.
export class WriteStream {
  fd: i32;
  constructor(fd: i32) {
    this.fd = fd;
  }

  get isTTY(): boolean {
    let tty: i32 = 0;
    unsafe {
      tty = isatty(this.fd);
    }
    return tty === 1;
  }

  write(chunk: string | u8[]): boolean {
    if (typeof chunk === "string") streamWrite(this.fd, new TextEncoder().encode(chunk));
    else streamWrite(this.fd, chunk);
    return true;
  }
}

function streamWrite(fd: i32, bytes: Ref<u8[]>): void {
  if (bytes.length > 0) unsafe { fsh_rt_stream_write(fd, ptrOf(bytes[0]), bytes.length as i64) };
}

export function stdout(): WriteStream {
  return new WriteStream(1);
}

// process.stdin, of which Fish has its chunks as for await reads them: the bytes standard input
// has given since the last chunk, each read on the blocking pool.
export async function* stdin(): AsyncGenerator<u8[]> {
  while (true) {
    const chunk = await spawnBlocking(() => __stdinTake(2));
    if (chunk === null) return;
    yield chunk;
  }
}

export function stderr(): WriteStream {
  return new WriteStream(2);
}

// Node's process.kill: sends the signal, SIGTERM unless named; a failure is "kill() failed: <code>: <reason>".
export function kill(pid: i64, signal: string | i64 = "SIGTERM"): boolean throws IoError {
  const failed = unsafe { fsh_rt_kill(pid, signalNumberOf(signal)) };
  if (failed === 0) return true;
  const code = failed === 3 ? "ESRCH" : failed === 1 ? "EPERM" : failed === 22 ? "EINVAL" : "E" + String(failed);
  const text = failed === 3 ? "No such process" : failed === 1 ? "Operation not permitted" : "Invalid argument";
  let e = new IoError("kill() failed: " + code + ": " + text);
  e.code = code;
  e.syscall = "kill";
  throw e;
}

// Aborted by the first SIGINT or SIGTERM; a second exits at once with 130 or 143.
export function shutdown(): AbortSignal {
  return shutdownSignal();
}

export function exit(code: i64 = 0): never {
  unsafe { fsh_rt_exit(code) };
  // The C call never returns.
  while (true) {}
}
`,
  // node:url's file URL functions, for POSIX paths. URL and URLSearchParams are globals.
  url: String.raw`
import { platform } from "std:os";
import { resolve } from "std:path";

// The path made absolute and percent-encoded where a URL's path can't hold it as written, with
// '%', '\' and tabs and newlines encoded too. A trailing slash stays.
export function pathToFileURL(path: string): URL {
  let resolved = resolve(path);
  if (path.endsWith("/") && !resolved.endsWith("/")) resolved = resolved + "/";
  const bytes = new TextEncoder().encode(resolved);
  const hex = "0123456789ABCDEF";
  let out = "file://";
  for (const b of bytes) {
    const c = b as i64;
    if (c <= 32 || c >= 127 || c === 34 || c === 35 || c === 37 || c === 60 || c === 62 || c === 63 || c === 92 || c === 96 || c === 123 || c === 125) {
      out = out + "%" + hex[(c >> 4) as usize] + hex[(c & 15) as usize];
    } else out = out + String.fromCharCode(c as u16);
  }
  try {
    return new URL(out);
  } catch (_e) {
    assert(false, "a file URL built from a path always parses");
    return pathToFileURL("/");
  }
}

// The path a file: URL names, decoded. A host, an encoded '/' or a scheme other than file: is
// refused.
export function fileURLToPath(url: string | URL): string throws TypeError {
  const u = typeof url === "string" ? new URL(url) : url;
  if (u.protocol !== "file:") throw new TypeError("The URL must be of scheme file");
  if (u.hostname !== "") throw new TypeError("File URL host must be \"localhost\" or empty on " + platform());
  const pathname = u.pathname;
  if (pathname.includes("%2f") || pathname.includes("%2F")) throw new TypeError("File URL path must not include encoded / characters");
  const bytes = new TextEncoder().encode(pathname);
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    const high = i + 2 < bytes.length ? hexDigit(bytes[i + 1]) : -1;
    const low = i + 2 < bytes.length ? hexDigit(bytes[i + 2]) : -1;
    if (bytes[i] !== 37) {
      out.push(bytes[i]);
      i += 1;
    } else if (high < 0 || low < 0) throw new TypeError("URI malformed");
    else {
      out.push((high * 16 + low) as u8);
      i += 3;
    }
  }
  // Bytes that aren't UTF-8 decode to U+FFFD, so they don't encode back to themselves.
  const decoded = new TextDecoder().decode(out);
  const again = new TextEncoder().encode(decoded);
  if (again.length !== out.length) throw new TypeError("URI malformed");
  for (let k: usize = 0; k < out.length; k++) if (again[k] !== out[k]) throw new TypeError("URI malformed");
  return decoded;
}

function hexDigit(b: u8): i64 {
  const c = b as i64;
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}
`,
  // Bun's global, as the subset this module documents: file, stdin, write, env, argv, sleep,
  // sleepSync, which, spawn, spawnSync, serve and version, each as Bun 1.4.3 gives it for the shapes
  // here. Bun.build isn't here. spawnSync's stdout and stderr are u8[],
  // empty when not piped, where Bun gives a Buffer, or undefined.
  Bun: String.raw`
import { statSync } from "std:fs";
import { dirname, resolve } from "std:path";
import { bytes as stdinBytes } from "stdin";

declare function fsh_rt_signal_name(n: i64): Ptr<u8>;
declare function usleep(microseconds: u32): i32;
declare function kill(pid: i32, signal: i32): i32;

// A file read when asked, by its path, or standard input's when name is null. Its calls take it
// over, so a temporary's, as in Bun.file(path).text(), outlives its statement.
export class BunFile {
  name: string | null;
  constructor(name: string | null) {
    this.name = name;
  }

  async bytes(this: Own<this>): Promise<u8[]> throws IoError {
    const name = this.name;
    if (name === null) return await stdinBytes();
    return await fileRead(name);
  }

  async text(this: Own<this>): Promise<string> throws IoError {
    const all = await this.bytes();
    return new TextDecoder().decode(all);
  }

  // Whether a regular file is there: a directory isn't one.
  async exists(this: Own<this>): Promise<boolean> {
    const name = this.name;
    if (name === null) return true;
    try {
      return statSync(name).isFile();
    } catch (_e) {
      return false;
    }
  }
}

export function file(path: string): BunFile {
  return new BunFile(path);
}

export function stdin(): BunFile {
  return new BunFile(null);
}

// Writes a file whole, making the directories it is in, and gives how many bytes it wrote.
export async function write(destination: string, data: string | u8[]): Promise<i64> throws IoError {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  dirMake(dirname(destination), true, 511);
  const length = bytes.length as i64;
  await fileWrite(destination, bytes);
  return length;
}

export function env(name: string): string | null {
  return process.env[name];
}

export function argv(): string[] {
  return process.argv;
}

// The prelude's sleep, which this module's own name would hide.
async function sleeping(ms: i64): Promise<void> {
  await sleep(ms);
}

export function sleepSync(ms: i64): void {
  let left = ms;
  while (left > 0) {
    const now = left < 1000 ? left : 1000;
    unsafe { usleep((now * 1000) as u32) };
    left = left - now;
  }
}

// The Bun release whose API this subset follows, since a Fish program has no Bun of its own.
export function version(): string {
  return "1.4.3";
}

function runnable(path: string): boolean {
  try {
    pathAccess(path, 1);
    return statSync(path).isFile();
  } catch (_e) {
    return false;
  }
}

// The executable file a command names, as an absolute path: a path given with a slash, or the
// first on PATH.
export function which(command: string): string | null {
  return found(command, process.env.PATH ?? "");
}

function found(command: string, path: string): string | null {
  if (command === "") return null;
  if (command.includes("/")) return runnable(command) ? resolve(command) : null;
  for (const dir of path.split(":")) {
    if (dir === "") continue;
    const at = resolve(dir, command);
    if (runnable(at)) return at;
  }
  return null;
}

export type SpawnStdio = "pipe" | "inherit" | "ignore";
export type SpawnOptions = { cwd?: string; env?: { [name: string]: string }; stdin?: u8[] | "inherit" | "ignore"; stdout?: SpawnStdio; stderr?: SpawnStdio };

export class SyncSubprocess {
  pid: i64;
  exitCode: i64 | null;
  signalCode: string | null;
  success: boolean;
  stdout: u8[];
  stderr: u8[];
  constructor(pid: i64, exitCode: i64 | null, signalCode: string | null, stdout: u8[], stderr: u8[]) {
    this.pid = pid;
    this.exitCode = exitCode;
    this.signalCode = signalCode;
    this.success = exitCode === 0;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// The runtime's two bits for a stream: piped, inherited or /dev/null.
function streamMode(given: SpawnStdio | null): i64 {
  if (given === null || given === "pipe") return 0;
  return given === "inherit" ? 1 : 2;
}

// Bun's TypeError for a string the C call would cut short, as an IoError with its code.
function nulFree(s: string, what: string): void throws IoError {
  if (!s.includes("\0")) return;
  let bad = new IoError("The " + what + " must be a string without null bytes. Received " + JSON.stringify(s));
  bad.code = "ERR_INVALID_ARG_VALUE";
  throw bad;
}

// What a spawn hands the runtime: the command's file, found on PATH unless it has a slash, its
// stdin's bytes, the runtime's flags and the environment's "K=V" pairs. stdin is options.stdin's
// unless given, and /dev/null when neither says.
function spawnPlan(cmd: Ref<string[]>, options: Ref<SpawnOptions>, stdin: "inherit" | "ignore" | null, out: SpawnStdio, err: SpawnStdio): [string, u8[], i64, string[]] throws IoError {
  if (cmd.length === 0) throw new IoError("cmd must not be empty");
  for (let i: usize = 0; i < cmd.length; i++) nulFree(cmd[i], "argument 'args[" + i + "]'");
  const command = cmd[0];
  let input: u8[] = [];
  // argv[0] travels in the arguments, so the command can be its path while keeping its name.
  let flags: i64 = 2 + 4 * streamMode(out) + 16 * streamMode(err) + 128 + 256;
  const given: Ref<u8[] | "inherit" | "ignore" | null> = options.stdin;
  if (stdin === "inherit") flags = flags - 1;
  else if (stdin === null) {
    if (given === "inherit") flags = flags - 1;
    else if (given !== null && given !== "ignore") {
      flags = flags - 2;
      input = given.clone();
    }
  }
  let pairs: string[] = [];
  let path = process.env.PATH ?? "";
  const env: Ref<{ [name: string]: string } | null> = options.env;
  if (env !== null) {
    flags = flags + 64;
    for (const [key, value] of Object.entries(env)) {
      nulFree(key, "property 'options.env['" + key + "']'");
      nulFree(value, "property 'options.env['" + key + "']'");
      if (key === "PATH") path = value;
      pairs.push(key + "=" + value);
    }
  }
  let file = command;
  if (!command.includes("/")) {
    const at = found(command, path);
    if (at === null) {
      let missing = new IoError('Executable not found in $PATH: "' + command + '"');
      missing.code = "ENOENT";
      missing.path = command;
      throw missing;
    }
    file = at;
  }
  return [file, input, flags, pairs];
}

// A signal's number, as kill() takes it, and its name, as a child's signalCode gives it.
function signalNumber(name: string): i64 {
  for (let n: i64 = 1; n < 65; n++) if (signalName(n) === name) return n;
  assert(false, "Unknown signal: " + name);
  return 0;
}

function signalName(n: i64): string {
  return unsafe { fsh_rt_signal_name(n).isNull() ? "SIG" + n : fromCString(fsh_rt_signal_name(n)) };
}

// Runs a command to its end. stdin is /dev/null unless given, and stdout and stderr are piped
// unless asked otherwise; env, when given, is the child's whole environment, and its PATH, when
// it has one, is where the command is looked for.
export function spawnSync(cmd: string[], options: SpawnOptions = {}): SyncSubprocess throws IoError {
  const [file, input, flags, pairs] = spawnPlan(cmd, options, null, options.stdout ?? "pipe", options.stderr ?? "pipe");
  const [pid, status, signo, stdout, stderr] = processSpawn(file, cmd, options.cwd ?? "", input, flags, pairs);
  const signal = signo === 0 ? null : signalName(signo);
  return new SyncSubprocess(pid, status < 0 ? null : status, signal, stdout, stderr);
}

// Bun.spawn's options this subset takes: stdio gives all three streams at once, in place of stdin,
// stdout and stderr, and detached starts the child in a process group of its own.
export type BunSpawnOptions = { cwd?: string; env?: { [name: string]: string }; stdin?: u8[] | "inherit" | "ignore"; stdout?: SpawnStdio; stderr?: SpawnStdio; stdio?: ["inherit" | "ignore", SpawnStdio, SpawnStdio]; detached?: boolean };

// How a child is doing, and the channels its exit code and output come through. The first of
// exited, stdout and stderr awaited claims the wait, which reads the child's output as it runs.
type ChildState = { handle: i64; claimed: Atomic<boolean>; status: Atomic<i64>; signal: Atomic<i64>; ended: Atomic<boolean>; killed: Atomic<boolean>; exit: Channel<i64>; out: Channel<string>; err: Channel<string> };

// A child Bun.spawn started, running beside the program. Unlike Bun's, its stdout and stderr are
// given whole as text once it ends, each to the first reader, and nothing reads them or waits for
// it until one of exited, stdout and stderr is awaited; exited can be awaited any number of times.
export class Subprocess {
  readonly pid: i64;
  #state: shared<ChildState>;

  constructor(pid: i64, state: shared<ChildState>) {
    this.pid = pid;
    this.#state = state;
  }

  // The child's exit code, or 128 and the signal that ended it, as Bun gives it.
  get exited(): Promise<i64> {
    return childExited(this.#state.clone());
  }

  get exitCode(): i64 | null {
    const status = this.#state.status.load();
    return this.#state.ended.load() && status >= 0 ? status : null;
  }

  get signalCode(): string | null {
    const n = this.#state.signal.load();
    return n === 0 ? null : signalName(n);
  }

  get killed(): boolean {
    return this.#state.killed.load();
  }

  // What the child wrote, for new Response(child.stdout).text(); nothing when it wasn't piped.
  get stdout(): Dyn<AsyncGenerator<string>> {
    return childText(this.#state.clone(), false);
  }

  get stderr(): Dyn<AsyncGenerator<string>> {
    return childText(this.#state.clone(), true);
  }

  // Sends the child a signal, SIGTERM unless named, unless it has already ended.
  kill(signal: string | i64 = "SIGTERM"): void {
    if (this.#state.ended.load()) return;
    const n = typeof signal === "string" ? signalNumber(signal) : signal;
    if (unsafe { kill(this.pid as i32, n as i32) } === 0) this.#state.killed.store(true);
  }
}

// The exit code, put back for the next reader once taken. The first reader starts the wait as a
// task of its own, so a reader dropped while waiting, as the loser of a race is, leaves it running
// for the readers after it.
async function childExited(state: shared<ChildState>): Promise<i64> {
  if (!state.claimed.exchange(true)) spawn(childWaited(state.clone()));
  while (true) {
    const code = await state.exit.receive();
    if (code !== null) {
      await state.exit.send(code);
      return code;
    }
  }
}

async function* childText(state: shared<ChildState>, err: boolean): AsyncGenerator<string> {
  if (!state.claimed.exchange(true)) spawn(childWaited(state.clone()));
  let text: string | null = null;
  if (err) text = await state.err.receive();
  else text = await state.out.receive();
  if (text !== null && text !== "") yield text;
}

// Waits for a child on the blocking pool, records how it ended, and hands its output on.
async function childWaited(state: shared<ChildState>): Promise<void> {
  const handle = state.handle;
  let code: i64 = 1;
  let stdout = "";
  let stderr = "";
  try {
    const [_pid, status, signo, outBytes, errBytes] = await spawnBlocking(() => processFinish(handle));
    state.status.store(status);
    state.signal.store(signo);
    code = status >= 0 ? status : 128 + signo;
    stdout = new TextDecoder().decode(outBytes);
    stderr = new TextDecoder().decode(errBytes);
  } catch (_e) {
    state.status.store(-1);
  }
  state.ended.store(true);
  await state.out.send(stdout);
  await state.err.send(stderr);
  await state.exit.send(code);
}

// Starts a command and gives the running child at once. stdin is /dev/null, stdout piped and
// stderr inherited unless asked otherwise, as Bun has them.
function spawning(cmd: string[], options: BunSpawnOptions = {}): Subprocess throws IoError {
  const stdio = options.stdio;
  const [file, input, flags, pairs] = stdio === null ? spawnPlan(cmd, options, null, options.stdout ?? "pipe", options.stderr ?? "inherit") : spawnPlan(cmd, options, stdio[0], stdio[1], stdio[2]);
  const group: i64 = options.detached === true ? 1024 : 0;
  const [pid, handle, _signo, _out, _err] = processSpawn(file, cmd, options.cwd ?? "", input, flags + 512 + group, pairs);
  const state = shared<ChildState>({ handle, claimed: new Atomic(false), status: new Atomic(-1), signal: new Atomic(0), ended: new Atomic(false), killed: new Atomic(false), exit: new Channel<i64>(1), out: new Channel<string>(1), err: new Channel<string>(1) });
  return new Subprocess(pid, state);
}

// Bun.serve's options this subset takes. fetch is async, and the port 3000 unless given.
export type BunServeOptions = { port?: i64; hostname?: string; unix?: string; tls?: { cert: string; key: string }; signal?: AbortSignal; fetch: (req: Request) => Promise<Response> };

// Serves until the signal, or the first SIGINT or SIGTERM, stops it: unlike Bun's, it is awaited,
// or spawned to run beside the rest of the program, and gives no Server.
async function serving(options: BunServeOptions): Promise<void> throws IoError {
  const unix = options.unix;
  const port = unix === null ? options.port ?? 3000 : options.port;
  await serve({ port, hostname: options.hostname, unix, tls: options.tls, signal: options.signal }, options.fetch);
}

export { sleeping as sleep, serving as serve, spawning as spawn };
`,
};

// Members of a std module read as values, each through a function of its: `argv` as
// `process.argv`, called with nothing, and `env` as a table, `process.env.HOME` and
// `process.env[name]` calling it with the key.
export const STD_VALUES: Record<string, Record<string, "value" | "table">> = {
  process: { argv: "value", env: "table", shutdown: "value", platform: "value", arch: "value", execPath: "value", pid: "value", stdin: "value", stdout: "value", stderr: "value" },
  Bun: { argv: "value", env: "table", stdin: "value", version: "value" },
  os: { constants: "value" },
};

// The compiler's own tests run JS through this module, which no program may import: Fish has no
// way to run JS source, only packages.
export const ENGINE_HOOK = String.raw`
export function evaluate(module: string): JsValue {
  return jsEvaluate(module);
}
`;

// Std's modules that have no Node name: only `std:` reaches them, so npm keeps the bare ones.
export const STD_ONLY = new Set<string>(["tar", "zip", "trace", "inspect", "sim", "grpc", "redis", "auth", "build", "compress"]);

// The std module a specifier names, if any. `std:os` is the name; `node:os` and `os` name it too,
// for code ported from Node, as `bun` names Bun's module.
export function stdModule(specifier: string): string | undefined {
  if (specifier.startsWith("std:")) {
    const own = specifier.slice("std:".length as i64);
    return STD_MODULES[own] !== undefined && own !== "Bun" ? own : undefined;
  }
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length as i64) : specifier;
  // "path/posix" is "path", which is POSIX's here.
  const name = bare === "path/posix" ? "path" : bare === "bun" ? "Bun" : bare;
  return STD_MODULES[name] !== undefined && !STD_ONLY.has(name) ? name : undefined;
}

// The names `std:` reaches, as an error lists them.
export function stdModuleNames(): string[] {
  let names: string[] = [];
  for (const name of Object.keys(STD_MODULES)) if (name !== "Bun") names.push(name);
  names.sort();
  return names;
}

// What awaiting a JS promise that rejects throws: the JS error's message, and what JS threw. It
// is in programs that use a package or name it, as holding a JsValue links the engine in.
const JS_ERROR = String.raw`
class JsError extends Error {
  value: JsValue;
  constructor(message: string, value: JsValue) {
    super(message);
    this.name = "JsError";
    this.value = value;
  }
}
`;

// The web streams API over async generators, in a program that names a stream or uses HTTP.
const STREAMS = `
// What a reader's read() gives: a value, or the end of the stream, as a generator's next() does.
type ReadableStreamReadResult<T> = { done: true } | { done: false; value: T };

// A stream's state, shared by the stream, its reader and its controller: the generator its
// values come from, whether a reader holds it, and for a stream made from an underlying source,
// the values queued and not yet read, whether the source closed, the error it reported and its
// cancel callback. Written out in place rather than named, and one level deep, since a type
// argument inside an alias or a shared inside a shared isn't carried into a generic class's
// instances.
class ReadableStream<T> {
  private state: shared<{ source: Lock<Dyn<AsyncGenerator<T>>[]>; locked: Atomic<i64>; items: Lock<T[]>; closed: Atomic<i64>; failure: Lock<Error[]>; cancel: Lock<((reason: string) => void)[]> }>;

  constructor(source?: UnderlyingSource<T>) {
    const generators: Dyn<AsyncGenerator<T>>[] = [];
    const cancels: ((reason: string) => void)[] = [];
    this.state = shared<{ source: Lock<Dyn<AsyncGenerator<T>>[]>; locked: Atomic<i64>; items: Lock<T[]>; closed: Atomic<i64>; failure: Lock<Error[]>; cancel: Lock<((reason: string) => void)[]> }>({ source: new Lock(generators), locked: new Atomic(0), items: new Lock<T[]>([]), closed: new Atomic(0), failure: new Lock<Error[]>([]), cancel: new Lock(cancels) });
    if (source !== null) {
      const start = source.start;
      const pull = source.pull;
      const cancel = source.cancel;
      if (cancel !== null) this.state.cancel.update((c) => c.push(cancel));
      const controller = new ReadableStreamDefaultController<T>(this.__handle());
      this.state.source.update((g) => g.push(__streamPulled<T>(start, pull, controller)));
    }
  }

  // A stream of what the generator yields, as ReadableStream.from reads an async iterable.
  static from<V>(generator: AsyncGenerator<V>): ReadableStream<V> {
    let stream = new ReadableStream<V>();
    stream.state.source.update((g) => g.push(generator));
    return stream;
  }

  // Whether a reader holds the stream, so no other can read it.
  get locked(): boolean {
    return this.state.locked.load() === 1;
  }

  // A reader of the stream, which locks it until the reader lets it go.
  getReader(): ReadableStreamDefaultReader<T> throws TypeError {
    if (this.state.locked.load() === 1) throw new TypeError("this ReadableStream is locked to a reader; release it with 'reader.releaseLock()' first");
    this.state.locked.store(1);
    return new ReadableStreamDefaultReader<T>(this.__handle());
  }

  // Ends the stream without reading the rest, running its source's cancel.
  async cancel(reason?: string): Promise<void> throws TypeError {
    if (this.state.locked.load() === 1) throw new TypeError("a locked ReadableStream can't be cancelled; cancel it through its reader");
    this.__cancel(reason ?? "");
  }

  // A second handle on the same stream, which a reader, a controller or a pipe in another task
  // reads and changes it through.
  __handle(): ReadableStream<T> {
    let stream = new ReadableStream<T>();
    stream.state = this.state.clone();
    return stream;
  }

  // The generator, taken out while a read runs it, since a lock can't be held across an await.
  __pop(): Dyn<AsyncGenerator<T>> | null {
    return this.state.source.update((s) => s.pop());
  }

  __push(g: Dyn<AsyncGenerator<T>>) {
    this.state.source.update((s) => s.push(g));
  }

  __lock(): void throws TypeError {
    if (this.state.locked.load() === 1) throw new TypeError("this ReadableStream is locked to a reader; release it with 'reader.releaseLock()' first");
    this.state.locked.store(1);
  }

  // Throws the error the stream's source reported through its controller, if it did.
  __failed(): void throws Error {
    const failed = this.state.failure.update((f) => f.length > 0 ? f[0]!.message : null);
    if (failed !== null) throw new Error(failed);
  }

  // Drops the stream's generator unread and runs its source's cancel, once.
  __cancel(reason: string) {
    this.state.source.update((s) => {
      while (s.length > 0) s.pop();
    });
    this.state.closed.store(1);
    const cancel = this.state.cancel.update((c) => c.pop());
    if (cancel !== null) cancel(reason);
  }

  __unlock() {
    this.state.locked.store(0);
  }

  // Queuing into a closed stream panics, where JavaScript throws, so a source's callbacks
  // needn't declare a throw.
  __enqueue(chunk: T) {
    assert(this.state.closed.load() === 0, "this ReadableStream is closed, so nothing more can be enqueued");
    this.state.items.update((xs) => xs.push(chunk));
  }

  __close() {
    this.state.closed.store(1);
  }

  __error(e: Error) {
    this.state.failure.update((f) => f.push(e));
    this.state.items.update((xs) => {
      while (xs.length > 0) xs.pop();
    });
    this.state.closed.store(1);
  }

  // The first queued value, taken out, or null when nothing is queued.
  __take(): T | null {
    return this.state.items.update((xs) => xs.length > 0 ? xs.shift() : null);
  }

  __closed(): boolean {
    return this.state.closed.load() === 1;
  }

  __empty(): boolean {
    return this.state.items.update((xs) => xs.length === 0);
  }

  // What 'for await' over the stream reads, which locks it for good: the generator itself. A
  // loop can't catch, so reading a locked stream this way panics, where JavaScript throws.
  __values(): Dyn<AsyncGenerator<T>> {
    assert(this.state.locked.load() === 0, "this ReadableStream is locked to a reader, so 'for await' can't read it; release the reader's lock first");
    this.state.locked.store(1);
    const g = this.state.source.update((s) => s.pop());
    if (g === null) return __streamNone<T>();
    return g;
  }

  // Writes each value into the destination, closing it at the end; a failure on either side
  // aborts the destination and is thrown here.
  async pipeTo(dest: Ref<WritableStream<T>>): Promise<void> throws Error | TypeError {
    await __streamPipe<T>(this, dest);
  }

  // The pair's readable side, with this stream piped into its writable side once it is read.
  pipeThrough<U>(pair: { writable: WritableStream<T>; readable: ReadableStream<U> }): ReadableStream<U> {
    const writable = pair.writable;
    const readable = pair.readable;
    return ReadableStream.from<U>(__streamThrough<T, U>(this.__handle(), writable, readable));
  }
}

async function* __streamNone<T>(): AsyncGenerator<T> {}

// The readable side of a pair, with the pipe into its writable side started on the first read,
// where a task can be spawned.
async function* __streamThrough<T, U>(from: ReadableStream<T>, to: WritableStream<T>, out: ReadableStream<U>): AsyncGenerator<U> {
  const _piping = spawn(__streamPiped<T>(from, to));
  for await (const x of out) yield x;
}

// A pipe run for its effect: its failure has already aborted the destination.
async function __streamPiped<T>(from: ReadableStream<T>, to: WritableStream<T>): Promise<void> {
  try {
    await __streamPipe<T>(from, to);
  } catch (_e) {}
}

// Generic code awaits these free functions rather than a stream's async methods, which
// code generation can't yet reach from inside another generic body.

// A stream's next value, or its end; an error its source reported is thrown here.
async function __streamRead<T>(s: Ref<ReadableStream<T>>): Promise<ReadableStreamReadResult<T>> throws Error {
  const taken = s.__pop();
  if (taken === null) {
    s.__failed();
    return { done: true };
  }
  let g = taken;
  const step = await g.next();
  s.__push(g);
  if (step.done === false) return { done: false, value: step.value };
  s.__failed();
  return { done: true };
}

// Writes each of a stream's values into the destination and closes it; a failure aborts the
// destination and is thrown.
async function __streamPipe<T>(from: Ref<ReadableStream<T>>, to: Ref<WritableStream<T>>): Promise<void> throws Error | TypeError {
  from.__lock();
  to.__lock();
  try {
    while (true) {
      const r = await __streamRead<T>(from);
      if (r.done === true) break;
      to.__write(r.value);
    }
  } catch (e) {
    to.__abort(e.message);
    throw e;
  }
  to.__close();
  to.__unlock();
  from.__unlock();
}

class ReadableStreamDefaultReader<T> {
  private stream: ReadableStream<T>;
  private released: boolean = false;

  constructor(stream: ReadableStream<T>) {
    this.stream = stream;
  }

  // The stream's next value, or its end; an error its source reported is thrown here.
  async read(): Promise<ReadableStreamReadResult<T>> throws Error | TypeError {
    if (this.released) throw new TypeError("this reader has released its lock, so it can't read");
    const r = await __streamRead<T>(this.stream);
    return r;
  }

  // Ends the stream without reading the rest, running its source's cancel.
  async cancel(reason?: string): Promise<void> {
    this.stream.__cancel(reason ?? "");
  }

  // Lets the stream go, so another reader can take it.
  releaseLock(this: Mut<this>) {
    if (this.released) return;
    this.released = true;
    this.stream.__unlock();
  }
}

// What a writable stream's sink is given: each chunk to write, then close at the end, or abort
// with the reason when the pipe or writer gives up.
// Plain functions, not async ones: a function stored in an object can't be async yet.
type UnderlyingSink<T> = { write?: (chunk: T) => void; close?: () => void; abort?: (reason: string) => void };

// A destination values are written into through a writer, one at a time.
class WritableStream<T> {
  private sink: shared<{ write: Lock<((chunk: T) => void)[]>; close: Lock<(() => void)[]>; abort: Lock<((reason: string) => void)[]>; locked: Atomic<i64>; closed: Atomic<i64> }>;

  constructor(sink?: UnderlyingSink<T>) {
    let writes: ((chunk: T) => void)[] = [];
    let closes: (() => void)[] = [];
    let aborts: ((reason: string) => void)[] = [];
    if (sink !== null) {
      const write = sink.write;
      if (write !== null) writes.push(write);
      const close = sink.close;
      if (close !== null) closes.push(close);
      const abort = sink.abort;
      if (abort !== null) aborts.push(abort);
    }
    this.sink = shared<{ write: Lock<((chunk: T) => void)[]>; close: Lock<(() => void)[]>; abort: Lock<((reason: string) => void)[]>; locked: Atomic<i64>; closed: Atomic<i64> }>({ write: new Lock(writes), close: new Lock(closes), abort: new Lock(aborts), locked: new Atomic(0), closed: new Atomic(0) });
  }

  get locked(): boolean {
    return this.sink.locked.load() === 1;
  }

  __lock(): void throws TypeError {
    if (this.sink.locked.load() === 1) throw new TypeError("this WritableStream is locked to a writer; release it with 'writer.releaseLock()' first");
    this.sink.locked.store(1);
  }

  __unlock() {
    this.sink.locked.store(0);
  }

  __write(chunk: T) {
    if (this.sink.closed.load() === 1) return;
    const write = this.sink.write.update((w) => w.length > 0 ? w[0]!.clone() : null);
    if (write !== null) write(chunk);
  }

  __close() {
    if (this.sink.closed.load() === 1) return;
    this.sink.closed.store(1);
    const close = this.sink.close.update((c) => c.pop());
    if (close !== null) close();
  }

  __abort(reason: string) {
    if (this.sink.closed.load() === 1) return;
    this.sink.closed.store(1);
    const abort = this.sink.abort.update((a) => a.pop());
    if (abort !== null) abort(reason);
  }

  // A writer of the stream, which locks it until the writer lets it go.
  getWriter(): WritableStreamDefaultWriter<T> throws TypeError {
    if (this.sink.locked.load() === 1) throw new TypeError("this WritableStream is locked to a writer; release it with 'writer.releaseLock()' first");
    this.sink.locked.store(1);
    return new WritableStreamDefaultWriter<T>(this.sink.clone());
  }
}

class WritableStreamDefaultWriter<T> {
  private sink: shared<{ write: Lock<((chunk: T) => void)[]>; close: Lock<(() => void)[]>; abort: Lock<((reason: string) => void)[]>; locked: Atomic<i64>; closed: Atomic<i64> }>;
  private released: boolean = false;

  constructor(sink: shared<{ write: Lock<((chunk: T) => void)[]>; close: Lock<(() => void)[]>; abort: Lock<((reason: string) => void)[]>; locked: Atomic<i64>; closed: Atomic<i64> }>) {
    this.sink = sink;
  }

  // Hands the chunk to the sink's write, waiting until it has taken it.
  async write(chunk: T): Promise<void> throws TypeError {
    if (this.released) throw new TypeError("this writer has released its lock, so it can't write");
    if (this.sink.closed.load() === 1) throw new TypeError("this WritableStream is closed, so nothing more can be written");
    const write = this.sink.write.update((w) => w.length > 0 ? w[0]!.clone() : null);
    if (write !== null) write(chunk);
  }

  // Ends the stream, running the sink's close once.
  async close(): Promise<void> {
    if (this.sink.closed.load() === 1) return;
    this.sink.closed.store(1);
    const close = this.sink.close.update((c) => c.pop());
    if (close !== null) close();
  }

  // Gives the stream up, running the sink's abort with the reason once.
  abort(reason?: string) {
    if (this.sink.closed.load() === 1) return;
    this.sink.closed.store(1);
    const abort = this.sink.abort.update((a) => a.pop());
    if (abort !== null) abort(reason ?? "");
  }

  releaseLock(this: Mut<this>) {
    if (this.released) return;
    this.released = true;
    this.sink.locked.store(0);
  }
}

// What an underlying source's callbacks are given: start once before the first read, pull when
// the queue is empty, and cancel with its reason when a reader cancels.
// Plain functions, not async ones: a function stored in an object can't be async yet.
type UnderlyingSource<T> = { start?: (controller: ReadableStreamDefaultController<T>) => void; pull?: (controller: ReadableStreamDefaultController<T>) => void; cancel?: (reason: string) => void };

// What a source queues values through. The queue is unbounded and enqueue never waits: a source
// held back reads the queue's emptiness through pull being called only when nothing is queued.
class ReadableStreamDefaultController<T> {
  private stream: ReadableStream<T>;

  constructor(stream: ReadableStream<T>) {
    this.stream = stream;
  }

  // Queuing into a closed stream panics, where JavaScript throws.
  enqueue(chunk: T) {
    this.stream.__enqueue(chunk);
  }

  // Ends the stream once what is queued has been read.
  close() {
    this.stream.__close();
  }

  // Ends the stream with an error, which its reader's next read throws.
  error(e: Error) {
    this.stream.__error(e);
  }

  __copy(): ReadableStreamDefaultController<T> {
    return new ReadableStreamDefaultController<T>(this.stream.__handle());
  }

  __take(): T | null {
    return this.stream.__take();
  }

  __closed(): boolean {
    return this.stream.__closed();
  }

  __empty(): boolean {
    return this.stream.__empty();
  }
}

// A source's values as a generator: start first, then each queued value, pulling for more when
// none is queued, until the source closes or errors.
async function* __streamPulled<T>(start: ((controller: ReadableStreamDefaultController<T>) => void) | null, pull: ((controller: ReadableStreamDefaultController<T>) => void) | null, controller: ReadableStreamDefaultController<T>): AsyncGenerator<T> {
  if (start !== null) start(controller.__copy());
  while (true) {
    const next = controller.__take();
    if (next !== null) {
      yield next;
      continue;
    }
    if (controller.__closed()) return;
    if (pull !== null) pull(controller.__copy());
    // ponytail: a source that queued nothing, enqueuing from elsewhere, is polled each
    // millisecond; a notification from enqueue would wake the reader at once.
    if (!controller.__closed() && controller.__empty()) await sleep(1);
  }
}
`;

// Html and what a JSX element is read as, for a program that writes one, names Html, or serves HTTP.
const HTML_NAMES = ["Html", "__htmlOf", "__htmlFrom", "__htmlChild", "__htmlAttr"];
const HTML = String.raw`
// Markup that is escaped already, which is what a JSX element gives. Made from a string it takes
// the text as markup and escapes nothing, so that is for markup a program trusts.
class Html {
  private text: string;
  constructor(text: string) { this.text = text; }
  toString(): string { return this.text; }
}
function __htmlEscape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function __htmlOf(text: string): Html { return new Html(text); }
function __htmlFrom(h: Ref<Html>): string { return h.toString(); }
// What an element's '{...}' holds, as markup: a string escaped, a number written out, an Html or
// each of an array of them as it is, and nothing for null.
function __htmlChild(x: Ref<string | i8 | i16 | i32 | i64 | isize | u8 | u16 | u32 | u64 | usize | f32 | f64 | Html | Html[] | null>): string {
  if (x === null) return "";
  if (typeof x === "string") return __htmlEscape(x);
  if (typeof x === "number") return JSON.stringify(x);
  if (x instanceof Html) return x.toString();
  let out = "";
  for (const h of x) out += h.toString();
  return out;
}
// One attribute as it is written in a tag: its name alone for true, nothing for false and null,
// and otherwise its value escaped between double quotes.
function __htmlAttr(name: string, value: Ref<string | i8 | i16 | i32 | i64 | isize | u8 | u16 | u32 | u64 | usize | f32 | f64 | boolean | null>): string {
  if (value === null || value === false) return "";
  if (value === true) return " " + name;
  return " " + name + "=\"" + __htmlEscape(typeof value === "string" ? value : JSON.stringify(value)) + "\"";
}
`;

// Arena<T>, for a program that names it and declares no Arena of its own.
const ARENA = String.raw`
// An arena: a value moved in with alloc stays where it is until the arena drops, when every value
// is dropped, so alloc lends it back for as long as the arena is borrowed. A chunk is filled to the
// room reserved for it and never grows, which keeps a value in place while later ones are added.
// The count is a Cell so an arena, changed through a shared reference, stays on one thread.
class Arena<T> {
  private chunks: T[][] = [];
  private count: Cell<usize> = new Cell<usize>(0);
  get length(): usize { return this.count.get(); }
  alloc(this: Cell<this>, value: T): Mut<T> {
    const full = this.chunks.length === 0 || this.chunks[this.chunks.length - 1].length === this.chunks[this.chunks.length - 1].capacity;
    if (full) {
      let chunk: T[] = [];
      chunk.reserve(this.chunks.length < 9 ? 8 << (this.chunks.length as i64) : 4096);
      this.chunks.push(chunk);
    }
    this.count.set(this.count.get() + 1);
    this.chunks[this.chunks.length - 1].push(value);
    return this.chunks[this.chunks.length - 1][this.chunks[this.chunks.length - 1].length - 1];
  }
  // Newest first, as a function's variables are dropped. A value holds references only to values
  // added before it, since none can be stored through the reference alloc gave, so whatever a
  // value's own disposer reads is still there. Quoted, since the prelude's computed names are
  // never lowered and this is the name a '[Symbol.dispose]' method is lowered to.
  "[Symbol.dispose]"(this: Mut<this>) {
    while (this.chunks.length > 0) {
      while (this.chunks[this.chunks.length - 1].length > 0) this.chunks[this.chunks.length - 1].pop();
      this.chunks.pop();
    }
  }
}
`;
const SIMD = `
// SIMD vectors' load and store, which the checker turns f32x4.load(a, i) and v.store(a, i)
// into, so the array is borrowed as by any function. The rest are LLVM vector instructions.
// LLVM's optimizer turns these lane reads and writes into vector loads and stores.
function __simd_f32x4_load(a: Ref<f32[]>, i: usize): f32x4 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3]]; }
function __simd_f32x4_store(v: f32x4, a: Mut<f32[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; }
function __simd_f32x8_load(a: Ref<f32[]>, i: usize): f32x8 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7]]; }
function __simd_f32x8_store(v: f32x8, a: Mut<f32[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; a[i + 4] = v[4]; a[i + 5] = v[5]; a[i + 6] = v[6]; a[i + 7] = v[7]; }
function __simd_f64x2_load(a: Ref<f64[]>, i: usize): f64x2 { return [a[i + 0], a[i + 1]]; }
function __simd_f64x2_store(v: f64x2, a: Mut<f64[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; }
function __simd_f64x4_load(a: Ref<f64[]>, i: usize): f64x4 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3]]; }
function __simd_f64x4_store(v: f64x4, a: Mut<f64[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; }
function __simd_i8x16_load(a: Ref<i8[]>, i: usize): i8x16 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7], a[i + 8], a[i + 9], a[i + 10], a[i + 11], a[i + 12], a[i + 13], a[i + 14], a[i + 15]]; }
function __simd_i8x16_store(v: i8x16, a: Mut<i8[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; a[i + 4] = v[4]; a[i + 5] = v[5]; a[i + 6] = v[6]; a[i + 7] = v[7]; a[i + 8] = v[8]; a[i + 9] = v[9]; a[i + 10] = v[10]; a[i + 11] = v[11]; a[i + 12] = v[12]; a[i + 13] = v[13]; a[i + 14] = v[14]; a[i + 15] = v[15]; }
function __simd_u8x16_load(a: Ref<u8[]>, i: usize): u8x16 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7], a[i + 8], a[i + 9], a[i + 10], a[i + 11], a[i + 12], a[i + 13], a[i + 14], a[i + 15]]; }
function __simd_u8x16_store(v: u8x16, a: Mut<u8[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; a[i + 4] = v[4]; a[i + 5] = v[5]; a[i + 6] = v[6]; a[i + 7] = v[7]; a[i + 8] = v[8]; a[i + 9] = v[9]; a[i + 10] = v[10]; a[i + 11] = v[11]; a[i + 12] = v[12]; a[i + 13] = v[13]; a[i + 14] = v[14]; a[i + 15] = v[15]; }
function __simd_i16x8_load(a: Ref<i16[]>, i: usize): i16x8 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7]]; }
function __simd_i16x8_store(v: i16x8, a: Mut<i16[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; a[i + 4] = v[4]; a[i + 5] = v[5]; a[i + 6] = v[6]; a[i + 7] = v[7]; }
function __simd_i32x4_load(a: Ref<i32[]>, i: usize): i32x4 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3]]; }
function __simd_i32x4_store(v: i32x4, a: Mut<i32[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; }
function __simd_i32x8_load(a: Ref<i32[]>, i: usize): i32x8 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7]]; }
function __simd_i32x8_store(v: i32x8, a: Mut<i32[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; a[i + 4] = v[4]; a[i + 5] = v[5]; a[i + 6] = v[6]; a[i + 7] = v[7]; }
function __simd_i64x2_load(a: Ref<i64[]>, i: usize): i64x2 { return [a[i + 0], a[i + 1]]; }
function __simd_i64x2_store(v: i64x2, a: Mut<i64[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; }
function __simd_u32x4_load(a: Ref<u32[]>, i: usize): u32x4 { return [a[i + 0], a[i + 1], a[i + 2], a[i + 3]]; }
function __simd_u32x4_store(v: u32x4, a: Mut<u32[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; a[i + 3] = v[3]; }
function __simd_u64x2_load(a: Ref<u64[]>, i: usize): u64x2 { return [a[i + 0], a[i + 1]]; }
function __simd_u64x2_store(v: u64x2, a: Mut<u64[]>, i: usize): void { a[i + 0] = v[0]; a[i + 1] = v[1]; }
`;
export const STD_SOURCE = PRELUDE + HTTP + TRACE + FETCH + SERVED + URL_CORE + URL_LIB + JSON_VALUE + JSON_NAME + AST + AST_HELPERS + JS_ERROR + BYTES + TYPED + DATA_VIEW + BUFFER + BTOA + ATOB + DATE + STDIN + TLS + STREAMS + ARENA + HTML + SIMD;
export const STD_FILE = "<fish std>";
// std's text as a program's last source, for rendering an error or a panic inside it.
export const STD: Source = { base: STD_BASE, src: STD_SOURCE, file: STD_FILE };

// The std statements a program is checked with, their spans moved past its own.
/** @throws {CompileError} */
export function stdFor(compilation: Mut<Compilation>, written: Ref<Stmt[]>): Stmt[] {
  // Each call takes its own copy, since the passes below change the tree, numbered as it is taken.
  let all: Stmt[] = [];
  if (compilation.session.std.cached) all = [...compilation.session.std.tree];
  else {
    compilation.session.std.parses++;
    all = parse(STD_SOURCE, { last: 0 });
  }
  // The statements of each of std's sections, in the order STD_SOURCE joins them.
  let sections: Stmt[][] = [];
  let from: usize = 0;
  for (const text of [PRELUDE, HTTP, TRACE, FETCH, SERVED, URL_CORE, URL_LIB, JSON_VALUE, JSON_NAME, AST + AST_HELPERS, JS_ERROR, BYTES, TYPED, DATA_VIEW, BUFFER, BTOA, ATOB, DATE, STDIN, TLS, STREAMS, ARENA, HTML, SIMD]) {
    const start = from;
    from += text.length;
    sections.push(all.filter((s) => s.start >= start && s.start < from));
  }
  let prelude = sections.shift()!;
  let http = sections.shift()!;
  let tracing = sections.shift()!;
  let fetching = sections.shift()!;
  let served = sections.shift()!;
  let core = sections.shift()!;
  let url = sections.shift()!;
  let json = sections.shift()!;
  let jsonName = sections.shift()!;
  let ast = sections.shift()!;
  let js = sections.shift()!;
  let bytes = sections.shift()!;
  let typed = sections.shift()!;
  let dataView = sections.shift()!;
  let buffer = sections.shift()!;
  let btoa = sections.shift()!;
  let atob = sections.shift()!;
  let dates = sections.shift()!;
  let reading = sections.shift()!;
  let tls = sections.shift()!;
  let streaming = sections.shift()!;
  let arenas = sections.shift()!;
  let htmls = sections.shift()!;
  let simds = sections.shift()!;
  renamed(json, { kind: "json" });
  renamed(jsonName, { kind: "json" });
  let astNames: string[] = [];
  for (const s of ast) for (const n of declaredNames(s)) astNames.push(n);
  const packages = written.some((s) => fromPackage(s));
  // A program's own URL, URLSearchParams or TypeError keeps its name, and std's takes one no
  // program can write.
  let declared = new Set<string>();
  for (const s of written) for (const n of declaredNames(s)) declared.add(n);
  const own = new Set(HIDDEN_NAMES.filter((n) => declared.has(n)));
  // fetch, URL and a Request the program builds read any URL, so they need the whole parser. The
  // server's requests, from a Host it checked and a target, need only its host and path rules.
  // The std:trace module's code names __traceOn, and what it wraps is sent through Http1.
  const httpUsed = uses(written, http, [...HTTP_NAMES, "__traceOn"]);
  const fetchUsed = httpUsed && uses(written, fetching, ["fetch"]);
  const urlWanted = fetchUsed || uses(written, [], URL_NAMES) || (httpUsed && mentionsName(written, "Request"));
  // The libraries a program gets by naming them; JsError also comes with any package.
  const jsonUsed = uses(written, json, ["Json", "JSON"]);
  const jsonNameUsed = uses(written, jsonName, ["Json"]);
  const astUsed = uses(written, ast, [...astNames, "quote", "quoteType"]);
  const jsUsed = uses(written, js, ["JsError"]) || packages;
  const dataViewUsed = uses(written, dataView, ["DataView"]);
  const bufferUsed = mentionsName(written, "Buffer") || mentionsName(written, "BufferEncoding");
  const btoaUsed = uses(written, btoa, ["btoa"]);
  const atobUsed = uses(written, atob, ["atob"]);
  const readingUsed = uses(written, reading, ["readLine", "__stdinTake", "prompt"]);
  // The checker turns 'bytes.toBase64()' and 'u8.fromHex(s)' into calls of these helpers, and
  // btoa, atob and Buffer call them too.
  const encoding = httpUsed || bufferUsed || (btoaUsed && btoa.length > 0) || (atobUsed && atob.length > 0) || mentionsEncoder(written);
  const dated = httpUsed || uses(written, dates, ["Date"]);
  const secure = fetchUsed || uses(written, tls, ["__tlsClient", "__tlsClientOffering"]);
  const streamed = httpUsed || uses(written, streaming, STREAM_NAMES);
  // The checker turns typed arrays' constructors and methods into calls of these helpers.
  const typing = (dataViewUsed && dataView.length > 0) || mentionsTypedArray(written);
  let chosen: Stmt[] = prelude;
  if (dated) chosen = chosen.concat(dates);
  if (httpUsed) chosen = chosen.concat(http).concat(tracing);
  if (fetchUsed) chosen = chosen.concat(fetching);
  if (httpUsed && !urlWanted) chosen = chosen.concat(served);
  if (httpUsed || urlWanted) chosen = chosen.concat(core);
  if (urlWanted) chosen = chosen.concat(url);
  if (jsonUsed) chosen = chosen.concat(json);
  if (jsonNameUsed) chosen = chosen.concat(jsonName);
  if (astUsed) chosen = chosen.concat(ast);
  if (jsUsed) chosen = chosen.concat(js);
  if (dataViewUsed) chosen = chosen.concat(dataView);
  if (bufferUsed) chosen = chosen.concat(buffer);
  if (btoaUsed) chosen = chosen.concat(btoa);
  if (atobUsed) chosen = chosen.concat(atob);
  if (readingUsed) chosen = chosen.concat(reading);
  if (encoding) chosen = chosen.concat(bytes);
  if (typing) chosen = chosen.concat(typed);
  if (secure) chosen = chosen.concat(tls);
  if (streamed) chosen = chosen.concat(streaming);
  if (uses(written, arenas, ["Arena"])) chosen = chosen.concat(arenas);
  // Response.html takes an Html, so every program that serves HTTP has it.
  if (httpUsed || uses(written, htmls, HTML_NAMES)) chosen = chosen.concat(htmls);
  // The checker turns SIMD vectors' constructors and methods into calls of these helpers.
  if (uses(written, simds, [...SIMD_TYPES.keys(), ...SIMD_MASKS.keys()])) chosen = chosen.concat(simds);
  // A C function the program declares already, as a std module it imports may, is declared once.
  const foreign = foreignShapes(written);
  if (foreign.size > 0) chosen = chosen.filter((s) => !declaredNames(s).some((n) => sameForeign(foreign, s, n)));
  if (own.size > 0) renamed(chosen, { kind: "own", names: own });
  // The array iterators' generators and the promise cells take names no program can write, so
  // none hides them.
  renamed(chosen, { kind: "helpers" });
  return renumberStmts(chosen, () => nextId(compilation.ids), STD_BASE);
}

// The names std gives a program a library under where they would clash: the prelude's helpers,
// declared and called as `__arrayFilled`, become `array filled`; std's classes a program declares
// its own of become `std URL`; and the JSON value alias takes its unwritable name, shown as `Json`.
type Renaming = { kind: "helpers" } | { kind: "own"; names: Set<string> } | { kind: "json" };

// The name `renaming` gives a node of kind `kind` named `name`, if it renames it.
function renameOf(renaming: Ref<Renaming>, kind: string, name: string): string | undefined {
  if (renaming.kind === "json") return (kind === "ref" || kind === "typeAlias") && name === "JsonValue" ? JSON_VALUE_NAME : undefined;
  if (renaming.kind === "own") return (kind === "class" || kind === "ident" || kind === "ref") && renaming.names.has(name) ? `std ${name}` : undefined;
  const helper = kind === "function" || kind === "ident" || kind === "typeAlias" || kind === "ref" || kind === "field" || kind === "member";
  if (!helper || !/^__(array|iter|promise|timer|timeout|router|url|date|number)/.test(name)) return undefined;
  let out = "";
  for (const c of name.slice(2)) out += c >= "A" && c <= "Z" ? ` ${c.toLowerCase()}` : c;
  return out;
}

function renamed(statements: Mut<Stmt[]>, renaming: Ref<Renaming>): void {
  let rewrites = new Rewrites();
  walk({ of: "stmts", node: statements }, (n) => {
    if (n.of === "stmt") {
      const s = n.node;
      if (s.kind === "function") {
        const name = renameOf(renaming, s.kind, s.name);
        if (name !== undefined) rewrites.replaceStmt(s, { ...s, name });
      } else if (s.kind === "class" && s.name !== undefined) {
        const name = renameOf(renaming, s.kind, s.name);
        if (name !== undefined) rewrites.replaceStmt(s, { ...s, name });
      } else if (s.kind === "typeAlias") {
        const name = renameOf(renaming, s.kind, s.name);
        if (name !== undefined && renaming.kind === "json") rewrites.replaceStmt(s, { ...s, name, shown: "Json" });
        else if (name !== undefined) rewrites.replaceStmt(s, { ...s, name });
      }
    } else if (n.of === "expr") {
      const e = n.node;
      if (e.kind === "ident") {
        const name = renameOf(renaming, e.kind, e.name);
        if (name !== undefined) rewrites.replace(e, { ...e, name });
      } else if (e.kind === "member") {
        const name = renameOf(renaming, e.kind, e.name);
        if (name !== undefined) rewrites.replace(e, { ...e, name });
      }
    } else if (n.of === "func") {
      const f = n.node;
      const name = renameOf(renaming, f.kind, f.name);
      if (name !== undefined) rewrites.replaceFunc(f, { ...f, name });
    } else if (n.of === "pattern") {
      const p = n.node;
      if (p.kind === "ident") {
        const name = renameOf(renaming, p.kind, p.name);
        if (name !== undefined) rewrites.replacePattern(p, { ...p, name });
      }
    } else if (n.of === "typeNode") {
      const t = n.node;
      if (t.kind === "ref") {
        const name = renameOf(renaming, t.kind, t.name);
        if (name !== undefined) rewrites.replaceTypeNode(t, { ...t, name });
      }
    } else if (n.of === "classMember") {
      const m = n.node;
      if (m.kind === "field" && typeof m.name === "string") {
        const name = renameOf(renaming, m.kind, m.name);
        if (name !== undefined) rewrites.replaceClassMember(m, { ...m, name });
      }
    }
  });
  rebuiltStmts(statements, rewrites);
}

// A call of a byte encoder or decoder: 'x.toBase64', 'x.toHex', 'u8.fromBase64' or 'u8.fromHex'.
function mentionsEncoder(statements: Ref<Stmt[]>): boolean {
  return someNode({ of: "stmts", node: statements }, (n) => {
    if (n.of !== "expr" || n.node.kind !== "member") return false;
    const m = n.node;
    return BYTE_METHODS.includes(m.name) || (BYTE_STATICS.includes(m.name) && m.object.kind === "ident" && m.object.name === "u8");
  });
}

// Whether a name or a type names this.
function mentionsName(statements: Ref<Stmt[]>, name: string): boolean {
  return someNode({ of: "stmts", node: statements }, (n) => nameOf(n) === name);
}

function mentionsTypedArray(statements: Ref<Stmt[]>): boolean {
  return someNode({ of: "stmts", node: statements }, (n) => {
    const name = nameOf(n);
    return name !== undefined && TYPED_ARRAY_NAMES.has(name);
  });
}

// The name an identifier or a type reference writes, a binding's included.
function nameOf(n: Ref<AnyNode>): string | undefined {
  if (n.of === "expr" && n.node.kind === "ident") return n.node.name;
  if (n.of === "pattern" && n.node.kind === "ident") return n.node.name;
  if (n.of === "typeNode" && n.node.kind === "ref") return n.node.name;
  return undefined;
}

// A program that refers to a library by one of its names gets it, unless it declares one of the
// library's top-level names itself.
// A declaration a package made, as its imports are linked into the program.
function fromPackage(s: Ref<Stmt>): boolean {
  return s.kind === "export" || s.kind === "declare" ? fromPackage(s.body) : "js" in s && s.js !== undefined;
}

function uses(written: Ref<Stmt[]>, library: Ref<Stmt[]>, wanted: Ref<string[]>): boolean {
  let declared = new Set<string>();
  for (const s of written) for (const n of declaredNames(s)) declared.add(n);
  // A C function both declare alike is one function, as a std module and a section may each need it.
  const foreign = foreignShapes(written);
  for (const s of library) for (const n of declaredNames(s)) if (declared.has(n) && !sameForeign(foreign, s, n)) return false;
  // A name the program declares is its own, not the library's.
  return someNode({ of: "stmts", node: written }, (n) => {
    const name = nameOf(n);
    return name !== undefined && wanted.includes(name) && !declared.has(name);
  });
}

// Whether a statement declares a C function, `declare function f(...): T;`.
function cDeclaration(s: Ref<Stmt>): boolean {
  return s.kind === "declare" && s.body.kind === "function" && s.body.body === undefined;
}

// The C functions these statements declare, each with its parameters' and result's types.
function foreignShapes(statements: Ref<Stmt[]>): Map<string, string> {
  let out = new Map<string, string>();
  for (const s of statements) {
    const shape = foreignSignature(s);
    if (shape === undefined) continue;
    for (const n of declaredNames(s)) out.set(n, shape);
  }
  return out;
}

// Whether `s` declares the C function `n` with the types the program's declaration has.
function sameForeign(foreign: Ref<Map<string, string>>, s: Ref<Stmt>, n: string): boolean {
  const theirs = foreign.get(n);
  return theirs !== undefined && foreignSignature(s) === theirs;
}

// A C declaration's parameter types and result type, its parameters' names left out.
function foreignSignature(s: Ref<Stmt>): string | undefined {
  if (s.kind !== "declare" || s.body.kind !== "function" || s.body.body !== undefined) return undefined;
  let parts: string[] = [];
  for (const p of s.body.params) parts.push(p.type === undefined ? "?" : typeText(p.type));
  return `(${parts.join(",")})${s.body.returnType === undefined ? "?" : typeText(s.body.returnType)}`;
}

// A type a C declaration writes, as a named type and its arguments; any other form is told apart
// only by its kind and place, which never matches another declaration's.
function typeText(t: Ref<TypeNode>): string {
  if (t.kind !== "ref") return `${t.kind}@${t.start}`;
  let args: string[] = [];
  for (const a of t.args) args.push(typeText(a));
  return args.length === 0 ? t.name : `${t.name}<${args.join(",")}>`;
}

// The top-level names a statement binds: a declaration's, each name its `let` or `const`
// patterns bind, and an import's, through `export` and `declare`.
function declaredNames(s: Ref<Stmt>): string[] {
  switch (s.kind) {
    case "export":
    case "declare":
      return declaredNames(s.body);
    case "exportDefault":
      return s.declaration === undefined ? [] : declaredNames(s.declaration);
    case "let": {
      let out: string[] = [];
      for (const d of s.declarations) boundNames(d.target, out);
      return out;
    }
    case "import": {
      let out: string[] = [];
      if (s.default !== undefined) out.push(s.default);
      if (s.namespace !== undefined) out.push(s.namespace);
      if (s.named !== undefined) for (const n of s.named) out.push(n.alias !== undefined ? n.alias : n.name);
      return out;
    }
    case "class":
      return s.name !== undefined ? [s.name] : [];
    case "function":
    case "enum":
    case "typeAlias":
    case "interface":
    case "namespace":
      return [s.name];
    default:
      return [];
  }
}

// The names a binding pattern binds, added to `out`; a default's value binds none.
function boundNames(p: Ref<Pattern>, out: Mut<string[]>): void {
  switch (p.kind) {
    case "ident":
      out.push(p.name);
      return;
    case "object":
      for (const prop of p.props) boundNames(prop.value, out);
      if (p.rest !== undefined) boundNames(p.rest, out);
      return;
    case "array":
      for (const e of p.elements) if (e !== undefined) boundNames(e, out);
      if (p.rest !== undefined) boundNames(p.rest, out);
      return;
    case "default":
      boundNames(p.target, out);
      return;
    default:
      return;
  }
}
