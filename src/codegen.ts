import assert from "node:assert";
import type { Body } from "./classes.ts";
import { cloneExpr, cloneStmt } from "./rebuild.ts";
import { bodyOf, type Arenas, type InstanceId, type LocalId } from "./arenas.ts";
import { selfOf, type Checked, type Instance, type Local, type Type } from "./check.ts";
import { crossed as rustCrossing, dropSymbol, rustClassOf, trusted, type Crossing } from "./rust.ts";
import { formatPlan, printStream, integerMethod, MATH_CONSTANTS, MATH_FLOAT, REGEX_FLAGS, regexStringType, type DynTable } from "./values.ts";
import { compile as compileRegex, parsePattern, type RegexTables } from "./regex.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { Lowering } from "./arithmetic.ts";
import { CompileError, locate, sourceOf, type Source } from "./diag.ts";
import { comptimeBlock, comptimeBody, comptimeParameter, comptimeValue, memberOf, toFloat, untagged, type ComptimeHost, type Value } from "./comptime.ts";
import { Printer, RUNTIME, type PrintHost } from "./runtime.ts";
import type { ArithmeticOp, BinaryOp, Expr, JsName, ObjectProp, Param, Pattern, Span, Stmt } from "./parser.ts";
import { ARRAY, DYN, compound, Conversions, llvmOf, textOf } from "./layout.ts";
import { made, type PatternInfo } from "./match.ts";
import { STD_BASE } from "./std.ts";
import { EMBEDDED, idOf, type RecordOf, type Typing, type ArrayRecord, type FixedRecord, TypeMap, TypeSet, isLock, literalText, copyField, type ClassRecord, copyMethod, type InterfaceType, type ClosureType, type FixedType, type RefType, integerInfo, SLEEP, YIELD_NOW, type ArrayType, type MapType, type FutureType, type HandleType, type GeneratorType, type InteriorType, type PointerType, type SharedType, type BlockType, type DynType, type Method, type Field, digest, isFloat, isInteger, redundantBang, bare, type ClassType, type Integer, type Numeric, type ObjectType, type RegexType, type UnionType, type RecursiveType, type LiteralType, type VariantType, isNumeric } from "./typing.ts";
import { NodeMap, walk, walkWhile, type AnyNode, type NodeSet } from "./nodes.ts";
import type { Tables } from "./compilation.ts";
import type { Kind, Verdict } from "./narrow.ts";

// Every instance to compile, as records.
export function compiledOf(checked: Ref<Checked>): Ref<Instance>[] {
  let out: Ref<Instance>[] = [];
  for (const i of checked.instances) out.push(checked.tables.arenas.instanceOf(i));
  return out;
}

const HEX_DIGITS = "0123456789ABCDEF";
// A byte as two hexadecimal digits.
const hexByte = (b: usize): string => `${HEX_DIGITS[b >> 4]!}${HEX_DIGITS[b & 15]!}`;

const COMPARISON: Partial<Record<BinaryOp, string>> = {
  "===": "eq", "!==": "ne", "<": "slt", "<=": "sle", ">": "sgt", ">=": "sge",
};

// Float comparisons are false for NaN, except `!==`, as in JavaScript.
const FLOAT_COMPARISON: Partial<Record<BinaryOp, string>> = {
  "===": "oeq", "!==": "une", "<": "olt", "<=": "ole", ">": "ogt", ">=": "oge",
};

function floatArithmetic(op: BinaryOp): string {
  return op === "+" ? "fadd" : op === "-" ? "fsub" : op === "*" ? "fmul" : op === "/" ? "fdiv" : "frem";
}

// Every function has unwind tables, and when panics unwind, the C personality, whose cleanups
// run a panic's drops.
const UNWINDS = "uwtable personality ptr @__gcc_personality_v0";

// An argument described for the runtime's util.format routine: its kind, an integer's or a
// boolean's value, a float's, a string or String(x), and an inspect tree.
const FARG = "{ i32, i64, double, ptr, ptr }";
const FARG_KINDS: { string: i32; int: i32; uint: i32; float: i32; boolean: i32; null: i32; parts: i32; digits: i32; bigint: i32 } = { string: 0, int: 1, uint: 2, float: 3, boolean: 4, null: 5, parts: 6, digits: 7, bigint: 8 };

// Whether a socket future's address is a path rather than a host and port: a Unix socket's, or
// std's own TCP-typed socket on a path, whose leaf gives the socket type where TCP's gives void.
function onPath(typing: Ref<Typing>, of: Type): boolean {
  if (typeof of === "string") return false;
  const r = typing.rec(of);
  return r.kind === "block" && r.which !== "UdpSocket";
}

// A float constant as LLVM writes one exactly: the bits of the double holding it, which for
// an f32 must be a float's value.
function floatConstant(value: f64, type: "f32" | "f64"): string {
  let view = new DataView(new ArrayBuffer(8));
  // An f32's value is the double nearest it, read back from the float's own four bytes.
  if (type === "f32") {
    view.setFloat32(0, value);
    value = view.getFloat32(0);
  }
  view.setFloat64(0, value);
  let out = "0x";
  for (let i: i64 = 0; i < 8; i++) out += hexByte(view.getUint8(i) as usize);
  return out;
}

// The callee of a call or invoke line, and the callees a frame's site needn't be stored before:
// intrinsics, printing and reference counts, none of which panics or calls back into Fish.
const CALLEE = /^(?:%\S+ = )?(?:call|invoke) [^@%]*([@%][^(]*)\(/;
const FRAME = "{ ptr, ptr, ptr }";
// The files of std's built-in modules, such as `node:path` and `fish:engine`.
const BUILT_IN = /^(node|fish):/;
const QUIET = /^@(llvm\.|printf$|dprintf$|fflush$|fsh_rt_str_retain$|fsh_rt_str_release$)/;

// A name inside LLVM's quotes. A generic class's instance is named by its type arguments, and a
// test by its name, which may hold quotes, so those are escaped as LLVM spells them.
const quoted = (name: string) => name.replace(/["\\]/g, (c) => `\\${hexByte(c.charCodeAt(0) as usize)}`);
// A symbol with each type argument list longer than this written as a hash of it: a generic
// class made from a structural type spells its fields in its name, which every method's symbol
// and frame name repeats.
const LONGEST_ARGUMENTS: usize = 160;
export function shortened(name: string): string {
  if (name.length <= LONGEST_ARGUMENTS) return name;
  let out = "";
  let depth = 0;
  let from = 0;
  let inText = false;
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!;
    // A literal type's text may hold `<` or `>`, as a function type's arrow holds `>`.
    if (c === "\"") inText = !inText;
    else if (inText && c === "\\") i++;
    if (inText || c === "\"") continue;
    if (c === "<") {
      if (depth === 0) {
        out += name.slice(from as i64, (i + 1) as i64);
        from = i + 1;
      }
      depth++;
    } else if (c === ">" && depth > 0 && name[i - 1] !== "=") {
      depth--;
      if (depth === 0) {
        const inner = name.slice(from as i64, i as i64);
        out += inner.length > LONGEST_ARGUMENTS ? `#${digest(inner)}` : inner;
        from = i;
      }
    }
  }
  return out + name.slice(from as i64);
}

// A type as a panic message names it: shortened, then cut off past a line's worth.
function brief(shown: string): string {
  const short = shortened(shown);
  return short.length <= 2 * LONGEST_ARGUMENTS ? short : `${short.slice(0, (2 * LONGEST_ARGUMENTS) as i64)}...`;
}

// Each instance's name in the IR: two instances whose types read alike, as two classes made from
// arguments shown the same way, are told apart by a count after the first.
export function symbolNames(arenas: Ref<Arenas>): Map<InstanceId, string> {
  let known = new Map<InstanceId, string>();
  let seen = new Map<string, usize>();
  for (let id: usize = 1; id <= arenas.instanceCount(); id++) {
    const x = arenas.instanceOf(id as InstanceId);
    const name = shortened(x.symbol);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    known.set(x.id, n === 1 ? name : `${name}~${n}`);
  }
  return known;
}

// An instance's name in the IR, from the names `symbolNames` gave the compilation's instances.
export const symbolIn = (arenas: Ref<Arenas>, i: Ref<Instance>, names: Ref<Map<InstanceId, string>>) => {
  const b = bodyOf(arenas, i);
  return b.rust !== undefined ? `@"${trusted(b.rust).symbol}"` : b.foreign === true ? `@"${b.name}"` : `@"fsh.${quoted(names.get(i.id) ?? shortened(i.symbol))}"`;
};

// A field as JSON reads and writes it: where it sits, and whether an empty one is left out.
type JsonField = { name: string; type: Type; path: usize[]; omit?: boolean };

// A node standing for another as a key of a table, which reads only its id.
// A union's members, or the one type that isn't one.
function membersOf(typing: Ref<Typing>, t: Type): Type[] {
  if (typeof t === "string") return [t];
  const r = typing.rec(t);
  return r.kind === "union" ? [...r.members] : [t];
}

// What `as`, `satisfies` or `unsafe` wraps.
function innerOf<A extends Lifetime>(e: Ref<Expr, A>): Ref<Expr, A> {
  if (e.kind === "as") return e.expr;
  if (e.kind === "satisfies") return e.expr;
  if (e.kind === "unsafe") return e.expr;
  return e;
}

// The runtime function releasing each kind of handle block.
const RELEASES = new Map<string, string>([["Semaphore", "fsh_rt_semaphore_release"], ["Permit", "fsh_rt_permit_drop"], ["Channel", "fsh_rt_channel_release"], ["AbortController", "fsh_rt_signal_release"], ["AbortSignal", "fsh_rt_signal_release"], ["TcpListener", "fsh_rt_socket_release"], ["TcpStream", "fsh_rt_socket_release"], ["UnixListener", "fsh_rt_socket_release"], ["UnixStream", "fsh_rt_socket_release"], ["UdpSocket", "fsh_rt_socket_release"], ["FileJob", "fsh_rt_file_job_release"], ["JsValue", "fsh_rt_js_release"], ["FileDescriptor", "fsh_rt_fd_release"]]);

// A failure that has nothing read before it to drop.
function noUndo(_cg: Mut<Codegen>): void {}

// The object a member or index expression reads from.
function partOf<A extends Lifetime>(e: Ref<Expr, A>): Ref<Expr, A> {
  if (e.kind === "member") return e.object;
  if (e.kind === "index") return e.object;
  return e;
}

function sharedPrefix(which: string): string {
  return which === "shared" ? "shared" : which === "Rc" ? "rc" : "weak";
}

function stmtKey(s: Ref<Stmt>): Stmt {
  return { id: s.id, kind: "empty", start: s.start, end: s.end };
}

function exprKey(e: Ref<Expr>): Expr {
  return { id: e.id, kind: "this", start: e.start, end: e.end };
}

function keyAt(id: usize, start: usize, end: usize): Expr {
  return { id, kind: "this", start, end };
}

// Whether an expression names a place: a variable, `this`, or a field read off one.
function isPlace(x: Ref<Expr>): boolean {
  return x.kind === "ident" || x.kind === "this" || (x.kind === "member" && !x.optional && isPlace(x.object));
}

// Function definitions and declarations, each with the lines after it, in order of the symbols
// they name.
function byName(lines: Ref<string[]>): string[] {
  let chunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("define ") || line.startsWith("declare ")) chunks.push([line]);
    else chunks[chunks.length - 1]!.push(line);
  }
  let names: string[] = [];
  let order: usize[] = [];
  for (let i: usize = 0; i < chunks.length; i++) {
    names.push(/@("[^"]*"|[\w.$-]+)\(/.exec(chunks[i]![0]!)![1]!);
    order.push(i);
  }
  const sorted = order.toSorted((a, b) => (names[a]! < names[b]! ? -1 : names[a]! > names[b]! ? 1 : 0));
  let out: string[] = [];
  for (const i of sorted) for (const line of chunks[i]!) out.push(line);
  return out;
}

// The `Math` functions LLVM's intrinsics compute exactly. The rest call the runtime's
// correctly rounded ones, since libm's differ by platform and LLVM folds constants with the
// libm of the machine compiling.
const MATH_INTRINSICS = new Set(["floor", "ceil", "trunc", "sqrt"]);
// The array methods that are another walking from the last element back.

// The C functions the runtime prelude already declares, which a `declare function` reuses.
function declared(): Set<string> {
  let out = new Set<string>();
  for (const line of RUNTIME) {
    const found = /^declare [^@]*@([\w.]+)\(/.exec(line);
    if (found !== null) out.add(found[1]!);
  }
  return out;
}
const DECLARED = declared();

// How a narrow value crosses to C, which expects it widened by its caller: a boolean, a byte
// holding 0 or 1, and unsigned integers zero-extended, signed ones sign-extended.
const extension = (type: Type) => (type === "boolean" || type === "u8" || type === "u16" ? "zeroext" : type === "i8" || type === "i16" ? "signext" : "");
const crossing = (typing: Ref<Typing>, type: Type) => (extension(type) === "" ? llvmOf(typing, type) : `${llvmOf(typing, type)} ${extension(type)}`);
const crossed = (typing: Ref<Typing>, type: Type) => (extension(type) === "" ? llvmOf(typing, type) : `${extension(type)} ${llvmOf(typing, type)}`);

// The C parameters a value crossing to a Rust shim is passed as: a pointer for a Rust type, a
// string or an Option of either, which is null when empty; an array's buffer and length; and a
// flag first for an Option of a number, a boolean or an array.
function shimParams(typing: Ref<Typing>, c: Ref<Crossing>): string[] {
  if (c.kind === "plain") return [crossing(typing, c.type)];
  if (c.kind === "array") return ["ptr", "i64"];
  if (c.kind === "option" && (c.of.kind === "plain" || c.of.kind === "array")) return ["i1 zeroext", ...shimParams(typing, c.of)];
  return ["ptr"];
}

// What a Rust shim returns for what its function gives, and the type of the slot it writes the
// rest of it into: an array, or what an Option of a number, a boolean or an array holds.
function shimGives(typing: Ref<Typing>, c: Ref<Crossing> | undefined): { returns: string; out?: string } {
  if (c === undefined) return { returns: "void" };
  if (c.kind === "plain") return { returns: crossed(typing, c.type) };
  if (c.kind === "array") return { returns: "void", out: ARRAY };
  if (c.kind === "option" && c.of.kind === "plain") return { returns: "zeroext i1", out: llvmOf(typing, c.inner) };
  if (c.kind === "option" && c.of.kind === "array") return { returns: "zeroext i1", out: ARRAY };
  return { returns: "ptr" };
}

// What a Rust function gives, as it crosses: a constructor gives its handle.
const rustGiven = (typing: Ref<Typing>, arenas: Ref<Arenas>, i: Ref<Instance>): Crossing | undefined => (bodyOf(arenas, i).self?.constructor === true ? rustCrossing(typing, bodyOf(arenas, i).owner!, true) : i.returns === "void" ? undefined : rustCrossing(typing, i.returns, true));

// A library has no C `main`; each export gets a C function under its own name instead.
// `sources` holds the program's files other than the entry, for panic locations.
// `harness`: the entry file is `fishc test`'s generated harness, whose functions keep no frame.
// `leaks`: a `--leaks` build, whose frames name each allocation's site, so it keeps them in release.
// `debug`: a `-g` build, whose own functions carry the marks `withDebugInfo` turns into line tables.
// A group of instances compiled as one: `template`'s code, the parameters it takes as a closure's
// address and code, and the closure body each of this instance's calls of them runs.
type Share = { template: InstanceId; at: Set<usize>; code: Map<usize, InstanceId | undefined> };
const PAIR = "{ ptr, ptr }";
export type Options = { src: string; file: string; release: boolean; panic: "unwind" | "abort"; library?: boolean; sources?: Source[]; harness?: boolean; leaks?: boolean; debug?: boolean; failed?: string[] };

// The owner a generated symbol is made for, when that is a type.
const typeOwner = (t: Type): string => `type ${idOf(t)}`;

// The function being emitted, set aside while another is emitted inside it.
type Emission = { allocas: string[]; body: string[]; temps: usize; labels: usize; block: string; pending: { v: string; type: Type; slot?: string }[]; scopes: Scope[]; framingOn: boolean; debuggingOn: boolean };

// What a block owns and drops at its end. A scope a match or a pipe opens for itself, which
// ends with the expression, is transient: a C string's buffer goes to the block around it.
type Scope = { transient: boolean; held: { slot: string; type: Type }[] };

// A `finally` region being emitted: the block its `finally` starts, the slot naming the way
// control left, each way out with how to resume it, the labels made before the region, and
// how many catches and scopes enclosed it.
type Region = { label: string; chosen: string; exits: { key: string; resume: (cg: Mut<Codegen>) => void }[]; start: usize; handlers: usize; depth: usize; floor: usize; slots: Map<string, { slot: string; type: Type }> };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
class Codegen implements PrintHost, ComptimeHost {
  src: string;
  file: string;
  release: boolean;
  panic: "unwind" | "abort";
  library: boolean;
  sources: Source[];
  harness: boolean;
  leaks: boolean;
  debug: boolean;
  failed: string[] | undefined;
  tables: Tables;
  instances: InstanceId[];
  names: Map<InstanceId, string>;
  unwinds: "uwtable" | "uwtable personality ptr @__gcc_personality_v0";
  framingOn: boolean;
  site: Span | undefined;
  debuggingOn: boolean;
  marked: Span | undefined;
  frames: boolean;
  globals: string[];
  regexes: Map<string, string>;
  out: string[];
  allocas: string[];
  body: string[];
  temps: usize;
  labels: usize;
  numbered: Map<LocalId, usize>;
  block: string;
  current: InstanceId;
  self: ClassType | undefined;
  captured: Map<LocalId, string>;
  known: NodeMap<Expr, string>;
  handlers: { label: string; slot: string; depth: usize; floor: usize }[];
  finallies: Region[];
  exits: NodeMap<Stmt, { exit: string; next?: string; depth: usize; }>;
  pending: { v: string; type: Type; slot?: string }[];
  floor: usize;
  reserved: NodeMap<Expr, string>;
  resuming: { type: GeneratorType | FutureType; frame: string; resumes: string[]; start: string; done: string } | undefined;
  framed: Set<string>;
  arms: NodeMap<Stmt, { slot: string; type: Type; } | undefined>;
  scopes: Scope[];
  spills: { slot: string; type: Type; v: string }[];
  handing: { v: string; type: Type }[];
  fixed: NodeMap<Expr, string>;
  texts: Map<string, string>;
  bigConstants: Map<string, string>;
  cStrings: Map<string, string>;
  emittedTables: Set<string>;
  glue: { drop: TypeMap<Type, string>; copy: TypeMap<Type, string>; };
  comparers: TypeMap<Type, string>;
  jsonWriters: TypeMap<Type, string>;
  jsonReaders: TypeMap<Type, string>;
  inspectors: TypeMap<Type, string>;
  awaitsOf: Map<InstanceId, { state: usize; field: usize; type: Type; }[]>;
  combinePolls: TypeMap<FutureType, string>;
  cancelled: Set<InstanceId>;
  stringers: TypeMap<Type, string>;
  constantGlobals: Map<InstanceId, string>;
  uncopyable: Set<string>;
  settledOutput: boolean;
  elementDrops: TypeMap<Type, string>;
  callbacks: Map<string, string>;
  settlers: Map<string, [string, string]>;
  jsSite: Span | undefined;
  vtables: Map<string, string>;
  orders: Map<string, string>;
  intrinsics: Set<string>;
  foreign: Set<string>;
  declaredRust: Set<string>;
  rustDrops: Set<string>;
  generatorOf: TypeMap<GeneratorType, InstanceId>;
  futureOf: TypeMap<FutureType, InstanceId>;
  taken: Map<string, string>;
  glued: TypeSet<FutureType>;
  shares: Map<InstanceId, Share>;
  pairs: Map<LocalId, string>;
  main: InstanceId;
  start: string[];
  filled: string[];

  constructor(checked: Checked, options: Options) {
    const first = checked.instances[0]!;
    let resumes = new TypeMap<GeneratorType, InstanceId>();
    let polls = new TypeMap<FutureType, InstanceId>();
    for (const i of checked.instances) {
      const made = checked.tables.arenas.instanceOf(i)!;
      if (made.generator !== undefined) resumes.set(made.generator, i);
      if (made.future !== undefined) polls.set(made.future, i);
    }
    this.names = symbolNames(checked.tables.arenas);
    this.src = options.src;
    this.file = options.file;
    this.release = options.release;
    this.panic = options.panic;
    this.library = options.library ?? false;
    this.sources = options.sources !== undefined ? options.sources : [];
    this.harness = options.harness ?? false;
    this.leaks = options.leaks ?? false;
    this.debug = options.debug ?? false;
    this.failed = options.failed;

    this.instances = checked.instances;

    this.tables = checked.tables;

    this.unwinds = options.panic === "abort" ? "uwtable" : UNWINDS;

    // In a debug or `--leaks` build each of the program's own functions keeps a frame on the
    // runtime's shadow stack, `{ site, name, prev }`, for a panic's backtrace and a leak's site:
    // `framing` is the body of the one being emitted, and `site` the expression or statement whose
    // calls it is making.
  

  

    // In a `-g` build, the body of the program's own function being emitted, and the site last marked in it.
  

  

    this.frames = false;

    this.resuming = undefined;

    this.site = undefined;

    this.marked = undefined;

    this.globals = [];

    this.regexes = new Map<string, string>();

    this.out = [];

    // Allocas go in the entry block, where mem2reg promotes them and loops don't grow the stack.
    this.allocas = [];

    this.body = [];

    this.temps = 0;

    this.labels = 0;

    // Each variable's number in the function being emitted, which tells apart two of one name.
    // Counted per function, so a function's IR doesn't change with the program around it.
    this.numbered = new Map<LocalId, usize>();

    // The label of the block being emitted into, which a phi names as its predecessor.
    this.block = "entry";

    // The instance being emitted, and the tables its checking produced.
    this.current = first;

    // The class of the constructor or method being emitted, whose instance `%this` points to.
  

    // In a closure, where each variable it captures lives, loaded from its environment.
    this.captured = new Map<LocalId, string>();

    // The value of an Option an optional chain's link has already evaluated, to read through.
    this.known = new NodeMap<Expr, string>();

    // The catch blocks enclosing the code being emitted, innermost last: where each starts, and
    // the slot its error goes in.
    this.handlers = [];

    // The `finally` regions enclosing the code being emitted, innermost last.
    this.finallies = [];

    // Where a `break` and a `continue` go for each statement they can name.
    this.exits = new NodeMap<Stmt, { exit: string; next?: string; depth: usize }>();

    // Values the statement being emitted made and nothing took over, released when it ends.
    // Each keeps a slot it is stored in across a call that may panic, for its landing pad.
    this.pending = [];

    // Where the statement being lowered starts in `pending`: a statement in a match arm's block
    // runs inside an expression whose own values are pending below it.
    this.floor = 0;

    // The scopes matches and pipes open for themselves.

    // The slot each C string in a loop's condition or update was given when the loop began.
    this.reserved = new NodeMap<Expr, string>();

    // The generator being emitted: its type, its frame's LLVM type, the block each `yield`
    // resumes at in order, where it starts, and where it gives that it has finished.
  

    // Slots that are fields of a generator's frame: they outlive one `next()` and start empty.
    this.framed = new Set<string>();

    // Where a `return` in each match arm's block puts the value it gives, when the match gives one.
    this.arms = new NodeMap<Stmt, { slot: string; type: Type } | undefined>();

    // What each enclosing scope owns, outermost first, dropped as it ends or is left.
    this.scopes = [];

    // Receivers copied into slots for owning methods, whose leftovers drop after the call.
    this.spills = [];

    // What `hand` handed over inside each `delivered` that hasn't returned yet, innermost last.
    this.handing = [];

    // The index values an assignment ran ahead of its value, by index expression.
    this.fixed = new NodeMap<Expr, string>();

    // Each literal's string block, made once.
    this.texts = new Map<string, string>();

    this.bigConstants = new Map<string, string>();

    this.cStrings = new Map<string, string>();

    this.emittedTables = new Set<string>();

    // The function dropping, or copying, what a value of each type owns, made once.
    this.glue = { drop: new TypeMap<Type, string>(), copy: new TypeMap<Type, string>() };

    // The function comparing two values of each compound type, made once.
    this.comparers = new TypeMap<Type, string>();

    this.jsonWriters = new TypeMap<Type, string>();

    this.jsonReaders = new TypeMap<Type, string>();

    this.inspectors = new TypeMap<Type, string>();

    // Each async instance's awaits, by the state it is paused in at each: the frame field the
    // awaited future is in, and its type, for cancelling it there.
    this.awaitsOf = new Map<InstanceId, { state: usize; field: usize; type: Type }[]>();

    // The poll functions of `Promise.all` and `Promise.race` futures, and the async instances a
    // cancel function is wanted for.
    this.combinePolls = new TypeMap<FutureType, string>();

    this.cancelled = new Set<InstanceId>();

    // The functions writing String(x) of a value with parts, by its type.
    this.stringers = new TypeMap<Type, string>();

    // The global each top-level const holding an aggregate lives in.
    this.constantGlobals = new Map<InstanceId, string>();

    // The thunks copying a Dyn that can't be copied that are made, by the Rust type they name or
    // "" for the general one, and whether the one dropping a settled JS promise's output is.
    this.uncopyable = new Set<string>();

    this.settledOutput = false;

    this.elementDrops = new TypeMap<Type, string>();

    // The functions JS calls a Fish callback through, by its type and where it was given, and the
    // tasks settling the JS promises Fish futures are given to JS as.
    this.callbacks = new Map<string, string>();

    this.settlers = new Map<string, [string, string]>();

    // Where a value going to JS is given, for a callback's panics to name.
  

    this.vtables = new Map<string, string>();

    // The functions `sort` compares through: one per comparator, and one per element type for the
    // default order.
    this.orders = new Map<string, string>();

    this.intrinsics = new Set<string>();

    // The C functions the program declares itself, which the libm functions Math uses may be.
    this.foreign = new Set<string>();

    // The shim functions declared, each once however many declarations name its Rust function,
    // and the drop functions of the Rust types the program drops.
    this.declaredRust = new Set<string>();

    this.rustDrops = new Set<string>();


    // The instance each generator type resumes, and each future type polls.
    this.generatorOf = resumes;

    this.futureOf = polls;

    // Each generated name in each family and what it stands for, so two things described alike
    // are never given one name.
    this.taken = new Map<string, string>();

    // The future types whose task glue is made.
    this.glued = new TypeSet<FutureType>();


    this.framingOn = false;
    this.debuggingOn = false;
    this.shares = new Map<InstanceId, Share>();
    this.pairs = new Map<LocalId, string>();
    this.main = first;
    this.start = [];
    this.filled = [];
    this.self = undefined;

    this.jsSite = undefined;

  }

  // Comptime runs on the checked program, every function of which is checked already.
  ensureChecked(_id: InstanceId): boolean {
    return true;
  }

  // An instance by its id, and the one being emitted.
  inst(id: InstanceId): Ref<Instance> {
    return this.tables.arenas.instanceOf(id)!;
  }

  bodyAt(id: InstanceId): Ref<Body> {
    return this.tables.arenas.bodyOf(this.tables.arenas.instanceOf(id)!.body)!;
  }

  cur(): Ref<Instance> {
    return this.tables.arenas.instanceOf(this.current)!;
  }

  // Emits every instance and gives the module's IR.
  /** @throws {CompileError} */
  module(this: Mut<this>): string {
    // Top-level consts and comptime blocks run while compiling, every one of them, so one that
    // fails is reported even when nothing reads it; none is compiled.
    for (const instance of this.instances) {
      if (this.bodyAt(instance).comptime === undefined || !this.inst(instance).concrete) continue;
      if (this.bodyAt(instance).comptime === "const") {
        const written = this.bodyAt(instance);
        const part = this.inst(instance).returns;
        this.bakeable(part, { start: written.start, end: written.end }, true);
      }
      comptimeBody(this, instance);
  }


  this.shares = this.sharing();

  // The current function's parameters taken as a closure's address and code, by their slots.
  this.pairs = new Map<LocalId, string>();

  for (const instance of this.instances) {
    if (this.bodyAt(instance).comptime !== undefined) continue;
    try {
      // A copy compiled as another instance of its function has no code of its own.
      if (this.shares.has(instance) && this.shares.get(instance)!.template !== instance) continue;
      // A C function is declared under its own name, unless the runtime already declares it.
      if (this.bodyAt(instance).foreign === true) {
        this.foreign.add(this.bodyAt(instance).name);
        if (this.bodyAt(instance).rust !== undefined) {
          // A Rust function's shim takes its handle first when it is a method, then its parameters
          // as they cross, the slot for the rest of what it gives, and where it puts a panic's message.
          const rust = this.symbol(instance);
          if (this.declaredRust.has(rust)) continue;
          this.declaredRust.add(rust);
          const self = this.bodyAt(instance).self !== undefined && !this.bodyAt(instance).self!.constructor ? ["ptr"] : [];
          const gives = shimGives(this.tables.typing, rustGiven(this.tables.typing, this.tables.arenas, this.inst(instance)));
          const params = [...self, ...this.inst(instance).signature!.flatMap((t) => shimParams(this.tables.typing, rustCrossing(this.tables.typing, t))), ...((gives.out !== undefined && gives.out !== "") ? ["ptr"] : []), ...(this.inst(instance).throws !== undefined ? ["ptr"] : []), "ptr"];
          this.out.push(`declare ${gives.returns} ${rust}(${params.join(", ")})`);
          this.out.push("");
          continue;
        }
        if (!DECLARED.has(this.bodyAt(instance).name)) {
          const line2 = `declare ${crossed(this.tables.typing, this.inst(instance).returns)} ${this.symbol(instance)}(${this.inst(instance).signature!.map((t) => crossing(this.tables.typing, t)).join(", ")})`;
          this.out.push(line2);
          this.out.push("");
        }
        continue;
      }
      this.current = instance;
      const f = this.bodyAt(instance);
      this.self = f.self?.type;
      this.allocas = [];
      this.body = [];
      this.temps = 0;
      this.labels = 0;
      this.numbered = new Map();
      this.block = "entry";
      this.pending = [];
      this.floor = 0;
      this.reserved.clear();
      this.scopes = [{ transient: false, held: [] }];
      const type = this.inst(instance).returns;
      this.framed = new Set();
      // std's functions, its built-in modules' included, keep no frame, as Rust's short backtrace
      // hides std's internals; nor do the arrows the checker wraps around a callback.
      const from = sourceOf(this.src, this.file, f.start, this.sources).file;
      const ours = f.start < STD_BASE && !BUILT_IN.test(from) && !(this.harness && from === this.file) && f.closure?.made !== true;
      this.framingOn = (!this.release || this.leaks) && !this.library && ours;
      this.site = undefined;
      this.debuggingOn = this.debug && f.start < STD_BASE && !BUILT_IN.test(from);
      this.marked = undefined;
      if (this.debuggingOn) this.allocas.push(`  ;fsh.fn ${f.start}`);
      const machine = this.inst(instance).generator ?? this.inst(instance).future;
      this.resuming = (machine !== undefined ? { type: machine, frame: this.llvm(machine), resumes: [], start: this.label(), done: this.label() } : undefined);
      // A generator's variables, and its loops' state, are fields of the frame each `next()` is
      // given, which already holds its parameters.
      if (this.resuming !== undefined) {
        const field = (cg: Mut<Codegen>, at: string, i: usize) => {
          cg.allocas.push(`  ${at} = getelementptr ${cg.resuming!.frame}, ptr %frame, i32 0, i32 ${i}`);
          cg.framed.add(at);
        };
        field(this, "%state", 0);
        // An async arrow's captures are its frame's copy of the closure; an async method's object is
        // borrowed through its frame, or held in it under `Own<this>`.
        if (f.closure !== undefined) {
          field(this, "%env", 1);
          // Its copy of the captures is the future's own, dropped once the body is done.
          const part2 = this.inst(instance).closure!;
          this.own("%env", part2);
        }
        if (f.self !== undefined && !f.self.constructor) {
          if (f.self.owned === true) field(this, "%this", 1);
          else {
            this.allocas.push(`  %this.at = getelementptr ${this.resuming.frame}, ptr %frame, i32 0, i32 1`);
            this.allocas.push("  %this = load ptr, ptr %this.at");
          }
        }
        const locals2 = this.inst(instance).frame!.locals;
        for (const [local, i] of locals2) {
          const slot3 = this.slot(local);
          field(this, slot3, i);
        }
        // A `for await` loop's third field is the future it awaits.
        const loops2 = this.inst(instance).frame!.loops;
        for (const [s, i] of loops2) for (const j of [i, i + 1, ...((s as { await?: boolean }).await === true ? [i + 2] : [])]) {
          field(this, `%loop${j}`, j);
        }
        for (const i of this.inst(instance).frame!.awaits.values()) field(this, `%await${i}`, i);
        this.startBlock(this.resuming.start);
        // The first `next`'s value has no `yield` to go to.
        this.dropSent();
      }
      // Parameters are copied into slots like any other binding. One taken as a closure's address
      // and code is the caller's to drop.
      this.pairs = new Map();
      const shared = this.shares.get(instance);
      const params = f.params.flatMap((p, k) => {
        const local = this.resolved(p);
        if (shared?.at.has(k) === true) {
          const at = `%"${this.loc(local).name}.pair.${this.loc(local).id}"`;
          this.allocas.push(`  ${at} = alloca ${PAIR}`);
          const line9 = `store ${PAIR} %"${this.loc(local).name}.arg", ptr ${at}`;
          this.emit(line9);
          this.pairs.set(local, at);
          return [`${PAIR} %"${this.loc(local).name}.arg"`];
        }
        this.reserve(local);
        const slot2 = this.slot(local);
        const part3 = this.loc(local).type;
        this.own(slot2, part3);
        if (this.resuming !== undefined) return [""];
        // A comptime parameter isn't passed: its instance knows its value.
        if (p.comptime) {
          const comptimeParameter2 = comptimeParameter(this.tables, this.inst(instance), p);
          const part4 = this.loc(local).type;
          const part5 = this.loc(local).type;
          const line3 = `store ${this.llvm(part5)} ${this.bake(comptimeParameter2, part4)}, ptr ${this.slot(local)}`;
          void this.emit(line3);
          return [];
        }
        const part6 = this.loc(local).type;
        const line4 = `store ${this.llvm(part6)} %"${this.loc(local).name}.arg", ptr ${this.slot(local)}`;
        this.emit(line4);
        const part7 = this.loc(local).type;
        return [`${this.llvm(part7)} %"${this.loc(local).name}.arg"`];
      });
      // A constructor or method works on its instance through a pointer, and a closure on what
      // it captured.
      if (f.self !== undefined) params.unshift("ptr %this");
      if (f.closure !== undefined) params.unshift("ptr %env");
      // A method owning its object drops it, unless the object moves out first.
      if (f.self?.owned === true) this.own("%this", f.self.type, false);
      this.captured = new Map();
      // A capture the closure holds lives in its environment; a borrowed one, where it points.
      [...(this.inst(instance).captures ?? [])].forEach(([alias, from], i) => {
        const at = this.temp();
        // In a future the entry block is the only one every poll passes through.
        const part8 = this.inst(instance).closure!;
        const line = `${at} = getelementptr ${this.llvm(part8)}, ptr %env, i32 0, i32 ${i}`;
        if (this.resuming !== undefined) this.allocas.push(`  ${line}`);
        else this.emit(line);
        const part9 = this.tables.typing.rec(this.inst(instance).closure!).fields[i]!.type;
        if (!this.isRef(part9)) return this.captured.set(alias, at);
        const pointer = from === "this" ? "%this" : this.temp();
        const load = `${pointer} = load ptr, ptr ${at}`;
        if (this.resuming !== undefined) this.allocas.push(`  ${load}`);
        else this.emit(load);
        this.captured.set(alias, pointer);
      });
      if (f.closure !== undefined) this.self = selfOf(this.tables.arenas, f)?.type;
      for (const each of f.body) this.statement(each);
      // Falling off the end drops what the body holds there, at its closing brace.
      this.site = { start: f.end - 1, end: f.end };
      // The last block is unreachable when every path returned; the checker guarantees it for values.
      if (type === "void" || this.resuming !== undefined) this.leave(undefined);
      else this.emit("unreachable");
      if (this.resuming !== undefined) {
        // Each `next()` or poll goes on from where the last stopped: the start, a `yield` or an
        // `await`, or the end. A finished future is never polled again.
        // Advancing a generator already finished drops what was sent; one finishing in this very
        // call has dropped or taken it already, and comes to `done` directly.
        const sent = this.recOf(this.resuming.type);
        const finished = sent?.kind === "generator" && sent.sends !== undefined && this.needsDrop(sent.sends) ? this.label() : this.resuming.done;
        if (finished !== this.resuming.done) {
          this.startBlock(finished);
          this.dropSent();
          this.emit(`br label %${this.resuming.done}`);
        }
        this.startBlock(this.resuming.done);
        const resumed = this.tables.typing.rec(this.resuming.type);
        if (resumed.kind === "generator") {
          const resultType2 = this.resultType(instance);
          const answer2 = this.answer(undefined, resumed.yields);
          const line5 = `ret ${resultType2} ${this.yieldedAs(answer2)}`;
          this.emit(line5);
        }
        else this.emit("unreachable");
        const resumes = [this.resuming.start, ...this.resuming.resumes].map((at, i) => `i32 ${i}, label %${at}`).join(" ");
        const frame = this.pushFrame(instance);
        for (const pushed of frame) this.allocas.push(pushed);
        this.allocas.push("  %resumed = load i32, ptr %state");
        this.allocas.push(`  switch i32 %resumed, label %${finished} [ ${resumes} ]`);
        // A generator taking values through `next(x)` is given one, and whether it was.
        const sends = resumed.kind === "generator" ? resumed.sends : undefined;
        const takes = resumed.kind === "future" || resumed.async === true ? "ptr %frame, ptr %cx" : sends !== undefined ? `ptr %frame, ${this.llvm(sends)} %sent, i1 %sent.has` : "ptr %frame";
        const line6 = `define internal ${this.resultType(instance)} ${this.symbol(instance)}(${takes}) ${this.unwinds} {`;
        this.out.push(line6);
        this.out.push("entry:");
        for (const pushed of this.allocas) this.out.push(pushed);
        const more = this.popFrame(this.body);
        for (const pushed of more) this.out.push(pushed);
        this.out.push("}");
        this.out.push("");
        continue;
      }
      // Fish's own functions stay inside this module, so two libraries never clash over them.
      const line7 = `define internal ${this.resultType(instance)} ${this.symbol(instance)}(${params.join(", ")}) ${this.unwinds} {`;
      const frame = this.pushFrame(instance);
      this.out.push(line7);
      this.out.push("entry:");
      for (const pushed of this.allocas) this.out.push(pushed);
      for (const pushed of frame) this.out.push(pushed);
      const more2 = this.popFrame(this.body);
      for (const pushed of more2) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
    } catch (e) {
      if (this.failed === undefined) throw e;
      this.failed.push(`${this.inst(instance).symbol}: ${e instanceof Error ? e.message : String(e)}`);
      const line8 = `declare void ${this.symbol(instance)}()`;
      this.out.push(line8);
      this.out.push("");
    }
  }

  this.framingOn = false;

  this.debuggingOn = false;

  if (this.frames) this.globals.push("@fsh_rt_frames = external thread_local global ptr");

  // A cancel function wanted while making one may want another.
  for (const done = new Set<InstanceId>(); done.size < this.cancelled.size;) {
    for (const i of [...this.cancelled]) {
      if (done.has(i)) continue;
      done.add(i);
      this.cancelFunction(this.tables.arenas.instanceOf(i).id);
    }
  }

  this.main = this.instances.find((i) => this.inst(i).symbol === "main")!;

  // Built before the module is put together, since its message adds a global.
  this.start = this.library ? this.instances.filter((i) => this.bodyAt(i).exported).flatMap(((i) => this.exported(i))) : this.entry();

  this.filled = this.fillConstants();


  // Definitions in order of their names, rather than of when they were made, so a function
  // has the same place among them whatever the program around it.
  return [
    ...this.globals.toSorted(),
    // The runtime reads which way a panic goes. A library leaves it to the runtime's default, so
    // two libraries in one program don't both define it; its exports abort on a panic anyway.
    ...(this.library ? [] : [`@fsh_panic_abort = constant i32 ${this.panic === "abort" ? 1 : 0}`]),
    "",
    ...RUNTIME,
    ...[...this.intrinsics].filter((line) => !this.foreign.has(/@([\w.]+)\(/.exec(line)![1]!)),
    ...[...this.rustDrops].map((name) => `declare void ${name}(ptr, ptr)`),
    "",
    ...byName(this.out),
    ...this.start,
    ...this.filled,
    "",
  ].join("\n");
  }

  loc(id: LocalId): Ref<Local> {
    return this.tables.arenas.localOf(id)!;
  }

  llvm(t: Type): string {
    return llvmOf(this.tables.typing, t);
  }

  // Instances made while compiling, as comptime makes, are named once they are met.
  symbol(this: Mut<this>, i: InstanceId): string {
    if (!this.names.has(i)) this.names = symbolNames(this.tables.arenas);
    return symbolIn(this.tables.arenas, this.inst(i), this.names);
  }

  recOf<T extends Type>(t: T | undefined): RecordOf<Exclude<T, string>> | undefined {
    return (t === undefined || typeof t === "string" ? undefined : this.tables.typing.rec(t as Exclude<T, string>));
  }

  isRef(t: Type): boolean {
    return this.recOf(t)?.kind === "ref";
  }

  isArray(t: Type): t is ArrayType {
    return this.recOf(t)?.kind === "array";
  }

  // Whether indexing a value reads an element: an array's, or a fixed array's, through a
  // reference too.
  indexes(t: Type): boolean {
  const held = this.referent(t);
  const kind = this.recOf(held)?.kind;
  return kind === "array" || kind === "fixed";
}

  isDyn(t: Type): t is DynType {
    return this.recOf(t)?.kind === "dyn";
  }

  relays(this: Mut<this>, from: Type, to: DynType): boolean {
    return this.isDyn(from) && this.tables.typing.callableOf.has(this.tables.typing.rec(from).of) && this.tables.typing.callableOf.has(this.tables.typing.rec(to).of) && !this.tables.typing.sameCallable(from, to);
  }

  // What a reference points to, or the type itself.
  referent(t: Type): Type {
  if (typeof t === "string") return t;
  const r = this.tables.typing.rec(t);
  return r.kind === "ref" ? r.to : t;
}

  // Whether a value of the type holds a Rust handle, which only moves.
  holdsRust(t: Type): boolean {
    return this.tables.typing.holdsPart(t, (u) => rustClassOf(this.tables.typing, u) !== undefined);
  }

  localAt(n: Ref<Expr | Stmt | Param | ObjectProp>): LocalId | undefined {
    return this.cur().locals.get(n);
  }

  callOf(e: Ref<Expr>): InstanceId | undefined {
    return this.cur().calls.get(e);
  }

  setterOf(e: Ref<Expr>): InstanceId | undefined {
    return this.cur().setters.get(e);
  }

  // The integer operators, lowered into the function being emitted.
  lowering(this: Mut<this>): Lowering<Codegen> {
    return new Lowering(this);
  }

  // Sets the function being emitted aside and starts an empty one, which keeps no frame and
  // carries no debug marks.
  setAside(this: Mut<this>): Emission {
    const saved: Emission = { allocas: this.allocas.splice(0, this.allocas.length as i64), body: this.body.splice(0, this.body.length as i64), temps: this.temps, labels: this.labels, block: this.block, pending: this.pending.splice(0, this.pending.length as i64), scopes: this.scopes.splice(0, this.scopes.length as i64), framingOn: this.framingOn, debuggingOn: this.debuggingOn };
    this.startFresh();
    this.framingOn = false;
    this.debuggingOn = false;
    return saved;
  }

  // Sets aside the instructions of the function being emitted, keeping what it has pending and
  // its scopes, while a helper with no values of its own is made.
  setAsideBody(this: Mut<this>): Emission {
    const saved: Emission = { allocas: this.allocas.splice(0, this.allocas.length as i64), body: this.body.splice(0, this.body.length as i64), temps: this.temps, labels: this.labels, block: this.block, pending: [], scopes: [], framingOn: this.framingOn, debuggingOn: this.debuggingOn };
    this.temps = 0;
    this.labels = 0;
    this.block = "entry";
    this.framingOn = false;
    this.debuggingOn = false;
    return saved;
  }

  takeUpBody(this: Mut<this>, saved: Emission): void {
    this.allocas = saved.allocas;
    this.body = saved.body;
    this.temps = saved.temps;
    this.labels = saved.labels;
    this.block = saved.block;
    this.framingOn = saved.framingOn;
    this.debuggingOn = saved.debuggingOn;
  }

  // Starts an empty function in place of the one being emitted.
  startFresh(this: Mut<this>): void {
    this.allocas = [];
    this.body = [];
    this.temps = 0;
    this.labels = 0;
    this.block = "entry";
    this.pending = [];
    this.scopes = [];
  }

  // Takes up again a function `setAside` set aside.
  takeUp(this: Mut<this>, saved: Emission): void {
    this.allocas = saved.allocas;
    this.body = saved.body;
    this.temps = saved.temps;
    this.labels = saved.labels;
    this.block = saved.block;
    this.pending = saved.pending;
    this.scopes = saved.scopes;
    this.framingOn = saved.framingOn;
    this.debuggingOn = saved.debuggingOn;
  }

  mayPanic(this: Mut<this>, call: string): void {
    this.unwinding(call);
  }

  // Conversions between the ways two types hold one value, and tests of which a union holds.
  conversions(this: Mut<this>): Conversions<Codegen> {
    return new Conversions(this);
  }

  printer(this: Mut<this>, stream: 1 | 2): Printer<Codegen> {
    return new Printer(this, stream);
  }

  convert(this: Mut<this>, v: string, from: Type, to: Type): string {
    return this.conversions().convert(v, from, to);
  }

  // The value of `x`, an operand of the test `e`; a guarded test keeps its left operand from
  // what its right one may do.
  operandOf(this: Mut<this>, x: Ref<Expr>, e: Ref<Expr>, guarded: boolean): string {
    return guarded && e.kind === "binary" && x.id === e.left.id ? this.operandBefore(x, e.right) : this.value(x);
  }

  deep(this: Mut<this>, a: string, b: string, type: Type): string {
    return this.deepEquals(a, b, type);
  }

  inspect(this: Mut<this>, v: string, type: Type): string {
    return this.inspected(v, type);
  }

  // A framed function's entry pushes its frame: a generator or future's on each resume, since it
  // pops at every suspend, so an `await` chain or a generator's resumer is the stack below it.
  // The record is `{ site, name, prev }`, the site first so each call's store is to the slot
  // itself; nothing else outlives the entry block, so unoptimized code spills nothing more.
  pushFrame(this: Mut<this>, i: InstanceId): string[] {
    if (!this.framingOn) return [];
    this.frames = true;
    return [
      `  %fsh.site = alloca ${FRAME}`,
      `  %fsh.name = getelementptr ${FRAME}, ptr %fsh.site, i32 0, i32 1`,
      `  %fsh.link = getelementptr ${FRAME}, ptr %fsh.site, i32 0, i32 2`,
      "  %fsh.prev = load ptr, ptr @fsh_rt_frames",
      "  store ptr null, ptr %fsh.site",
      `  store ptr ${this.cString(this.frameName(i))}, ptr %fsh.name`,
      "  store ptr %fsh.prev, ptr %fsh.link",
      "  store ptr %fsh.site, ptr @fsh_rt_frames",
    ];
  }


  // Every return pops it; an unwinding panic leaves it, for the runtime to reset.
  popFrame(lines: Ref<string[]>): string[] {
    if (!this.framingOn) return [...lines];
    let n = 0;
    return lines.flatMap((line) => {
      if (!line.startsWith("  ret ")) return [line];
      const [link, prev] = [`%fsh.link${n}`, `%fsh.prev${n++}`];
      return [`  ${link} = getelementptr ${FRAME}, ptr %fsh.site, i32 0, i32 2`, `  ${prev} = load ptr, ptr ${link}`, `  store ptr ${prev}, ptr @fsh_rt_frames`, line];
    });
  }


  // A frame's name: the function as written, a generic one's instance without its number, a
  // nested function by its name and an arrow by where it starts.
  // Instances of one function that differ only in the closures given to parameters it only calls,
  // or hands on to itself at the same place, are compiled once: each such parameter is passed as
  // the closure's address and its body's code, and the caller drops the closure once the call
  // returns. A walker given a different closure by every caller is otherwise copied for each.
  sharing(): Map<InstanceId, Share> {
    let groups = new Map<string, InstanceId[]>();
    let found = new Map<InstanceId, Set<usize>>();
    for (const i of this.instances) {
      const at = this.callbacksOnlyCalled(i);
      if (at.size === 0) continue;
      found.set(i, new Set([...at]));
      const b = this.bodyAt(i);
      let parts = [`${b.name}@${b.start}`, this.tables.typing.keyOf(this.inst(i).returns), this.inst(i).throws === undefined ? "" : this.tables.typing.keyOf(this.inst(i).throws!)];
      let kAt: usize = 0;
      for (const p of b.params) {
        const k = kAt;
        kAt++;
        const get2 = this.inst(i).locals.get(p)!;
        const local = this.loc(get2);
        if (!at.has(k as usize)) {
          parts.push(this.tables.typing.keyOf(local.type));
          continue;
        }
        // What calling it gives and takes, which every instance sharing the code must agree on: as
        // types, since one IR shape can hold values that are dropped or dispatched differently.
        const target = this.calledThrough(i, p.pattern.kind === "ident" ? p.pattern.name : "");
        parts.push(target === undefined ? "*" : `*${this.inst(target).throws === undefined ? "" : this.tables.typing.keyOf(this.inst(target).throws!)}*${this.tables.typing.keyOf(this.inst(target).returns)}(${this.bodyAt(target).params.map((q) => this.tables.typing.keyOf(this.loc(this.inst(target).locals.get(q)!).type)).join(",")})`);
      }
      let bound = [...this.inst(i).bindings];
      bound.sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [name, t] of bound) {
        if (name.startsWith("#") && at.has(parseInt(name.slice(1))! as usize)) continue;
        parts.push(`${name}=${this.tables.typing.keyOf(t)}`);
      }
      const key = parts.join("|");
      if (!groups.has(key)) groups.set(key, []);
      let group = groups.get(key)!;
      group.push(i);
    }
    let out = new Map<InstanceId, Share>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      let template = group[0]!;
      for (const id of group) if (this.inst(id).symbol < this.inst(template).symbol) template = id;
      for (const id of group) {
        const i = this.tables.arenas.instanceOf(id);
        const b = bodyOf(this.tables.arenas, i);
        let code = new Map<usize, InstanceId | undefined>();
        const items = found.get(i.id)!;
        for (const k of items) {
          const pattern: Ref<Pattern> = b.params[k]!.pattern;
          code.set(k, this.calledThrough(i.id, pattern.kind === "ident" ? pattern.name : ""));
        }
        out.set(i.id, { template, at: found.get(i.id)!, code });
      }
    }
    return out;
  }


  // The parameters of a plain function holding a closure that its body only calls, or hands on
  // to the same function at the same place; one read anywhere else, a nested function's included,
  // is used some other way.
  callbacksOnlyCalled(i: InstanceId): Set<usize> {
    const b = this.bodyAt(i);
    let at = new Set<usize>();
    if (b.self !== undefined || b.closure !== undefined || b.generator === true || b.async === true || b.foreign === true || b.rust !== undefined || b.js !== undefined || b.exported === true || b.comptime !== undefined || this.inst(i).symbol === "main") return at;
    if (b.params.some((p) => p.comptime || p.rest)) return at;
    let kAt: usize = 0;
    for (const p of b.params) {
      const k = kAt;
      kAt++;
      if (p.pattern.kind !== "ident" || p.optional || p.default !== undefined) continue;
      const get2 = this.inst(i).locals.get(p)!;
      const part = this.loc(get2).type;
      if (this.recOf(part)?.kind !== "closure") continue;
      const name = p.pattern.name;
      let uses = 0;
      let calls = 0;
      // A generic function value runs another instance for each type it is called with.
      let runs = new Set<InstanceId>();
      // Inside a nested arrow or function only reading it counts: its calls aren't the body's.
      for (const st of b.body) {
        walkWhile({ of: "stmt", node: st }, (n) => {
          if (n.of === "objectProp" && n.node.kind === "shorthand" && n.node.name === name) uses++;
          if (n.of !== "expr") return true;
          const e = n.node;
          if (e.kind === "ident" && e.name === name) uses++;
          if (e.kind === "arrow" || e.kind === "function") {
            walk(n, (m) => {
              if (m.of === "expr" && m.node.kind === "ident" && m.node.name === name) uses++;
              if (m.of === "objectProp" && m.node.kind === "shorthand" && m.node.name === name) uses++;
            });
            return false;
          }
          if (e.kind === "call") {
            const target = this.inst(i).calls.get(e);
            if (e.callee.kind === "ident" && e.callee.name === name && e.args.every((a) => a.kind !== "spread")) {
              calls++;
              if (target !== undefined) runs.add(target);
            }
            let j: usize = 0;
            for (const a of e.args) {
              if (a.kind === "ident" && a.name === name && j === (k as usize) && target !== undefined && this.sameFunction(target, i)) calls++;
              j++;
            }
          }
          return true;
        });
      }
      // A call through the pair passes an environment and builds no frame, so it can only run a
      // plain closure: a generic function value's instance takes no environment.
      const plain = [...runs].every((r) => {
        const called = bodyOf(this.tables.arenas, this.tables.arenas.instanceOf(r));
        return called.closure !== undefined && called.async !== true && called.generator !== true;
      });
      if (uses > 0 && uses === calls && runs.size <= 1 && plain) at.add(k as usize);
    }
    return at;
  }


  sameFunction(a: InstanceId, b: InstanceId): boolean {
    const x = this.bodyAt(a);
    const y = this.bodyAt(b);
    return x.name === y.name && x.start === y.start;
  }


  // The closure's body a call of the parameter `name` runs, in `i`.
  calledThrough(i: InstanceId, name: string): InstanceId | undefined {
    let found: InstanceId | undefined = undefined;
    const body2 = this.bodyAt(i).body;
    for (const st of body2) {
      walkWhile({ of: "stmt", node: st }, (n) => {
        if (found !== undefined) return false;
        if (n.of === "expr" && n.node.kind === "call" && n.node.callee.kind === "ident" && n.node.callee.name === name) {
          const target = this.inst(i).calls.get(n.node);
          if (target !== undefined) found = target;
        }
        return true;
      });
    }
    return found;
  }


  frameName(i: InstanceId): string {
    const closure = this.bodyAt(i).closure;
    if (closure !== undefined) {
      if (closure.self !== undefined) return closure.self;
      const written = this.bodyAt(i);
      return `<arrow ${this.where({ start: written.start, end: written.end }).split(":").slice(-2).join(":")}>`;
    }
    // A generic instance ends in `#<id>`, which no frame shows; a private name is `#name` after a
    // dot or space, renamed `#name@Class` when a base declares one too.
    return shortened(this.inst(i).symbol).replace(/(?<![.\s])#\w+$/, "").replace(/(#\w+)@[^.#\s]+/g, "$1");
  }


  // The part of a generated symbol telling `owner` apart in its family: a hash of its description
  // rather than a count, so it is the same in every program making it. Owners described alike
  // get numbered suffixes.
  stableId(this: Mut<this>, family: string, description: string, owner: string = description): string {
    const stem = digest(description);
    let id = stem;
    for (let n = 1; this.taken.has(`${family} ${id}`) && this.taken.get(`${family} ${id}`) !== owner; n++) id = `${stem}.${n}`;
    this.taken.set(`${family} ${id}`, owner);
    return id;
  }


  // A top-level const holding an aggregate lives in a global, filled once before main runs (or
  // as a library loads) and only ever read; its arrays and strings are never freed.
  constantGlobal(this: Mut<this>, c: InstanceId): string {
    const made = this.constantGlobals.get(c);
    if ((made !== undefined && made !== "")) return made;
    const name = `@"fsh.const.${this.bodyAt(c).name.slice("const ".length as i64)}"`;
    this.constantGlobals.set(c, name);
    const part = this.inst(c).returns;
    this.globals.push(`${name} = internal global ${this.llvm(part)} zeroinitializer`);
    return name;
  }


  // The globals are filled before main; the runtime drops them at exit, before its leak check.
  /** @throws {CompileError} */
  fillConstants(this: Mut<this>): string[] {
    if (this.constantGlobals.size === 0) return [];
    const made = (cg: Mut<Codegen>, name: string, fill: (cg: Mut<Codegen>) => void) => {
      const saved = cg.setAside();
      fill(cg);
      cg.emit("ret void");
      const lines = [`define internal void ${name}() {`, "entry:", ...cg.allocas, ...cg.body, "}", ""];
      cg.takeUp(saved);
      return lines;
    };
    // Each constant's value, computed while compiling, before the filler that stores it.
    const constants = [...this.constantGlobals.keys()];
    let computed: Value[] = [];
    for (const c of constants) computed.push(comptimeBody(this, c));
    const filler = made(this, '@"fsh.constants"', (cg) => {
      let at: usize = 0;
      for (const [c, name] of [...cg.constantGlobals]) {
        const gives = cg.inst(c).returns;
        const line = `store ${cg.llvm(gives)} ${cg.bake(computed[at]!, gives)}, ptr ${name}`;
        at++;
        cg.emit(line);
      }
      cg.emit('call void @fsh_rt_constants(ptr @"fsh.constants.drop")');
    });
    const dropper = made(this, '@"fsh.constants.drop"', (cg) => {
      for (const [c, name] of [...cg.constantGlobals]) {
        const v = cg.temp();
        const gives = cg.inst(c).returns;
        cg.emit(`${v} = load ${cg.llvm(gives)}, ptr ${name}`);
        cg.dispose(v, gives);
      }
    });
    return [...filler, ...dropper, '@llvm.global_ctors = appending global [1 x { i32, ptr, ptr }] [{ i32, ptr, ptr } { i32 65535, ptr @"fsh.constants", ptr null }]'];
  }


  // Comptime gives what can be built into the program: numbers, booleans, strings, and arrays,
  // Maps, Sets, objects, instances, unions and enums of them; a top-level const may also hold an Atomic or
  // a Lock.
  /** @throws {CompileError} */
  bakeable(this: Mut<this>, type: Type, at: Ref<Span>, constant = false) {
    // The first part of a type comptime can't make, or undefined.
    function fault(cg: Mut<Codegen>, t: Type): Type | undefined {
      if (typeof t === "string") return t === "void" ? t : undefined;
      const r = cg.tables.typing.rec(t);
      if (r.kind === "literal" || r.kind === "regex") return undefined;
      // A type holding itself isn't built into the program.
      if (cg.tables.typing.tiedBy(t) !== undefined) return t;
      let parts: Type[] = [];
      if (r.kind === "union") parts = [...r.members];
      else if (r.kind === "array") parts = [r.element];
      else if (r.kind === "object" || r.kind === "variant") parts = r.fields.map((f) => f.type);
      else if (r.kind === "class") {
        if (r.base !== undefined) parts.push(r.base);
        for (const f of r.fields) parts.push(f.type);
      } else if (r.kind === "map") parts = r.set ? [r.key] : [r.key, r.value];
      else if (r.kind === "interior" && constant && r.which !== "Cell") parts = [r.of];
      else return t;
      for (const p of parts) {
        const found = fault(cg, p);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    const part = fault(this, type);
    if (part === undefined) return;
    const inside = part === type ? "" : ` (in '${this.tables.typing.show(type)}')`;
    const what = this.isRef(type) ? "a top-level const is already computed while compiling; read it without 'comptime'" : `'${this.tables.typing.show(part)}'${inside} can't be computed while compiling: comptime makes numbers, booleans, strings, and arrays, Maps, Sets, objects, instances, unions and enums of them`;
    throw new CompileError("E1102", what, at.start, at.end);
  }


  // Two numbers of different types, as an instance's argument and a value of its bound may be,
  // equal by value: as f64 when either is a float, as JavaScript's numbers are, else as i128.
  // ponytail: a u128 beside a signed type compares as i128, wrong past i128's range.
  mixedNumbers(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string | undefined {
    const number = (cg: Mut<Codegen>, t: Type): [Numeric, string | undefined] | undefined => {
      const r = cg.recOf(t);
      const base = r?.kind === "literal" ? cg.tables.typing.baseOf(t as LiteralType) : t;
      if (!isNumeric(base)) return undefined;
      return [base, r !== undefined && r.kind === "literal" ? literalText(r.value) : undefined];
    };
    const [x, y] = [number(this, aType), number(this, bType)];
    if (x === undefined || y === undefined || x[0] === y[0]) return undefined;
    const common: Numeric = isFloat(x[0]) || isFloat(y[0]) ? "f64" : x[0] === "u128" && y[0] === "u128" ? "u128" : "i128";
    const side = (cg: Mut<Codegen>, [type, constant]: [Numeric, string | undefined], v: string) => (constant !== undefined ? (isFloat(common) && !constant.includes(".") ? `${constant}.0` : constant) : cg.cast(v, type, common));
    const [l, r] = [side(this, x, a), side(this, y, b)];
    const result = this.temp();
    this.emit(`${result} = ${isFloat(common) ? "fcmp oeq" : "icmp eq"} ${this.llvm(common)} ${l}, ${r}`);
    return result;
  }


  // Rust's `as`: integers truncate or extend by the source's signedness, floats round toward
  // zero into integers, saturating with NaN as 0, and widen or narrow between themselves.
  cast(this: Mut<this>, v: string, from: Type, to: Numeric): string {
    if (from === to || this.llvm(from) === this.llvm(to) && isInteger(from) && isInteger(to)) return v;
    const result = this.temp();
    const [a, b] = [this.llvm(from), this.llvm(to)];
    if (from === "boolean") this.emit(`${result} = zext i1 ${v} to ${b}`);
    else if (isInteger(from) && isInteger(to)) {
      const [wide, narrow] = [integerInfo(from).bits, integerInfo(to).bits];
      this.emit(`${result} = ${narrow < wide ? "trunc" : integerInfo(from).signed ? "sext" : "zext"} ${a} ${v} to ${b}`);
    } else if (isInteger(from)) this.emit(`${result} = ${integerInfo(from).signed ? "sitofp" : "uitofp"} ${a} ${v} to ${b}`);
    else if (isInteger(to)) {
      const intrinsic = `@llvm.fpto${integerInfo(to).signed ? "s" : "u"}i.sat.${b}.${a === "double" ? "f64" : "f32"}`;
      this.intrinsics.add(`declare ${b} ${intrinsic}(${a})`);
      this.emit(`${result} = call ${b} ${intrinsic}(${a} ${v})`);
    } else this.emit(`${result} = ${to === "f64" ? "fpext" : "fptrunc"} ${a} ${v} to ${b}`);
    return result;
  }


  // A binary operator on numbers: floats never overflow, and integers are checked as Rust's are.
  numeric(this: Mut<this>, op: BinaryOp, a: string, b: string, at: Ref<Span>, type: Type): string {
    if (type === "bigint") return this.bigOperate(op, a, b, at);
    if (!isFloat(type)) return this.lowering().operate(op, a, b, at, type as Integer);
    const result = this.temp();
    // `**` is `Math.pow`; an f32 one is worked in f64 and rounded back.
    if (op === "**") {
      this.intrinsics.add("declare double @fsh_math_pow(double, double)");
      if (type === "f64") {
        this.emit(`${result} = call double @fsh_math_pow(double ${a}, double ${b})`);
        return result;
      }
      const [x, y, wide] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${x} = fpext float ${a} to double`);
      this.emit(`${y} = fpext float ${b} to double`);
      this.emit(`${wide} = call double @fsh_math_pow(double ${x}, double ${y})`);
      this.emit(`${result} = fptrunc double ${wide} to float`);
      return result;
    }
    this.emit(`${result} = ${floatArithmetic(op)} ${this.llvm(type)} ${a}, ${b}`);
    return result;
  }


  // A bigint as a number: an integer from its low bits, a float rounded to the nearest; another
  // bigint is another reference to it.
  bigTo(this: Mut<this>, v: string, to: Type): string {
    if (to === "bigint") return v;
    const result = this.temp();
    if (isFloat(to)) {
      this.emit(`${result} = call double @fsh_rt_big_f64(ptr ${v})`);
      if (to === "f64") return result;
      const narrow = this.temp();
      this.emit(`${narrow} = fptrunc double ${result} to float`);
      return narrow;
    }
    this.emit(`${result} = call i128 @fsh_rt_big_low(ptr ${v})`);
    const { bits } = integerInfo(to as Integer);
    if (bits === 128) return result;
    const narrow = this.temp();
    this.emit(`${narrow} = trunc i128 ${result} to i${bits}`);
    return narrow;
  }


  // Whether an 'as' widens to a type that isn't a number, rather than converting a number or
  // checking a union's tag.
  widens(this: Mut<this>, e: Ref<Extract<Expr, { kind: "as" | "satisfies" }>>): boolean {
    const [from, to] = [this.valueType(e.expr), this.cur().types.get(e)!];
    if (this.recOf(from)?.kind === "union" && from !== to && !this.tables.typing.fits(from, to)) return false;
    return !isNumeric(to) && to !== "bigint" && this.recOf(to)?.kind !== "pointer";
  }


  // A new bigint from an operator on two, made by the runtime.
  bigOperate(this: Mut<this>, op: BinaryOp, a: string, b: string, at: Ref<Span>): string {
    const result = this.temp();
    // Division, powers and shifts may panic, unwinding what the statement holds.
    const call = (cg: Mut<Codegen>, line: string, panics = false) => {
      if (panics) cg.unwinding(`call ptr ${line}`, result);
      else cg.emit(`${result} = call ptr ${line}`);
    };
    switch (op) {
      case "+": call(this, `@fsh_rt_big_add(ptr ${a}, ptr ${b})`); break;
      case "-": call(this, `@fsh_rt_big_sub(ptr ${a}, ptr ${b})`); break;
      case "*": call(this, `@fsh_rt_big_mul(ptr ${a}, ptr ${b})`); break;
      case "/": case "%": const line2 = `@fsh_rt_big_div(ptr ${a}, ptr ${b}, i32 ${op === "%" ? 1 : 0}, ptr ${this.panicAt(at)})`;
      call(this, line2, true); break;
      case "**": const line3 = `@fsh_rt_big_pow(ptr ${a}, ptr ${b}, ptr ${this.panicAt(at)})`;
      call(this, line3, true); break;
      case "<<": case ">>": const line4 = `@fsh_rt_big_shift(ptr ${a}, ptr ${b}, i32 ${op === ">>" ? 1 : 0}, ptr ${this.panicAt(at)})`;
      call(this, line4, true); break;
      case "&": case "|": case "^": call(this, `@fsh_rt_big_bitwise(ptr ${a}, ptr ${b}, i32 ${["&", "|", "^"].indexOf(op)})`); break;
      default: assert(false, `internal error: no bigint '${op}'`);
    }
    return result;
  }


  // `Math` on f64 lowers to LLVM's intrinsics or to the runtime's functions; `abs`, `sign`, `min`
  // and `max` keep their numeric type, a float `min` or `max` giving NaN for any NaN and telling
  // -0 from 0, as JavaScript does.
  mathCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const name = (e.callee as Extract<Expr, { kind: "member" }>).name;
    const type = this.cur().types.get(e) as Numeric;
    const t = this.llvm(type);
    const args = e.args.map((a) => this.value(a));
    const r = (cg: Mut<Codegen>) => cg.temp();
    const call = (cg: Mut<Codegen>, fn: string, xs: string[], of: string = t) => {
      const result = r(cg);
      cg.intrinsics.add(`declare ${of} ${fn}(${xs.map(() => of).join(", ")})`);
      cg.emit(`${result} = call ${of} ${fn}(${xs.map((x) => `${of} ${x}`).join(", ")})`);
      return result;
    };
    const op = (cg: Mut<Codegen>, line: string) => {
      const result = r(cg);
      cg.emit(`${result} = ${line}`);
      return result;
    };
    if (MATH_INTRINSICS.has(name)) return call(this, `@llvm.${name}.f64`, args);
    if (name in MATH_FLOAT && name !== "round") return call(this, `@fsh_math_${name}`, args);
    const x = args[0]!;
    const float = isFloat(type);
    const number = (n: f64) => (float ? floatConstant(n, type as "f32" | "f64") : `${n}`);
    if (name === "round") {
      const down = call(this, "@llvm.floor.f64", [x]);
      const line2 = `fcmp oge double ${op(this, `fsub double ${x}, ${down}`)}, ${floatConstant(0.5, "f64")}`;
      const up = op(this, line2);
      const line3 = `select i1 ${up}, double ${op(this, `fadd double ${down}, ${floatConstant(1, "f64")}`)}, double ${down}`;
      const rounded = op(this, line3);
      return call(this, "@llvm.copysign.f64", [rounded, x]);
    }
    const signed = !float && integerInfo(type as Integer).signed;
    const less = float ? "fcmp olt" : signed ? "icmp slt" : "icmp ult";
    const more = float ? "fcmp ogt" : signed ? "icmp sgt" : "icmp ugt";
    if (name === "abs") {
      if (float) return call(this, `@llvm.fabs.${type}`, [x]);
      if (!signed) return x;
      const negative = op(this, `icmp slt ${t} ${x}, 0`);
      const [neg, done, start] = [this.label(), this.label(), this.block];
      this.emit(`br i1 ${negative}, label %${neg}, label %${done}`);
      this.startBlock(neg);
      const negated = this.lowering().arithmetic("-", "0", x, { start: e.start, end: e.end }, type as Integer, "negate");
      const from = this.block;
      this.emit(`br label %${done}`);
      this.startBlock(done);
      return op(this, `phi ${t} [ ${x}, %${start} ], [ ${negated}, %${from} ]`);
    }
    if (name === "sign") {
      const zero = float ? x : "0";
      const line4 = `select i1 ${op(this, `${less} ${t} ${x}, ${number(0)}`)}, ${t} ${signed || float ? number(-1) : "0"}, ${t} ${zero}`;
      const below = op(this, line4);
      const line5 = `select i1 ${op(this, `${more} ${t} ${x}, ${number(0)}`)}, ${t} ${number(1)}, ${t} ${below}`;
      return op(this, line5);
    }
    const better = name === "min" ? less : more;
    return args.reduce((a, b) => {
      const line6 = `select i1 ${op(this, `${better} ${t} ${a}, ${b}`)}, ${t} ${a}, ${t} ${b}`;
      const pick = op(this, line6);
      if (!float) return pick;
      const bits = type === "f32" ? "i32" : "i64";
      const line7 = `${name === "min" ? "or" : "and"} ${bits} ${op(this, `bitcast ${t} ${a} to ${bits}`)}, ${op(this, `bitcast ${t} ${b} to ${bits}`)}`;
      const joined = op(this, line7);
      const line8 = `select i1 ${op(this, `fcmp oeq ${t} ${a}, ${b}`)}, ${t} ${op(this, `bitcast ${bits} ${joined} to ${t}`)}, ${t} ${pick}`;
      const zeros = op(this, line8);
      const line9 = `select i1 ${op(this, `fcmp uno ${t} ${a}, ${a}`)}, ${t} ${a}, ${t} ${zeros}`;
      return op(this, line9);
    });
  }


  // `x.toFixed(digits)`: a float from its exact value, an integer exactly; digits past 100
  // panic, as JavaScript throws a RangeError.
  toFixed(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const op = (cg: Mut<Codegen>, line: string) => {
      const v = cg.temp();
      cg.emit(`${v} = ${line}`);
      return v;
    };
    const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
    const type = this.tables.typing.lower(this.valueType(object)) as Numeric;
    const x = this.value(object);
    const digits = e.args.length > 0 ? this.value(e.args[0]!) : "0";
    if (e.args.length > 0) {
      const op2 = op(this, `icmp ugt i64 ${digits}, 100`);
      this.lowering().panicIf(op2, "toFixed() digits argument must be between 0 and 100", { start: e.args[0]!.start, end: e.args[0]!.end });
    }
    const result = this.temp();
    if (isFloat(type)) {
      const wide = type === "f32" ? op(this, `fpext float ${x} to double`) : x;
      this.emit(`${result} = call ptr @fsh_rt_to_fixed(double ${wide}, i64 ${digits})`);
    } else {
      const { signed, bits } = integerInfo(type as Integer);
      let wide: string;
      if (bits === 64) {
        wide = x;
      } else {
        const line2 = `${signed ? "sext" : "zext"} ${this.llvm(type)} ${x} to i64`;
        wide = op(this, line2);
      }
      this.emit(`${result} = call ptr @fsh_rt_int_to_fixed(i64 ${wide}, i32 ${signed ? 1 : 0}, i64 ${digits})`);
    }
    if (!this.cur().types.has(e)) this.pending.push({ v: result, type: "string" });
    return result;
  }


  // `x.checkedAdd(y)` and its kin: checked gives null when the operation overflowed, and
  // overflowing pairs the wrapped value with whether it did, the intrinsic's own `{ iN, i1 }`.
  integerMethodCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const callee: Ref<Expr> = e.callee;
    if (callee.kind !== "member") return "";
    const type = this.tables.typing.lower(this.valueType(callee.object)) as Integer;
    const [family, operation] = integerMethod(callee.name)!;
    const a = this.value(callee.object);
    const chosen = e.args.length > 0 ? this.value(e.args[0]!) : "";
    const [v, over] = this.lowering().method(family, operation, a, chosen, { start: e.start, end: e.end }, type);
    const t = this.llvm(type);
    const result = this.temp();
    if (family === "checked") {
      const option = this.tables.typing.unionType([type, "null"]);
      const line = `${result} = select i1 ${over!}, ${this.llvm(option)} ${this.convert("zeroinitializer", "null", option)}, ${this.llvm(option)} ${this.convert(v, type, option)}`;
      this.emit(line);
      return result;
    }
    if (family !== "overflowing") return v;
    const pair = this.temp();
    this.emit(`${pair} = insertvalue { ${t}, i1 } undef, ${t} ${v}, 0`);
    this.emit(`${result} = insertvalue { ${t}, i1 } ${pair}, i1 ${over!}, 1`);
    return result;
  }


  // An assertion: a panic at the call when it is false, giving its message, or else
  // `assertion failed: ` and its condition as written. The message is made only then, as Rust's is.
  assertCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): undefined {
    const holds = this.value(e.args[0]!);
    const [fail, ok] = [this.label(), this.label()];
    this.emit(`br i1 ${holds}, label %${ok}, label %${fail}`);
    this.startBlock(fail);
    if (e.args.length > 1) {
      // The message is handed over owned, and what making it left pending released first.
      const mark = this.pending.length;
      const message = this.owned(e.args[1]!);
      this.settle(mark);
      const line = `call void @fsh_rt_panic_assert(ptr ${this.panicAt({ start: e.start, end: e.end })}, ptr ${message})`;
      this.unwinding(line);
    } else {
      const line2 = `call void @fsh_rt_panic(ptr ${this.cString(`panicked at ${this.where({ start: e.start, end: e.end })}:\nassertion failed: ${this.tables.asserts.get(e)!}\n`)})`;
      this.unwinding(line2);
    }
    this.emit("unreachable");
    this.startBlock(ok);
    return undefined;
  }


  // A number parsed by the runtime, or null where JavaScript would give NaN.
  parseCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, name: "parseInt" | "parseFloat" | "Number"): string {
    const number: Type = name === "parseInt" ? "i64" : "f64";
    const s = this.operand(e.args[0]!, e.args, 1);
    const radix = e.args.length > 1 ? this.value(e.args[1]!) : "0";
    const [out, ok, read, found] = [this.alloca(this.llvm(number)), this.temp(), this.temp(), this.temp()];
    const args = name === "parseInt" ? `ptr ${s}, i64 ${radix}, ptr ${out}` : `ptr ${s}, ptr ${out}`;
    this.emit(`${ok} = call i32 @fsh_rt_parse_${name === "Number" ? "number" : name === "parseInt" ? "int" : "float"}(${args})`);
    this.emit(`${read} = load ${this.llvm(number)}, ptr ${out}`);
    this.emit(`${found} = icmp ne i32 ${ok}, 0`);
    const type = this.cur().types.get(e) ?? this.tables.typing.unionType([number, "null"]);
    const result = this.temp();
    const line = `${result} = select i1 ${found}, ${this.llvm(type)} ${this.convert(read, number, type)}, ${this.llvm(type)} ${this.convert("zeroinitializer", "null", type)}`;
    this.emit(line);
    return result;
  }


  emit(this: Mut<this>, line: string) {
    if (this.debuggingOn && this.site !== undefined && (this.marked === undefined || this.site.start !== this.marked.start || this.site.end !== this.marked.end)) {
      this.body.push(`  ;fsh.at ${this.site.start}`);
      this.marked = { start: this.site.start, end: this.site.end };
    }
    const called = this.framingOn && this.site !== undefined ? CALLEE.exec(line) : null;
    if (called !== null && !QUIET.test(called[1]!)) {
      let start: usize = 0;
      let end: usize = 0;
      if (this.site !== undefined) {
        start = this.site.start;
        end = this.site.end;
      }
      const at = this.where({ start, end });
      const text = this.cString(at);
      this.body.push(`  store ptr ${text}, ptr %fsh.site`);
    }
    this.body.push(`  ${line}`);
  }


  alloca(this: Mut<this>, type: string): string {
    const slot = this.temp();
    this.allocas.push(`  ${slot} = alloca ${type}`);
    return slot;
  }


  temp(this: Mut<this>): string {
    return `%t${this.temps++}`;
  }


  label(this: Mut<this>): string {
    return `L${this.labels++}`;
  }


  startBlock(this: Mut<this>, name: string) {
    this.body.push(`${name}:`);
    this.block = name;
  }


  // A pipe's hidden topic is named `%`, which an LLVM name can't start with.
  // A loop's condition and update run again after its body, which may leave first: each C
  // string they make gets its slot in the loop's scope up front, so every way out drops it.
  reserveC(this: Mut<this>, e: Ref<Expr>) {
    walkWhile({ of: "expr", node: e }, (n) => {
      if (n.of !== "expr") return true;
      const call = n.node;
      if (call.kind === "arrow") return false;
      if (call.kind === "call" && call.callee.kind === "ident" && call.callee.name === "cString" && !this.cur().calls.has(call) && !this.reserved.has(call)) {
        const held = this.alloca(ARRAY);
        this.allocas.push(`  store ${ARRAY} zeroinitializer, ptr ${held}`);
        const part = { slot: held, type: this.tables.typing.arrayType("u8") };
        this.scopes[this.scopes.length - 1]!.held.push(part);
        this.reserved.set(exprKey(call), held);
      }
      return true;
    });
  }




  // A C string's buffer, owned by the enclosing block as an array of bytes it frees at its end;
  // a scope a match or a pipe opens isn't a block. A loop's condition makes one each time round,
  // so the slot drops what it holds first. C would read only up to a NUL inside, so a string
  // holding one can't cross, as Rust's `CString` refuses it.
  forC(this: Mut<this>, s: string, at: Ref<Expr>): string {
    const [made, old, refused] = [this.temp(), this.temp(), this.temp()];
    this.unwinding(`call ptr @fsh_rt_str_cstring(ptr ${s})`, made);
    this.emit(`${refused} = icmp eq ptr ${made}, null`);
    this.lowering().panicIf(refused, "a string holding NUL can't cross to C, which would read only up to it", { start: at.start, end: at.end });
    let held = this.reserved.get(at);
    if ((held === undefined || held === "")) {
      held = this.alloca(ARRAY);
      this.allocas.push(`  store ${ARRAY} zeroinitializer, ptr ${held}`);
      this.scopes.findLast((scope) => !scope.transient)!.held.push({ slot: held, type: this.tables.typing.arrayType("u8") });
    }
    this.emit(`${old} = load ${ARRAY}, ptr ${held}`);
    const arrayType2 = this.tables.typing.arrayType("u8");
    this.dispose(old, arrayType2);
    const array = this.temp();
    this.emit(`${array} = insertvalue ${ARRAY} zeroinitializer, ptr ${made}, 0`);
    this.emit(`store ${ARRAY} ${array}, ptr ${held}`);
    return made;
  }


  // A raw pointer's method: a load or a store of what it points at, the address `n` elements
  // along, or whether it is null.
  pointerCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string | undefined {
    const p = this.valueType(callee.object) as PointerType;
    const at = this.value(callee.object);
    const result = this.temp();
    switch (callee.name) {
      case "read":
        this.emit(`${result} = load ${this.llvm(this.tables.typing.rec(p).to)}, ptr ${at}`);
        return result;
      case "write":
        const line = `store ${this.llvm(this.tables.typing.rec(p).to)} ${this.value(e.args[0]!)}, ptr ${at}`;
        this.emit(line);
        return undefined;
      case "offset":
        const line2 = `${result} = getelementptr ${this.llvm(this.tables.typing.rec(p).to)}, ptr ${at}, i64 ${this.value(e.args[0]!)}`;
        this.emit(line2);
        return result;
      default:
        this.emit(`${result} = icmp eq ptr ${at}, null`);
        return result;
    }
  }


  // A new Atomic, Cell, Lock or RwLock: what it holds, a boolean widened to a byte in an Atomic,
  // and a lock's word unlocked.
  interiorNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, t: InteriorType): string {
    const v = this.owned(e.args![0]!);
    const result = this.temp();
    if (isLock(this.tables.typing.rec(t))) this.emit(`${result} = insertvalue ${this.llvm(t)} { i32 0, ${this.llvm(this.tables.typing.rec(t).of)} poison }, ${this.llvm(this.tables.typing.rec(t).of)} ${v}, 1`);
    else if (this.llvm(t) !== this.llvm(this.tables.typing.rec(t).of)) this.emit(`${result} = zext i1 ${v} to i8`);
    else return v;
    return result;
  }


  // An Atomic's method, as one sequentially consistent atomic instruction on where it lives.
  atomicCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string | undefined {
    const t = this.referent(this.valueType(callee.object)) as InteriorType;
    const at = this.receiver(callee.object);
    if (this.tables.typing.rec(t).which === "Cell") return this.cellCall(e, callee, t, at);
    if (isLock(this.tables.typing.rec(t))) return this.lockUpdate(e, t, at);
    const ty = this.llvm(t);
    const align = `align ${ty === "i8" ? 1 : ty === "i16" ? 2 : ty === "i32" ? 4 : 8}`;
    const byte = ty !== this.llvm(this.tables.typing.rec(t).of);
    const args = e.args.map((a) => {
      const v = this.value(a);
      if (!byte) return v;
      const wide = this.temp();
      this.emit(`${wide} = zext i1 ${v} to i8`);
      return wide;
    });
    const result = this.temp();
    switch (callee.name) {
      case "load":
        this.emit(`${result} = load atomic ${ty}, ptr ${at} seq_cst, ${align}`);
        break;
      case "store":
        this.emit(`store atomic ${ty} ${args[0]!}, ptr ${at} seq_cst, ${align}`);
        return undefined;
      case "compareExchange": {
        const pair = this.temp();
        this.emit(`${pair} = cmpxchg ptr ${at}, ${ty} ${args[0]!}, ${ty} ${args[1]!} seq_cst seq_cst`);
        this.emit(`${result} = extractvalue { ${ty}, i1 } ${pair}, 0`);
        break;
      }
      default: {
        const op = callee.name === "add" ? "add" : callee.name === "sub" ? "sub" : "xchg";
        this.emit(`${result} = atomicrmw ${op} ptr ${at}, ${ty} ${args[0]!} seq_cst`);
      }
    }
    if (!byte) return result;
    const narrow = this.temp();
    this.emit(`${narrow} = trunc i8 ${result} to i1`);
    return narrow;
  }


  // Gives up a shared value's count; the last drops the value and frees the block. An Rc's last
  // strong count gives up the strongs' weak count instead, which frees it once no Weak is left.
  dropShared(this: Mut<this>, t: SharedType) {
    const which = this.tables.typing.rec(t).which;
    if (which === "Weak") {
      this.emit("call void @fsh_rt_weak_release(ptr %v)");
      return;
    }
    const [last, held, at, value] = [this.temp(), this.temp(), this.temp(), this.temp()];
    const [free, done] = [this.label(), this.label()];
    this.emit(`${last} = call i32 @fsh_rt_${which === "Rc" ? "rc" : "shared"}_release(ptr %v)`);
    this.emit(`${held} = icmp ne i32 ${last}, 0`);
    this.emit(`br i1 ${held}, label %${free}, label %${done}`);
    this.startBlock(free);
    const line = `${at} = getelementptr ${this.sharedBlock(t)}, ptr %v, i32 0, i32 1, i32 1`;
    this.emit(line);
    this.emit(`${value} = load ${this.llvm(this.tables.typing.rec(t).of)}, ptr ${at}`);
    this.dispose(value, this.tables.typing.rec(t).of);
    this.emit(which === "Rc" ? "call void @fsh_rt_weak_release(ptr %v)" : "call void @fsh_rt_free(ptr %v)");
    this.emit(`br label %${done}`);
    this.startBlock(done);
  }


  // Takes a lock word, panicking if this thread already holds it, which would wait forever, or
  // if a task panicked holding it, which leaves it held over a value it may have half changed.
  takeLock(this: Mut<this>, word: string, at: Ref<Span>, take = "fsh_rt_lock") {
    const [taken, held, poisoned] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${taken} = call i32 @${take}(ptr ${word})`);
    this.emit(`${held} = icmp eq i32 ${taken}, 1`);
    const holder = take === "fsh_rt_lock" ? "an `update`" : "a `read` or an `update`";
    this.lowering().panicIf(held, `this lock is already held by ${holder} running here; use the value its callback is given`, at);
    this.emit(`${poisoned} = icmp eq i32 ${taken}, 2`);
    this.lowering().panicIf(poisoned, "a task panicked while holding this lock, so the value it guards may be half changed", at);
  }


  // Marks an Rc's value read or changed for a callback, panicking where the two would overlap.
  borrowRc(this: Mut<this>, word: string, at: Ref<Span>, reading: boolean) {
    const [taken, changing, read] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${taken} = call i32 @fsh_rt_rc_${reading ? "read" : "write"}(ptr ${word})`);
    this.emit(`${changing} = icmp eq i32 ${taken}, 1`);
    this.lowering().panicIf(changing, reading ? "this Rc's value is being changed by an `update` running here, so it can't be read until that returns" : "this Rc's value is already being changed by an `update` running here; use the value its callback is given", at);
    if (reading) return;
    this.emit(`${read} = icmp eq i32 ${taken}, 2`);
    this.lowering().panicIf(read, "this Rc's value is being read by a `read` or a method running here, so `update` can't change it until that returns", at);
  }


  // 'AbortSignal.any's handles and their count: a literal's, lent one by one, in a stack array,
  // and otherwise the borrowed array's own buffer.
  signalList(this: Mut<this>, list: Ref<Expr>): string {
    if (list.kind !== "array") {
      const [array, whole, buffer, length] = [this.value(list), this.temp(), this.temp(), this.temp()];
      this.emit(`${whole} = load ${ARRAY}, ptr ${array}`);
      this.emit(`${buffer} = extractvalue ${ARRAY} ${whole}, 0`);
      this.emit(`${length} = extractvalue ${ARRAY} ${whole}, 1`);
      return `ptr ${buffer}, i64 ${length}`;
    }
    const n = list.elements.length;
    const handles = this.alloca(`[${Math.max(n, 1)} x ptr]`);
    let iAt: usize = 0;
    for (const x of list.elements) {
      const i = iAt;
      iAt++;
      const [handle, at] = [this.temp(), this.temp()];
      const line = `${handle} = load ptr, ptr ${this.value(x!)}`;
      this.emit(line);
      this.emit(`${at} = getelementptr [${Math.max(n, 1)} x ptr], ptr ${handles}, i32 0, i32 ${i}`);
      this.emit(`store ptr ${handle}, ptr ${at}`);
    }
    return `ptr ${handles}, i64 ${n}`;
  }


  // A wait's frame given an AbortSignal, its last argument: a count on it goes in the frame.
  signalled(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, future: FutureType, frame: string): string {
    if (this.tables.typing.leafOf.get(future)?.signal !== true) return frame;
    const [handle, next] = [this.temp(), this.temp()];
    const line = `${handle} = load ptr, ptr ${this.value(e.args.at(-1)!)}`;
    this.emit(line);
    const blockType2 = this.tables.typing.blockType("AbortSignal");
    const line2 = `${next} = insertvalue ${this.llvm(future)} ${frame}, ptr ${this.copied(handle, blockType2)}, ${this.tables.typing.rec(future).frame.length - 2}`;
    this.emit(line2);
    return next;
  }


  // A new `AbortError`, its message a literal.
  abortError(this: Mut<this>, type: Type): string {
    const made = this.temp();
    const line = `${made} = insertvalue ${this.llvm(type)} zeroinitializer, ptr ${this.text("This operation was aborted")}, 0`;
    this.emit(line);
    return made;
  }


  // `c.signal`, another handle to a controller's signal, and `signal.aborted`.
  blockProperty(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): string {
    const holder = this.cur().types.get(e.object)!;
    const handle = this.isRef(holder) ? this.temp() : this.value(e.object);
    if (this.isRef(holder)) {
      const line = `${handle} = load ptr, ptr ${this.value(e.object)}`;
      this.emit(line);
    }
    if (e.name === "signal") {
      const get2 = this.cur().types.get(e)!;
      return this.copied(handle, get2);
    }
    if (e.name === "port") {
      const port = this.temp();
      this.emit(`${port} = call i64 @fsh_rt_tcp_port(ptr ${handle})`);
      return port;
    }
    const [aborted, yes] = [this.temp(), this.temp()];
    this.emit(`${aborted} = call i32 @fsh_rt_signal_aborted(ptr ${handle})`);
    this.emit(`${yes} = icmp ne i32 ${aborted}, 0`);
    return yes;
  }


  // `new Semaphore(n)` and `new Channel<T>(capacity)`: a block in the runtime with one count.
  blockNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>, t: BlockType): string {
    const made = this.temp();
    if (this.tables.typing.rec(t).which === "AbortController") {
      this.emit(`${made} = call ptr @fsh_rt_signal_new()`);
      return made;
    }
    const n = this.value(e.args![0]!);
    if (this.tables.typing.rec(t).which === "Semaphore") {
      const negative = this.temp();
      this.emit(`${negative} = icmp slt i64 ${n}, 0`);
      this.lowering().panicIf(negative, "a semaphore's number of slots can't be negative", { start: e.start, end: e.end });
      this.emit(`${made} = call ptr @fsh_rt_semaphore_new(i64 ${n})`);
      return made;
    }
    const small = this.temp();
    this.emit(`${small} = icmp slt i64 ${n}, 1`);
    this.lowering().panicIf(small, "a channel's capacity must be at least 1", { start: e.start, end: e.end });
    // The ring is allocated whole, so its size in bytes must fit.
    // ponytail: the ring is allocated up front, grow it on demand if large capacities matter
    const [end, size, wide, most, large] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${end} = getelementptr ${this.llvm(this.tables.typing.rec(t).of)}, ptr null, i64 1`);
    this.emit(`${size} = ptrtoint ptr ${end} to i64`);
    this.emit(`${wide} = icmp eq i64 ${size}, 0`);
    this.emit(`${most} = select i1 ${wide}, i64 1, i64 ${size}`);
    const limit = this.temp();
    this.emit(`${limit} = udiv i64 ${(1n << 47n).toString()}, ${most}`);
    this.emit(`${large} = icmp sgt i64 ${n}, ${limit}`);
    this.lowering().panicIf(large, "a channel's capacity is too large to allocate", { start: e.start, end: e.end });
    const line = `${made} = call ptr @fsh_rt_channel_new(i64 ${n}, i64 ${size}, ptr ${this.elementDrop(this.tables.typing.rec(t).of)})`;
    this.emit(line);
    return made;
  }


  // A map's entry: its state, hash and key bits for the runtime, then its key and value.
  entryType(t: MapType): string {
    return `{ i64, i64, i64, ${this.llvm(this.tables.typing.rec(t).key)}, ${this.tables.typing.rec(t).set ? "{}" : this.llvm(this.tables.typing.rec(t).value)} }`;
  }


  // The byte offset of part `i` of an LLVM struct type, or with no `i`, the type's size.
  offsetOf(this: Mut<this>, type: string, i?: usize): string {
    const [at, n] = [this.temp(), this.temp()];
    this.emit(i === undefined ? `${at} = getelementptr ${type}, ptr null, i64 1` : `${at} = getelementptr ${type}, ptr null, i64 0, i32 ${i}`);
    this.emit(`${n} = ptrtoint ptr ${at} to i64`);
    return n;
  }


  // A float key as JavaScript's SameValueZero sees it: `-0` becomes `+0`, which adding `+0` does.
  sameValueZero(this: Mut<this>, v: string, key: Type): string {
    const k = this.tables.typing.lower(key);
    if (!isFloat(k)) return v;
    const zeroed = this.temp();
    this.emit(`${zeroed} = fadd ${this.llvm(k)} ${v}, 0.0`);
    return zeroed;
  }


  // A key as the runtime hashes and compares it: a string's pointer, an integer widened to 64
  // bits, a float's bits with every NaN one NaN, or a union's member index.
  keyBits(this: Mut<this>, v: string, key: Type): string {
    const k = this.tables.typing.lower(key);
    if (isFloat(k)) {
      const [wide, raw, nan, bits] = [k === "f64" ? this.sameValueZero(v, key) : this.temp(), this.temp(), this.temp(), this.temp()];
      if (k === "f32") {
        const line = `${wide} = fpext float ${this.sameValueZero(v, key)} to double`;
        this.emit(line);
      }
      this.emit(`${raw} = bitcast double ${wide} to i64`);
      this.emit(`${nan} = fcmp uno double ${wide}, 0.0`);
      this.emit(`${bits} = select i1 ${nan}, i64 ${0x7ff8000000000000n}, i64 ${raw}`);
      return bits;
    }
    if (k === "string") {
      const bits = this.temp();
      this.emit(`${bits} = ptrtoint ptr ${v} to i64`);
      return bits;
    }
    if (isInteger(k)) {
      if (integerInfo(k).bits === 64) return v;
      const bits = this.temp();
      this.emit(`${bits} = ${integerInfo(k).signed ? "sext" : "zext"} ${this.llvm(k)} ${v} to i64`);
      return bits;
    }
    if (this.recOf(k)?.kind === "union") {
      const [tag, bits] = [this.temp(), this.temp()];
      this.emit(`${tag} = extractvalue ${this.llvm(k)} ${v}, 0`);
      this.emit(`${bits} = zext i32 ${tag} to i64`);
      return bits;
    }
    return "0";
  }


  // `new Map<K, V>()` and `new Set<T>()`: an empty table, told how to drop its keys and values.
  // With `from`, the array whose pairs or members it takes over, a later key replacing an earlier.
  mapNew(this: Mut<this>, t: MapType, from: Ref<Expr> | undefined): string {
    // The array runs first, so a panic in it has no table to leave behind.
    const whole = (from !== undefined ? this.owned(from) : undefined);
    const made = this.emptyMap(t);
    if (from === undefined || (whole === undefined || whole === "")) return made;
    const array = this.tables.typing.rec((this.cur().coercions.get(from) ?? this.cur().types.get(from)) as ArrayType);
    const et = this.llvm(array.element);
    const [data, length] = [this.temp(), this.temp()];
    this.emit(`${data} = extractvalue ${ARRAY} ${whole}, 0`);
    this.emit(`${length} = extractvalue ${ARRAY} ${whole}, 1`);
    this.elements(array.element, data, length, (cg, at) => {
      const element = cg.temp();
      cg.emit(`${element} = load ${et}, ptr ${at}`);
      if (cg.tables.typing.rec(t).set) {
        cg.inserted(t, made, element, undefined);
        return;
      }
      const [key, v] = [cg.temp(), cg.temp()];
      cg.emit(`${key} = extractvalue ${et} ${element}, 0`);
      cg.emit(`${v} = extractvalue ${et} ${element}, 1`);
      cg.inserted(t, made, key, v);
    });
    this.emit(`call void @fsh_rt_free(ptr ${data})`);
    return made;
  }


  emptyMap(this: Mut<this>, t: MapType): string {
    const entry = this.entryType(t);
    const [size, keyAt, valueAt] = [this.offsetOf(entry), this.offsetOf(entry, 3), this.offsetOf(entry, 4)];
    const drop = (cg: Mut<Codegen>, part: Type) => (cg.needsDrop(part) ? cg.elementDrop(part) : "null");
    const made = this.temp();
    const chosen = this.tables.typing.lower(this.tables.typing.rec(t).key) === "string" ? 1 : 0;
    const part2 = this.tables.typing.rec(t).key;
    const drop2 = drop(this, part2);
    const value = this.tables.typing.rec(t).value;
    const drop3 = this.tables.typing.rec(t).set ? "null" : drop(this, value);
    const line = `${made} = call ptr @fsh_rt_map_new(i64 ${size}, i64 ${keyAt}, i64 ${valueAt}, i32 ${chosen}, ptr ${drop2}, ptr ${drop3})`;
    this.emit(line);
    return made;
  }


  // Puts an owned key, and for a Map its owned value, into the table: a key already there keeps
  // its first copy and its place in the order, as JavaScript's does, and its old value is dropped.
  inserted(this: Mut<this>, t: MapType, map: string, key: string, v: string | undefined) {
    const entry = this.entryType(t);
    const [kt, vt] = [this.llvm(this.tables.typing.rec(t).key), this.llvm(this.tables.typing.rec(t).value)];
    const valueAt = (cg: Mut<Codegen>, at: string) => {
      const slot = cg.temp();
      cg.emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
      return slot;
    };
    const [found, at, was, there, replace, fresh, done] = [this.alloca("i32"), this.temp(), this.temp(), this.temp(), this.label(), this.label(), this.label()];
    const line = `${at} = call ptr @fsh_rt_map_insert(ptr ${map}, i64 ${this.keyBits(key, this.tables.typing.rec(t).key)}, ptr ${found})`;
    this.emit(line);
    this.emit(`${was} = load i32, ptr ${found}`);
    this.emit(`${there} = icmp ne i32 ${was}, 0`);
    this.emit(`br i1 ${there}, label %${replace}, label %${fresh}`);
    this.startBlock(replace);
    this.dispose(key, this.tables.typing.rec(t).key);
    if (v !== undefined) {
      const [slot, old] = [valueAt(this, at), this.temp()];
      this.emit(`${old} = load ${vt}, ptr ${slot}`);
      this.dispose(old, this.tables.typing.rec(t).value);
      this.emit(`store ${vt} ${v}, ptr ${slot}`);
    }
    this.emit(`br label %${done}`);
    this.startBlock(fresh);
    const keySlot = this.temp();
    this.emit(`${keySlot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    const line2 = `store ${kt} ${this.sameValueZero(key, this.tables.typing.rec(t).key)}, ptr ${keySlot}`;
    this.emit(line2);
    if (v !== undefined) {
      const line3 = `store ${vt} ${v}, ptr ${valueAt(this, at)}`;
      this.emit(line3);
    }
    this.emit(`br label %${done}`);
    this.startBlock(done);
  }


  // A copy of the map in %v: the table copied whole, then each live entry's value and key copied
  // in place. A value's copy may panic, and the copy so far goes with it.
  copyMap(this: Mut<this>, t: MapType): string {
    const entry = this.entryType(t);
    const [copy, used, index] = [this.temp(), this.temp(), this.alloca("i64")];
    this.emit(`${copy} = call ptr @fsh_rt_map_copy(ptr %v)`);
    this.emit(`${used} = call i64 @fsh_rt_map_used(ptr ${copy})`);
    this.emit(`store i64 0, ptr ${index}`);
    const [head, body, live, next, done] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp ult i64 ${i}, ${used}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    const [at, state, copying] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = call ptr @fsh_rt_map_at(ptr ${copy}, i64 ${i})`);
    this.emit(`${state} = load i64, ptr ${at}`);
    this.emit(`${copying} = icmp eq i64 ${state}, 3`);
    this.emit(`br i1 ${copying}, label %${live}, label %${next}`);
    this.startBlock(live);
    if (!this.tables.typing.rec(t).set && this.needsDrop(this.tables.typing.rec(t).value)) {
      const [slot, v, made] = [this.temp(), this.temp(), this.temp()];
      const vt = this.llvm(this.tables.typing.rec(t).value);
      this.emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
      this.emit(`${v} = load ${vt}, ptr ${slot}`);
      const held = this.recOf(this.tables.typing.rec(t).value);
      if (held !== undefined && held.kind !== "handle" && held.kind !== "interior") {
        const line = `call ${vt} ${this.helper("copy", this.tables.typing.rec(t).value as Exclude<Type, string>)}(${vt} ${v})`;
        this.unwinding(line, made, (cg: Mut<Codegen>) => cg.emit(`call void @fsh_rt_map_free(ptr ${copy})`));
        this.emit(`store ${vt} ${made}, ptr ${slot}`);
      } else {
        const line2 = `store ${vt} ${this.copied(v, this.tables.typing.rec(t).value)}, ptr ${slot}`;
        this.emit(line2);
      }
    }
    const [keySlot, k] = [this.temp(), this.temp()];
    const kt = this.llvm(this.tables.typing.rec(t).key);
    this.emit(`${keySlot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    this.emit(`${k} = load ${kt}, ptr ${keySlot}`);
    const key = this.copied(k, this.tables.typing.rec(t).key);
    this.emit(`store ${kt} ${key}, ptr ${keySlot}`);
    const line3 = `call void @fsh_rt_map_copied(ptr ${copy}, i64 ${i}, i64 ${this.keyBits(key, this.tables.typing.rec(t).key)})`;
    this.emit(line3);
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const after = this.temp();
    this.emit(`${after} = add i64 ${i}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    return copy;
  }


  // A Map's or a Set's method on the table its receiver holds. `set` and `add` give the receiver
  // back, a `Mut` borrow of where the table lives.
  mapCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string | undefined {
    const t = this.valueType(callee.object) as MapType;
    const entry = this.entryType(t);
    const at = this.receiver(callee.object);
    const map = this.temp();
    this.emit(`${map} = load ptr, ptr ${at}`);
    const [kt, vt] = [this.llvm(this.tables.typing.rec(t).key), this.tables.typing.rec(t).set ? "{}" : this.llvm(this.tables.typing.rec(t).value)];
    const part = (cg: Mut<Codegen>, e: string, i: 3 | 4) => {
      const slot = cg.temp();
      cg.emit(`${slot} = getelementptr ${entry}, ptr ${e}, i64 0, i32 ${i}`);
      return slot;
    };
    const load = (cg: Mut<Codegen>, type: string, slot: string) => {
      const v = cg.temp();
      cg.emit(`${v} = load ${type}, ptr ${slot}`);
      return v;
    };
    const name = callee.name;
    if (name === "clear") {
      this.emit(`call void @fsh_rt_map_clear(ptr ${map})`);
      return undefined;
    }
    if (name === "keys" || name === "values" || name === "entries") return this.listed(e, name, t, map);
    if (name === "forEach") return this.eachEntry(e, t, map);
    // The key is owned for the call: kept when it goes in, dropped once it has been looked up.
    // A panic in the value's argument drops the key made before it.
    const [key, given] = this.delivered<[string, string | undefined]>((cg): [string, string | undefined] => {
      const owned2 = cg.owned(e.args[0]!);
      const hand2 = cg.hand(owned2, cg.tables.typing.rec(t).key);
      if (name !== "set") return [hand2, undefined];
      const owned3 = cg.owned(e.args[1]!);
      return [hand2, cg.hand(owned3, cg.tables.typing.rec(t).value)];
    });
    if (name === "set" || name === "add") {
      this.inserted(t, map, key, given);
      return at;
    }
    const bits = this.keyBits(key, this.tables.typing.rec(t).key);
    if (name === "delete") {
      const [gone, removed, drop, done] = [this.temp(), this.temp(), this.label(), this.label()];
      this.emit(`${gone} = call ptr @fsh_rt_map_remove(ptr ${map}, i64 ${bits})`);
      this.dispose(key, this.tables.typing.rec(t).key);
      this.emit(`${removed} = icmp ne ptr ${gone}, null`);
      this.emit(`br i1 ${removed}, label %${drop}, label %${done}`);
      this.startBlock(drop);
      const part2 = part(this, gone, 3);
      const load2 = load(this, kt, part2);
      this.dispose(load2, this.tables.typing.rec(t).key);
      if (!this.tables.typing.rec(t).set) {
        const part3 = part(this, gone, 4);
        const load3 = load(this, vt, part3);
        this.dispose(load3, this.tables.typing.rec(t).value);
      }
      this.emit(`br label %${done}`);
      this.startBlock(done);
      return removed;
    }
    const [i, there] = [this.temp(), this.temp()];
    this.emit(`${i} = call i64 @fsh_rt_map_find(ptr ${map}, i64 ${bits})`);
    this.dispose(key, this.tables.typing.rec(t).key);
    this.emit(`${there} = icmp sge i64 ${i}, 0`);
    if (name === "has") return there;
    const [hit, miss, done] = [this.label(), this.label(), this.label()];
    // `update(k, f)`: the arrow called once with the value to change, when the key is there.
    if (name === "update") {
      const callback: Ref<Expr> = e.args[1]!;
      const closure = this.cur().types.get(callback) as ClosureType;
      const env = this.alloca(this.llvm(closure));
      const line = `store ${this.llvm(closure)} ${this.owned(callback)}, ptr ${env}`;
      this.emit(line);

      this.emit(`br i1 ${there}, label %${hit}, label %${done}`);
      this.startBlock(hit);
      const found = this.temp();
      this.emit(`${found} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
      const target = this.callOf(callback)!;
      const slice2 = [`ptr ${part(this, found, 4)}`].slice(0, this.bodyAt(target).params.length as i64);
      const gives = this.invoke(target, env, slice2, exprKey(e), undefined, (cg: Mut<Codegen>) => cg.dropStashed(env, closure));
      if (gives !== undefined && this.needsDrop(this.tables.typing.rec(closure).returns)) this.dispose(gives, this.tables.typing.rec(closure).returns);
      this.emit(`br label %${done}`);
      this.startBlock(done);
      this.dropStashed(env, closure);
      return there;
    }
    // `get`: a clone of the value, or nothing.
    const option = this.tables.typing.unionType([this.tables.typing.rec(t).value, "null"]);
    const out = this.alloca(this.llvm(option));
    this.emit(`br i1 ${there}, label %${hit}, label %${miss}`);
    this.startBlock(hit);
    const found = this.temp();
    this.emit(`${found} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
    const part4 = part(this, found, 4);
    const load4 = load(this, vt, part4);
    const copied2 = this.copied(load4, this.tables.typing.rec(t).value);
    const line2 = `store ${this.llvm(option)} ${this.convert(copied2, this.tables.typing.rec(t).value, option)}, ptr ${out}`;
    this.emit(line2);
    this.emit(`br label %${done}`);
    this.startBlock(miss);
    const line3 = `store ${this.llvm(option)} ${this.convert("zeroinitializer", "null", option)}, ptr ${out}`;
    this.emit(line3);
    this.emit(`br label %${done}`);
    this.startBlock(done);
    const llvm2 = this.llvm(option);
    const v = load(this, llvm2, out);
    if (!this.cur().types.has(e) && this.needsDrop(option)) this.pending.push({ v, type: option });
    return v;
  }


  // `for...of` over a Map's entries or a Set's members, in insertion order. The table's pointer
  // and the entry reached live in slots, so a generator's loop may stop at a `yield`; the loop
  // owns the table only when it was made for it.
  /** @throws {CompileError} */
  mapLoop(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>, t: MapType) {
    const local = this.resolved(s.left as Stmt);
    const entry = this.entryType(t);
    this.scopes.push({ transient: false, held: [] });
    const [held, counter] = [this.loopSlot(s, 0, "ptr"), this.loopSlot(s, 1, "i64")];
    const kept = (this.resuming !== undefined ? this.tables.typing.rec(this.resuming.type).frame[this.cur().frame!.loops.get(s)!]!.type : undefined);
    if (kept !== undefined ? this.recOf(kept)?.kind === "map" : this.fresh(s.right)) {
      this.own(held, t);
      const line = `store ptr ${this.owned(s.right)}, ptr ${held}`;
      this.emit(line);
    } else {
      const line2 = `store ptr ${this.value(s.right)}, ptr ${held}`;
      this.emit(line2);
    }
    this.settle();
    this.emit(`store i64 0, ptr ${counter}`);
    const [test, live, loop, next, end] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    const [i, map, used, more] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${counter}`);
    this.emit(`${map} = load ptr, ptr ${held}`);
    this.emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    this.emit(`${more} = icmp slt i64 ${i}, ${used}`);
    this.emit(`br i1 ${more}, label %${live}, label %${end}`);
    this.startBlock(live);
    const [at, state, alive] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
    this.emit(`${state} = load i64, ptr ${at}`);
    this.emit(`${alive} = icmp eq i64 ${state}, 1`);
    this.emit(`br i1 ${alive}, label %${loop}, label %${next}`);
    this.startBlock(loop);
    this.exits.set(stmtKey(s), { exit: end, next, depth: this.scopes.length });
    this.scopes.push({ transient: false, held: [] });
    this.reserve(local);
    const slot2 = this.slot(local);
    const part6 = this.loc(local).type;
    this.own(slot2, part6);
    // Each part is a pointer into the entry, or a copy when it copies.
    const piece = (cg: Mut<Codegen>, i: 3 | 4, type: Type, given: Type) => {
      const part = cg.temp();
      cg.emit(`${part} = getelementptr ${entry}, ptr ${at}, i64 0, i32 ${i}`);
      if (cg.isRef(given)) return part;
      const v = cg.temp();
      cg.emit(`${v} = load ${cg.llvm(type)}, ptr ${part}`);
      return cg.copied(v, type);
    };
    if (this.tables.typing.rec(t).set) {
      const part2 = this.tables.typing.rec(t).key;
      const part3 = this.loc(local).type;
      const part7 = this.loc(local).type;
      const line3 = `store ${this.llvm(part7)} ${piece(this, 3, part2, part3)}, ptr ${this.slot(local)}`;
      this.emit(line3);
    }
    else {
      const [k, v] = this.tables.typing.elementsOf(this.loc(local).type as ObjectType);
      const [first, pair] = [this.temp(), this.temp()];
      const part4 = this.tables.typing.rec(t).key;
      const part8 = this.loc(local).type;
      const line5 = `${first} = insertvalue ${this.llvm(part8)} undef, ${this.llvm(k!)} ${piece(this, 3, part4, k!)}, 0`;
      this.emit(line5);
      const part5 = this.tables.typing.rec(t).value;
      const part9 = this.loc(local).type;
      const line6 = `${pair} = insertvalue ${this.llvm(part9)} ${first}, ${this.llvm(v!)} ${piece(this, 4, part5, v!)}, 1`;
      this.emit(line6);
      const part10 = this.loc(local).type;
      const line4 = `store ${this.llvm(part10)} ${pair}, ptr ${this.slot(local)}`;
      this.emit(line4);
    }
    for (const each of s.body) this.statement(each);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const [now, after] = [this.temp(), this.temp()];
    this.emit(`${now} = load i64, ptr ${counter}`);
    this.emit(`${after} = add i64 ${now}, 1`);
    this.emit(`store i64 ${after}, ptr ${counter}`);
    this.emit(`br label %${test}`);
    this.startBlock(end);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
  }


  // Runs the body for each live entry of a map, in insertion order, with a pointer to it.
  entriesLoop(this: Mut<this>, t: MapType, map: string, each: (cg: Mut<Codegen>, entry: string) => void) {
    const [used, index] = [this.temp(), this.alloca("i64")];
    const order = this.dictOrder(t, map);
    this.emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    this.emit(`store i64 0, ptr ${index}`);
    const [head, body, live, next, done] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${used}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    const [at, state, alive] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = ${this.entryAt(map, order, i)}`);
    this.emit(`${state} = load i64, ptr ${at}`);
    this.emit(`${alive} = icmp eq i64 ${state}, 1`);
    this.emit(`br i1 ${alive}, label %${live}, label %${next}`);
    this.startBlock(live);
    each(this, at);
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const after = this.temp();
    this.emit(`${after} = add i64 ${i}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    if ((order !== undefined && order !== "")) this.emit(`call void @fsh_rt_free(ptr ${order})`);
  }


  // A dictionary's entries are read in the order JavaScript gives an object's keys, which the
  // runtime works out for each read of them all; a Map's in the order they were made.
  dictOrder(this: Mut<this>, t: MapType, map: string): string | undefined {
    if (this.tables.typing.rec(t).dict !== true) return undefined;
    const order = this.temp();
    this.emit(`${order} = call ptr @fsh_rt_dict_order(ptr ${map})`);
    return order;
  }


  entryAt(map: string, order: string | undefined, i: string): string {
    return (order !== undefined && order !== "") ? `call ptr @fsh_rt_dict_at(ptr ${map}, ptr ${order}, i64 ${i})` : `call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`;
  }


  // `keys()`, `values()` and `entries()`: arrays of clones, in insertion order. A Set's values
  // are its members, and its entries pair each member with itself, as JavaScript's do.
  listed(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, name: string, t: MapType, map: string): string {
    const result = this.cur().types.get(e) as ArrayType;
    const out = this.alloca(ARRAY);
    this.emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    const entry = this.entryType(t);
    const read = (cg: Mut<Codegen>, at: string, i: 3 | 4, type: Type) => {
      const [slot, v] = [cg.temp(), cg.temp()];
      cg.emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 ${i}`);
      cg.emit(`${v} = load ${cg.llvm(type)}, ptr ${slot}`);
      return cg.copied(v, type);
    };
    this.entriesLoop(t, map, (cg, at) => {
      if (name === "keys" || (name === "values" && cg.tables.typing.rec(t).set)) {
        const part = cg.tables.typing.rec(t).key;
        const read2 = read(cg, at, 3, part);
        cg.appended(out, cg.tables.typing.rec(t).key, read2);
        return;
      }
      if (name === "values") {
        const part2 = cg.tables.typing.rec(t).value;
        const read3 = read(cg, at, 4, part2);
        cg.appended(out, cg.tables.typing.rec(t).value, read3);
        return;
      }
      const pair = cg.tables.typing.rec(result).element;
      const part3 = cg.tables.typing.rec(t).key;
      const read4 = read(cg, at, 3, part3);
      const key = cg.tables.typing.rec(t).key;
      const value = cg.tables.typing.rec(t).value;
      const [k, v] = [read4, cg.tables.typing.rec(t).set ? read(cg, at, 3, key) : read(cg, at, 4, value)];
      const [first, both] = [cg.temp(), cg.temp()];
      cg.emit(`${first} = insertvalue ${cg.llvm(pair)} undef, ${cg.llvm(cg.tables.typing.rec(t).key)} ${k}, 0`);
      cg.emit(`${both} = insertvalue ${cg.llvm(pair)} ${first}, ${cg.tables.typing.rec(t).set ? cg.llvm(cg.tables.typing.rec(t).key) : cg.llvm(cg.tables.typing.rec(t).value)} ${v}, 1`);
      cg.appended(out, pair, both);
    });
    const v = this.temp();
    this.emit(`${v} = load ${ARRAY}, ptr ${out}`);
    if (!this.cur().types.has(e)) this.pending.push({ v, type: result });
    return v;
  }


  // `forEach(f)`: the arrow called with each value and its key, or each member, borrowed or copied.
  eachEntry(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, t: MapType, map: string): undefined {
    const entry = this.entryType(t);
    const callback: Ref<Expr> = e.args[0]!;
    const closure = this.cur().types.get(callback) as ClosureType;
    const target = this.callOf(callback)!;
    const env = this.alloca(this.llvm(closure));
    const line = `store ${this.llvm(closure)} ${this.owned(callback)}, ptr ${env}`;
    this.emit(line);
    const parts: [3 | 4, Type][] = this.tables.typing.rec(t).set ? [[3, this.tables.typing.rec(t).key], [3, this.tables.typing.rec(t).key]] : [[4, this.tables.typing.rec(t).value], [3, this.tables.typing.rec(t).key]];
    this.entriesLoop(t, map, (cg, at) => {
      const passed = parts.slice(0, cg.tables.typing.rec(closure).params.length as i64).map(([i, type], n) => {
        const slot = cg.temp();
        cg.emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 ${i}`);
        const given = cg.tables.typing.rec(closure).params[n as usize]!;
        if (cg.isRef(given)) return `ptr ${slot}`;
        const v = cg.temp();
        cg.emit(`${v} = load ${cg.llvm(type)}, ptr ${slot}`);
        const copied2 = cg.copied(v, type);
        return `${cg.llvm(given)} ${cg.convert(copied2, type, given)}`;
      });
      const slice2 = passed.slice(0, cg.bodyAt(target).params.length as i64);
      const gives = cg.invoke(target, env, slice2, exprKey(e), undefined, (cg: Mut<Codegen>) => {
        if (cg.needsDrop(closure)) {
          const unstash2 = cg.unstash(env, closure);
          cg.dispose(unstash2, closure);
        }
      });
      if (gives !== undefined && cg.needsDrop(cg.tables.typing.rec(closure).returns)) cg.dispose(gives, cg.tables.typing.rec(closure).returns);
    });
    if (this.needsDrop(closure)) {
      const unstash3 = this.unstash(env, closure);
      this.dispose(unstash3, closure);
    }
    return undefined;
  }


  // An export of one of the program's packages, as a JsValue. The bundle is defined once the
  // packages the program reaches are bundled.
  jsExport(this: Mut<this>, name: Ref<JsName>, at: Ref<Span>): string {
    const box = this.temp();
    const line = `call ptr @fsh_rt_js_export(ptr @fsh.js.bundle, i64 ${name.package}, ptr ${this.cString(name.name)}, ptr ${this.panicAt(at)})`;
    this.unwinding(line, box);
    return box;
  }


  // A call of a package's function: each argument converted into a new JS value, and the result
  // read back as its declaration says.
  jsCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, name: Ref<JsName>, target: InstanceId): string | undefined {
    const fn = this.jsExport(name, { start: e.start, end: e.end });
    const map2 = this.bodyAt(target).params.map((p) => p.optional);
    const argv = this.jsArgv(e.args, map2);
    const result = this.temp();
    const line = `call ptr @fsh_rt_js_call(ptr ${fn}, ptr null, i64 ${e.args.length}, ptr ${argv}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
    this.unwinding(line, result);
    const gives = this.cur().types.get(e) ?? (this.inst(target).returns === "void" ? undefined : this.inst(target).returns);
    if (gives === undefined) {
      this.emit(`call void @fsh_rt_js_release(ptr ${result})`);
      return undefined;
    }
    return this.fromJs(result, gives, `'${name.name}' from '${name.module}' gave`, { start: e.start, end: e.end });
  }


  // Arguments going to JS, each a new JS value in a buffer of boxes the call gives up; `optional`
  // says which parameters JS may leave out, so an empty value is undefined there.
  jsArgv(this: Mut<this>, args: Ref<Expr[]>, optional: Ref<boolean[]>): string {
    const boxes = args.map((a, i) => {
      this.jsSite = { start: a.start, end: a.end };
      const to = this.cur().coercions.get(a);
      // A callback is handed over to JS, which keeps it, as the stored callable it meets, and a
      // future as the stored Promise, which a task awaits; one read from a place moves out of it.
      const held = to ?? this.cur().types.get(a)!;
      if (this.isCallback(held) || this.isPromised(held)) {
        const owned2 = this.owned(a);
        return this.toJs(owned2, held, (i as usize) < optional.length && optional[i as usize]! ? "undefined" : "null");
      }
      const jsOperand2 = this.jsOperand(a);
      const get2 = this.cur().types.get(a)!;
      const get3 = this.cur().coercions.get(a);
      return this.toJs(jsOperand2, get2, (i as usize) < optional.length && optional[i as usize]! ? "undefined" : "null", get3);
    });
    const argv = this.alloca(`[${Math.max(boxes.length, 1)} x ptr]`);
    let iAt: usize = 0;
    for (const box of boxes) {
      const i = iAt;
      iAt++;
      const at = this.temp();
      this.emit(`${at} = getelementptr [${boxes.length} x ptr], ptr ${argv}, i32 0, i32 ${i}`);
      this.emit(`store ptr ${box}, ptr ${at}`);
    }
    return argv;
  }


  // A value going to JS, as its own type rather than one it meets, as JS takes any; one made
  // for the statement is dropped once it ends.
  jsOperand(this: Mut<this>, a: Ref<Expr>): string {
    const v = this.known.get(a) ?? this.evaluate(a);
    if (this.fresh(a) && !this.known.has(a)) this.pending.push({ v, type: this.cur().types.get(a)! });
    return v;
  }


  // A handle's box, read through a reference to it.
  jsHandle(this: Mut<this>, object: Ref<Expr>): string {
    const v = this.value(object);
    if (!this.isRef(this.valueType(object))) return v;
    const box = this.temp();
    this.emit(`${box} = load ptr, ptr ${v}`);
    return box;
  }


  // Which parameters of the method, constructor or static a call takes are written with `?`.
  optionalAt(call: Ref<Expr>): boolean[] {
    const optional = this.tables.jsOptionalOf.get(call);
    return optional === undefined ? [] : [...optional];
  }

  // The site whose calls the function being emitted is making now.
  siteNow(): Span | undefined {
    return this.site === undefined ? undefined : { start: this.site.start, end: this.site.end };
  }

  // Where the value going to JS now was written, for the callbacks and settlers made for it.
  jsSiteNow(): Span | undefined {
    return this.jsSite === undefined ? undefined : { start: this.jsSite.start, end: this.jsSite.end };
  }


  // A property of a JS object read as its declaration says: a handle's, or a class's static.
  jsGet(this: Mut<this>, object: string, name: string, type: Type, what: string, at: Ref<Span>): string {
    const box = this.temp();
    const line = `call ptr @fsh_rt_js_get(ptr ${object}, ptr ${this.text(name)}, ptr ${this.panicAt(at)})`;
    this.unwinding(line, box);
    return this.fromJs(box, type, what, at);
  }


  // A method of a JS object called with it as `this`, its result read as `gives` says, or
  // dropped when the call's value goes unused.
  jsMethod(this: Mut<this>, object: string, name: string, args: Ref<Expr[]>, gives: Type | undefined, what: string, at: Ref<Expr>): string | undefined {
    const fn = this.temp();
    const line = `call ptr @fsh_rt_js_get(ptr ${object}, ptr ${this.text(name)}, ptr ${this.panicAt({ start: at.start, end: at.end })})`;
    this.unwinding(line, fn);
    this.emit(`call void @fsh_rt_block_retain(ptr ${object})`);
    const argv = this.jsArgv(args, this.optionalAt(at));
    const result = this.temp();
    const line2 = `call ptr @fsh_rt_js_call(ptr ${fn}, ptr ${object}, i64 ${args.length}, ptr ${argv}, ptr ${this.panicAt({ start: at.start, end: at.end })})`;
    this.unwinding(line2, result);
    if (gives === undefined || gives === "void") {
      this.emit(`call void @fsh_rt_js_release(ptr ${result})`);
      return undefined;
    }
    return this.fromJs(result, gives, what, { start: at.start, end: at.end });
  }


  // A package's class's static member, read or called on the class itself.
  jsStatic(this: Mut<this>, e: Ref<Expr>, name: Ref<JsName>): string | undefined {
    const c = this.jsExport(name, { start: e.start, end: e.end });
    let result: string | undefined = undefined;
    if (e.kind === "member") {
      const get2 = this.cur().types.get(e)!;
      result = this.jsGet(c, e.name, get2, `'${name.name}.${e.name}' is`, { start: e.start, end: e.end });
    }
    else if (e.kind === "call" && e.callee.kind === "member") {
      const method = e.callee.name;
      const get3 = this.cur().types.get(e);
      result = this.jsMethod(c, method, e.args, get3, `'${name.name}.${method}' gave`, e);
    }
    this.emit(`call void @fsh_rt_js_release(ptr ${c})`);
    return result;
  }


  // A stored callable, which crosses into JS as a function.
  isCallback(t: Type): boolean {
    if (typeof t === "string") return false;
    const r = this.tables.typing.rec(t);
    return r.kind === "dyn" && this.tables.typing.callableOf.has(r.of);
  }


  // A stored Promise, which crosses into JS as a promise.
  isPromised(t: Type): boolean {
    if (typeof t === "string") return false;
    const r = this.tables.typing.rec(t);
    return r.kind === "dyn" && this.tables.typing.promiseElement(r.of) !== undefined;
  }


  // The task settling a JS promise with what a stored Promise gives, given at `at`: its poll,
  // awaiting the Promise and resolving the JS promise with its value made a JS value, and the
  // drop of a frame never finished. The frame holds the Promise and the settling functions.
  jsSettler(this: Mut<this>, type: DynType, at: Ref<Span>): [string, string] {
    const key = `${this.tables.typing.keyOf(type)} ${at.start}`;
    const made = this.settlers.get(key);
    if (made !== undefined) return made;
    const line = `${this.tables.typing.described(type)} ${at.start}`;
    const n = this.stableId("js.settle", line, key);
    const names: [string, string] = [`@fsh.js.settle.${n}`, `@fsh.js.settle.drop.${n}`];
    this.settlers.set(key, names);
    const frame = `{ ${DYN}, ptr }`;
    const saved = this.setAside();
    const site = this.jsSiteNow();
    const [innerAt, settleAt, settle] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${innerAt} = getelementptr ${frame}, ptr %frame, i32 0, i32 0`);
    this.emit(`${settleAt} = getelementptr ${frame}, ptr %frame, i32 0, i32 1`);
    this.emit(`${settle} = load ptr, ptr ${settleAt}`);
    const step = this.pollStep(type, innerAt, { start: at.start, end: at.end });
    this.startBlock(step.waiting);
    this.emit("ret i32 0");
    this.startBlock(step.failed);
    this.emit("unreachable");
    this.startBlock(step.ready);
    const gives = this.tables.typing.promiseElement(this.tables.typing.rec(type).of)!;
    const v = step.value(this);
    this.jsSite = { start: at.start, end: at.end };
    const box = gives === "void" || v === undefined ? this.temp() : this.toJs(v, gives, "null");
    if (gives === "void" || v === undefined) this.emit(`${box} = call ptr @fsh_rt_js_of_empty(i32 1)`);
    this.emit(`call void @fsh_rt_js_settle(ptr ${settle}, ptr ${box})`);
    if (v !== undefined && gives !== "void") this.dispose(v, gives);
    const old = this.temp();
    this.emit(`${old} = load ${DYN}, ptr ${innerAt}`);
    this.dispose(old, type);
    this.emit("ret i32 1");
    this.out.push(`define internal i32 ${names[0]}(ptr %cx, ptr %frame) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.startFresh();
    const [promise, held] = [this.temp(), this.temp()];
    this.emit(`${promise} = load ${DYN}, ptr %frame`);
    this.dispose(promise, type);
    const at1 = this.temp();
    this.emit(`${at1} = getelementptr ${frame}, ptr %frame, i32 0, i32 1`);
    this.emit(`${held} = load ptr, ptr ${at1}`);
    this.emit(`call void @fsh_rt_js_release(ptr ${held})`);
    this.emit("ret void");
    this.out.push(`define internal void ${names[1]}(ptr %frame) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    if (!this.settledOutput) {
      this.settledOutput = true;
      this.out.push(`define internal void @"fsh.js.settled.output"(ptr %out) {`);
      this.out.push("entry:");
      this.out.push("  ret void");
      this.out.push("}");
      this.out.push("");
    }
    this.takeUp(saved);
    this.jsSite = site;
    return names;
  }


  // The function JS calls a callback of this type through, given at `at`: what JS gives it read
  // as its parameters say, the callable called, and what it gives made a JS value. Called with a
  // count below zero, as JS's garbage collector drops the function, it drops the callable.
  jsCallback(this: Mut<this>, type: DynType, at: Ref<Span>): string {
    const key = `${this.tables.typing.keyOf(type)} ${at.start}`;
    const made = this.callbacks.get(key);
    if ((made !== undefined && made !== "")) return made;
    const line = `${this.tables.typing.described(type)} ${at.start}`;
    const name = `@fsh.js.callback.${this.stableId("js.callback", line, key)}`;
    this.callbacks.set(key, name);
    const saved = this.setAside();
    const site = this.jsSiteNow();
    const fn = this.tables.typing.callableOf.get(this.tables.typing.rec(type).of)!;
    const [dropping, drop, call] = [this.temp(), this.label(), this.label()];
    this.emit(`${dropping} = icmp slt i64 %argc, 0`);
    this.emit(`br i1 ${dropping}, label %${drop}, label %${call}`);
    this.startBlock(drop);
    const [half, whole] = [this.temp(), this.temp()];
    this.emit(`${half} = insertvalue ${DYN} undef, ptr %data, 0`);
    this.emit(`${whole} = insertvalue ${DYN} ${half}, ptr %table, 1`);
    this.dispose(whole, type);
    this.emit("ret ptr null");
    this.startBlock(call);
    const args = this.tables.typing.rec(fn).params.map((p, i) => {
      const [slot, box] = [this.temp(), this.temp()];
      this.emit(`${slot} = getelementptr ptr, ptr %argv, i64 ${i}`);
      this.emit(`${box} = load ptr, ptr ${slot}`);
      return `, ${this.llvm(p)} ${this.fromJs(box, p, `a callback was given`, { start: at.start, end: at.end })}`;
    });
    const callee = this.vslot("%table", 0);
    const result = this.tables.typing.rec(fn).returns === "void" ? undefined : this.temp();
    this.unwinding(`call ${this.tables.typing.rec(fn).returns === "void" ? "void" : this.llvm(this.tables.typing.rec(fn).returns)} ${callee}(ptr %data${args.join("")})`, result);
    if (result === undefined) this.emit("ret ptr null");
    else {
      this.jsSite = { start: at.start, end: at.end };
      const box = this.toJs(result, this.tables.typing.rec(fn).returns, "null");
      this.dispose(result, this.tables.typing.rec(fn).returns);
      this.emit(`ret ptr ${box}`);
    }
    this.out.push(`define internal ptr ${name}(ptr %data, ptr %table, i64 %argc, ptr %argv) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUp(saved);
    this.jsSite = site;
    return name;
  }


  // The shape an object is given as: a package's, or an object type, through an Option.
  jsShapeOf(t: Type): ObjectType | InterfaceType | undefined {
    if (typeof t === "string") return undefined;
    const r = this.tables.typing.rec(t);
    if (r.kind === "union") return r.members.map(((t) => this.jsShapeOf(t))).find((s) => s !== undefined);
    return this.tables.typing.jsShape(t) ?? (r.kind === "object" ? (t as ObjectType) : undefined);
  }


  // A Fish value as a new JS value, in a box of its own; empty is `undefined` for a parameter
  // written with `?`, which JS may leave out, and `null` otherwise. A field an object leaves out
  // isn't there in JS either.
  toJs(this: Mut<this>, v: string, type: Type, empty: "undefined" | "null", declared?: Type): string {
    const r = this.recOf(type);
    if (r?.kind === "param") return this.toJs(v, r.concrete!, empty, declared);
    const box = this.temp();
    if (this.isRef(type)) {
      const loaded = this.temp();
      this.emit(`${loaded} = load ${this.llvm(this.referent(type))}, ptr ${v}`);
      return this.toJs(loaded, this.referent(type), empty);
    }
    if (r?.kind === "block") {
      this.emit(`call void @fsh_rt_block_retain(ptr ${v})`);
      return v;
    }
    if (r?.kind === "union") {
      const box = this.tables.typing.blockType("JsValue");
      const b = this.conversions().branch(v, type as UnionType, box);
      for (let i: usize = 0; i < b.members.length; i++) {
        const part = this.conversions().arm(b, i, v, type as UnionType);
        const member = b.members[i]!;
        const made = this.toJs(part, member, empty, declared);
        this.conversions().armDone(b, box, made);
      }
      return this.conversions().joined(b, box);
    }
    // A Fish future as a JS promise, settled by a task that awaits it, spawned now.
    if (this.isPromised(type)) {
      const [settleAt, frame] = [this.alloca("ptr"), this.alloca(`{ ${DYN}, ptr }`)];
      this.emit(`${box} = call ptr @fsh_rt_js_promise(ptr ${settleAt})`);
      const [settle, innerAt, heldAt, task] = [this.temp(), this.temp(), this.temp(), this.temp()];
      this.emit(`${settle} = load ptr, ptr ${settleAt}`);
      this.emit(`${innerAt} = getelementptr { ${DYN}, ptr }, ptr ${frame}, i32 0, i32 0`);
      this.emit(`store ${DYN} ${v}, ptr ${innerAt}`);
      this.emit(`${heldAt} = getelementptr { ${DYN}, ptr }, ptr ${frame}, i32 0, i32 1`);
      this.emit(`store ptr ${settle}, ptr ${heldAt}`);
      const [poll, drop] = this.jsSettler(type as DynType, this.jsSiteNow()!);
      this.unwinding(`call ptr @fsh_rt_spawn(ptr ${poll}, ptr ${drop}, ptr @"fsh.js.settled.output", ptr ${frame}, i64 ${this.sizeOf(`{ ${DYN}, ptr }`)}, i64 8)`, task);
      this.emit(`call void @fsh_rt_handle_drop(ptr ${task})`);
      return box;
    }
    // A callback as a JS function that owns it.
    if (this.isCallback(type)) {
      const [data, table] = [this.temp(), this.temp()];
      this.emit(`${data} = extractvalue ${DYN} ${v}, 0`);
      this.emit(`${table} = extractvalue ${DYN} ${v}, 1`);
      const line = `${box} = call ptr @fsh_rt_js_function(ptr ${data}, ptr ${table}, ptr ${this.jsCallback(type as DynType, this.jsSiteNow()!)}, i32 ${this.tables.typing.rec(this.tables.typing.callableOf.get(this.tables.typing.rec(type as DynType).of)!).params.length})`;
      this.emit(line);
      return box;
    }
    // An array or a tuple as a new JS array, and an object as a new JS object, each part
    // converted in turn.
    if (r?.kind === "array" || r?.kind === "fixed" || (r?.kind === "object" && r.tuple === true)) {
      this.emit(`${box} = call ptr @fsh_rt_js_array()`);
      const push = (cg: Mut<Codegen>, part: string, t: Type) => {
        const line2 = `call void @fsh_rt_js_push(ptr ${box}, ptr ${cg.toJs(part, t, "null")})`;
        cg.emit(line2);
      };
      if (r.kind === "array" && r.element === "never") return box;
      if (r.kind === "array") {
        const [data, length] = [this.temp(), this.temp()];
        this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
        this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
        this.elements(r.element, data, length, (cg, at) => {
          const part = cg.temp();
          cg.emit(`${part} = load ${cg.llvm(r.element)}, ptr ${at}`);
          push(cg, part, r.element);
        });
      } else {
        const parts = r.kind === "fixed" ? Array.from({ length: r.size }, () => r.element) : this.tables.typing.elementsOf(type as ObjectType);
        let iAt: usize = 0;
        for (const t of parts) {
          const i = iAt;
          iAt++;
          const part = this.temp();
          this.emit(`${part} = extractvalue ${this.llvm(type)} ${v}, ${r.kind === "fixed" ? `${i}` : this.tables.typing.fieldPath(type as ObjectType, String(i)).join(", ")}`);
          push(this, part, t);
        }
      }
      return box;
    }
    if (r?.kind === "object") {
      this.emit(`${box} = call ptr @fsh_rt_js_object()`);
      // The shape the object is given as says which properties are written with `?`.
      const shape = declared === undefined ? undefined : this.jsShapeOf(this.referent(declared));
      for (const f of r.fields) {
        const part = this.temp();
        const into = shape !== undefined ? this.tables.typing.rec(shape).fields.find((g) => g.name === f.name) : undefined;
        this.emit(`${part} = extractvalue ${this.llvm(type)} ${v}, ${this.tables.typing.fieldPath(type as ObjectType, f.name).join(", ")}`);
        const line3 = `call void @fsh_rt_js_put(ptr ${box}, ptr ${this.cString(f.name)}, ptr ${this.toJs(part, f.type, into?.optional !== undefined ? "undefined" : "null", into?.type)})`;
        this.emit(line3);
      }
      return box;
    }
    if (r?.kind === "literal") {
      const value = r.value;
      if (typeof value === "string") {
        const line4 = `${box} = call ptr @fsh_rt_js_of_string(ptr ${this.text(value)})`;
        this.emit(line4);
      }
      else if (typeof value === "boolean") this.emit(`${box} = call ptr @fsh_rt_js_of_boolean(i32 ${value ? 1 : 0})`);
      else this.emit(`${box} = call ptr @fsh_rt_js_of_number(double ${floatConstant(toFloat(value as bigint), "f64")})`);
      return box;
    }
    if (type === "string") this.emit(`${box} = call ptr @fsh_rt_js_of_string(ptr ${v})`);
    else if (type === "boolean") {
      const word = this.temp();
      this.emit(`${word} = zext i1 ${v} to i32`);
      this.emit(`${box} = call ptr @fsh_rt_js_of_boolean(i32 ${word})`);
    } else if (type === "null") this.emit(`${box} = call ptr @fsh_rt_js_of_empty(i32 ${empty === "undefined" ? 1 : 0})`);
    else {
      const line5 = `${box} = call ptr @fsh_rt_js_of_number(double ${type === "f64" ? v : this.cast(v, type, "f64")})`;
      this.emit(line5);
    }
    return box;
  }


  // A JsValue read as the type its declaration gives it, checked, giving up its box: `what` says
  // what gave it, as "'f' from 'pkg' gave". A union takes the first member the JS value is.
  fromJs(this: Mut<this>, box: string, type: Type, what: string, at: Ref<Span>): string {
    const r = this.recOf(type);
    if (r?.kind === "param") return this.fromJs(box, r.concrete!, what, at);
    if (this.tables.typing.isPlainJs(type)) return box;
    const checked = (cg: Mut<Codegen>, call: string) => `${call}(ptr ${box}, ptr ${cg.cString(what)}, ptr ${cg.cString(cg.tables.typing.show(type))}, ptr ${cg.panicAt(at)})`;
    // Panics unless the JS value is what the declaration says, by the test `jsMatches` makes.
    const expect = (cg: Mut<Codegen>, test: string) => {
      const [yes, no] = [cg.label(), cg.label()];
      cg.emit(`br i1 ${test}, label %${yes}, label %${no}`);
      cg.startBlock(no);
      const line4 = `call void ${checked(cg, "@fsh_rt_js_mismatch")}`;
      cg.unwinding(line4);
      cg.emit("unreachable");
      cg.startBlock(yes);
    };
    if (r?.kind === "union") return this.jsUnion(box, type as UnionType, what, at);
    // A promise is awaited as a future holding it, which reads what it settles with then.
    if (r?.kind === "future") {
      const frame = this.temp();
      this.emit(`${frame} = insertvalue ${this.llvm(type)} zeroinitializer, ptr ${box}, 1`);
      return frame;
    }
    // A handle of a declared shape holds an object.
    if (r?.kind === "block") {
      const line5 = `call void ${checked(this, "@fsh_rt_js_object_is")}`;
      this.unwinding(line5);
      return box;
    }
    if (type === "string" || type === "f64" || type === "boolean") {
      const [result, read] = type === "string" ? ["ptr", "string"] : type === "f64" ? ["double", "number"] : ["i32", "boolean"];
      const v = this.temp();
      const line6 = `call ${result} ${checked(this, `@fsh_rt_js_as_${read}`)}`;
      this.unwinding(line6, v);
      if (type !== "boolean") return v;
      const yes = this.temp();
      this.emit(`${yes} = icmp ne i32 ${v}, 0`);
      return yes;
    }
    // Another number type takes a JS number it holds exactly.
    if (isFloat(type) || isInteger(type)) {
      const [d, v] = [this.temp(), this.temp()];
      if (isFloat(type)) {
        const line7 = `call double ${checked(this, "@fsh_rt_js_as_number")}`;
        this.unwinding(line7, d);
        this.emit(`${v} = fptrunc double ${d} to float`);
        return v;
      }
      const { bits, signed } = integerInfo(type as Integer);
      // The bound past the largest value, which a double holds exactly where the largest isn't.
      const half = Math.pow(2, (bits - 1) as f64);
      const min = signed ? -half : 0;
      const past = signed ? half : half * 2;
      const line = `call double @fsh_rt_js_as_integer(ptr ${box}, double ${floatConstant(min, "f64")}, double ${floatConstant(past, "f64")}, ptr ${this.cString(what)}, ptr ${this.cString(this.tables.typing.show(type))}, ptr ${this.panicAt(at)})`;
      this.unwinding(line, d);
      this.emit(`${v} = ${signed ? "fptosi" : "fptoui"} double ${d} to ${this.llvm(type)}`);
      return v;
    }
    // Empty, and a literal, hold nothing once they are known to be what the declaration says.
    if (type === "null" || r?.kind === "literal") {
      const jsMatches2 = this.jsMatches(box, type);
      expect(this, jsMatches2);
      this.emit(`call void @fsh_rt_js_release(ptr ${box})`);
      return "zeroinitializer";
    }
    assert(r !== undefined, `internal error: no reading of a '${this.tables.typing.show(type)}' out of JS`);
    // A JS array as a new Fish array, each element read as the declaration says; a fixed array
    // takes exactly its length, and a tuple its elements by their places.
    if (r.kind === "array" || r.kind === "fixed" || (r.kind === "object" && r.tuple === true)) {
      const length = this.temp();
      const line8 = `call i64 ${checked(this, "@fsh_rt_js_length")}`;
      this.unwinding(line8, length);
      // ponytail: an element that isn't what its declaration says panics leaving the elements read
      // so far, and the array's box, unfreed; free them on the way out if a panic stops being final
      const read = (cg: Mut<Codegen>, i: string, element: Type) => {
        const part = cg.temp();
        const line2 = `call ptr @fsh_rt_js_at(ptr ${box}, i64 ${i}, ptr ${cg.panicAt(at)})`;
        cg.unwinding(line2, part);
        return cg.fromJs(part, element, `${what} an array holding`, at);
      };
      if (r.kind === "array") {
        const data = this.temp();
        const line3 = `${data} = call ptr @fsh_rt_array_alloc(i64 ${this.bytes(r.element, length)})`;
        this.emit(line3);
        this.elements(r.element, data, length, (cg, slot, i) => {
          const line9 = `store ${cg.llvm(r.element)} ${read(cg, i, r.element)}, ptr ${slot}`;
          cg.emit(line9);
        });
        this.emit(`call void @fsh_rt_js_release(ptr ${box})`);
        return this.built(data, length, length);
      }
      const parts = r.kind === "fixed" ? Array.from({ length: r.size }, () => r.element) : this.tables.typing.elementsOf(type as ObjectType);
      const enough = this.temp();
      this.emit(`${enough} = icmp ${r.kind === "fixed" ? "eq" : "sge"} i64 ${length}, ${parts.filter((p) => r.kind === "fixed" || !this.tables.typing.isOption(p)).length}`);
      expect(this, enough);
      let made = "zeroinitializer";
      let iAt: usize = 0;
      for (const element of parts) {
        const i = iAt;
        iAt++;
        const next = this.temp();
        const line10 = `${next} = insertvalue ${this.llvm(type)} ${made}, ${this.llvm(element)} ${read(this, String(i), element)}, ${r.kind === "fixed" ? `${i}` : this.tables.typing.fieldPath(type as ObjectType, String(i)).join(", ")}`;
        this.emit(line10);
        made = next;
      }
      this.emit(`call void @fsh_rt_js_release(ptr ${box})`);
      return made;
    }
    // A JS object as a new Fish object of its declared shape, each property read in turn.
    if (r.kind === "object") {
      const jsMatches3 = this.jsMatches(box, type);
      expect(this, jsMatches3);
      let made = "zeroinitializer";
      for (const f of r.fields) {
        const next = this.temp();
        const v = this.jsGet(box, f.name, f.type, `${what} an object whose '${f.name}' is`, at);
        this.emit(`${next} = insertvalue ${this.llvm(type)} ${made}, ${this.llvm(f.type)} ${v}, ${this.tables.typing.fieldPath(type as ObjectType, f.name).join(", ")}`);
        made = next;
      }
      this.emit(`call void @fsh_rt_js_release(ptr ${box})`);
      return made;
    }
    assert(false, `internal error: no reading of a '${this.tables.typing.show(type)}' out of JS`);
    return "undef";
  }


  // A JS value read as the first member of a union it is: literals tried first, then the rest,
  // a plain JsValue last as it takes anything.
  jsUnion(this: Mut<this>, box: string, type: UnionType, what: string, at: Ref<Span>): string {
    const rank = (cg: Mut<Codegen>, m: Type) => (cg.recOf(m)?.kind === "literal" ? 0 : cg.tables.typing.isPlainJs(m) ? 2 : 1);
    let order = [...this.tables.typing.rec(type).members];
    order.sort((a, b) => rank(this, a) - rank(this, b));
    const [slot, done] = [this.alloca(this.llvm(type)), this.label()];
    for (const m of order) {
      const [yes, no] = [this.label(), this.label()];
      const line = `br i1 ${this.jsMatches(box, m)}, label %${yes}, label %${no}`;
      this.emit(line);
      this.startBlock(yes);
      const fromJs2 = this.fromJs(box, m, what, at);
      const line2 = `store ${this.llvm(type)} ${this.convert(fromJs2, m, type)}, ptr ${slot}`;
      this.emit(line2);
      this.emit(`br label %${done}`);
      this.startBlock(no);
    }
    const line3 = `call void @fsh_rt_js_mismatch(ptr ${box}, ptr ${this.cString(what)}, ptr ${this.cString(this.tables.typing.show(type))}, ptr ${this.panicAt(at)})`;
    this.unwinding(line3);
    this.emit("unreachable");
    this.startBlock(done);
    const out = this.temp();
    this.emit(`${out} = load ${this.llvm(type)}, ptr ${slot}`);
    return out;
  }


  // Whether a JS value is of a declared type, as an `i1`: a literal by its value, an array or a
  // tuple by each element, an object by each property, and a handle's shape by having each
  // property it can't leave out, its literal properties matching. Nothing it reads throws.
  jsMatches(this: Mut<this>, box: string, m: Type): string {
    const is = (cg: Mut<Codegen>, kind: i32, s = "null", d = "0.0") => {
      const [r, b] = [cg.temp(), cg.temp()];
      cg.emit(`${r} = call i32 @fsh_rt_js_is(ptr ${box}, i32 ${kind}, ptr ${s}, double ${d})`);
      cg.emit(`${b} = icmp ne i32 ${r}, 0`);
      return b;
    };
    if (this.tables.typing.isPlainJs(m)) return "true";
    if (m === "null") return is(this, 1);
    if (m === "string") return is(this, 2);
    if (m === "boolean") return is(this, 4);
    if (isFloat(m) || isInteger(m)) return is(this, 3);
    if (typeof m === "string") return "false";
    const r = this.tables.typing.rec(m);
    if (r.kind === "literal") {
      const literal = this.jsLiteral(r.value);
      return is(this, literal[0], literal[1], literal[2]);
    }
    if (r.kind === "param") return this.jsMatches(box, r.concrete!);
    if (r.kind === "union") {
      // Any member, the rest tried only while none has matched.
      const members = [...r.members];
      let any = this.jsMatches(box, members[0]!);
      for (let i: usize = 1; i < members.length; i++) {
        const member = members[i]!;
        const none = this.temp();
        this.emit(`${none} = xor i1 ${any}, true`);
        const later = this.both(none, (cg) => cg.jsMatches(box, member));
        const v = this.temp();
        this.emit(`${v} = or i1 ${any}, ${later}`);
        any = v;
      }
      return any;
    }
    if (r.kind === "array" || r.kind === "fixed" || (r.kind === "object" && r.tuple === true)) {
      const is2 = is(this, 10);
      return this.jsArrayMatches(box, m as ArrayType | FixedType | ObjectType, is2);
    }
    if (r.kind === "object") {
      let all = is(this, 9);
      for (const f of r.fields) all = this.both(all, (cg) => {
          const cString2 = cg.cString(f.name);
          return cg.jsPart(box, cString2, "-1", (cg, part) => cg.jsMatches(part, f.type));
        });
      return all;
    }
    const shape = r.kind === "block" ? this.tables.typing.jsShape(m as BlockType) : undefined;
    let all = is(this, 9);
    let shaped: { name: string; type: Type }[] = [];
    if (shape !== undefined) {
      const written = this.tables.typing.rec(shape).fields;
      for (const f of written) shaped.push({ name: f.name, type: f.type });
    }
    for (const f of shaped) {
      if (this.tables.typing.isOption(f.type)) continue;
      const ft = typeof f.type === "string" ? undefined : this.tables.typing.rec(f.type);
      const [kind, s, d]: [i32, string, string] = ft?.kind === "literal" ? this.jsLiteral(ft.value) : [11, "null", "0.0"];
      const [r, b, both] = [this.temp(), this.temp(), this.temp()];
      const line = `${r} = call i32 @fsh_rt_js_field_is(ptr ${box}, ptr ${this.cString(f.name)}, i32 ${kind}, ptr ${s}, double ${d})`;
      this.emit(line);
      this.emit(`${b} = icmp ne i32 ${r}, 0`);
      this.emit(`${both} = and i1 ${all}, ${b}`);
      all = both;
    }
    return all;
  }


  // `first`, and then, only where it holds, what `then` tests, as an `i1`.
  both(this: Mut<this>, first: string, then: (cg: Mut<Codegen>) => string): string {
    const [more, done, from] = [this.label(), this.label(), this.block];
    this.emit(`br i1 ${first}, label %${more}, label %${done}`);
    this.startBlock(more);
    const second = then(this);
    const after = this.block;
    this.emit(`br label %${done}`);
    this.startBlock(done);
    const v = this.temp();
    this.emit(`${v} = phi i1 [ false, %${from} ], [ ${second}, %${after} ]`);
    return v;
  }


  // What `test` says of a property, by name, or an element, by index, of a JS value, read
  // without throwing: one that throws as it is read is undefined.
  jsPart(this: Mut<this>, box: string, name: string, index: string, test: (cg: Mut<Codegen>, part: string) => string): string {
    const part = this.temp();
    this.emit(`${part} = call ptr @fsh_rt_js_peek(ptr ${box}, ptr ${name === "null" ? "null" : name}, i64 ${index})`);
    const v = test(this, part);
    this.emit(`call void @fsh_rt_js_release(ptr ${part})`);
    return v;
  }


  // Whether a JS array holds what an array, fixed array or tuple type says, every element of it.
  jsArrayMatches(this: Mut<this>, box: string, m: Type, isArray: string): string {
    if (typeof m === "string") return "false";
    const r = this.tables.typing.rec(m);
    return this.both(isArray, (cg) => {
      const length = cg.temp();
      cg.emit(`${length} = call i64 @fsh_rt_js_count(ptr ${box})`);
      if (r.kind === "object") {
        const parts = cg.tables.typing.elementsOf(m as ObjectType);
        const enough = cg.temp();
        cg.emit(`${enough} = icmp sge i64 ${length}, ${parts.filter((p) => !cg.tables.typing.isOption(p)).length}`);
        return parts.reduce((all, element, i) => cg.both(all, (cg) => cg.jsPart(box, "null", String(i), (cg, part) => cg.jsMatches(part, element))), enough);
      }
      const element = (r as ArrayRecord | FixedRecord).element;
      const fits = r.kind === "fixed" ? cg.temp() : "true";
      if (r.kind === "fixed") cg.emit(`${fits} = icmp eq i64 ${length}, ${r.size}`);
      return cg.both(fits, (cg) => {
        // Each element in turn, until one doesn't match.
        const [i, ok] = [cg.alloca("i64"), cg.alloca("i1")];
        cg.emit(`store i64 0, ptr ${i}`);
        cg.emit(`store i1 true, ptr ${ok}`);
        const [test, body, next, end] = [cg.label(), cg.label(), cg.label(), cg.label()];
        cg.emit(`br label %${test}`);
        cg.startBlock(test);
        const [at, more] = [cg.temp(), cg.temp()];
        cg.emit(`${at} = load i64, ptr ${i}`);
        cg.emit(`${more} = icmp slt i64 ${at}, ${length}`);
        cg.emit(`br i1 ${more}, label %${body}, label %${end}`);
        cg.startBlock(body);
        const matched = cg.jsPart(box, "null", at, (cg, part) => cg.jsMatches(part, element));
        cg.emit(`br i1 ${matched}, label %${next}, label %${end}`);
        cg.startBlock(next);
        const step = cg.temp();
        cg.emit(`${step} = add i64 ${at}, 1`);
        cg.emit(`store i64 ${step}, ptr ${i}`);
        cg.emit(`br label %${test}`);
        cg.startBlock(end);
        const [reached, all] = [cg.temp(), cg.temp()];
        cg.emit(`${reached} = load i64, ptr ${i}`);
        cg.emit(`${all} = icmp eq i64 ${reached}, ${length}`);
        return all;
      });
    });
  }


  // What `fsh_rt_js_is` takes to test for a literal: its kind, and its text or number.
  jsLiteral(this: Mut<this>, value: string | bigint | boolean): [i32, string, string] {
    if (typeof value === "string") return [5, this.text(value), "0.0"];
    if (typeof value === "boolean") return [value ? 7 : 6, "null", "0.0"];
    return [8, "null", floatConstant(toFloat(value), "f64")];
  }


  // A JsValue narrowed to a string, number or boolean, read out of JS.
  jsRead(this: Mut<this>, box: string, as: Type): string {
    const [read, v] = [this.temp(), this.temp()];
    if (as === "string") {
      this.emit(`${read} = call ptr @fsh_rt_js_string(ptr ${box})`);
      return read;
    }
    if (as === "f64") {
      this.emit(`${read} = call double @fsh_rt_js_number(ptr ${box})`);
      return read;
    }
    this.emit(`${read} = call i32 @fsh_rt_js_boolean(ptr ${box})`);
    this.emit(`${v} = icmp ne i32 ${read}, 0`);
    return v;
  }


  // A Semaphore's or Channel's method, or a JsValue's. Those that wait give a future holding a
  // count on the block, and for `send` the value going in.
  blockCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string | undefined {
    const t = this.referent(this.valueType(callee.object)) as BlockType;
    const handle = this.temp();
    const line = `${handle} = load ptr, ptr ${this.receiver(callee.object)}`;
    this.emit(line);
    if (this.tables.jsMethods.has(e)) {
      const get2 = this.cur().types.get(e);
      return this.jsMethod(handle, callee.name, e.args, get2, `'${callee.name}' of '${this.tables.typing.show(t)}' gave`, e);
    }
    if (this.tables.jsAccessors.has(e)) {
      const [made, has] = [this.temp(), this.temp()];
      const at = callee.name === "at" ? `i64 ${this.value(e.args[0]!)}` : `ptr ${this.value(e.args[0]!)}`;
      const line2 = `call ${callee.name === "has" ? "i32" : "ptr"} @fsh_rt_js_${callee.name}(ptr ${handle}, ${at}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
      this.unwinding(line2, made);
      if (callee.name !== "has") return made;
      this.emit(`${has} = icmp ne i32 ${made}, 0`);
      return has;
    }
    if (callee.name === "abort") {
      this.emit(`call void @fsh_rt_signal_abort(ptr ${handle})`);
      return undefined;
    }
    if (callee.name === "throwIfAborted") {
      const [aborted, yes, stop, fine] = [this.temp(), this.temp(), this.label(), this.label()];
      this.emit(`${aborted} = call i32 @fsh_rt_signal_aborted(ptr ${handle})`);
      this.emit(`${yes} = icmp ne i32 ${aborted}, 0`);
      this.emit(`br i1 ${yes}, label %${stop}, label %${fine}`);
      this.startBlock(stop);
      const part = this.cur().raises.get(e)!.from;
      const abortError2 = this.abortError(part);
      this.raised(e, abortError2);
      this.startBlock(fine);
      return undefined;
    }
    // A settle the cell no longer takes leaves its value here to drop.
    if (callee.name === "settle") {
      const of = this.tables.typing.lower(this.tables.typing.rec(t).of);
      const [slot, taken, kept, drop, done] = [this.alloca(this.llvm(of)), this.temp(), this.temp(), this.label(), this.label()];
      const line3 = `store ${this.llvm(of)} ${this.owned(e.args[0]!)}, ptr ${slot}`;
      this.emit(line3);
      this.emit(`${taken} = call i32 @fsh_rt_channel_settle(ptr ${handle}, ptr ${slot})`);
      const no = this.temp();
      this.emit(`${no} = icmp eq i32 ${taken}, 0`);
      this.emit(`br i1 ${no}, label %${drop}, label %${done}`);
      this.startBlock(drop);
      this.emit(`${kept} = load ${this.llvm(of)}, ptr ${slot}`);
      this.dispose(kept, of);
      this.emit(`br label %${done}`);
      this.startBlock(done);
      return undefined;
    }
    if (callee.name === "startTls" || callee.name === "listenTls") {
      const made = this.temp();
      const line4 = `${made} = call ptr @fsh_rt_tls_${callee.name === "startTls" ? "client" : "listen"}(ptr ${handle}, ptr ${this.value(e.args[0]!)}, ptr ${this.value(e.args[1]!)})`;
      this.emit(line4);
      if (!this.cur().types.has(e)) this.pending.push({ v: made, type: "string" });
      return made;
    }
    if (callee.name === "available" || callee.name === "close") {
      const result = this.temp();
      if (callee.name === "close") {
        this.emit(`call void @fsh_rt_channel_close(ptr ${handle})`);
        return undefined;
      }
      this.emit(`${result} = call i64 @fsh_rt_semaphore_available(ptr ${handle})`);
      return result;
    }
    const future = this.cur().types.get(e) as FutureType;
    if (this.tables.typing.rec(t).which === "UdpSocket") return this.udpFrame(e, handle, future);
    // What a send, read or write carries: the value going in, the most bytes, or the bytes.
    const carried = ["send", "read", "write"].includes(callee.name) ? this.tables.typing.rec(future).frame[2]!.type : undefined;
    const given = carried === undefined ? undefined : carried === "i64" ? this.value(e.args[0]!) : this.owned(e.args[0]!);
    let frame = this.temp();
    const line5 = `${frame} = insertvalue ${this.llvm(future)} zeroinitializer, ptr ${this.copied(handle, t)}, 1`;
    this.emit(line5);
    if (given !== undefined) {
      const next = this.temp();
      this.emit(`${next} = insertvalue ${this.llvm(future)} ${frame}, ${this.llvm(carried!)} ${given}, 2`);
      frame = next;
    }
    return this.signalled(e, future, frame);
  }


  // A UdpSocket's wait: a count on the socket, then what its leaf's frame carries in order, the
  // bytes and address of a send, a connect's address, or nothing for a receive.
  udpFrame(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, handle: string, future: FutureType): string {
    let frame = this.temp();
    const blockType2 = this.tables.typing.blockType("UdpSocket");
    const line = `${frame} = insertvalue ${this.llvm(future)} zeroinitializer, ptr ${this.copied(handle, blockType2)}, 1`;
    this.emit(line);
    const name = (e.callee as Extract<Expr, { kind: "member" }>).name;
    const args = e.args.slice(0, name === "sendTo" ? 3 : name === "connect" ? 2 : name === "send" ? 1 : 0);
    let iAt: usize = 0;
    for (const arg of args) {
      const i = iAt;
      iAt++;
      const type = this.tables.typing.rec(future).frame[(2 + i) as usize]!.type;
      const [v, next] = [type === "i64" ? this.value(arg) : this.owned(arg), this.temp()];
      this.emit(`${next} = insertvalue ${this.llvm(future)} ${frame}, ${this.llvm(type)} ${v}, ${2 + i}`);
      frame = next;
    }
    return this.signalled(e, future, frame);
  }


  // A new block for a Dyn's value. At least a byte, so an empty class has an address of its own.
  // A shared Dyn's block is counted: the runtime keeps its count in 16 bytes before the value.
  dynBlock(this: Mut<this>, type: Type, counted = false): string {
    const [end, size, empty, some, block] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${end} = getelementptr ${this.llvm(type)}, ptr null, i64 1`);
    this.emit(`${size} = ptrtoint ptr ${end} to i64`);
    this.emit(`${empty} = icmp eq i64 ${size}, 0`);
    this.emit(`${some} = select i1 ${empty}, i64 1, i64 ${size}`);
    this.emit(`${block} = call ptr @${counted ? "fsh_rt_dyn_alloc" : "fsh_rt_alloc"}(i64 ${some})`);
    return block;
  }


  // A value moved into a new Dyn's block, with the vtable of its type for the Dyn's interface.
  box(this: Mut<this>, v: string, type: Type, to: DynType): string {
    const [made, dyn] = [this.temp(), this.temp()];
    const block = this.dynBlock(type, this.tables.typing.sharesDyn(to));
    this.emit(`store ${this.llvm(type)} ${v}, ptr ${block}`);
    this.emit(`${made} = insertvalue ${DYN} undef, ptr ${block}, 0`);
    const line = `${dyn} = insertvalue ${DYN} ${made}, ptr ${this.vtable(type, to)}, 1`;
    this.emit(line);
    return dyn;
  }


  // The vtable of a type for an interface: drop the block, copy it (the compiler's copies),
  // clone it as '.clone()' would (null when the type can't be), then a slot per member. A
  // shared Dyn's copy and clone count the block again and its drop gives a count up. Any other
  // Dyn's copy is its clone, so state it holds in an Atomic or a Lock is never split in two.
  vtable(this: Mut<this>, type: Type, to: DynType): string {
    const key = `${this.tables.typing.keyOf(type)} ${this.tables.typing.keyOf(to)}`;
    const made = this.vtables.get(key);
    if ((made !== undefined && made !== "")) return made;
    const line = `${this.tables.typing.described(type)} as ${this.tables.typing.described(to)}`;
    const n = this.stableId("vtable", line, key);
    const name = `@fsh.vtable.${n}`;
    this.vtables.set(key, name);
    const table = this.tables.dynMembers.get(key)!;
    let slots: string[];
    if (this.tables.typing.sharesDyn(to)) {
      // A shared Dyn's '.clone()' runs its class's own clone when it has one, and otherwise shares.
      const own = table.clone !== undefined && table.clone !== "copy";
      slots = [this.dynRelease(type, n), "@fsh_rt_dyn_retain", own === true ? this.dynClone(type, n, table, true) : "@fsh_rt_dyn_retain"];
    } else {
      // A Rust value is never copied, so a Dyn holding one panics if it ever is.
      let rust: string | undefined = undefined;
      this.tables.typing.holdsPart(type, (u) => {
        if (rust === undefined) rust = rustClassOf(this.tables.typing, u)?.name;
        return rust !== undefined;
      });
      const copied = rust !== undefined ? this.dynUncopyable(rust!) : this.dynCopy(type, n);
      const cloned = table.clone === "copy" ? copied : this.dynClone(type, n, table);
      // A value holding nothing pinned copies as the compiler copies, its own Dyns through their
      // own vtables; one that does would split that state, so its copy panics.
      const pinned = this.tables.typing.holdsPart(type, (u) => {
        if (typeof u === "string") return false;
        const r = this.tables.typing.rec(u);
        return (r.kind === "interior" && r.which !== "Cell") || (r.kind === "block" && (r.which === "Semaphore" || r.which === "Permit")) || r.kind === "handle" || r.kind === "generator";
      });
      const copy = !pinned || this.tables.typing.promiseElement(this.tables.typing.rec(to).of) !== undefined ? copied : table.clone !== undefined ? cloned : this.dynUncopyable();
      slots = [this.dynDrop(type, n), copy, cloned];
    }
    const more = this.dynSlots(type, n, to, table);
    for (const pushed of more) slots.push(pushed);
    // An error-like value boxed as a cause keeps how it prints, so an Error prints its cause
    // chain as Node does.
    if (this.tables.typing.rec(this.tables.typing.rec(to).of).name === "ErrorLike") slots.push(this.inspectThunk(type, n));
    this.globals.push(`${name} = internal constant [${slots.length} x ptr] [${slots.map((s) => `ptr ${s}`).join(", ")}]`);
    return name;
  }


  // Emits a thunk taking the pointer to a Dyn's block, then `params`, its body from `fill`. It
  // is a function of its own, so nothing the function being emitted holds drops in it.
  thunk(this: Mut<this>, name: string, returns: string, fill: (cg: Mut<Codegen>) => void, params: string[] = []) {
    const saved = this.setAside();
    fill(this);
    const takes = ["ptr %p", ...params].join(", ");
    this.out.push(`define internal ${returns} ${name}(${takes}) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUp(saved);
  }


  // A boxed value's inspect tree at a depth, as console.log would make it for its own type.
  inspectThunk(this: Mut<this>, type: Type, n: string): string {
    const name = `@fsh.dyn.inspect.${n}`;
    this.thunk(name, "ptr", (cg) => {
      const v = cg.temp();
      cg.emit(`${v} = load ${cg.llvm(type)}, ptr %p`);
      const line = `ret ptr ${cg.inspectTree(v, type, "%d")}`;
      cg.emit(line);
    }, ["i64 %d"]);
    return name;
  }


  // A shared Dyn's drop: the last count drops the value and frees its block.
  dynRelease(this: Mut<this>, type: Type, n: string): string {
    const name = `@fsh.dyn.release.${n}`;
    this.thunk(name, "void", (cg) => {
      const [last, gone, kept, v] = [cg.temp(), cg.label(), cg.label(), cg.temp()];
      cg.emit(`${last} = call i1 @fsh_rt_dyn_release(ptr %p)`);
      cg.emit(`br i1 ${last}, label %${gone}, label %${kept}`);
      cg.startBlock(gone);
      cg.emit(`${v} = load ${cg.llvm(type)}, ptr %p`);
      cg.dispose(v, type);
      cg.emit("call void @fsh_rt_dyn_free(ptr %p)");
      cg.emit(`br label %${kept}`);
      cg.startBlock(kept);
      cg.emit("ret void");
    });
    return name;
  }


  // The copy of a Dyn whose value can't be cloned: it panics rather than split state in two,
  // naming the Rust type when a Rust value is what can't be copied.
  dynUncopyable(this: Mut<this>, rust = ""): string {
    const name = rust !== "" ? `@"fsh.dyn.uncopyable.${rust}"` : `@"fsh.dyn.uncopyable"`;
    if (!this.uncopyable.has(rust)) {
      this.uncopyable.add(rust);
      const why = rust !== ""
        ? `its value holds a Rust '${rust}', which is moved, never copied; await the futures holding one, or move them rather than copy them`
        : "its value holds an Atomic, a Lock, a JoinHandle, a Rust value or something else changed or awaited in one place, so it can't be copied; keep it in a shared value, or give its interface no methods that change it";
      this.thunk(name, "ptr", (cg) => {
        const line = `call void @fsh_rt_panic(ptr ${cg.cString(`panicked while copying a Dyn:\n${why}\n`)})`;
        cg.unwinding(line);
        cg.emit("unreachable");
      });
    }
    return name;
  }


  dynDrop(this: Mut<this>, type: Type, n: string): string {
    const name = `@fsh.dyn.drop.${n}`;
    this.thunk(name, "void", (cg) => {
      const v = cg.temp();
      cg.emit(`${v} = load ${cg.llvm(type)}, ptr %p`);
      cg.dispose(v, type);
      cg.emit("call void @fsh_rt_free(ptr %p)");
      cg.emit("ret void");
    });
    return name;
  }


  // A new block holding the compiler's copy of the value: what its copies and drops balance on.
  dynCopy(this: Mut<this>, type: Type, n: string): string {
    const name = `@fsh.dyn.copy.${n}`;
    this.thunk(name, "ptr", (cg) => {
      const v = cg.temp();
      cg.emit(`${v} = load ${cg.llvm(type)}, ptr %p`);
      // Copied before its block is made, since a copy may panic part way.
      const made = cg.copied(v, type);
      const block = cg.dynBlock(type);
      cg.emit(`store ${cg.llvm(type)} ${made}, ptr ${block}`);
      cg.emit(`ret ptr ${block}`);
    });
    return name;
  }


  // What a Dyn's '.clone()' runs when the class has its own `clone`: a new block holding what
  // it gives. Null when the type can't be cloned, which the call panics on.
  dynClone(this: Mut<this>, type: Type, n: string, table: Ref<DynTable>, counted = false): string {
    if (table.clone === undefined || table.clone === "copy") return "null";
    const own = table.clone;
    const name = `@fsh.dyn.clone.${n}`;
    this.thunk(name, "ptr", (cg) => {
      const made = cg.invoke(own, "%p", [])!;
      const block = cg.dynBlock(type, counted);
      cg.emit(`store ${cg.llvm(type)} ${made}, ptr ${block}`);
      cg.emit(`ret ptr ${block}`);
    });
    return name;
  }


  // A slot per interface member: each method, then each field. A method giving an interface
  // type can't be called through a Dyn, so its slot is null.
  dynSlots(this: Mut<this>, type: Type, n: string, to: DynType, { methods, fields }: DynTable): string[] {
    // A boxed future's slots are its poll, which takes its frame as the block, and its cancel.
    if (this.tables.typing.promiseElement(this.tables.typing.rec(to).of) !== undefined) {
      if (this.tables.typing.leafOf.get(type as FutureType)?.method === "next") return this.nextSlots(type as FutureType, n);
      const instance = this.futureOf.get(type as FutureType)!;
      this.cancelled.add(instance);
      return [this.symbol(instance), this.cancelSymbol(instance)];
    }
    if (this.isDyn(type)) return [this.relayThunk(`@"fsh.dyn.${n}.call"`, type, this.tables.typing.rec(this.tables.typing.rec(to).of).methods[0]!)];
    const r = this.recOf(type);
    if (r?.kind === "generator") return [this.generatorNext(type as GeneratorType, n)];
    const abstract = (cg: Mut<Codegen>, t: Type) => cg.recOf(t)?.kind === "interface" && cg.tables.typing.promiseElement(t) === undefined;
    const declared = this.tables.typing.rec(this.tables.typing.rec(to).of).methods.map((m) => copyMethod(m));
    let made: string[] = [];
    for (let i: usize = 0; i < declared.length; i++) {
      if (abstract(this, declared[i]!.returns) || i >= methods.length || methods[i] === undefined) made.push("null");
      else made.push(this.methodThunk(`@"fsh.dyn.${n}.${declared[i]!.name}"`, type, declared[i]!, methods[i]!));
    }
    return [...made, ...this.tables.typing.rec(this.tables.typing.rec(to).of).fields.map((f, i) => this.fieldThunk(`@"fsh.dyn.${n}.get ${f.name}"`, type, f, fields[i as usize]))];
  }


  // A boxed async generator's `next()`: its future, borrowing the generator in the block, boxed.
  generatorNext(this: Mut<this>, type: GeneratorType, n: string): string {
    const name = `@"fsh.dyn.${n}.next"`;
    this.thunk(name, DYN, (cg) => {
      const future = cg.tables.typing.leafFuture("next", type);
      const made = cg.temp();
      cg.emit(`${made} = insertvalue ${cg.llvm(future)} zeroinitializer, ptr %p, 1`);
      const nextResult2 = cg.tables.typing.nextResult(cg.tables.typing.rec(type).yields);
      const lentPromise2 = cg.tables.typing.lentPromise(nextResult2);
      const line = `ret ${DYN} ${cg.box(made, future, lentPromise2)}`;
      cg.emit(line);
    });
    return name;
  }


  // A boxed `next()` future's poll and cancel: the generator's own, through the pointer to it.
  nextSlots(this: Mut<this>, future: FutureType, n: string): string[] {
    const target = this.generatorOf.get(this.tables.typing.leafOf.get(future)!.of as GeneratorType)!;
    this.cancelled.add(target);
    const generator = (cg: Mut<Codegen>) => {
      const [slot, p] = [cg.temp(), cg.temp()];
      cg.emit(`${slot} = getelementptr ${cg.llvm(future)}, ptr %p, i32 0, i32 1`);
      cg.emit(`${p} = load ptr, ptr ${slot}`);
      return p;
    };
    const poll = `@"fsh.dyn.${n}.poll"`;
    this.thunk(poll, this.pollType(future), (cg) => {
      const result = cg.temp();
      const line = `${result} = call ${cg.pollType(future)} ${cg.symbol(target)}(ptr ${generator(cg)}, ptr %cx)`;
      cg.emit(line);
      cg.emit(`ret ${cg.pollType(future)} ${result}`);
    }, ["ptr %cx"]);
    const cancel = `@"fsh.dyn.${n}.cancel"`;
    this.thunk(cancel, "void", (cg) => {
      const line2 = `call void ${cg.cancelSymbol(target)}(ptr ${generator(cg)}, ptr %cx)`;
      cg.emit(line2);
      cg.emit("ret void");
    }, ["ptr %cx"]);
    return [poll, cancel];
  }


  // A method's slot: the type's method run on the block, its result as the interface gives it.
  // Through a method declaring `this: Own<this>` the Dyn is given up: its block is freed after,
  // and its value dropped first unless the type's method took it over.
  // A throwing callable's slot gives whether the call failed, then its value and its error, as
  // its function type has them; a closure throwing nothing never fails.
  // The block a switch's case is entered through, releasing first a subject the switch made.
  enterCase(this: Mut<this>, holding: boolean, entries: Mut<[string, string][]>, body: string): string {
    if (!holding) return body;
    const via = this.label();
    entries.push([via, body]);
    return via;
  }

  // A closure stashed in `env` for a loop's calls, dropped once they are over or one panics.
  dropStashed(this: Mut<this>, env: string, closure: Type): void {
    if (!this.needsDrop(closure)) return;
    const kept = this.unstash(env, closure);
    this.dispose(kept, closure);
  }

  // Given up, the block is freed once the method returns or unwinds: its value dropped first,
  // or for a base's owning method, the derived fields it doesn't know of.
  giveUp(this: Mut<this>, target: InstanceId, type: Type, upcasts: boolean, owner: ClassType | undefined): void {
    if (this.bodyAt(target).self?.owned !== true) {
      const v = this.temp();
      this.emit(`${v} = load ${this.llvm(type)}, ptr %p`);
      this.dispose(v, type);
    } else if (upcasts) {
      for (let t = type as ClassType; t !== owner; t = this.tables.typing.rec(t).base!) {
        const at = this.upcast("%p", type as ClassType, t);
        for (const [part, i] of this.parts(t)) {
          if (i === 0 || !this.needsDrop(part)) continue;
          const [slot, v] = [this.temp(), this.temp()];
          this.emit(`${slot} = getelementptr ${this.llvm(t)}, ptr ${at}, i32 0, i32 ${i}`);
          this.emit(`${v} = load ${this.llvm(part)}, ptr ${slot}`);
          this.dispose(v, part);
        }
      }
    }
    this.emit("call void @fsh_rt_free(ptr %p)");
  }

  methodThunk(this: Mut<this>, name: string, type: Type, m: Ref<Method>, target: InstanceId): string {
    if (this.tables.typing.promiseElement(m.returns) !== undefined) return this.futureThunk(name, type, m, target);
    const returns = m.throws !== undefined ? this.throwing(m.returns, m.throws) : m.returns === "void" ? "void" : this.llvm(m.returns);
    this.thunk(name, returns, (cg) => {
      const owner = cg.bodyAt(target).owner;
      const r = cg.recOf(type);
      const upcasts = r?.kind === "class" && owner !== undefined && owner !== type;
      const self = upcasts ? cg.upcast("%p", type as ClassType, owner!) : "%p";
      const owning = m.owned === true;
      // A closure may take fewer parameters than its callable passes: the rest are dropped here.
      const taken = cg.bodyAt(target).closure !== undefined ? cg.bodyAt(target).params.length : m.params.length;
      for (let i: usize = taken; i < m.params.length; i++) cg.dispose(`%a${i}`, m.params[i]!);
      const args = m.params.slice(0, taken as i64).map((p, i) => `${cg.llvm(p)} %a${i}`);
      const give = (cg: Mut<Codegen>, v: string | undefined) => {
        if (m.throws !== undefined) cg.succeeded(m, v);
        else cg.emit(v === undefined ? "ret void" : `ret ${returns} ${v}`);
      };
      let result: string | undefined;
      if (m.throws !== undefined && cg.inst(target).throws !== undefined) {
        const shape = cg.resultType(target);
        const raw = cg.temp();
        const line = `call ${shape} ${cg.symbol(target)}(${[`ptr ${self}`, ...args].join(", ")})`;
        const chosen = owning ? (cg: Mut<Codegen>) => cg.giveUp(target, type, upcasts, owner) : undefined;
        cg.unwinding(line, raw, chosen);
        if (owning) cg.giveUp(target, type, upcasts, owner);
        const part2 = cg.inst(target).returns;
        const part3 = cg.inst(target).throws!;
        result = cg.failedOut(shape, raw, part2, part3, m);
      } else {
        const chosen2 = owning ? (cg: Mut<Codegen>) => cg.giveUp(target, type, upcasts, owner) : undefined;
        result = cg.invoke(target, self, args, undefined, chosen2);
      }
      if (result === undefined || m.returns === "void") {
        if (result !== undefined) {
          const part4 = cg.inst(target).returns;
          cg.dispose(result, part4);
        }
        give(cg, undefined);
        return;
      }
      // A result narrowed to what the interface gives drops the parts it leaves out.
      const part = cg.inst(target).returns;
      const keeps = cg.keepsAll(part, m.returns);
      if (cg.needsDrop(part) && !keeps) {
        const part5 = cg.inst(target).returns;
        const convert2 = cg.convert(result, part5, m.returns);
        const kept = cg.copied(convert2, m.returns);
        const part6 = cg.inst(target).returns;
        cg.dispose(result, part6);
        give(cg, kept);
        return;
      }
      const part7 = cg.inst(target).returns;
      const convert3 = cg.convert(result, part7, m.returns);
      give(cg, convert3);
    }, m.params.map((p, i) => `${this.llvm(p)} %a${i}`));
    return name;
  }


  // A throwing slot's result once its call gave `raw`, of `shape`: a failure returns at once,
  // its error converted to the slot's; otherwise its value is left for the slot to give.
  failedOut(this: Mut<this>, shape: string, raw: string, gives: Type, thrown: Type, m: Ref<Method>): string | undefined {
    const returns = this.throwing(m.returns, m.throws!);
    const [failed, bad, ok, error, failure, made] = [this.temp(), this.label(), this.label(), this.temp(), this.temp(), this.temp()];
    this.emit(`${failed} = extractvalue ${shape} ${raw}, 0`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(bad);
    this.emit(`${error} = extractvalue ${shape} ${raw}, 2`);
    this.emit(`${failure} = insertvalue ${returns} undef, i1 true, 0`);
    const line = `${made} = insertvalue ${returns} ${failure}, ${this.llvm(m.throws!)} ${this.convert(error, thrown, m.throws!)}, 2`;
    this.emit(line);
    this.emit(`ret ${returns} ${made}`);
    this.startBlock(ok);
    if (gives === "void") return undefined;
    const got = this.temp();
    this.emit(`${got} = extractvalue ${shape} ${raw}, 1`);
    return got;
  }


  // Returns from a throwing slot with a value, or none, that didn't fail.
  succeeded(this: Mut<this>, m: Ref<Method>, v: string | undefined) {
    const returns = this.throwing(m.returns, m.throws!);
    let made = this.temp();
    this.emit(`${made} = insertvalue ${returns} undef, i1 false, 0`);
    if (v !== undefined) {
      const next = this.temp();
      this.emit(`${next} = insertvalue ${returns} ${made}, ${this.llvm(m.returns)} ${v}, 1`);
      made = next;
    }
    this.emit(`ret ${returns} ${made}`);
  }


  // The slot of a stored callable held in one that throws more: the held one's call, its result
  // or its error passed on as this one's.
  relayThunk(this: Mut<this>, name: string, inner: DynType, m: Ref<Method>): string {
    const held = copyMethod(this.tables.typing.rec(this.tables.typing.rec(inner).of).methods[0]!);
    this.thunk(name, this.throwing(m.returns, m.throws!), (cg) => {
      const [dyn, data, table] = [cg.temp(), cg.temp(), cg.temp()];
      cg.emit(`${dyn} = load ${DYN}, ptr %p`);
      cg.emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      cg.emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      const fn = cg.vslot(table, 0);
      const shape = held.throws !== undefined ? cg.throwing(held.returns, held.throws) : held.returns === "void" ? "void" : cg.llvm(held.returns);
      const raw = shape === "void" ? undefined : cg.temp();
      cg.unwinding(`call ${shape} ${fn}(ptr ${data}${m.params.map((p, i) => `, ${cg.llvm(p)} %a${i}`).join("")})`, raw);
      const got = held.throws !== undefined ? cg.failedOut(shape, raw!, held.returns, held.throws, m) : raw;
      const chosen = got === undefined || m.returns === "void" ? undefined : cg.convert(got, held.returns, m.returns);
      cg.succeeded(m, chosen);
    }, m.params.map((p, i) => `${this.llvm(p)} %a${i}`));
    return name;
  }


  // A slot giving a `Promise<T>`: the future the method or async arrow makes, its frame holding
  // the block (a method's object, borrowed) or a copy of the closure, then the arguments, boxed.
  futureThunk(this: Mut<this>, name: string, type: Type, m: Ref<Method>, target: InstanceId): string {
    const closure = this.bodyAt(target).closure !== undefined;
    const to = closure ? (this.tables.typing.stored(m.returns) as DynType) : this.tables.typing.lentPromise(this.tables.typing.promiseElement(m.returns)!);
    const params = m.params.map((p, i) => `${this.llvm(p)} %a${i}`);
    this.thunk(name, DYN, (cg) => {
      const taken = closure ? cg.bodyAt(target).params.length : m.params.length;
      for (let i: usize = taken; i < m.params.length; i++) cg.dispose(`%a${i}`, m.params[i]!);
      let made: string;
      let future: FutureType;
      if (cg.inst(target).future !== undefined) {
        future = cg.inst(target).future!;
        let frame = cg.temp();
        if (closure) {
          const env = cg.temp();
          const part2 = cg.inst(target).closure!;
          const line3 = `${env} = load ${cg.llvm(part2)}, ptr %p`;
          cg.emit(line3);
          const part = cg.inst(target).closure!;
          const part3 = cg.inst(target).closure!;
          const line = `${frame} = insertvalue ${cg.llvm(future)} zeroinitializer, ${cg.llvm(part3)} ${cg.copied(env, part)}, 1`;
          cg.emit(line);
        } else {
          const owner = cg.bodyAt(target).owner;
          const r = cg.recOf(type);
          const self = r?.kind === "class" && owner !== undefined && owner !== type ? cg.upcast("%p", type as ClassType, owner) : "%p";
          cg.emit(`${frame} = insertvalue ${cg.llvm(future)} zeroinitializer, ptr ${self}, 1`);
        }
        let iAt: usize = 0;
        for (const p of params.slice(0, taken as i64)) {
          const i = iAt;
          iAt++;
          const next = cg.temp();
          cg.emit(`${next} = insertvalue ${cg.llvm(future)} ${frame}, ${p}, ${i + 2}`);
          frame = next;
        }
        made = frame;
      } else {
        future = (cg.inst(target).returns as FutureType);
        made = cg.invoke(target, "%p", params.slice(0, taken as i64))!;
      }
      const line2 = `ret ${DYN} ${cg.box(made, future, to)}`;
      cg.emit(line2);
    }, [...params]);
    return name;
  }


  // A field's slot: a copy of the field, or what the getter supplying it gives.
  fieldThunk(this: Mut<this>, name: string, type: Type, f: Ref<Field>, getter: InstanceId | undefined): string {
    this.thunk(name, this.llvm(f.type), (cg) => {
      if (getter !== undefined) {
        const owner = cg.bodyAt(getter).owner;
        const r = cg.recOf(type);
        const self = r?.kind === "class" && owner !== undefined && owner !== type ? cg.upcast("%p", type as ClassType, owner) : "%p";
        const invoke2 = cg.invoke(getter, self, [])!;
        const part = cg.inst(getter).returns;
        const line = `ret ${cg.llvm(f.type)} ${cg.convert(invoke2, part, f.type)}`;
        cg.emit(line);
        return;
      }
      const holder = type as ObjectType | ClassType;
      const own = cg.tables.typing.field(holder, f.name)!.type;
      const [at, v] = [cg.temp(), cg.temp()];
      cg.emit(`${at} = getelementptr ${cg.llvm(holder)}, ptr %p, i32 0, ${cg.tables.typing.fieldPath(holder, f.name).map((i) => `i32 ${i}`).join(", ")}`);
      cg.emit(`${v} = load ${cg.llvm(own)}, ptr ${at}`);
      const copied2 = cg.copied(v, own);
      const line2 = `ret ${cg.llvm(f.type)} ${cg.convert(copied2, own, f.type)}`;
      cg.emit(line2);
    });
    return name;
  }


  // `d.clone()`: a new Dyn with the clone its vtable gives, or a panic when its value can't be.
  dynCloned(this: Mut<this>, e: Ref<Span>, object: Ref<Expr>): string {
    const dyn = this.temp();
    const line = `${dyn} = load ${DYN}, ptr ${this.receiver(object)}`;
    this.emit(line);
    const [data, table, at, fn, none, made, copy, result] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
    this.emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
    this.emit(`${at} = getelementptr ptr, ptr ${table}, i64 2`);
    this.emit(`${fn} = load ptr, ptr ${at}`);
    this.emit(`${none} = icmp eq ptr ${fn}, null`);
    this.lowering().panicIf(none, "this Dyn's value can't be cloned: its type holds an Atomic, a Lock, a JoinHandle or something else changed or awaited in one place", e);
    // A class's own clone may panic.
    this.unwinding(`call ptr ${fn}(ptr ${data})`, made);
    this.emit(`${copy} = insertvalue ${DYN} ${dyn}, ptr ${made}, 0`);
    this.emit(`${result} = insertvalue ${DYN} ${copy}, ptr ${table}, 1`);
    return result;
  }


  // A Dyn's block and vtable, for a call or a field read through it.
  opened(this: Mut<this>, object: Ref<Expr>, take: boolean): [string, string] {
    const dyn = take ? this.owned(object) : this.temp();
    if (!take) {
      const line = `${dyn} = load ${DYN}, ptr ${this.receiver(object)}`;
      this.emit(line);
    }
    const [data, table] = [this.temp(), this.temp()];
    this.emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
    this.emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
    return [data, table];
  }


  // The function in a vtable's slot after its drop, copy and clone.
  vslot(this: Mut<this>, table: string, i: usize): string {
    const [at, fn] = [this.temp(), this.temp()];
    this.emit(`${at} = getelementptr ptr, ptr ${table}, i64 ${3 + i}`);
    this.emit(`${fn} = load ptr, ptr ${at}`);
    return fn;
  }


  // A method call through a Dyn: one taking its object over takes the Dyn.
  // A stored callable's call is its one method's, on the callee itself.
  dynCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Expr>): string | undefined {
    const via = this.tables.dynCalls.get(e)!.callable;
    if (via !== undefined) return this.dynCallOn(e, cloneExpr(via));
    return this.dynCallOn(e, callee.kind === "member" ? callee.object : callee);
  }

  dynCallOn(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, object: Ref<Expr>): string | undefined {
    const info = this.tables.dynCalls.get(e)!;
    const optional = this.tables.optionalCallables.get(e);
    if (optional !== undefined) return this.optionalCallableCall(e, object, optional, info.index);
    const t = this.referent(this.valueType(object)) as DynType;
    const m = copyMethod(this.tables.typing.rec(this.tables.typing.rec(t).of).methods[info.index]!);
    const [data, table] = this.opened(object, info.owned);
    const fn = this.vslot(table, info.index);
    const called = (cg: Mut<Codegen>) => cg.dynInvoke(e, m, fn, data);
    return this.tables.optionalCalls.has(e) ? this.slotted(e, fn, m.returns, called) : called(this);
  }

  // `f?.(x)` on an Option of a stored callable: the call when one is there, the empty Option or
  // nothing when it isn't. The Option is read in place; the callable stays its.
  optionalCallableCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, object: Ref<Expr>, union: UnionType, index: usize): string | undefined {
    const dyn = this.tables.typing.rec(union).members.find((m) => m !== "null")! as DynType;
    const m = copyMethod(this.tables.typing.rec(this.tables.typing.rec(dyn).of).methods[index]!);
    const held = this.temp();
    const line = `${held} = load ${this.llvm(union)}, ptr ${this.receiver(object)}`;
    this.emit(line);
    const empty: Type[] = ["null"];
    const none = this.conversions().holds(held, union, empty);
    return this.whenPresent(e, none, m.returns, (cg) => {
      const d = cg.convert(held, union, dyn);
      const [data, table] = [cg.temp(), cg.temp()];
      cg.emit(`${data} = extractvalue ${DYN} ${d}, 0`);
      cg.emit(`${table} = extractvalue ${DYN} ${d}, 1`);
      const fn = cg.vslot(table, index);
      return cg.dynInvoke(e, m, fn, data);
    });
  }

  dynInvoke(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, m: Ref<Method>, fn: string, data: string): string | undefined {
    const args = e.args.map((a, i) => `, ${this.llvm(m.params[i as usize]!)} ${this.owned(a)}`).join("");
    // A `Promise<T>` comes back as its boxed future.
    const gives = this.tables.typing.promiseElement(m.returns) !== undefined ? this.cur().types.get(e)! : m.returns;
    const returns = m.throws !== undefined ? this.throwing(gives, m.throws) : gives === "void" ? "void" : this.llvm(gives);
    const made = returns === "void" ? undefined : this.temp();
    this.unwinding(`call ${returns} ${fn}(ptr ${data}${args})`, made);
    const result = m.throws !== undefined ? this.unpacked(returns, made!, gives, e) : made;
    if ((result !== undefined && result !== "") && !this.cur().types.has(e) && this.needsDrop(gives)) this.pending.push({ v: result, type: gives });
    return result;
  }


  // Whether an optional method is there: known for a type parameter's instance, and through a
  // Dyn, whether its slot is filled.
  presence(this: Mut<this>, e: Ref<Expr>): string {
    const { object, name, when } = this.tables.presenceTests.get(e)!;
    const t = this.referent(this.valueType(object));
    if (this.recOf(t)?.kind !== "dyn") {
      this.ranFor(object);
      return String(this.cur().absent?.has(e) === true ? !when : when);
    }
    const [, table] = this.opened(object, false);
    const fn = this.vslot(table, this.tables.typing.rec(this.tables.typing.rec(t as DynType).of).methods.findIndex((m) => m.name === name) as usize);
    const result = this.temp();
    this.emit(`${result} = icmp ${when ? "ne" : "eq"} ptr ${fn}, null`);
    return result;
  }


  // A receiver whose method is known present or absent still runs, as JavaScript reads it, unless
  // it is a place, whose reading does nothing; a value it makes is dropped.
  ranFor(this: Mut<this>, object: Ref<Expr>) {
    if (isPlace(object)) return;
    const v = this.evaluate(object);
    if (this.fresh(object)) this.pending.push({ v, type: this.cur().types.get(object)! });
  }


  // `d.m?.()` through a Dyn: the empty Option when the type left the method out, its slot empty.
  slotted(this: Mut<this>, e: Ref<Expr>, fn: string, gives: Type, called: (cg: Mut<Codegen>) => string | undefined): string | undefined {
    const missing = this.temp();
    this.emit(`${missing} = icmp eq ptr ${fn}, null`);
    return this.whenPresent(e, missing, gives, called);
  }

  // `called` run when `missing` is false; the empty Option in its place otherwise.
  whenPresent(this: Mut<this>, e: Ref<Expr>, missing: string, gives: Type, called: (cg: Mut<Codegen>) => string | undefined): string | undefined {
    const [some, none, end] = [this.label(), this.label(), this.label()];
    this.emit(`br i1 ${missing}, label %${none}, label %${some}`);
    this.startBlock(some);
    const mark = this.pending.length;
    const got = called(this);
    const type = this.cur().types.get(e);
    const wrapped = got !== undefined && type !== undefined ? this.convert(got, gives, type) : undefined;
    this.settle(mark);
    const someEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(none);
    const empty = wrapped !== undefined && type !== undefined ? this.convert("zeroinitializer", "null", type) : undefined;
    const noneEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(end);
    if (wrapped === undefined || type === undefined || empty === undefined) return undefined;
    const result = this.temp();
    this.emit(`${result} = phi ${this.llvm(type)} [ ${wrapped}, %${someEnd} ], [ ${empty}, %${noneEnd} ]`);
    return result;
  }


  // A field read through a Dyn: a copy, through its slot after the methods'.
  dynField(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): string {
    const get2 = this.cur().types.get(e.object)!;
    const t = this.referent(get2) as DynType;
    const [data, table] = this.opened(e.object, false);
    const fn = this.vslot(table, this.tables.typing.rec(this.tables.typing.rec(t).of).methods.length + (this.tables.typing.rec(this.tables.typing.rec(t).of).fields.findIndex((f) => f.name === e.name) as usize));
    const result = this.temp();
    const get3 = this.cur().types.get(e)!;
    const line = `${result} = call ${this.llvm(get3)} ${fn}(ptr ${data})`;
    this.emit(line);
    return result;
  }


  // A function dropping one value where it lives, for a channel to drop what it still holds.
  elementDrop(this: Mut<this>, type: Type): string {
    const made = this.elementDrops.get(type);
    if ((made !== undefined && made !== "")) return made;
    const described2 = this.tables.typing.described(type);
    const name = `@fsh.element.drop.${this.stableId("element.drop", described2, typeOwner(type))}`;
    this.elementDrops.set(type, name);
    // The function being emitted keeps what it has pending and its scopes while this one is made.
    const saved = this.setAsideBody();
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(type)}, ptr %p`);
    this.dispose(v, type);
    this.emit("ret void");
    this.out.push(`define internal void ${name}(ptr %p) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUpBody(saved);
    return name;
  }


  // A shared value's block: its count, an Rc's its strong and weak counts, then what a Lock of
  // its value would be.
  sharedBlock(this: Mut<this>, t: SharedType): string {
    const interiorType2 = this.tables.typing.interiorType("Lock", this.tables.typing.rec(t).of);
    return `{ ${this.tables.typing.rec(t).which === "shared" ? "i64" : "[2 x i64]"}, ${this.llvm(interiorType2)} }`;
  }


  // `shared(v)` or `new Rc(v)`: a new block with one count, holding v. `new Weak<T>()` has none.
  sharedNew(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" | "new" }>>, t: SharedType): string {
    if (this.tables.typing.rec(t).which === "Weak") return "null";
    const v = this.owned(e.args![0]!);
    const [end, size, block, at] = [this.temp(), this.temp(), this.temp(), this.temp()];
    const line = `${end} = getelementptr ${this.sharedBlock(t)}, ptr null, i64 1`;
    this.emit(line);
    this.emit(`${size} = ptrtoint ptr ${end} to i64`);
    this.emit(`${block} = call ptr @fsh_rt_${this.tables.typing.rec(t).which === "Rc" ? "rc" : "shared"}_new(i64 ${size})`);
    const line2 = `${at} = getelementptr ${this.sharedBlock(t)}, ptr ${block}, i32 0, i32 1, i32 1`;
    this.emit(line2);
    this.emit(`store ${this.llvm(this.tables.typing.rec(t).of)} ${v}, ptr ${at}`);
    return block;
  }


  // `rc.downgrade()`, a Weak sharing the block, and `w.upgrade()`, an Rc of it while its value
  // is alive, or else null.
  countedCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string {
    const block = this.temp();
    const line = `${block} = load ptr, ptr ${this.receiver(callee.object)}`;
    this.emit(line);
    if (callee.name === "downgrade") {
      this.emit(`call void @fsh_rt_weak_retain(ptr ${block})`);
      return block;
    }
    const option = this.cur().types.get(e) as UnionType;
    const [rc, alive, result] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${rc} = call ptr @fsh_rt_rc_upgrade(ptr ${block})`);
    this.emit(`${alive} = icmp ne ptr ${rc}, null`);
    const some = this.convert(rc, this.tables.typing.rec(option).members.find((m) => m !== "null")!, option);
    const none = this.convert("zeroinitializer", "null", option);
    this.emit(`${result} = select i1 ${alive}, ${this.llvm(option)} ${some}, ${this.llvm(option)} ${none}`);
    return result;
  }


  // `update`: the callback runs with a pointer to what the Lock holds, between taking and
  // releasing its word; an RwLock's `read` or `update` takes its word's read or write side.
  // The callback's captures are made before the lock is taken.
  lockUpdate(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, t: InteriorType, at: string, rc = false): string | undefined {
    const callback = e.args[0]!;
    // The callback's value lives in a slot it is called through; what it leaves of its captures
    // is dropped after it, as at any closure's call.
    const made = this.cur().types.get(callback)!;
    const env = this.alloca(this.llvm(made));
    const line = `store ${this.llvm(made)} ${this.owned(callback)}, ptr ${env}`;
    this.emit(line);
    let leftovers: ((cg: Mut<Codegen>) => void) | undefined;
    if (this.needsDrop(made)) {
      leftovers = (cg: Mut<Codegen>) => {
        const unstash2 = cg.unstash(env, made);
        cg.dispose(unstash2, made);
      };
    } else {
      leftovers = undefined;
    }
    const reading = e.callee.kind === "member" && e.callee.name === "read";
    if (rc) this.borrowRc(at, { start: e.start, end: e.end }, reading);
    else this.takeLock(at, { start: e.start, end: e.end }, this.tables.typing.rec(t).which === "Lock" ? "fsh_rt_lock" : reading ? "fsh_rt_read_lock" : "fsh_rt_write_lock");
    const inside = this.temp();
    this.emit(`${inside} = getelementptr ${this.llvm(t)}, ptr ${at}, i32 0, i32 1`);
    const target = this.callOf(callback)!;
    const chosen = this.bodyAt(target).params.length > 0 ? [`ptr ${inside}`] : [];
    const result = this.invoke(target, env, chosen, exprKey(e), leftovers);
    this.emit(`call void @${rc ? (reading ? "fsh_rt_rc_read_end" : "fsh_rt_rc_write_end") : reading ? "fsh_rt_read_unlock" : "fsh_rt_unlock"}(ptr ${at})`);
    if ((result !== undefined && result !== "") && !this.cur().types.has(e) && this.needsDrop(this.inst(target).returns)) this.pending.push({ v: result, type: this.inst(target).returns });
    return result;
  }


  // A Cell's method: a plain load or store where it lives, which only one thread can reach.
  cellCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>, t: InteriorType, at: string): string | undefined {
    const ty = this.llvm(this.tables.typing.rec(t).of);
    // The argument runs first: it may use the same Cell.
    const given = callee.name === "get" ? undefined : this.owned(e.args[0]!);
    const old = this.temp();
    this.emit(`${old} = load ${ty}, ptr ${at}`);
    if (given === undefined) return this.copied(old, this.tables.typing.rec(t).of);
    this.emit(`store ${ty} ${given}, ptr ${at}`);
    if (callee.name === "replace") return old;
    this.dispose(old, this.tables.typing.rec(t).of);
    return undefined;
  }


  // Part `i` of a loop's state: an alloca, or in a generator, the frame's field for it.
  loopSlot(this: Mut<this>, s: Ref<Stmt>, i: usize, type: string): string {
    return this.resuming !== undefined ? `%loop${this.cur().frame!.loops.get(s)! + i}` : this.alloca(type);
  }


  // `for...of` over a fixed array: each element where it lives, as an array's loop gives them;
  // a temporary is held in a slot of the loop's own.
  /** @throws {CompileError} */
  fixedLoop(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>, type: FixedType) {
    const local = this.resolved(s.left as Stmt);
    this.scopes.push({ transient: false, held: [] });
    // Where the array lives is kept in the loop's slot, and read again each pass, as a
    // generator's or an async function's loop may be resumed in a later call.
    // In a resumable body the frame decides: its slot is a pointer exactly when the source is a
    // place to point at.
    const kept = (this.resuming !== undefined ? this.tables.typing.rec(this.resuming.type).frame[this.cur().frame!.loops.get(s)!]!.type : undefined);
    let lent: boolean;
    if (kept !== undefined) {
      lent = this.isRef(kept);
    } else {
      const get2 = this.cur().types.get(s.right)!;
      lent = this.isRef(get2) || this.lendable(s.right);
    }
    const held = this.loopSlot(s, 0, lent ? "ptr" : this.llvm(type));
    if (lent) {
      const get3 = this.cur().types.get(s.right)!;
      const line = `store ptr ${this.isRef(get3) ? this.evaluate(s.right) : this.address(s.right)}, ptr ${held}`;
      this.emit(line);
    }
    else {
      this.own(held, type);
      const line2 = `store ${this.llvm(type)} ${this.owned(s.right)}, ptr ${held}`;
      this.emit(line2);
    }
    this.settle();
    const counter = this.loopSlot(s, 1, "i64");
    this.emit(`store i64 0, ptr ${counter}`);
    const [test, loop, next, end] = [this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${counter}`);
    this.emit(`${more} = icmp ult i64 ${i}, ${this.tables.typing.rec(type).size}`);
    this.emit(`br i1 ${more}, label %${loop}, label %${end}`);
    this.startBlock(loop);
    this.exits.set(stmtKey(s), { exit: end, next, depth: this.scopes.length });
    this.scopes.push({ transient: false, held: [] });
    this.reserve(local);
    const slot2 = this.slot(local);
    const part = this.loc(local).type;
    this.own(slot2, part);
    let base = held;
    if (lent) {
      base = this.temp();
      this.emit(`${base} = load ptr, ptr ${held}`);
    }
    const at = this.temp();
    this.emit(`${at} = getelementptr ${this.llvm(type)}, ptr ${base}, i64 0, i64 ${i}`);
    const part2 = this.loc(local).type;
    if (this.isRef(part2)) {
      const line3 = `store ptr ${at}, ptr ${this.slot(local)}`;
      this.emit(line3);
    }
    else {
      const v = this.temp();
      this.emit(`${v} = load ${this.llvm(this.tables.typing.rec(type).element)}, ptr ${at}`);
      const part3 = this.loc(local).type;
      const line4 = `store ${this.llvm(part3)} ${this.copied(v, this.tables.typing.rec(type).element)}, ptr ${this.slot(local)}`;
      this.emit(line4);
    }
    for (const each of s.body) this.statement(each);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const [now, after] = [this.temp(), this.temp()];
    this.emit(`${now} = load i64, ptr ${counter}`);
    this.emit(`${after} = add i64 ${now}, 1`);
    this.emit(`store i64 ${after}, ptr ${counter}`);
    this.emit(`br label %${test}`);
    this.startBlock(end);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
  }


  // `for...of` over a string: each code point as a new string, until the runtime gives none. The
  // loop holds a reference to the string, so changing the variable it came from changes nothing.
  /** @throws {CompileError} */
  stringLoop(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>) {
    const local = this.resolved(s.left as Stmt);
    this.scopes.push({ transient: false, held: [] });
    const [held, offset] = [this.loopSlot(s, 0, "ptr"), this.loopSlot(s, 1, "i64")];
    let text: string;
    if (this.fresh(s.right)) {
      text = this.owned(s.right);
    } else {
      const operand = this.value(s.right);
      text = this.copied(operand, "string");
    }
    this.own(held, "string");
    this.emit(`store ptr ${text}, ptr ${held}`);
    this.settle();
    this.emit(`store i64 0, ptr ${offset}`);
    const [test, loop, next, end] = [this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    const [string, point, done] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${string} = load ptr, ptr ${held}`);
    this.emit(`${point} = call ptr @fsh_rt_str_next(ptr ${string}, ptr ${offset})`);
    this.emit(`${done} = icmp eq ptr ${point}, null`);
    this.emit(`br i1 ${done}, label %${end}, label %${loop}`);
    this.startBlock(loop);
    this.exits.set(stmtKey(s), { exit: end, next, depth: this.scopes.length });
    this.scopes.push({ transient: false, held: [] });
    this.reserve(local);
    const slot2 = this.slot(local);
    this.own(slot2, "string");
    const line = `store ptr ${point}, ptr ${this.slot(local)}`;
    this.emit(line);
    for (const each of s.body) this.statement(each);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    this.emit(`br label %${next}`);
    this.startBlock(next);
    this.emit(`br label %${test}`);
    this.startBlock(end);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
  }


  // `for...of` over a generator: each `next()` gives the variable its value, until it finishes.
  // The loop owns a generator it was given, and drops it once the loop ends however it ends; one
  // it borrows through a `Mut` stays with its owner.
  /** @throws {CompileError} */
  generatorLoop(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>, iterated: Type, right: Ref<Expr>) {
    const local = this.resolved(s.left as Stmt);
    const generator = this.referent(iterated) as GeneratorType;
    this.scopes.push({ transient: false, held: [] });
    const held = this.loopSlot(s, 0, this.llvm(iterated));
    if (this.isRef(iterated)) {
      const line = `store ptr ${this.value(right)}, ptr ${held}`;
      this.emit(line);
    }
    else {
      this.own(held, generator);
      const line2 = `store ${this.llvm(generator)} ${this.owned(right)}, ptr ${held}`;
      this.emit(line2);
    }
    this.settle();
    const [test, loop, end] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    let at = held;
    if (this.isRef(iterated)) {
      at = this.temp();
      this.emit(`${at} = load ptr, ptr ${held}`);
    }
    const result = this.resume(generator, at, right);
    const [finished, more] = this.nextShapes(this.tables.typing.rec(generator).yields);
    const nextResult2 = this.tables.typing.nextResult(this.tables.typing.rec(generator).yields) as UnionType;
    const done: Type[] = [finished];
    const line3 = `br i1 ${this.conversions().holds(result, nextResult2, done)}, label %${end}, label %${loop}`;
    this.emit(line3);
    this.startBlock(loop);
    this.exits.set(stmtKey(s), { exit: end, next: test, depth: this.scopes.length });
    this.scopes.push({ transient: false, held: [] });
    this.reserve(local);
    const slot2 = this.slot(local);
    const part = this.loc(local).type;
    this.own(slot2, part);
    const nextResult3 = this.tables.typing.nextResult(this.tables.typing.rec(generator).yields);
    const [shaped, v] = [this.convert(result, nextResult3, more), this.temp()];
    this.emit(`${v} = extractvalue ${this.llvm(more)} ${shaped}, 1`);
    const part2 = this.loc(local).type;
    const line4 = `store ${this.llvm(part2)} ${v}, ptr ${this.slot(local)}`;
    this.emit(line4);
    for (const each of s.body) this.statement(each);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    this.emit(`br label %${test}`);
    this.startBlock(end);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
  }


  // `for await`: each pass awaits the next value in the loop's await slot, an async generator's
  // `next()` or a Channel's `receive()`, until the generator finishes or the channel is closed
  // and drained. The loop owns a generator it was given, as a generator's loop does, and a count
  // on its channel.
  /** @throws {CompileError} */
  awaitLoop(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "forIn" | "forOf" }>>, iterated: Type) {
    const local = this.resolved(s.left as Stmt);
    const base = this.cur().frame!.loops.get(s)!;
    const [held, at] = [`%loop${base}`, `%loop${base + 2}`];
    const kept = this.tables.typing.rec(this.resuming!.type).frame[base]!.type;
    const awaited = this.tables.typing.rec(this.resuming!.type).frame[base + 2]!.type as FutureType | DynType;
    const boxed = this.tables.typing.rec(awaited).kind === "dyn" ? awaited : undefined;
    const future = awaited as FutureType;
    const keptRec = this.recOf(kept);
    const channel = keptRec?.kind === "block" ? (kept as BlockType) : undefined;
    this.scopes.push({ transient: false, held: [] });
    if (channel !== undefined) {
      let handle = this.value(s.right);
      if (this.isRef(iterated)) {
        handle = this.temp();
        const line = `${handle} = load ptr, ptr ${this.value(s.right)}`;
        this.emit(line);
      }
      this.own(held, channel);
      const line2 = `store ptr ${this.copied(handle, channel)}, ptr ${held}`;
      this.emit(line2);
    } else if (this.isRef(kept)) {
      const line3 = `store ptr ${this.value(s.right)}, ptr ${held}`;
      this.emit(line3);
    }
    else {
      this.own(held, kept);
      const line4 = `store ${this.llvm(kept)} ${this.owned(s.right)}, ptr ${held}`;
      this.emit(line4);
    }
    this.settle();
    this.scopes[this.scopes.length - 1]!.held.push({ slot: at, type: awaited });
    const [test, loop, end] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    let source = held;
    if (channel !== undefined || this.isRef(kept)) {
      source = this.temp();
      this.emit(`${source} = load ptr, ptr ${held}`);
    }
    if (boxed !== undefined) {
      // A boxed generator's `next()` is its vtable's first slot after drop, copy and clone.
      const [dyn, data, table] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${dyn} = load ${DYN}, ptr ${source}`);
      this.emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      this.emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      const made = this.temp();
      const line5 = `call ${DYN} ${this.vslot(table, 0)}(ptr ${data})`;
      this.unwinding(line5, made);
      this.emit(`store ${DYN} ${made}, ptr ${at}`);
    } else {
      const frame = this.temp();
      const line6 = `${frame} = insertvalue ${this.llvm(future)} zeroinitializer, ptr ${channel !== undefined ? this.copied(source, channel) : source}, 1`;
      this.emit(line6);
      this.emit(`store ${this.llvm(future)} ${frame}, ptr ${at}`);
    }
    const result = this.suspend(awaited, at, base + 2, s.right)!;
    const gives = (boxed !== undefined ? this.tables.typing.promiseElement(this.tables.typing.rec(boxed as DynType).of)! : this.tables.typing.rec(future).gives) as UnionType;
    let v: string;
    if (channel !== undefined) {
      const absent2: Type[] = ["null"];
    const line7 = `br i1 ${this.conversions().holds(result, gives, absent2)}, label %${end}, label %${loop}`;
      this.emit(line7);
      this.startBlock(loop);
      const part = this.loc(local).type;
      v = this.convert(result, gives, part);
    } else {
      const part2 = this.loc(local).type;
      const [finished, more] = this.nextShapes(part2);
      const line8 = `br i1 ${this.conversions().holds(result, gives, [finished])}, label %${end}, label %${loop}`;
      this.emit(line8);
      this.startBlock(loop);
      v = this.temp();
      const line9 = `${v} = extractvalue ${this.llvm(more)} ${this.convert(result, gives, more)}, 1`;
      this.emit(line9);
    }
    this.exits.set(stmtKey(s), { exit: end, next: test, depth: this.scopes.length });
    this.scopes.push({ transient: false, held: [] });
    this.reserve(local);
    const slot2 = this.slot(local);
    const part3 = this.loc(local).type;
    this.own(slot2, part3);
    const part4 = this.loc(local).type;
    const line10 = `store ${this.llvm(part4)} ${v}, ptr ${this.slot(local)}`;
    this.emit(line10);
    for (const each of s.body) this.statement(each);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    this.emit(`br label %${test}`);
    this.startBlock(end);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
  }


  // The two shapes `next()` gives: finished, and holding a value.
  nextShapes(this: Mut<this>, yields: Type): [ObjectType, ObjectType] {
    const nextResult2 = this.tables.typing.nextResult(yields) as UnionType;
    const members = this.tables.typing.rec(nextResult2).members.map((m) => m as ObjectType);
    const finished = members.find((m) => this.tables.typing.rec(m).fields.length === 1)!;
    return [finished, members.find((m) => m !== finished)!];
  }


  // What `next()` gives: `v`, or that the generator has finished. `done` is a literal, which
  // takes no room: the union's tag tells the two apart.
  answer(this: Mut<this>, v: string | undefined, yields: Type): string {
    const [finished, more] = this.nextShapes(yields);
    if (v === undefined) {
      const nextResult2 = this.tables.typing.nextResult(yields);
      return this.convert("zeroinitializer", finished, nextResult2);
    }
    const made = this.temp();
    this.emit(`${made} = insertvalue ${this.llvm(more)} zeroinitializer, ${this.llvm(yields)} ${v}, 1`);
    const nextResult3 = this.tables.typing.nextResult(yields);
    return this.convert(made, more, nextResult3);
  }


  // Runs a generator to its next `yield`, through a pointer to it. An error it throws is
  // raised at `raising`.
  // `sent` is the value `next(x)` gives it, for one taking values.
  resume(this: Mut<this>, generator: GeneratorType, at: string, raising: Ref<Expr>, sent?: string): string {
    const target = this.generatorOf.get(generator)!;
    const result = this.temp();
    const g = this.tables.typing.rec(generator);
    const given = g.sends !== undefined ? `, ${this.llvm(g.sends)} ${sent ?? "zeroinitializer"}, i1 ${sent !== undefined}` : "";
    const line = `call ${this.resultType(target)} ${this.symbol(target)}(ptr ${at}${given})`;
    this.unwinding(line, result);
    if (g.throws !== undefined) {
      const resultType2 = this.resultType(target);
      const nextResult2 = this.tables.typing.nextResult(g.yields);
      return this.unpacked(resultType2, result, nextResult2, raising)!;
    }
    return result;
  }


  // `yield v`: the value goes back to `next()`'s caller, and the next call goes on from here.
  // As a statement, it drops what `next(x)` sent; as a value, it gives it.
  yielded(this: Mut<this>, e: Ref<Extract<Expr, { kind: "yield" }>>, used = false): string {
    const v = this.owned(e.value!);
    this.settle();
    const result = this.answer(v, this.tables.typing.rec(this.resuming!.type as GeneratorType).yields);
    const at = this.label();
    if (this.resuming !== undefined) this.resuming.resumes.push(at);
    this.emit(`store i32 ${this.resuming!.resumes.length}, ptr %state`);
    const line = `ret ${this.resultType(this.current)} ${this.yieldedAs(result)}`;
    this.emit(line);
    this.startBlock(at);
    if (!used) {
      this.dropSent();
      return "";
    }
    // JavaScript gives `undefined` when nothing was sent, which no Fish type holds.
    const [fail, ok] = [this.label(), this.label()];
    this.emit(`br i1 %sent.has, label %${ok}, label %${fail}`);
    this.startBlock(fail);
    const line2 = `call void @fsh_rt_panic(ptr ${this.cString(`panicked at ${this.where({ start: e.start, end: e.end })}:\ngenerator resumed without a value\n`)})`;
    this.unwinding(line2);
    this.emit("unreachable");
    this.startBlock(ok);
    return "%sent";
  }


  // Drops a value `next(x)` sent that nothing takes.
  dropSent(this: Mut<this>) {
    const sends = this.cur().generator === undefined ? undefined : this.tables.typing.rec(this.cur().generator!).sends;
    if (sends === undefined || !this.needsDrop(sends)) return;
    const [drop, on] = [this.label(), this.label()];
    this.emit(`br i1 %sent.has, label %${drop}, label %${on}`);
    this.startBlock(drop);
    this.dispose("%sent", sends);
    this.emit(`br label %${on}`);
    this.startBlock(on);
  }


  // A variable's slot: an alloca, or in a generator, the frame's field, reached on entry.
  reserve(this: Mut<this>, local: LocalId) {
    const slot2 = this.slot(local);
    if (!this.framed.has(slot2)) {
      const slot3 = this.slot(local);
      const part = this.loc(local).type;
      const line = `  ${slot3} = alloca ${this.llvm(part)}`;
      this.allocas.push(line);
    }
  }


  slot(this: Mut<this>, local: LocalId): string {
    const at = this.captured.get(local);
    if ((at !== undefined && at !== "")) return at;
    let n = this.numbered.get(local);
    if (n === undefined) {
      n = this.numbered.size;
      this.numbered.set(local, n);
    }
    // Its number follows a dot, as no other name in a function's IR puts one. Quoted unless
    // plain, so any name a variable may have, `café` or a pattern's `[a, b]`, is a valid one.
    const name = `${this.loc(local).name === "%" ? "topic" : this.loc(local).name}.${n}`;
    return /^[-\w$.]+$/.test(name) ? `%${name}` : `%"${name}"`;
  }


  resolved(node: Ref<Expr | Stmt | Param | ObjectProp>): LocalId {
    const local = this.localAt(node);
    assert(local !== undefined, "internal error: unresolved name");
    return local!;
  }


  /** @throws {CompileError} */
  statement(this: Mut<this>, s: Ref<Stmt>): void {
    if (this.cur().unreached?.has(s) === true) return;
    const outer = this.siteNow();
    this.site = { start: s.start, end: s.end };
    this.lowerStatement(s);
    this.site = outer;
  }


  /** @throws {CompileError} */
  lowerStatement(this: Mut<this>, s: Ref<Stmt>) {
    switch (s.kind) {
      case "expr":
        if (s.expr.kind === "yield") {
          this.yielded(s.expr);
          return;
        }
        this.effect(s.expr);
        this.settle();
        return;
      case "block":
      case "unsafe":
        this.scoped(s.body);
        return;
      // A comptime block runs while compiling and leaves nothing to run.
      case "comptime":
        const part = this.current;
        comptimeBlock(this, part, s);
        return;
      case "if": {
        const cond = this.value(s.cond);
        this.settle();
        const then = this.label();
        const otherwise = s.else !== undefined ? this.label() : undefined;
        const end = this.label();
        this.emit(`br i1 ${cond}, label %${then}, label %${otherwise ?? end}`);
        this.startBlock(then);
        this.scoped(s.then);
        this.emit(`br label %${end}`);
        if (s.else !== undefined && (otherwise !== undefined && otherwise !== "")) {
          this.startBlock(otherwise);
          this.scoped(s.else);
          this.emit(`br label %${end}`);
        }
        this.startBlock(end);
        return;
      }
      case "while": {
        this.reserveC(s.cond);
        const test = this.label();
        const loop = this.label();
        const end = this.label();
        this.emit(`br label %${test}`);
        this.startBlock(test);
        const cond = this.value(s.cond);
        this.settle();
        this.emit(`br i1 ${cond}, label %${loop}, label %${end}`);
        this.startBlock(loop);
        this.exits.set(stmtKey(s), { exit: end, next: test, depth: this.scopes.length });
        this.scoped(s.body);
        this.emit(`br label %${test}`);
        this.startBlock(end);
        return;
      }
      case "for": {
        // The initializer's variables last for the whole loop.
        this.scopes.push({ transient: false, held: [] });
        if (s.init !== undefined) this.statement(s.init);
        if (s.test !== undefined) this.reserveC(s.test);
        if (s.update !== undefined) this.reserveC(s.update);
        const [test, loop, next, end] = [this.label(), this.label(), this.label(), this.label()];
        this.emit(`br label %${test}`);
        this.startBlock(test);
        const cond = s.test !== undefined ? this.value(s.test) : undefined;
        this.settle();
        this.emit((cond !== undefined && cond !== "") ? `br i1 ${cond}, label %${loop}, label %${end}` : `br label %${loop}`);
        this.startBlock(loop);
        this.exits.set(stmtKey(s), { exit: end, next, depth: this.scopes.length });
        this.scoped(s.body);
        this.emit(`br label %${next}`);
        this.startBlock(next);
        if (s.update !== undefined) this.effect(s.update);
        this.settle();
        this.emit(`br label %${test}`);
        this.startBlock(end);
        this.drop(this.scopes.length - 1);
        this.scopes.pop();
        return;
      }
      // The array is read once; one the loop made itself is owned by the loop until it ends.
      // Each pass gives the variable a pointer to its element, or a copy of a Copy one.
      case "forOf": {
        const via = this.cur().iterators?.get(s);
        if (via !== undefined) {
          const get2 = this.cur().types.get(via)!;
          this.generatorLoop(s, get2, via);
          return;
        }
        const iterated = this.cur().types.get(s.right)!;
        if (s.await) {
          this.awaitLoop(s, iterated);
          return;
        }
        const yielding = this.referent(iterated);
        if (this.recOf(yielding)?.kind === "generator") {
          this.generatorLoop(s, iterated, s.right);
          return;
        }
        if (this.tables.typing.lower(this.valueType(s.right)) === "string") {
          this.stringLoop(s);
          return;
        }
        const get4 = this.cur().types.get(s.right)!;
        const inline = this.referent(get4);
        const ir = this.recOf(inline);
        if (ir?.kind === "fixed") {
          this.fixedLoop(s, inline as FixedType);
          return;
        }
        if (ir?.kind === "map") {
          this.mapLoop(s, inline as MapType);
          return;
        }
        const type = this.valueType(s.right) as ArrayType;
        const local = this.resolved(s.left as Stmt);
        this.scopes.push({ transient: false, held: [] });
        // The array, and the position reached, live in slots: a generator's loop may stop at a
        // `yield` and go on in a later call.
        const [held, counter] = [this.loopSlot(s, 0, ARRAY), this.loopSlot(s, 1, "i64")];
        // In a generator, the frame says whether the loop owns its array.
        const kept = (this.resuming !== undefined ? this.tables.typing.rec(this.resuming.type).frame[this.cur().frame!.loops.get(s)!]!.type : undefined);
        if (kept !== undefined ? this.recOf(kept)?.kind === "array" : this.fresh(s.right)) {
          this.own(held, type);
          const line = `store ${ARRAY} ${this.owned(s.right)}, ptr ${held}`;
          this.emit(line);
        } else {
          const line2 = `store ${ARRAY} ${this.value(s.right)}, ptr ${held}`;
          this.emit(line2);
        }
        this.settle();
        this.emit(`store i64 0, ptr ${counter}`);
        const [test, loop, next, end] = [this.label(), this.label(), this.label(), this.label()];
        this.emit(`br label %${test}`);
        this.startBlock(test);
        const [i, more, array, length, data] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
        this.emit(`${i} = load i64, ptr ${counter}`);
        this.emit(`${array} = load ${ARRAY}, ptr ${held}`);
        this.emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
        this.emit(`${more} = icmp ult i64 ${i}, ${length}`);
        this.emit(`br i1 ${more}, label %${loop}, label %${end}`);
        this.startBlock(loop);
        this.exits.set(stmtKey(s), { exit: end, next, depth: this.scopes.length });
        this.scopes.push({ transient: false, held: [] });
        this.reserve(local);
        const slot2 = this.slot(local);
        const part2 = this.loc(local).type;
        this.own(slot2, part2);
        const at = this.temp();
        this.emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
        this.emit(`${at} = getelementptr ${this.llvm(this.tables.typing.rec(type).element)}, ptr ${data}, i64 ${i}`);
        // A reference element is itself the loop's value; any other reference borrows the slot.
        const part6 = this.loc(local).type;
        if (this.isRef(part6) && !this.isRef(this.tables.typing.rec(type).element)) {
          const line3 = `store ptr ${at}, ptr ${this.slot(local)}`;
          this.emit(line3);
        }
        else {
          const v = this.temp();
          this.emit(`${v} = load ${this.llvm(this.tables.typing.rec(type).element)}, ptr ${at}`);
          const part7 = this.loc(local).type;
          const line4 = `store ${this.llvm(part7)} ${this.copied(v, this.tables.typing.rec(type).element)}, ptr ${this.slot(local)}`;
          this.emit(line4);
        }
        for (const each of s.body) this.statement(each);
        this.drop(this.scopes.length - 1);
        this.scopes.pop();
        this.emit(`br label %${next}`);
        this.startBlock(next);
        const [now, after] = [this.temp(), this.temp()];
        this.emit(`${now} = load i64, ptr ${counter}`);
        this.emit(`${after} = add i64 ${now}, 1`);
        this.emit(`store i64 ${after}, ptr ${counter}`);
        this.emit(`br label %${test}`);
        this.startBlock(end);
        this.drop(this.scopes.length - 1);
        this.scopes.pop();
        return;
      }
      case "doWhile": {
        this.reserveC(s.cond);
        const [loop, test, end] = [this.label(), this.label(), this.label()];
        this.emit(`br label %${loop}`);
        this.startBlock(loop);
        this.exits.set(stmtKey(s), { exit: end, next: test, depth: this.scopes.length });
        this.scoped(s.body);
        this.emit(`br label %${test}`);
        this.startBlock(test);
        const cond = this.value(s.cond);
        this.settle();
        this.emit(`br i1 ${cond}, label %${loop}, label %${end}`);
        this.startBlock(end);
        return;
      }
      case "switch": {
        const tested = this.value(s.discriminant);
        let written = false;
        for (const c of s.cases) if (c.test !== undefined && this.writes(c.test)) written = true;
        const subject = this.kept(s.discriminant, tested, written);
        // A subject the switch made is released on the way into the body that runs, and stays
        // pending through the tests, so an error raised in one drops it too.
        const held = this.pending.slice(this.floor as i64);
        let entries: [string, string][] = [];
        const subjectType = this.valueType(s.discriminant);
        const type = this.llvm(subjectType);
        const bodies = s.cases.map(() => this.label());
        const end = this.label();
        this.exits.set(stmtKey(s), { exit: end, depth: this.scopes.length });
        // The cases share one scope.
        this.scopes.push({ transient: false, held: [] });
        // The tests run in order; when none matches, control goes to `default`, wherever it sits.
        let iAt: usize = 0;
        for (const c of s.cases) {
          const i = iAt;
          iAt++;
          if (c.test === undefined) continue;
          const test = this.value(c.test);
          // Anything but two values of one primitive type, such as a union or an enum member,
          // compares by value.
          const testType = this.valueType(c.test);
          const primitive = typeof subjectType === "string" && testType === subjectType && subjectType !== "string" && subjectType !== "bigint";
          const equal = primitive ? this.compare(type, subject, test) : this.conversions().equals(subject, subjectType, test, testType);
          this.settle(this.floor + held.length);
          const next = this.label();
          const line7 = `br i1 ${equal}, label %${this.enterCase(held.length > 0, entries, bodies[i]!)}, label %${next}`;
          this.emit(line7);
          this.startBlock(next);
        }
        const fallback = s.cases.findIndex((c) => c.test === undefined);
        const line8 = `br label %${this.enterCase(held.length > 0, entries, fallback < 0 ? end : bodies[fallback as usize]!)}`;
        this.emit(line8);
        this.pending.splice(this.floor as i64);
        for (const [via, body] of entries) {
          this.startBlock(via);
          for (const { v, type } of held) this.dispose(v, type);
          this.emit(`br label %${body}`);
        }
        let iAt2: usize = 0;
        for (const c of s.cases) {
          const i = iAt2;
          iAt2++;
          this.startBlock(bodies[i]!);
          c.body.forEach(((s) => this.statement(s)));
          this.emit(`br label %${i + 1 < bodies.length ? bodies[i + 1]! : end}`);
        }
        this.startBlock(end);
        this.drop(this.scopes.length - 1);
        this.scopes.pop();
        return;
      }
      case "labeled": {
        const end = this.label();
        this.exits.set(stmtKey(s), { exit: end, depth: this.scopes.length });
        this.statement(s.body);
        this.emit(`br label %${end}`);
        this.startBlock(end);
        return;
      }
      case "break":
      case "continue": {
        const target = this.exits.get(this.cur().jumps.get(s)!)!;
        this.jump(s.kind === "break" ? target.exit : target.next!, target.depth);
        const label2 = this.label();
        this.startBlock(label2);
        return;
      }
      case "return":
        if (this.cur().jumps.has(s)) {
          const get3 = this.cur().jumps.get(s)!;
          this.given(s, get3);
        } else if (s.value !== undefined && (this.cur().future !== undefined ? this.tables.typing.rec(this.cur().future!).gives : this.cur().returns) === "void") {
          // An arrow's expression body may be a call returning nothing.
          this.effect(s.value);
          this.settle();
          this.leave(undefined);
        } else {
          // A future's inferred result is widened from what its returns give, as a `let` is.
          let v: string | undefined;
          if (s.value !== undefined) {
            v = this.owned(s.value);
            if (this.cur().future !== undefined) {
              const part3 = this.tables.typing.rec(this.cur().future!).gives;
              v = this.convert(v, this.valueType(s.value), part3);
            }
          } else {
            v = undefined;
          }
          this.settle();
          this.leave(v);
        }
        // Anything after a return goes in a fresh block that nothing branches to.
        const label3 = this.label();
        this.startBlock(label3);
        return;
      case "throw":
        const owned2 = this.owned(s.value);
        this.raised(s, owned2);
        this.pending.length = this.floor;
        const label4 = this.label();
        this.startBlock(label4);
        return;
      // An error raised in the block is stored where the catch reads it, and the catch runs.
      // A `finally` runs however the two are left, then carries on the way they were left.
      case "try": {
        const finishes = s.finalizer !== undefined;
        if (finishes) this.enter();
        const after = this.label();
        const done = (cg: Mut<Codegen>) => {
          if (finishes) cg.exit("normal", (cg: Mut<Codegen>) => cg.emit(`br label %${after}`));
          else cg.emit(`br label %${after}`);
        };
        if (s.handler === undefined) {
          this.scoped(s.block);
          done(this);
        } else {
          const local = s.param !== undefined ? this.resolved(s) : undefined;
          const type = this.cur().caught.get(s)!;
          const handler = { label: this.label(), slot: this.alloca(this.llvm(type)), depth: this.scopes.length, floor: this.floor };
          this.handlers.push(handler);
          this.scoped(s.block);
          this.handlers.pop();
          done(this);
          this.startBlock(handler.label);
          this.scopes.push({ transient: false, held: [] });
          const caught = this.temp();
          this.emit(`${caught} = load ${this.llvm(type)}, ptr ${handler.slot}`);
          // The catch's variable owns the error; with none, the error is dropped here.
          if (local !== undefined) {
            this.reserve(local);
            const slot3 = this.slot(local);
            const part4 = this.loc(local).type;
            this.own(slot3, part4);
            const line5 = `store ${this.llvm(type)} ${caught}, ptr ${this.slot(local)}`;
            this.emit(line5);
          } else this.dispose(caught, type);
          s.handler.forEach(((s) => this.statement(s)));
          this.drop(this.scopes.length - 1);
          this.scopes.pop();
          done(this);
        }
        if (finishes) {
          const region = this.finallies.pop()!;
          this.startBlock(region.label);
          // What a way out keeps while the finally runs is dropped if the finally leaves its own way.
          this.scopes.push({ transient: false, held: [] });
          for (const { slot, type } of region.slots.values()) this.own(slot, type);
          this.scoped(s.finalizer!);
          const chosen = this.temp();
          this.emit(`${chosen} = load i32, ptr ${region.chosen}`);
          const targets = region.exits.map(() => this.label());
          this.emit(`switch i32 ${chosen}, label %${targets[0]!} [ ${targets.map((t, i) => `i32 ${i}, label %${t}`).join(" ")} ]`);
          let iAt3: usize = 0;
          for (const e of region.exits) {
            const i = iAt3;
            iAt3++;
            this.startBlock(targets[i]!);
            e.resume(this);
          }
          this.scopes.pop();
        }
        this.startBlock(after);
        return;
      }
      case "let": {
        const local = this.resolved(s);
        this.reserve(local);
        const slot4 = this.slot(local);
        const part5 = this.loc(local).type;
        this.own(slot4, part5);
        // A variable declared without a value starts empty, as a moved-out one is.
        const init = s.declarations[0]!.init;
        const part8 = this.loc(local).type;
        const line6 = `store ${this.llvm(part8)} ${init !== undefined ? this.owned(init) : "zeroinitializer"}, ptr ${this.slot(local)}`;
        this.emit(line6);
        this.settle();
        return;
      }
    }
  }


  // Emits a call that may panic, assigning its result to `result` when given. Unwinding, with
  // anything live here, it is an invoke whose landing pad drops the statement's values and every
  // scope's variables, runs `cleanup` for what the call itself held, and lets the unwind go on.
  // Variables not yet set, or already dropped, are empty, so dropping every scope is safe.
  unwinding(this: Mut<this>, call: string, result?: string, cleanup?: (cg: Mut<Codegen>) => void) {
    const assign = (result !== undefined && result !== "") ? `${result} = ` : "";
    const live = this.pending.some((p) => this.needsDrop(p.type)) || this.scopes.some((s) => s.held.length > 0);
    if (this.panic === "abort" || (!live && cleanup === undefined)) {
      this.emit(assign + call);
      return;
    }
    // A landing pad reads the statement's values back from slots: at -O0 on AArch64, LLVM loses
    // the second register of a two-register value carried into one. Each call stores them
    // again, since a value may reach it along a path no earlier store was on.
    let held: { slot: string; type: Type }[] = [];
    for (let i: usize = 0; i < this.pending.length; i++) {
      const type = this.pending[i]!.type;
      if (!this.needsDrop(type)) continue;
      if (this.pending[i]!.slot === undefined) {
        const slot = this.alloca(this.llvm(type));
        this.pending[i]!.slot = slot;
      }
      this.emit(`store ${this.llvm(type)} ${this.pending[i]!.v}, ptr ${this.pending[i]!.slot!}`);
      held.push({ slot: this.pending[i]!.slot!, type });
    }
    const [ok, pad, caught] = [this.label(), this.label(), this.temp()];
    this.emit(`${assign}invoke ${call.slice("call ".length as i64)} to label %${ok} unwind label %${pad}`);
    this.startBlock(pad);
    this.emit(`${caught} = landingpad { ptr, i32 } cleanup`);
    cleanup?.(this);
    held.reverse();
    for (const p of held) {
      const v = this.temp();
      this.emit(`${v} = load ${this.llvm(p.type)}, ptr ${p.slot}`);
      this.dispose(v, p.type);
    }
    this.drop(0);
    this.emit(`resume { ptr, i32 } ${caught}`);
    this.startBlock(ok);
  }


  // A match: the subject is read once, then each arm's pattern is tested in order; a match binds
  // its names and runs its guard, and a failing guard drops what it bound and tries the next arm.
  // The checker made sure some arm matches. As a value, each arm gives one of its own. A value
  // the match made is its own, in a slot its bindings move parts out of, dropped with what is
  // left once the match ends; a place is read where it lives, and bindings point into it.
  /** @throws {CompileError} */
  lowerMatch(this: Mut<this>, e: Ref<Extract<Expr, { kind: "match" }>>, wanted: boolean): string | undefined {
    const type = this.valueType(e.subject);
    this.scopes.push({ transient: true, held: [] });
    let subject: string;
    let at: string | undefined;
    const owning = made(e.subject) && this.fresh(e.subject);
    if (owning) {
      subject = this.value(e.subject, true);
      at = this.alloca(this.llvm(type));
      this.own(at, type);
      this.emit(`store ${this.llvm(type)} ${subject}, ptr ${at}`);
    } else {
      subject = this.value(e.subject);
      at = this.lendable(e.subject) && !this.cur().coercions.has(e.subject) && this.stored(e.subject) === type ? this.address(e.subject) : undefined;
    }
    const result = wanted ? this.cur().types.get(e) : undefined;
    const slot = (result !== undefined ? this.alloca(this.llvm(result)) : undefined);
    const end = this.label();
    for (const arm of e.arms) {
      const next = this.label();
      this.tested(arm.pattern, subject, next);
      this.scopes.push({ transient: true, held: [] });
      // A guarded arm copies what it binds, since a failing guard moves on to arms that may bind
      // the same parts.
      this.bindAll(arm.pattern, subject, at, owning && arm.guard === undefined);
      if (arm.guard !== undefined) {
        const mark = this.pending.length;
        const ok = this.value(arm.guard);
        this.settle(mark);
        const [body, failed] = [this.label(), this.label()];
        this.emit(`br i1 ${ok}, label %${body}, label %${failed}`);
        this.startBlock(failed);
        this.drop(this.scopes.length - 1);
        this.emit(`br label %${next}`);
        this.startBlock(body);
      }
      const mark = this.pending.length;
      if (arm.body.kind === "block") {
        const given = this.label();
        this.exits.set(stmtKey(arm.body), { exit: given, depth: this.scopes.length });
        this.arms.set(stmtKey(arm.body), result !== undefined && (slot !== undefined && slot !== "") ? { slot, type: result } : undefined);
        const outer = this.floor;
        this.floor = mark;
        this.statement(arm.body);
        this.floor = outer;
        this.emit(`br label %${given}`);
        this.startBlock(given);
      } else {
        if (result !== undefined && (slot !== undefined && slot !== "")) {
          const line = `store ${this.llvm(result)} ${this.needsDrop(result) ? this.owned(arm.body) : this.value(arm.body)}, ptr ${slot}`;
          this.emit(line);
        }
        else this.effect(arm.body);
        this.settle(mark);
      }
      this.drop(this.scopes.length - 1);
      this.scopes.pop();
      this.emit(`br label %${end}`);
      this.startBlock(next);
    }
    this.emit("unreachable");
    this.startBlock(end);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    if (result === undefined || (slot === undefined || slot === "")) return undefined;
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(result)}, ptr ${slot}`);
    return v;
  }


  // A pipe over a value: the value lives in the topic's slot while the right side runs, and is
  // dropped after it unless the right side moved it out.
  /** @throws {CompileError} */
  lowerPipe(this: Mut<this>, e: Ref<Extract<Expr, { kind: "pipe" }>>, wanted: boolean): string | undefined {
    const local = this.localAt(e)!;
    this.scopes.push({ transient: true, held: [] });
    this.reserve(local);
    const slot2 = this.slot(local);
    const part = this.loc(local).type;
    this.own(slot2, part);
    const part2 = this.loc(local).type;
    const line = `store ${this.llvm(part2)} ${this.owned(e.value)}, ptr ${this.slot(local)}`;
    this.emit(line);
    const mark = this.pending.length;
    const type = this.cur().types.get(e);
    let v: string | undefined = undefined;
    if (wanted && type !== undefined) v = this.needsDrop(type) ? this.owned(e.body) : this.value(e.body);
    else this.effect(e.body);
    this.settle(mark);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
    return v;
  }


  // A `return` in a match arm's block: its value goes where the match keeps what it gives, and
  // control leaves the arm, dropping what the scopes inside it own.
  /** @throws {CompileError} */
  given(this: Mut<this>, s: Ref<Extract<Stmt, { kind: "return" }>>, arm: Ref<Stmt>) {
    const into = this.arms.get(arm);
    if (s.value !== undefined && into !== undefined) {
      const line = `store ${this.llvm(into.type)} ${this.needsDrop(into.type) ? this.owned(s.value) : this.value(s.value)}, ptr ${into.slot}`;
      this.emit(line);
    }
    else if (s.value !== undefined) this.effect(s.value);
    this.settle();
    const target = this.exits.get(arm)!;
    this.jump(target.exit, target.depth);
  }


  // Tests a value against a pattern, going on when it matches and to `no` when it doesn't. A
  // payload is only read once its member's tag is known.
  tested(this: Mut<this>, p: Ref<Pattern>, v: string, no: string): void {
    const info = this.cur().patterns.get(p)!;
    const pass = (cg: Mut<Codegen>, condition: string) => {
      const ok = cg.label();
      cg.emit(`br i1 ${condition}, label %${ok}, label %${no}`);
      cg.startBlock(ok);
    };
    const matched = typeof info.type === "string" ? undefined : this.tables.typing.rec(info.type as Exclude<Type, string>);
    const union = matched?.kind === "union" ? (info.type as UnionType) : undefined;
    switch (info.kind) {
      case "any":
        return;
      case "literal":
        let chosen = "false";
        if (info.member !== undefined) {
          chosen = this.conversions().equals(v, info.type, "zeroinitializer", info.member);
        } else {
          assert(p.kind === "literal", "internal error: a literal test without its literal");
          if (p.kind === "literal") {
            const operand = this.value(p.value);
            chosen = this.conversions().equals(v, info.type, operand, this.valueType(p.value));
          }
        }
        pass(this, chosen);
        return;
      case "none":
        const absent: Type[] = ["null"];
        const chosen2 = union !== undefined ? this.conversions().holds(v, union, absent) : "true";
        pass(this, chosen2);
        return;
      case "some": {
        const empty = this.temp();
        const line = `${empty} = xor i1 ${this.conversions().holds(v, union!, ["null"])}, true`;
        this.emit(line);
        pass(this, empty);
        const convert2 = this.convert(v, info.type, info.inner);
        this.tested(info.arg, convert2, no);
        return;
      }
      case "variant": {
        if (union !== undefined) {
          const holds2 = this.conversions().holds(v, union, [info.variant]);
          pass(this, holds2);
        }
        const payload = union !== undefined ? this.convert(v, info.type, info.variant) : v;
        let iAt: usize = 0;
        for (const arg of info.args) {
          const i = iAt;
          iAt++;
          const field = this.temp();
          this.emit(`${field} = extractvalue ${this.llvm(info.variant)} ${payload}, ${i}`);
          this.tested(arg, field, no);
        }
        return;
      }
      case "object": {
        if (union !== undefined) {
          const holds3 = this.conversions().holds(v, union, info.shapes);
          pass(this, holds3);
        }
        const holder = this.shapeOf(info);
        const held = union !== undefined ? this.convert(v, info.type, holder) : v;
        for (const [key, sub, type] of info.fields) {
          const fieldOf2 = this.fieldOf(held, holder, key, type);
          this.tested(sub, fieldOf2, no);
        }
        return;
      }
      case "array": {
        const [length, data, same] = [this.temp(), this.temp(), this.temp()];
        this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
        this.emit(`${same} = icmp eq i64 ${length}, ${info.items.length}`);
        pass(this, same);
        this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
        let iAt2: usize = 0;
        for (const item of info.items) {
          const i = iAt2;
          iAt2++;
          const part = this.loadElement(data, info.element, i as usize).v;
          this.tested(item, part, no);
        }
        return;
      }
      case "or": {
        const yes = this.label();
        let iAt3: usize = 0;
        for (const alt of info.alternatives) {
          const i = iAt3;
          iAt3++;
          const next = (i as usize) < info.alternatives.length - 1 ? this.label() : no;
          this.tested(alt, v, next);
          this.emit(`br label %${yes}`);
          if (next !== no) this.startBlock(next);
        }
        this.startBlock(yes);
        return;
      }
    }
  }


  // Binds the names a pattern gives, in the arm's scope: a pointer into where the value lives,
  // for a borrowing binding; otherwise the value, moved out of a temporary the match owns, or a
  // copy. A part with no place of its own to point at is pointed at in a copy of its bits.
  bindAll(this: Mut<this>, p: Ref<Pattern>, v: string, at: string | undefined, move: boolean): void {
    const info = this.cur().patterns.get(p)!;
    if (info.kind === "any" && p.kind === "ident") {
      const local = this.resolved(keyAt(p.id, p.start, p.end));
      this.reserve(local);
      // A binding borrowing the part points where it lives; one of a part that is itself a
      // reference, like a `Mut` field, holds that reference.
      const part2 = this.loc(local).type;
      if (this.isRef(part2) && this.loc(local).type !== info.type) {
        let pointer = at;
        if ((pointer === undefined || pointer === "")) {
          pointer = this.alloca(this.llvm(info.type));
          this.emit(`store ${this.llvm(info.type)} ${v}, ptr ${pointer}`);
        }
        const line = `store ptr ${pointer}, ptr ${this.slot(local)}`;
        this.emit(line);
        return;
      }
      const slot2 = this.slot(local);
      const part = this.loc(local).type;
      this.own(slot2, part);
      const taken = move && (at !== undefined && at !== "") && this.needsDrop(info.type);
      if (taken) this.emit(`store ${this.llvm(info.type)} zeroinitializer, ptr ${at!}`);
      const part3 = this.loc(local).type;
      const line2 = `store ${this.llvm(part3)} ${taken ? v : this.copied(v, info.type)}, ptr ${this.slot(local)}`;
      this.emit(line2);
      return;
    }
    if (info.kind === "variant") {
      const inUnion = info.type !== info.variant;
      const payload = inUnion ? this.convert(v, info.type, info.variant) : v;
      const payloadAt = (at !== undefined && at !== "") && inUnion ? this.partAt(this.llvm(info.type), at, 1) : at;
      let iAt: usize = 0;
      for (const arg of info.args) {
        const i = iAt;
        iAt++;
        const field = this.temp();
        this.emit(`${field} = extractvalue ${this.llvm(info.variant)} ${payload}, ${i}`);
        const chosen = payloadAt !== undefined ? this.partAt(this.llvm(info.variant), payloadAt, i as usize) : undefined;
        this.bindAll(arg, field, chosen, move);
      }
      return;
    }
    if (info.kind === "object") {
      // One shape has its fields in place; several have no one place to point into.
      const holder = this.shapeOf(info);
      const union = info.type !== holder;
      const held = union ? this.convert(v, info.type, holder) : v;
      const shape = this.recOf(holder);
      const single = shape?.kind === "object" || shape?.kind === "class" ? (holder as ObjectType | ClassType) : undefined;
      const holderAt = (at !== undefined && at !== "") && single !== undefined ? (union ? this.partAt(this.llvm(info.type), at, 1) : at) : undefined;
      for (const [key, sub, type] of info.fields) {
        let fieldAt: string | undefined = undefined;
        if ((holderAt !== undefined && holderAt !== "") && single !== undefined) {
          fieldAt = this.temp();
          this.emit(`${fieldAt} = getelementptr ${this.llvm(single)}, ptr ${holderAt}, i32 0, ${this.tables.typing.fieldPath(single, key).map((i) => `i32 ${i}`).join(", ")}`);
        }
        const fieldOf2 = this.fieldOf(held, holder, key, type);
        this.bindAll(sub, fieldOf2, fieldAt, move && fieldAt !== undefined);
      }
      return;
    }
    if (info.kind === "array") {
      const data = this.temp();
      this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
      let iAt2: usize = 0;
      for (const item of info.items) {
        const i = iAt2;
        iAt2++;
        const { v: element, at: elementAt } = this.loadElement(data, info.element, i as usize);
        this.bindAll(item, element, elementAt, move);
      }
      return;
    }
    if (info.kind === "some") {
      // Only an Option of one member keeps that member in place as its payload.
      const alone = this.tables.typing.rec(info.type as UnionType).members.length === 2;
      const innerAt = (at !== undefined && at !== "") && alone ? this.partAt(this.llvm(info.type), at, 1) : undefined;
      const convert2 = this.convert(v, info.type, info.inner);
      this.bindAll(info.arg, convert2, innerAt, move && innerAt !== undefined);
    }
  }


  // What an object pattern meets once its member is known: its one shape, or the union of them.
  shapeOf(this: Mut<this>, info: Ref<Extract<PatternInfo, { kind: "object" }>>): Type {
    return info.shapes.length === 1 ? info.shapes[0]! : this.tables.typing.unionType([...info.shapes]);
  }


  // A field of a value, read as `type`: from an object or instance, or a union's members.
  fieldOf(this: Mut<this>, v: string, holder: Type, key: string, type: Type): string {
    const held = this.tables.typing.rec(holder as Exclude<Type, string>);
    if (held.kind === "union") return this.conversions().unionField(v, holder as Exclude<Type, string> as UnionType, key, type);
    if (held.kind === "recursive") {
      const loaded = this.temp();
      this.emit(`${loaded} = load ${this.llvm(held.of)}, ptr ${v}`);
      return this.fieldOf(loaded, held.of, key, type);
    }
    const shape = holder as ObjectType | ClassType;
    const read = this.temp();
    this.emit(`${read} = extractvalue ${this.llvm(shape)} ${v}, ${this.tables.typing.fieldPath(shape, key).join(", ")}`);
    return this.convert(read, this.tables.typing.field(shape, key)!.type, type);
  }


  // An array's element `i`, and where it lives.
  loadElement(this: Mut<this>, data: string, element: Type, i: usize): { v: string; at: string } {
    const [at, v] = [this.temp(), this.temp()];
    this.emit(`${at} = getelementptr ${this.llvm(element)}, ptr ${data}, i64 ${i}`);
    this.emit(`${v} = load ${this.llvm(element)}, ptr ${at}`);
    return { v, at };
  }


  // A pointer to part `i` of an aggregate in memory.
  partAt(this: Mut<this>, type: string, at: string, i: usize): string {
    const part = this.temp();
    this.emit(`${part} = getelementptr ${type}, ptr ${at}, i32 0, i32 ${i}`);
    return part;
  }


  // An expression run for its effect, dropping any value it makes.
  /** @throws {CompileError} */
  effect(this: Mut<this>, e: Ref<Expr>) {
    if (e.kind === "match") {
      this.lowerMatch(e, false);
      return;
    }
    if (e.kind === "pipe") {
      this.lowerPipe(e, false);
      return;
    }
    if (e.kind === "unary" && e.op === "await") {
      const v = this.awaitFuture(e);
      const gives = this.tables.typing.rec(this.valueType(e.operand) as FutureType).gives;
      if (v !== undefined && this.needsDrop(gives)) this.dispose(v, gives);
      return;
    }
    if (e.kind !== "call") {
      this.value(e);
      return;
    }
    const result = this.call(e);
    // A call whose value goes unused has no type of its own recorded.
    const called = this.callOf(e);
    const type = this.cur().types.get(e) ?? (called !== undefined ? this.inst(called).returns : undefined);
    if (result !== undefined && type !== undefined) this.dispose(result, type);
  }


  // Whether a value of the type owns memory it gives back when dropped: a string, or anything
  // holding one by value.
  needsDrop(type: Type | undefined): boolean {
    if (type === "string" || type === "bigint" || (type !== undefined && rustClassOf(this.tables.typing, type) !== undefined)) return true;
    if (type === undefined || typeof type === "string") return false;
    const r = this.tables.typing.rec(type);
    if (r.kind === "handle") return true;
    if (r.kind === "union") return r.members.some(((type) => this.needsDrop(type)));
    if (r.kind === "array" || r.kind === "map" || r.kind === "shared" || r.kind === "block" || r.kind === "dyn" || r.kind === "recursive") return true;
    if (r.kind === "fixed") return r.size > 0 && this.needsDrop(r.element);
    if (r.kind === "interior" && !isLock(r)) return this.needsDrop(r.of);
    return this.parts(type).some(([t]) => this.needsDrop(t));
  }


  // The parts of an aggregate value, each with its index: an instance's embedded base, then its
  // fields; an object's or a closure's fields.
  parts(type: Exclude<Type, string>): [Type, usize][] {
    const r = this.tables.typing.rec(type);
    // A lock is its word, then what it holds.
    if (r.kind === "interior") return isLock(r) ? [[r.of, 1]] : [];
    if (r.kind !== "object" && r.kind !== "class" && r.kind !== "closure" && r.kind !== "variant" && r.kind !== "generator" && r.kind !== "future") return [];
    let out: [Type, usize][] = r.kind === "class" && r.base !== undefined ? [[r.base, 0]] : [];
    const offset = out.length;
    const held = r.kind === "generator" || r.kind === "future" ? r.frame : r.fields;
    for (let i: usize = 0; i < held.length; i++) out.push([held[i]!.type, i + offset]);
    return out;
  }


  // A copy of a value, holding its own reference to each string in it.
  copied(this: Mut<this>, v: string, type: Type): string {
    if (this.holdsRust(type)) assert(false, `internal error: a '${this.tables.typing.show(type)}' holds a Rust handle, which is moved, never copied`);
    const r = this.recOf(type);
    if (r?.kind === "interior" && !isLock(r)) return this.copied(v, r.of);
    if (!this.needsDrop(type)) return v;
    if (type === "string") {
      this.emit(`call void @fsh_rt_str_retain(ptr ${v})`);
      return v;
    }
    if (type === "bigint") {
      this.emit(`call void @fsh_rt_big_retain(ptr ${v})`);
      return v;
    }
    if (r?.kind === "handle") {
      this.emit(`call void @fsh_rt_handle_retain(ptr ${v})`);
      return v;
    }
    // A copy may panic part way, on a Dyn whose value can't be copied.
    const result = this.temp();
    const line = `call ${this.llvm(type)} ${this.helper("copy", type as Exclude<Type, string>)}(${this.llvm(type)} ${v})`;
    this.unwinding(line, result);
    return result;
  }


  // Gives up a value: releases a reference to everything it owns.
  dispose(this: Mut<this>, v: string, type: Type): void {
    const r = this.recOf(type);
    if (r?.kind === "interior" && !isLock(r)) {
      this.dispose(v, r.of);
      return;
    }
    if (!this.needsDrop(type)) return;
    if (type === "string") {
      this.emit(`call void @fsh_rt_str_release(ptr ${v})`);
      return;
    }
    if (type === "bigint") {
      this.emit(`call void @fsh_rt_big_release(ptr ${v})`);
      return;
    }
    if (r?.kind === "handle") {
      this.emit(`call void @fsh_rt_handle_drop(ptr ${v})`);
      return;
    }
    const rust = rustClassOf(this.tables.typing, type);
    if (rust !== undefined) {
      // Rust's drop runs in the shim, which hands back a panic in it for the runtime to raise.
      const dropped = rust.name;
      const [name, caught] = [`@"${dropSymbol(rust)}"`, this.alloca("ptr")];
      this.rustDrops.add(name);
      this.emit(`store ptr null, ptr ${caught}`);
      this.emit(`call void ${name}(ptr ${v}, ptr ${caught})`);
      const line = `call void @fsh_rt_rust_dropped(ptr ${caught}, ptr ${this.cString(`panicked while dropping a Rust '${dropped}':\n`)})`;
      this.emit(line);
      return;
    }
    const line2 = `call void ${this.helper("drop", type as Exclude<Type, string>)}(${this.llvm(type)} ${v})`;
    this.emit(line2);
  }


  // The function that drops what a value of an aggregate type owns, or returns a copy of it,
  // part by part, or for a union, in the member it holds. It is named before it is made, so a
  // type holding itself calls it.
  helper(this: Mut<this>, kind: "drop" | "copy", type: Exclude<Type, string>): string {
    const r = this.tables.typing.rec(type);
    if (kind === "copy" && this.holdsRust(type)) assert(false, `internal error: a '${this.tables.typing.show(type)}' holds a Rust handle, which is moved, never copied`);
    const made = kind === "copy" ? this.glue.copy.get(type) : this.glue.drop.get(type);
    if ((made !== undefined && made !== "")) return made;
    const described2 = this.tables.typing.described(type);
    const name = `@fsh.${kind}.${this.stableId(kind, described2, typeOwner(type))}`;
    if (kind === "copy") this.glue.copy.set(type, name);
    else this.glue.drop.set(type, name);
    // A copy keeps the parts it has made pending, so a panic part way drops them.
    const saved = this.setAside();
    const t = this.llvm(type);
    const each = (cg: Mut<Codegen>, v: string, part: Type, track = true) => {
      if (kind === "drop") {
        cg.dispose(v, part);
        return v;
      }
      const made = cg.copied(v, part);
      if (track) cg.pending.push({ v: made, type: part });
      return made;
    };
    let result = "%v";
    if (r.kind === "array") {
      result = kind === "drop" ? this.dropArray(type as ArrayType) : this.copyArray(type as ArrayType);
    } else if (r.kind === "map") {
      // A map moved out of its place left it empty, which the runtime's free skips.
      if (kind === "drop") this.emit("call void @fsh_rt_map_free(ptr %v)");
      else result = this.copyMap(type as MapType);
    } else if (r.kind === "fixed") {
      // Element by element in a loop over the value held in a slot, each copy written back.
      const [slot, index] = [this.alloca(t), this.alloca("i64")];
      this.emit(`store ${t} %v, ptr ${slot}`);
      this.emit(`store i64 0, ptr ${index}`);
      const [head, body, done] = [this.label(), this.label(), this.label()];
      this.emit(`br label %${head}`);
      this.startBlock(head);
      const [i, more] = [this.temp(), this.temp()];
      this.emit(`${i} = load i64, ptr ${index}`);
      this.emit(`${more} = icmp ult i64 ${i}, ${r.size}`);
      this.emit(`br i1 ${more}, label %${body}, label %${done}`);
      this.startBlock(body);
      const [at, v, after] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${at} = getelementptr ${t}, ptr ${slot}, i64 0, i64 ${i}`);
      this.emit(`${v} = load ${this.llvm(r.element)}, ptr ${at}`);
      const made = each(this, v, r.element, false);
      if (kind === "copy") this.emit(`store ${this.llvm(r.element)} ${made}, ptr ${at}`);
      this.emit(`${after} = add i64 ${i}, 1`);
      this.emit(`store i64 ${after}, ptr ${index}`);
      this.emit(`br label %${head}`);
      this.startBlock(done);
      if (kind === "copy") {
        result = this.temp();
        this.emit(`${result} = load ${t}, ptr ${slot}`);
      }
    } else if (r.kind === "recursive") {
      result = kind === "drop" ? this.dropBlock(type as RecursiveType) : this.copyBlock(type as RecursiveType);
    } else if (r.kind === "shared") {
      if (kind === "copy") this.emit(`call void @fsh_rt_${sharedPrefix(this.tables.typing.rec(type as SharedType).which)}_retain(ptr %v)`);
      else this.dropShared(type as SharedType);
    } else if (r.kind === "dyn") {
      // Through the vtable: its drop frees the block; its copy gives a new block. A Dyn moved
      // out of its place left it empty, with nothing to drop or copy.
      const [data, table, empty, at, fn, full, done] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.label(), this.label()];
      this.emit(`${data} = extractvalue ${DYN} %v, 0`);
      this.emit(`${table} = extractvalue ${DYN} %v, 1`);
      this.emit(`${empty} = icmp eq ptr ${data}, null`);
      this.emit(`br i1 ${empty}, label %${done}, label %${full}`);
      this.startBlock(full);
      this.emit(`${at} = getelementptr ptr, ptr ${table}, i64 ${kind === "drop" ? 0 : 1}`);
      this.emit(`${fn} = load ptr, ptr ${at}`);
      let copy: string | undefined = undefined;
      if (kind === "drop") this.emit(`call void ${fn}(ptr ${data})`);
      else {
        const made = this.temp();
        copy = this.temp();
        this.unwinding(`call ptr ${fn}(ptr ${data})`, made);
        this.emit(`${copy} = insertvalue ${DYN} %v, ptr ${made}, 0`);
      }
      const from = this.block;
      this.emit(`br label %${done}`);
      this.startBlock(done);
      if ((copy !== undefined && copy !== "")) {
        result = this.temp();
        this.emit(`${result} = phi ${DYN} [ %v, %entry ], [ ${copy}, %${from} ]`);
      }
    } else if (r.kind === "block") {
      const release = RELEASES.get(r.which)!;
      this.emit(kind === "copy" ? "call void @fsh_rt_block_retain(ptr %v)" : `call void @${release}(ptr %v)`);
    } else if (r.kind === "union") {
      // The copy starts as the value itself, which is right for members owning nothing.
      const copy = kind === "copy" ? this.alloca(t) : "";
      if (copy !== "") this.emit(`store ${t} %v, ptr ${copy}`);
      const tag = this.temp();
      this.emit(`${tag} = extractvalue ${t} %v, 0`);
      const owners = r.members.filter(((type) => this.needsDrop(type)));
      const cases = owners.map(() => this.label());
      const end = this.label();
      this.emit(`switch i32 ${tag}, label %${end} [ ${owners.map((m, i) => `i32 ${r.members.indexOf(m)}, label %${cases[i as usize]!}`).join(" ")} ]`);
      let iAt: usize = 0;
      for (const m of owners) {
        const i = iAt;
        iAt++;
        this.startBlock(cases[i as usize]!);
        // One member's copy, made on its own path, so nothing else is pending beside it.
        const convert2 = this.convert("%v", type, m);
        const part = each(this, convert2, m, false);
        if (copy !== "") {
          const line = `store ${t} ${this.convert(part, m, type)}, ptr ${copy}`;
          this.emit(line);
        }
        this.emit(`br label %${end}`);
      }
      this.startBlock(end);
      if (copy !== "") {
        result = this.temp();
        this.emit(`${result} = load ${t}, ptr ${copy}`);
      }
    } else {
      for (const [part, i] of this.parts(type)) {
        if (!this.needsDrop(part)) continue;
        const v = this.temp();
        this.emit(`${v} = extractvalue ${t} %v, ${i}`);
        const made = each(this, v, part);
        if (kind === "drop") continue;
        const next = this.temp();
        this.emit(`${next} = insertvalue ${t} ${result}, ${this.llvm(part)} ${made}, ${i}`);
        result = next;
      }
    }
    this.emit(kind === "drop" ? "ret void" : `ret ${t} ${result}`);
    this.out.push(`define internal ${kind === "drop" ? "void" : t} ${name}(${t} %v) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUp(saved);
    return name;
  }


  // Whether two values of one compound type are equal, part by part, through the function made
  // for the type, which a type holding itself calls again.
  deepEquals(this: Mut<this>, a: string, b: string, type: Type): string {
    let name = this.comparers.get(type);
    if ((name === undefined || name === "")) {
      const described2 = this.tables.typing.described(type);
      name = `@fsh.eq.${this.stableId("eq", described2, typeOwner(type))}`;
      this.comparers.set(type, name);
      const saved = this.setAside();
      const t = this.llvm(type);
      const line = `ret i1 ${this.compareParts("%a", "%b", type as Exclude<Type, string>)}`;
      this.emit(line);
      this.out.push(`define internal i1 ${name}(${t} %a, ${t} %b) {`);
      this.out.push("entry:");
      for (const pushed of this.allocas) this.out.push(pushed);
      for (const pushed of this.body) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
      this.takeUp(saved);
    }
    const result = this.temp();
    this.emit(`${result} = call i1 ${name}(${this.llvm(type)} ${a}, ${this.llvm(type)} ${b})`);
    return result;
  }


  // Whether every part of two values of a compound type is equal.
  compareParts(this: Mut<this>, a: string, b: string, type: Exclude<Type, string>): string {
    const r = this.tables.typing.rec(type);
    const both = (cg: Mut<Codegen>, x: string, y: string, t: Type) => cg.conversions().equals(x, t, y, t);
    const all = (cg: Mut<Codegen>, results: string[]) => results.reduce((acc, r) => {
      if (acc === "true") return r;
      const next = cg.temp();
      cg.emit(`${next} = and i1 ${acc}, ${r}`);
      return next;
    }, "true");
    if (r.kind === "recursive") {
      const [x, y] = [this.temp(), this.temp()];
      this.emit(`${x} = load ${this.llvm(r.of)}, ptr ${a}`);
      this.emit(`${y} = load ${this.llvm(r.of)}, ptr ${b}`);
      return both(this, x, y, r.of);
    }
    if (r.kind === "array" || r.kind === "fixed") {
      // Element by element in a loop, once the lengths agree.
      const element = this.llvm(r.element);
      const result = this.alloca("i1");
      this.emit(`store i1 true, ptr ${result}`);
      const [length, other, data, otherData] = [this.temp(), this.temp(), this.temp(), this.temp()];
      if (r.kind === "array") {
        this.emit(`${length} = extractvalue ${ARRAY} ${a}, 1`);
        this.emit(`${other} = extractvalue ${ARRAY} ${b}, 1`);
        this.emit(`${data} = extractvalue ${ARRAY} ${a}, 0`);
        this.emit(`${otherData} = extractvalue ${ARRAY} ${b}, 0`);
      } else {
        const [sa, sb] = [this.alloca(this.llvm(type)), this.alloca(this.llvm(type))];
        this.emit(`store ${this.llvm(type)} ${a}, ptr ${sa}`);
        this.emit(`store ${this.llvm(type)} ${b}, ptr ${sb}`);
        this.emit(`${length} = add i64 0, ${r.size}`);
        this.emit(`${other} = add i64 0, ${r.size}`);
        this.emit(`${data} = getelementptr ${this.llvm(type)}, ptr ${sa}, i32 0, i32 0`);
        this.emit(`${otherData} = getelementptr ${this.llvm(type)}, ptr ${sb}, i32 0, i32 0`);
      }
      const same = this.temp();
      this.emit(`${same} = icmp eq i64 ${length}, ${other}`);
      const index = this.alloca("i64");
      this.emit(`store i64 0, ptr ${index}`);
      const [head, loop, differ, done] = [this.label(), this.label(), this.label(), this.label()];
      this.emit(`br i1 ${same}, label %${head}, label %${differ}`);
      this.startBlock(head);
      const [i, more] = [this.temp(), this.temp()];
      this.emit(`${i} = load i64, ptr ${index}`);
      this.emit(`${more} = icmp ult i64 ${i}, ${length}`);
      this.emit(`br i1 ${more}, label %${loop}, label %${done}`);
      this.startBlock(loop);
      const [at, bt, x, y, next] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
      this.emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
      this.emit(`${bt} = getelementptr ${element}, ptr ${otherData}, i64 ${i}`);
      this.emit(`${x} = load ${element}, ptr ${at}`);
      this.emit(`${y} = load ${element}, ptr ${bt}`);
      const equal = both(this, x, y, r.element);
      this.emit(`${next} = add i64 ${i}, 1`);
      this.emit(`store i64 ${next}, ptr ${index}`);
      this.emit(`br i1 ${equal}, label %${head}, label %${differ}`);
      this.startBlock(differ);
      this.emit(`store i1 false, ptr ${result}`);
      this.emit(`br label %${done}`);
      this.startBlock(done);
      const out = this.temp();
      this.emit(`${out} = load i1, ptr ${result}`);
      return out;
    }
    // An instance compares through its class's `equals`, which takes the other by reference.
    const own = r.kind === "class" ? this.tables.equalities.get(type as ClassType) : undefined;
    if (own !== undefined) {
      const [x, y] = [this.alloca(this.llvm(type)), this.alloca(this.llvm(type))];
      this.emit(`store ${this.llvm(type)} ${a}, ptr ${x}`);
      this.emit(`store ${this.llvm(type)} ${b}, ptr ${y}`);
      const part = this.bodyAt(own).owner!;
      const upcast2 = this.upcast(x, type as ClassType, part);
      const part2 = this.bodyAt(own).owner!;
      const list = [`ptr ${this.upcast(y, type as ClassType, part2)}`];
      return this.invoke(own, upcast2, list)!;
    }
    // An object, an instance or an enum's member: its fields, a base first.
    const parts = r.kind === "class" && r.base !== undefined ? [[r.base, 0] as const, ...r.fields.map((f, i) => [f.type, i + 1] as const)] : r.fields.map((f, i) => [f.type, i] as const);
    const map2 = parts.map(([t, i]) => {
      const [x, y] = [this.temp(), this.temp()];
      this.emit(`${x} = extractvalue ${this.llvm(type)} ${a}, ${i}`);
      this.emit(`${y} = extractvalue ${this.llvm(type)} ${b}, ${i}`);
      return both(this, x, y, t);
    });
    return all(this, map2);
  }


  // `JSON.stringify(x)`: x written into a new writer, whose text becomes the string.
  stringifyCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const x: Ref<Expr> = e.args[0]!;
    const v = this.value(x);
    const w = this.temp();
    this.emit(`${w} = call ptr @fsh_rt_json_new()`);
    const part = this.cur().spelled?.get(x) ?? this.cur().coercions.get(x) ?? this.cur().types.get(x)!;
    this.jsonWrite(w, v, part);
    const result = this.temp();
    this.emit(`${result} = call ptr @fsh_rt_json_done(ptr ${w})`);
    if (!this.cur().types.has(e)) this.pending.push({ v: result, type: "string" });
    return result;
  }


  // Writes a value as JSON, through the function made for its type when it has parts.
  // The type as written is kept beside the lowered one, which forgets how a field was
  // spelled: an empty `x?: T` is left out, as JavaScript leaves out an undefined field.
  jsonWrite(this: Mut<this>, w: string, v: string, type: Type): void {
    const t = this.tables.typing.lower(type);
    if (typeof t === "string" || this.tables.typing.rec(t).kind === "literal") {
      this.jsonScalar(w, v, t);
      return;
    }
    const written = this.asWritten(type);
    let name = this.jsonWriters.get(written);
    if ((name === undefined || name === "")) {
      const described2 = this.tables.typing.described(written);
      name = `@fsh.json.${this.stableId("json", described2, typeOwner(written))}`;
      this.jsonWriters.set(written, name);
      const saved = this.setAside();
      this.jsonParts("%w", "%v", t, written);
      this.emit("ret void");
      this.out.push(`define internal void ${name}(ptr %w, ${this.llvm(t)} %v) {`);
      this.out.push("entry:");
      for (const pushed of this.allocas) this.out.push(pushed);
      for (const pushed of this.body) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
      this.takeUp(saved);
    }
    this.emit(`call void ${name}(ptr ${w}, ${this.llvm(t)} ${v})`);
  }


  jsonRaw(this: Mut<this>, w: string, s: string) {
    const line = `call void @fsh_rt_json_raw(ptr ${w}, ptr ${this.cString(s)}, i64 ${new TextEncoder().encode(s).length})`;
    this.emit(line);
  }


  jsonScalar(this: Mut<this>, w: string, v: string, t: Type) {
    const literal = this.recOf(t);
    if (literal?.kind === "literal") {
      this.jsonRaw(w, typeof literal.value === "string" ? JSON.stringify(literal.value) : literalText(literal.value));
      return;
    }
    if (t === "null") {
      this.jsonRaw(w, "null");
      return;
    }
    if (t === "string") {
      this.emit(`call void @fsh_rt_json_string(ptr ${w}, ptr ${v})`);
      return;
    }
    if (t === "boolean") {
      const [yes, no, done] = [this.label(), this.label(), this.label()];
      this.emit(`br i1 ${v}, label %${yes}, label %${no}`);
      this.startBlock(yes);
      this.jsonRaw(w, "true");
      this.emit(`br label %${done}`);
      this.startBlock(no);
      this.jsonRaw(w, "false");
      this.emit(`br label %${done}`);
      this.startBlock(done);
      return;
    }
    if (isFloat(t)) {
      let wide = v;
      if (t === "f32") {
        wide = this.temp();
        this.emit(`${wide} = fpext float ${v} to double`);
      }
      this.emit(`call void @fsh_rt_json_f64(ptr ${w}, double ${wide}, i32 ${t === "f32" ? 1 : 0})`);
      return;
    }
    const { bits, signed } = integerInfo(t as Integer);
    if (bits === 128) {
      this.emit(`call void @fsh_rt_json_${signed ? "i" : "u"}128(ptr ${w}, i128 ${v})`);
      return;
    }
    let wide = v;
    if (bits < 64) {
      wide = this.temp();
      this.emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
    }
    this.emit(`call void @fsh_rt_json_${signed ? "i64" : "u64"}(ptr ${w}, i64 ${wide})`);
  }


  // The parts of a value with them: an array's elements, an object's fields by name, an
  // instance's fields as declared, a base's first, a union's member, an enum's member tagged by
  // its name as serde writes it.
  // A type parameter's type as written, or the type itself.
  asWritten(t: Type): Type {
    const r = this.recOf(t);
    return r?.kind === "param" && r.concrete !== undefined ? this.asWritten(r.concrete) : t;
  }


  // A part of `written` where `lowered` has the same shape, so its spelling can be read.
  writtenPart(this: Mut<this>, written: Type, lowered: Exclude<Type, string>, part: (cg: Mut<Codegen>, t: Exclude<Type, string>) => Type | undefined): Type | undefined {
    return typeof written !== "string" && this.tables.typing.rec(written).kind === this.tables.typing.rec(lowered).kind ? part(this, written) : undefined;
  }


  // The class `written` spells where `lowered` is a class, or `lowered` itself.
  classShape(written: Type, lowered: Exclude<Type, string>): ClassType {
    const shaped = this.writtenShape(written, lowered);
    return (shaped !== undefined ? shaped : lowered) as ClassType;
  }

  // The record of `written` where it has the same shape as `lowered`.
  writtenShape(written: Type, lowered: Exclude<Type, string>) {
    const r = this.recOf(written);
    return r?.kind === this.tables.typing.rec(lowered).kind ? (written as Exclude<Type, string>) : undefined;
  }


  // A union's members as written, each beside the lowered member it lowers to: members sort by
  // their keys, which spelling changes, so a written member may sit at another index.
  writtenMembers(this: Mut<this>, written: Type, t: UnionType): Type[] {
    const spelled = this.writtenShape(written, t) as UnionType | undefined;
    let as: Type[] = [];
    if (spelled !== undefined) {
      const written2 = this.tables.typing.rec(spelled).members;
      for (const s of written2) as.push(s);
    }
    let out: Type[] = [];
    const lowered = this.tables.typing.rec(t).members;
    for (const m of lowered) {
      let found: Type | undefined = undefined;
      for (const s of as) if (found === undefined && this.tables.typing.lower(s) === m) found = s;
      out.push(found !== undefined ? found : m);
    }
    return out;
  }


  jsonParts(this: Mut<this>, w: string, v: string, t: Exclude<Type, string>, written: Type = t) {
    const r = this.tables.typing.rec(t);
    if (r.kind === "ref" || r.kind === "recursive") {
      const to = r.kind === "ref" ? r.to : r.of;
      const held = this.temp();
      const lower2 = this.tables.typing.lower(to);
      const line = `${held} = load ${this.llvm(lower2)}, ptr ${v}`;
      this.emit(line);
      const part = this.writtenPart(written, t, (cg, x) => { const held = cg.tables.typing.rec(x); return held.kind === "ref" ? held.to : undefined; }) ?? to;
      this.jsonWrite(w, held, part);
      return;
    }
    if (r.kind === "array" || r.kind === "fixed") {
      const part2 = this.writtenPart(written, t, (cg, x) => cg.tables.typing.rec(x as ArrayType).element) ?? r.element;
      this.jsonElements(w, v, t as ArrayType | FixedType, part2);
      return;
    }
    if (r.kind === "map") {
      const part3 = this.writtenPart(written, t, (cg, x) => cg.tables.typing.rec(x as MapType).value) ?? r.value;
      this.jsonEntries(w, v, t as MapType, part3);
      return;
    }
    if (r.kind === "union") {
      const writtenMembers2 = this.writtenMembers(written, t as UnionType);
      this.jsonMember(w, v, t as UnionType, writtenMembers2);
      return;
    }
    if (r.kind === "variant") {
      if (r.fields.length === 0) {
        this.jsonRaw(w, JSON.stringify(r.member));
        return;
      }
      this.jsonRaw(w, `{${JSON.stringify(r.member)}:`);
      if (r.fields.length > 1) this.jsonRaw(w, "[");
      let iAt: usize = 0;
      for (const f of r.fields) {
        const i = iAt;
        iAt++;
        if (i > 0) this.jsonRaw(w, ",");
        const x = this.temp();
        this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${i}`);
        this.jsonWrite(w, x, f.type);
      }
      this.jsonRaw(w, r.fields.length > 1 ? "]}" : "}");
      return;
    }
    if (r.kind === "class") {
      this.jsonObject(w, v, t as ClassType, this.jsonFields(this.classShape(written, t)));
      return;
    }
    const object = t as ObjectType;
    const spelled = this.writtenShape(written, t) as ObjectType | undefined;
    const as = this.recOf(spelled)?.fields.length === this.tables.typing.rec(object).fields.length ? this.tables.typing.rec(spelled!).fields : this.tables.typing.rec(object).fields;
    if (this.tables.typing.isTuple(object)) {
      const [order, rest] = this.tupleOrder(object);
      const length = this.tables.typing.rec(object).required === undefined ? undefined : this.tupleLength(v, object);
      const many = (cg: Mut<Codegen>) => {
        const x = cg.temp();
        cg.emit(`${x} = extractvalue ${cg.llvm(t)} ${v}, ${rest!.i}`);
        return x;
      };
      if (rest !== undefined && order.length === 0) {
        const many2 = many(this);
        this.jsonElements(w, many2, rest.f.type as ArrayType, this.tables.typing.rec(as[rest.i]!.type as ArrayType).element);
        return;
      }
      this.jsonRaw(w, "[");
      let nAt: usize = 0;
      for (const { i } of order) {
        const n = nAt;
        nAt++;
        this.present(length, n as usize, (cg) => {
          if (n > 0) cg.jsonRaw(w, ",");
          const x = cg.temp();
          cg.emit(`${x} = extractvalue ${cg.llvm(t)} ${v}, ${i}`);
          cg.jsonWrite(w, x, as[i]!.type);
        });
      }
      if (rest !== undefined) {
        const many3 = many(this);
        this.jsonElements(w, many3, rest.f.type as ArrayType, this.tables.typing.rec(as[rest.i]!.type as ArrayType).element, true);
      }
      this.jsonRaw(w, "]");
      return;
    }
    this.jsonObject(w, v, t, this.objectJsonFields(object, as));
  }


  // A class's fields JSON writes, a base's first, each with where it sits in the instance.
  // An object's fields as JSON writes them, typed and marked optional as the object was written.
  objectJsonFields(object: ObjectType, as: Ref<Field[]>): JsonField[] {
    let out: JsonField[] = [];
    const count = this.tables.typing.rec(object).fields.length;
    for (let i: usize = 0; i < count; i++) out.push({ name: this.tables.typing.rec(object).fields[i]!.name, type: as[i]!.type, path: [i], omit: as[i]!.optional !== undefined });
    return out;
  }


  jsonFields(c: ClassType): JsonField[] {
    const base = this.tables.typing.rec(c).base;
    let out: JsonField[] = [];
    if (base !== undefined) for (const f of this.jsonFields(base)) out.push({ name: f.name, type: f.type, path: [0, ...f.path], omit: f.omit });
    const own = this.ownJsonFields(c, base !== undefined ? 1 : 0);
    for (const f of own) out.push({ name: f.name, type: f.type, path: [...f.path], omit: f.omit });
    return out;
  }


  // Where an instance of a class extending Map or Set, itself or through its bases, holds the
  // collection, which it prints as.
  embeddedField(this: Mut<this>, c: ClassType): { path: usize[]; type: MapType } | undefined {
    const r = this.tables.typing.rec(c);
    const offset = r.base !== undefined ? 1 : 0;
    const i = r.fields.findIndex((f) => f.name === EMBEDDED);
    if (i >= 0) return { path: [(offset + i) as usize], type: this.tables.typing.lower(r.fields[i as usize]!.type) as MapType };
    const inner = (r.base !== undefined ? this.embeddedField(r.base) : undefined);
    return (inner !== undefined ? { ...inner, path: [0, ...inner.path] } : undefined);
  }


  ownJsonFields(c: ClassType, offset: usize): JsonField[] {
    let out: JsonField[] = [];
    const fields = this.tables.typing.rec(c).fields;
    for (let i: usize = 0; i < fields.length; i++) {
      const f: Ref<Field> = fields[i]!;
      if (!f.name.startsWith("#")) out.push({ name: f.name, type: f.type, path: [offset + i], omit: f.optional !== undefined });
    }
    return out;
  }


  // An object's fields; one spelled `x?: T` is left out while empty, so whether a comma is
  // needed is known only as the fields are written.
  jsonObject(this: Mut<this>, w: string, v: string, t: Type, fields: Ref<JsonField[]>) {
    this.jsonRaw(w, "{");
    const dynamic = fields.some((f) => f.omit === true);
    const wrote = dynamic ? this.alloca("i1") : "";
    if (dynamic) this.emit(`store i1 false, ptr ${wrote}`);
    let nAt: usize = 0;
    for (const f of fields) {
      const n = nAt;
      nAt++;
      const x = this.temp();
      this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${f.path.join(", ")}`);
      const after = this.label();
      if (f.omit === true) {
        const lower2 = this.tables.typing.lower(f.type) as UnionType;
        const lower3 = this.tables.typing.lower(f.type) as UnionType;
        const filter2 = this.tables.typing.rec(lower3).members.filter((m) => m !== "null");
        const [present, write] = [this.conversions().holds(x, lower2, filter2), this.label()];
        this.emit(`br i1 ${present}, label %${write}, label %${after}`);
        this.startBlock(write);
      }
      const key = `${JSON.stringify(f.name)}:`;
      if (!dynamic) this.jsonRaw(w, `${n > 0 ? "," : ""}${key}`);
      else {
        const [was, comma, bare] = [this.temp(), this.label(), this.label()];
        this.emit(`${was} = load i1, ptr ${wrote}`);
        this.emit(`br i1 ${was}, label %${comma}, label %${bare}`);
        this.startBlock(comma);
        this.jsonRaw(w, ",");
        this.emit(`br label %${bare}`);
        this.startBlock(bare);
        this.jsonRaw(w, key);
        this.emit(`store i1 true, ptr ${wrote}`);
      }
      this.jsonWrite(w, x, f.type);
      this.emit(`br label %${after}`);
      this.startBlock(after);
    }
    this.jsonRaw(w, "}");
  }


  // `bare` writes the elements alone, each after a comma, as a rest tuple's follow its fixed ones.
  jsonElements(this: Mut<this>, w: string, v: string, t: ArrayType | FixedType, written: Type, bare = false) {
    const lower2 = this.tables.typing.lower(this.tables.typing.rec(t).element);
    const element = this.llvm(lower2);
    const [length, data] = [this.temp(), this.temp()];
    if (this.tables.typing.rec(t).kind === "array") {
      this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
    } else {
      const slot = this.alloca(this.llvm(t));
      this.emit(`store ${this.llvm(t)} ${v}, ptr ${slot}`);
      this.emit(`${length} = add i64 0, ${this.tables.typing.rec(t as FixedType).size}`);
      this.emit(`${data} = getelementptr ${this.llvm(t)}, ptr ${slot}, i32 0, i32 0`);
    }
    if (!bare) this.jsonRaw(w, "[");
    const index = this.alloca("i64");
    this.emit(`store i64 0, ptr ${index}`);
    const [head, loop, comma, item, done] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${length}`);
    this.emit(`br i1 ${more}, label %${loop}, label %${done}`);
    this.startBlock(loop);
    const first = bare ? "false" : this.temp();
    if (!bare) this.emit(`${first} = icmp eq i64 ${i}, 0`);
    this.emit(`br i1 ${first}, label %${item}, label %${comma}`);
    this.startBlock(comma);
    this.jsonRaw(w, ",");
    this.emit(`br label %${item}`);
    this.startBlock(item);
    const [at, x, next] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
    this.emit(`${x} = load ${element}, ptr ${at}`);
    this.jsonWrite(w, x, written);
    this.emit(`${next} = add i64 ${i}, 1`);
    this.emit(`store i64 ${next}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    if (!bare) this.jsonRaw(w, "]");
  }


  // The string `console.log` prints for a value: its tree, laid out by the runtime.
  inspected(this: Mut<this>, v: string, type: Type): string {
    const tree = this.inspectTree(v, type);
    const text = this.temp();
    this.emit(`${text} = call ptr @fsh_rt_insp_done(ptr ${tree})`);
    return text;
  }


  // util.format's call: each argument described for the runtime's routine, which formats them.
  formatted(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const n = e.args.length;
    const slots = this.alloca(`[${n} x ${FARG}]`);
    const needs = this.formatNeeds(e.args);
    let iAt: usize = 0;
    for (const a of e.args) {
      const i = iAt;
      iAt++;
      const v = a.kind === "string" ? this.text(a.value) : this.operand(a, e.args, (i + 1) as usize);
      const at = this.temp();
      this.emit(`${at} = getelementptr [${n} x ${FARG}], ptr ${slots}, i32 0, i32 ${i}`);
      this.describe(at, v, this.printedType(a), needs[i as usize]!);
    }
    const result = this.temp();
    const line = `call ptr @fsh_rt_format(ptr ${slots}, i64 ${n}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
    this.unwinding(line, result);
    if (!this.cur().types.has(e)) this.pending.push({ v: result, type: "string" });
    return result;
  }


  printedType(a: Ref<Expr>): Type {
    return a.kind === "string" ? "string" : (this.cur().spelled?.get(a) ?? this.valueType(a));
  }


  // Whether a first argument may be a format, a string with more arguments after it, as Node
  // formats one: a literal holding a percent sign, or a string known only at run time.
  formats(this: Mut<this>, args: Ref<Expr[]>): boolean {
    if (args.length < 2) return false;
    const first: Ref<Expr> = args[0]!;
    if (first.kind === "string") return first.value.includes("%");
    const t = this.tables.typing.lower(this.printedType(first));
    const text = (cg: Mut<Codegen>, m: Type) => {
      const r = cg.recOf(m);
      return m === "string" || (r?.kind === "literal" && typeof r.value === "string");
    };
    const r = this.recOf(t);
    return text(this, t) || (r?.kind === "union" && r.members.some((m) => text(this, m)));
  }


  // What each argument's description needs: a literal format says which specifier takes each,
  // so only that is built; one read at run time may ask anything of any.
  formatNeeds(this: Mut<this>, args: Ref<Expr[]>): { text: boolean; depth: i64 }[] {
    const format = args.length >= 2 && args[0]!.kind === "string" ? textOf(args[0]!) : undefined;
    if (format === undefined) {
      const inspected = !this.formats(args);
      return args.map(() => (inspected ? { text: false, depth: 2 } : { text: true, depth: 4 }));
    }
    const { specs, rest } = formatPlan(format, args.length);
    const DEPTHS: Record<string, i64> = { s: 0, O: 2, o: 4 };
    return args.map((_, i) => {
      if (i === 0 || (i as usize) >= rest) return { text: false, depth: 2 };
      const spec = specs[(i - 1) as usize]!;
      return { text: "dif".includes(spec), depth: DEPTHS[spec] ?? -1 };
    });
  }


  // An argument's description: its kind and value, and for a value with parts its String(x) when
  // `need.text` and its inspect tree, cut at `need.depth`, when that isn't -1. A union is
  // described by its member.
  describe(this: Mut<this>, at: string, v: string, type: Type, need: Ref<{ text: boolean; depth: i64 }>): void {
    const t = this.tables.typing.lower(type);
    const r = this.recOf(t);
    const put = (cg: Mut<Codegen>, index: usize, of: string, x: string) => {
      const p = cg.temp();
      cg.emit(`${p} = getelementptr ${FARG}, ptr ${at}, i32 0, i32 ${index}`);
      cg.emit(`store ${of} ${x}, ptr ${p}`);
    };
    const whole = (cg: Mut<Codegen>, kind: i32, x: string) => {
      put(cg, 0, "i32", String(kind));
      put(cg, 1, "i64", x);
    };
    if (r?.kind === "union") {
      const members = this.writtenMembers(type, t as UnionType);
      const tag = this.temp();
      this.emit(`${tag} = extractvalue ${this.llvm(t)} ${v}, 0`);
      const cases = r.members.map(() => this.label());
      const end = this.label();
      this.emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      let iAt: usize = 0;
      for (const m of r.members) {
        const i = iAt;
        iAt++;
        this.startBlock(cases[i as usize]!);
        const convert2 = this.convert(v, t, m);
        this.describe(at, convert2, members[i as usize]!, need);
        this.emit(`br label %${end}`);
      }
      this.startBlock(end);
      return;
    }
    if (r?.kind === "literal") {
      const x = r.value;
      if (typeof x === "string") {
        put(this, 0, "i32", String(FARG_KINDS.string));
        const text2 = this.text(x);
        put(this, 3, "ptr", text2);
      } else if (typeof x === "boolean") whole(this, FARG_KINDS.boolean, x ? "1" : "0");
      else whole(this, FARG_KINDS.int as i32, String(x));
      return;
    }
    if (t === "string") {
      put(this, 0, "i32", String(FARG_KINDS.string));
      put(this, 3, "ptr", v);
    } else if (t === "boolean") {
      const x = this.temp();
      this.emit(`${x} = zext i1 ${v} to i64`);
      whole(this, FARG_KINDS.boolean as i32, x);
    } else if (t === "null" || t === "void" || t === "never") put(this, 0, "i32", String(FARG_KINDS.null));
    else if (isFloat(t)) {
      let x = v;
      if (t === "f32") {
        x = this.temp();
        this.emit(`${x} = fpext float ${v} to double`);
      }
      whole(this, FARG_KINDS.float as i32, t === "f32" ? "1" : "0");
      put(this, 2, "double", x);
    } else if (t === "bigint" || (isInteger(t) && integerInfo(t).bits === 128)) {
      put(this, 0, "i32", String(t === "bigint" ? FARG_KINDS.bigint : FARG_KINDS.digits));
      // Made inside a union member's block, the text is freed by the runtime once read, as a
      // value with parts' is.
      const digits = this.temp();
      if (t === "bigint") this.emit(`${digits} = call ptr @fsh_rt_big_text(ptr ${v}, i64 10)`);
      else this.emit(`${digits} = call ptr @fsh_rt_str_from_${integerInfo(t as Integer).signed ? "i" : "u"}128(i128 ${v})`);
      put(this, 3, "ptr", digits);
      put(this, 4, "ptr", "null");
    } else if (isInteger(t)) {
      const { bits, signed } = integerInfo(t);
      let x = v;
      if (bits < 64) {
        x = this.temp();
        this.emit(`${x} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      whole(this, signed ? FARG_KINDS.int : FARG_KINDS.uint, x);
    } else {
      put(this, 0, "i32", String(FARG_KINDS.parts));
      const chosen = need.text ? this.jsText(v, type) : "null";
      put(this, 3, "ptr", chosen);
      const chosen2 = need.depth >= 0 ? this.inspectTree(v, type, String(2 - need.depth)) : "null";
      put(this, 4, "ptr", chosen2);
    }
  }


  // JavaScript's String(x) of a value with parts, a new string: an array's elements joined by
  // commas, an empty one's as nothing; an object or instance is `[object Object]`.
  jsText(this: Mut<this>, v: string, type: Type): string {
    const [b, s] = [this.temp(), this.temp()];
    this.emit(`${b} = call ptr @fsh_rt_text_new()`);
    this.jsTextInto(b, v, type);
    this.emit(`${s} = call ptr @fsh_rt_text_done(ptr ${b})`);
    return s;
  }


  jsTextInto(this: Mut<this>, b: string, v: string, type: Type): void {
    const t = this.tables.typing.lower(type);
    const raw = (cg: Mut<Codegen>, s: string) => {
      const line = `call void @fsh_rt_text_raw(ptr ${b}, ptr ${cg.cString(s)})`;
      cg.emit(line);
    };
    const literal = this.recOf(t);
    if (literal?.kind === "literal") {
      raw(this, literalText(literal.value));
      return;
    }
    if (t === "string") {
      this.emit(`call void @fsh_rt_text_add(ptr ${b}, ptr ${v})`);
      return;
    }
    if (t === "null" || t === "void" || t === "never") return;
    if (t === "boolean") {
      const word = this.temp();
      const line2 = `${word} = select i1 ${v}, ptr ${this.cString("true")}, ptr ${this.cString("false")}`;
      this.emit(line2);
      this.emit(`call void @fsh_rt_text_raw(ptr ${b}, ptr ${word})`);
      return;
    }
    if (isFloat(t)) {
      this.emit(`call void @fsh_rt_text_${t}(ptr ${b}, ${this.llvm(t)} ${v})`);
      return;
    }
    if (t === "bigint") {
      const digits = this.temp();
      this.emit(`${digits} = call ptr @fsh_rt_big_text(ptr ${v}, i64 10)`);
      this.emit(`call void @fsh_rt_text_add(ptr ${b}, ptr ${digits})`);
      this.emit(`call void @fsh_rt_str_release(ptr ${digits})`);
      return;
    }
    if (isInteger(t)) {
      const { bits, signed } = integerInfo(t);
      if (bits === 128) {
        this.emit(`call void @fsh_rt_text_${signed ? "i" : "u"}128(ptr ${b}, i128 ${v})`);
        return;
      }
      let x = v;
      if (bits < 64) {
        x = this.temp();
        this.emit(`${x} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      this.emit(`call void @fsh_rt_text_${signed ? "i64" : "u64"}(ptr ${b}, i64 ${x})`);
      return;
    }
    if (typeof t === "string") return;
    const r = this.tables.typing.rec(t);
    if (r.kind === "union") {
      const tag = this.temp();
      this.emit(`${tag} = extractvalue ${this.llvm(t)} ${v}, 0`);
      const cases = r.members.map(() => this.label());
      const end = this.label();
      this.emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      let iAt: usize = 0;
      for (const m of r.members) {
        const i = iAt;
        iAt++;
        this.startBlock(cases[i as usize]!);
        const convert2 = this.convert(v, t, m);
        this.jsTextInto(b, convert2, m);
        this.emit(`br label %${end}`);
      }
      this.startBlock(end);
      return;
    }
    if (r.kind === "map") {
      raw(this, r.set ? "[object Set]" : r.dict === true ? "[object Object]" : "[object Map]");
      return;
    }
    if (r.kind === "regex") {
      raw(this, `/${r.source}/${r.flags}`);
      return;
    }
    if (r.kind !== "array" && r.kind !== "fixed" && r.kind !== "ref" && r.kind !== "recursive" && !(r.kind === "object" && this.tables.typing.isTuple(t))) {
      raw(this, "[object Object]");
      return;
    }
    let name = this.stringers.get(t);
    if ((name === undefined || name === "")) {
      const described2 = this.tables.typing.described(t);
      name = `@fsh.text.${this.stableId("text", described2, typeOwner(t))}`;
      this.stringers.set(t, name);
      const saved = this.setAside();
      this.jsTextParts("%b", "%v", t);
      this.emit("ret void");
      this.out.push(`define internal void ${name}(${this.llvm(t)} %v, ptr %b) {`);
      this.out.push("entry:");
      for (const pushed of this.allocas) this.out.push(pushed);
      for (const pushed of this.body) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
      this.takeUp(saved);
    }
    this.emit(`call void ${name}(${this.llvm(t)} ${v}, ptr ${b})`);
  }


  // What an array, a tuple or a reference writes for String(x).
  jsTextParts(this: Mut<this>, b: string, v: string, t: Exclude<Type, string>) {
    const r = this.tables.typing.rec(t);
    if (r.kind === "ref" || r.kind === "recursive") {
      const to = r.kind === "ref" ? r.to : r.of;
      const held = this.temp();
      const lower2 = this.tables.typing.lower(to);
      const line = `${held} = load ${this.llvm(lower2)}, ptr ${v}`;
      this.emit(line);
      this.jsTextInto(b, held, to);
      return;
    }
    const comma = (cg: Mut<Codegen>) => {
      const line2 = `call void @fsh_rt_text_raw(ptr ${b}, ptr ${cg.cString(",")})`;
      cg.emit(line2);
    };
    if (r.kind === "object") {
      const [order, rest] = this.tupleOrder(t as ObjectType);
      const length = r.required === undefined ? undefined : this.tupleLength(v, t as ObjectType);
      for (let n: usize = 0; n < order.length; n++) {
        const i = order[n]!.i;
        const part = order[n]!.f.type;
        this.present(length, n, (cg) => {
          if (n > 0) comma(cg);
          const x = cg.temp();
          cg.emit(`${x} = extractvalue ${cg.llvm(t)} ${v}, ${i}`);
          cg.jsTextInto(b, x, part);
        });
      }
      if (rest === undefined) return;
      const many = this.temp();
      this.emit(`${many} = extractvalue ${this.llvm(t)} ${v}, ${rest.i}`);
      this.jsElements(b, many, rest.f.type as ArrayType, order.length > 0);
      return;
    }
    if (r.kind === "array" || r.kind === "fixed") {
      this.jsElements(b, v, t as ArrayType | FixedType, false);
      return;
    }
  }


  // An array's elements, each after a comma but the first unless `after` says one came before.
  jsElements(this: Mut<this>, b: string, v: string, t: ArrayType | FixedType, after: boolean) {
    const lower2 = this.tables.typing.lower(this.tables.typing.rec(t).element);
    const element = this.llvm(lower2);
    const [length, data] = [this.temp(), this.temp()];
    if (this.tables.typing.rec(t).kind === "array") {
      this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
    } else {
      const slot = this.alloca(this.llvm(t));
      this.emit(`store ${this.llvm(t)} ${v}, ptr ${slot}`);
      this.emit(`${length} = add i64 0, ${this.tables.typing.rec(t as FixedType).size}`);
      this.emit(`${data} = getelementptr ${this.llvm(t)}, ptr ${slot}, i32 0, i32 0`);
    }
    const index = this.alloca("i64");
    this.emit(`store i64 0, ptr ${index}`);
    const [head, loop, separate, write, done] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${length}`);
    this.emit(`br i1 ${more}, label %${loop}, label %${done}`);
    this.startBlock(loop);
    const first = this.temp();
    this.emit(`${first} = icmp eq i64 ${i}, 0`);
    this.emit(`br i1 ${after ? "false" : first}, label %${write}, label %${separate}`);
    this.startBlock(separate);
    const line = `call void @fsh_rt_text_raw(ptr ${b}, ptr ${this.cString(",")})`;
    this.emit(line);
    this.emit(`br label %${write}`);
    this.startBlock(write);
    const [at, x, next] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
    this.emit(`${x} = load ${element}, ptr ${at}`);
    this.jsTextInto(b, x, this.tables.typing.rec(t).element);
    this.emit(`${next} = add i64 ${i}, 1`);
    this.emit(`store i64 ${next}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
  }


  // A value's tree for the runtime's layout, through the function made for its type when it
  // has parts. The type as written is kept beside the lowered one, for how fields were spelled.
  // `depth` is how deep in the printed value this one sits, as Node counts it.
  inspectTree(this: Mut<this>, v: string, type: Type, depth = "0"): string {
    const t = this.tables.typing.lower(type);
    if (typeof t === "string" || this.tables.typing.rec(t).kind === "literal") return this.inspectScalar(v, t);
    const written = this.asWritten(type);
    let name = this.inspectors.get(written);
    if ((name === undefined || name === "")) {
      const described2 = this.tables.typing.described(written);
      name = `@fsh.insp.${this.stableId("insp", described2, typeOwner(written))}`;
      this.inspectors.set(written, name);
      const saved = this.setAside();
      const line = `ret ptr ${this.inspectParts("%v", t, written)}`;
      this.emit(line);
      this.out.push(`define internal ptr ${name}(${this.llvm(t)} %v, i64 %d) {`);
      this.out.push("entry:");
      for (const pushed of this.allocas) this.out.push(pushed);
      for (const pushed of this.body) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
      this.takeUp(saved);
    }
    const node = this.temp();
    this.emit(`${node} = call ptr ${name}(${this.llvm(t)} ${v}, i64 ${depth})`);
    return node;
  }


  inspectScalar(this: Mut<this>, v: string, t: Type): string {
    const node = this.temp();
    const literal = this.recOf(t);
    if (literal?.kind === "literal") {
      const { value } = literal;
      if (typeof value === "string") {
        const line = `${node} = call ptr @fsh_rt_insp_string(ptr ${this.text(value)})`;
        this.emit(line);
      } else if (typeof value === "bigint") this.emit(`${node} = call ptr @fsh_rt_insp_i64(i64 ${value})`);
      else {
        const line2 = `${node} = call ptr @fsh_rt_insp_text(ptr ${this.cString(String(value))})`;
        this.emit(line2);
      }
      return node;
    }
    if (t === "null" || t === "never" || t === "void") {
      const line3 = `${node} = call ptr @fsh_rt_insp_text(ptr ${this.cString("null")})`;
      this.emit(line3);
    }
    else if (t === "string") this.emit(`${node} = call ptr @fsh_rt_insp_string(ptr ${v})`);
    else if (t === "bigint") this.emit(`${node} = call ptr @fsh_rt_insp_bigint(ptr ${v})`);
    else if (t === "boolean") {
      const word = this.temp();
      const line4 = `${word} = select i1 ${v}, ptr ${this.cString("true")}, ptr ${this.cString("false")}`;
      this.emit(line4);
      this.emit(`${node} = call ptr @fsh_rt_insp_text(ptr ${word})`);
    } else if (isFloat(t)) {
      let wide = v;
      if (t === "f32") {
        wide = this.temp();
        this.emit(`${wide} = fpext float ${v} to double`);
      }
      this.emit(`${node} = call ptr @fsh_rt_insp_f64(double ${wide}, i32 ${t === "f32" ? 1 : 0})`);
    } else {
      const { bits, signed } = integerInfo(t as Integer);
      let wide = v;
      if (bits < 64) {
        wide = this.temp();
        this.emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      if (bits === 128) this.emit(`${node} = call ptr @fsh_rt_insp_${signed ? "i" : "u"}128(i128 ${v})`);
      else this.emit(`${node} = call ptr @fsh_rt_insp_${signed ? "i64" : "u64"}(i64 ${wide})`);
    }
    return node;
  }


  // The tree of a value with parts: elements, members, entries, a member's values, an object's
  // fields by name or an instance's as declared, a base's first. An empty field spelled `x?: T`
  // is left out, as Node leaves out a field that isn't there.
  inspectParts(this: Mut<this>, v: string, t: Exclude<Type, string>, written: Type): string {
    const r = this.tables.typing.rec(t);
    if (r.kind === "ref" || r.kind === "recursive") {
      const to = r.kind === "ref" ? r.to : r.of;
      const held = this.temp();
      const lower2 = this.tables.typing.lower(to);
      const line = `${held} = load ${this.llvm(lower2)}, ptr ${v}`;
      this.emit(line);
      const part = this.writtenPart(written, t, (cg, x) => { const held = cg.tables.typing.rec(x); return held.kind === "ref" ? held.to : undefined; }) ?? to;
      return this.inspectTree(held, part, "%d");
    }
    // A typed array prints as an array under its name, an ArrayBuffer as its bytes in hex.
    const typed = this.tables.typing.typedName(written);
    if (typed === "ArrayBuffer") {
      const [length, data, node] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
      this.emit(`${node} = call ptr @fsh_rt_insp_buffer(ptr ${data}, i64 ${length})`);
      return node;
    }
    const named = (cg: Mut<Codegen>, node: string) => {
      if (typed !== undefined) {
        const line2 = `call void @fsh_rt_insp_named(ptr ${node}, ptr ${cg.cString(typed)})`;
        cg.emit(line2);
      }
      return node;
    };
    // std's Date prints as its ISO string at any depth, as Node prints one.
    const iso = r.kind === "class" ? this.instances.find((i) => this.bodyAt(i).name === `${r.name}.toISOString` && this.bodyAt(i).start >= STD_BASE) : undefined;
    if (iso !== undefined) {
      const [self, text, node] = [this.alloca(this.llvm(t)), this.temp(), this.temp()];
      this.emit(`store ${this.llvm(t)} ${v}, ptr ${self}`);
      const line3 = `${text} = call ptr ${this.symbol(iso)}(ptr ${self})`;
      this.emit(line3);
      this.emit(`${node} = call ptr @fsh_rt_insp_raw(ptr ${text})`);
      return node;
    }
    // Past depth 2 Node prints a value with parts as `[Object]`, or `{}` when it has none, so
    // only its size and keys are kept, which also bounds how deep this goes.
    if (r.kind !== "union" && r.kind !== "variant") {
      const [deep, shell, full] = [this.temp(), this.label(), this.label()];
      this.emit(`${deep} = icmp sgt i64 %d, 2`);
      this.emit(`br i1 ${deep}, label %${shell}, label %${full}`);
      this.startBlock(shell);
      const inspectShell2 = this.inspectShell(v, t, written);
      const line4 = `ret ptr ${named(this, inspectShell2)}`;
      this.emit(line4);
      this.startBlock(full);
    }
    const next = this.temp();
    this.emit(`${next} = add i64 %d, 1`);
    if (r.kind === "array" || r.kind === "fixed") {
      const part2 = this.writtenPart(written, t, (cg, x) => cg.tables.typing.rec(x as ArrayType).element) ?? r.element;
      const inspectElements2 = this.inspectElements(v, t as ArrayType | FixedType, part2, next, typed === "Float32Array");
      return named(this, inspectElements2);
    }
    if (r.kind === "map") {
      const part3 = this.writtenPart(written, t, (cg, x) => cg.tables.typing.rec(x as MapType).value) ?? r.value;
      return this.inspectEntries(v, t as MapType, part3, next);
    }
    if (r.kind === "union") {
      const members = this.writtenMembers(written, t as UnionType);
      const result = this.alloca("ptr");
      const tag = this.temp();
      this.emit(`${tag} = extractvalue ${this.llvm(t)} ${v}, 0`);
      const done = this.label();
      const cases = r.members.map(() => this.label());
      this.emit(`switch i32 ${tag}, label %${done} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      let iAt: usize = 0;
      for (const m of r.members) {
        const i = iAt;
        iAt++;
        this.startBlock(cases[i as usize]!);
        const member = this.tables.typing.lower(m);
        let x = "zeroinitializer";
        if (this.recOf(member)?.kind !== "literal" && member !== "null") {
          const slot = this.alloca(this.llvm(t));
          this.emit(`store ${this.llvm(t)} ${v}, ptr ${slot}`);
          const at = this.temp();
          x = this.temp();
          this.emit(`${at} = getelementptr ${this.llvm(t)}, ptr ${slot}, i32 0, i32 1`);
          this.emit(`${x} = load ${this.llvm(member)}, ptr ${at}, align 8`);
        }
        const line5 = `store ptr ${this.inspectTree(x, members[i as usize]!, "%d")}, ptr ${result}`;
        this.emit(line5);
        this.emit(`br label %${done}`);
      }
      this.startBlock(done);
      const node = this.temp();
      this.emit(`${node} = load ptr, ptr ${result}`);
      return node;
    }
    if (r.kind === "variant") {
      const node = this.temp();
      const line6 = `${node} = call ptr @fsh_rt_insp_variant(ptr ${this.cString(r.member)})`;
      this.emit(line6);
      let iAt2: usize = 0;
      for (const f of r.fields) {
        const i = iAt2;
        iAt2++;
        const x = this.temp();
        this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${i}`);
        const line7 = `call void @fsh_rt_insp_push(ptr ${node}, ptr ${this.inspectTree(x, f.type, "%d")})`;
        this.emit(line7);
      }
      return node;
    }
    const object = t as ObjectType;
    const spelled = this.writtenShape(written, t) as ObjectType | undefined;
    const as = this.recOf(spelled)?.fields.length === this.tables.typing.rec(object).fields.length ? this.tables.typing.rec(spelled!).fields : this.tables.typing.rec(object).fields;
    if (r.kind === "object" && this.tables.typing.isTuple(object)) {
      const [order, rest] = this.tupleOrder(object);
      const length = this.tables.typing.rec(object).required === undefined ? undefined : this.tupleLength(v, object);
      const node = this.temp();
      this.emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${length !== undefined ? length : `${order.length}`})`);
      let nAt: usize = 0;
      for (const { i } of order) {
        const n = nAt;
        nAt++;
        this.present(length, n as usize, (cg) => {
          const x = cg.temp();
          cg.emit(`${x} = extractvalue ${cg.llvm(t)} ${v}, ${i}`);
          const line8 = `call void @fsh_rt_insp_push(ptr ${node}, ptr ${cg.inspectTree(x, as[i]!.type, next)})`;
          cg.emit(line8);
        });
      }
      // A rest tuple's further elements join its own, as one array.
      if (rest !== undefined) {
        const x = this.temp();
        this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${rest.i}`);
        const line9 = `call void @fsh_rt_insp_append(ptr ${node}, ptr ${this.inspectElements(x, rest.f.type as ArrayType, this.tables.typing.rec(as[rest.i]!.type as ArrayType).element, next)})`;
        this.emit(line9);
      }
      return node;
    }
    const fields = r.kind === "class" ? this.jsonFields(this.classShape(written, t)) : this.objectJsonFields(object, as);
    if (r.kind === "class" && this.errorClass(t as ClassType)) return this.errorTree(v, t as ClassType, fields, next);
    const name = r.kind === "class" ? r.name.replace(/[@<].*$/, "") : "";
    const embedded = r.kind === "class" ? this.embeddedField(t as ClassType) : undefined;
    let node = this.temp();
    if (embedded !== undefined) {
      const x = this.temp();
      this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${embedded.path.join(", ")}`);
      node = this.inspectEntries(x, embedded.type, this.tables.typing.rec(embedded.type).value, next);
      const line10 = `call void @fsh_rt_insp_named(ptr ${node}, ptr ${this.cString(name)})`;
      this.emit(line10);
    } else {
      const line11 = `${node} = call ptr @fsh_rt_insp_object(ptr ${this.cString(name)})`;
      this.emit(line11);
    }
    for (const f of fields) {
      const x = this.temp();
      this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${f.path.join(", ")}`);
      const after = this.label();
      if (f.omit === true) {
        const lower3 = this.tables.typing.lower(f.type) as UnionType;
        const lower4 = this.tables.typing.lower(f.type) as UnionType;
        const filter2 = this.tables.typing.rec(lower4).members.filter((m) => m !== "null");
        const present = this.conversions().holds(x, lower3, filter2);
        const write = this.label();
        this.emit(`br i1 ${present}, label %${write}, label %${after}`);
        this.startBlock(write);
      }
      const line12 = `call void @fsh_rt_insp_field(ptr ${node}, ptr ${this.cString(f.name)}, ptr ${this.inspectTree(x, f.type, next)})`;
      this.emit(line12);
      this.emit(`br label %${after}`);
      this.startBlock(after);
    }
    return node;
  }


  // Whether a class is the prelude's Error, or extends it.
  errorClass(t: ClassType): boolean {
    if (this.tables.typing.rec(t).generic?.name === "AggregateError") return true;
    let c: ClassType | undefined = t;
    while (c !== undefined) {
      const held: ClassRecord = this.tables.typing.rec(c);
      if (held.name === "Error" && held.generic === undefined) return true;
      c = held.base;
    }
    return false;
  }


  // An Error as Node prints one with its stack left out: its header, then the fields beyond
  // Error's own and its cause, read through what ErrorLike gives.
  // `shell`, past the depth, it keeps only whether it has more than its header to show.
  errorTree(this: Mut<this>, v: string, t: ClassType, fields: Ref<JsonField[]>, depth: string, shell = false): string {
    const blank = (cg: Mut<Codegen>) => {
      const b = cg.temp();
      const line = `${b} = call ptr @fsh_rt_insp_text(ptr ${cg.cString("")})`;
      cg.emit(line);
      return b;
    };
    const all = this.jsonFields(t);
    const read = (cg: Mut<Codegen>, name: string) => {
      const f = all.find((x) => x.name === name)!;
      const x = cg.temp();
      cg.emit(`${x} = extractvalue ${cg.llvm(t)} ${v}, ${f.path.join(", ")}`);
      return [x, f.type] as const;
    };
    const node = this.temp();
    const line2 = `${node} = call ptr @fsh_rt_insp_error(ptr ${this.cString(this.tables.typing.rec(t).name.replace(/[@<].*$/, ""))}, ptr ${read(this, "name")[0]}, ptr ${read(this, "message")[0]})`;
    this.emit(line2);
    // A JsError's JS value is left out, as printing one isn't supported yet.
    const shown = fields.filter((f) => f.name !== "name" && f.name !== "message" && f.name !== "cause" && !(this.tables.typing.rec(t).name === "JsError" && f.name === "value"));
    for (const f of shown) {
      const x = this.temp();
      this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${f.path.join(", ")}`);
      const after = this.label();
      if (f.omit === true) {
        const lower2 = this.tables.typing.lower(f.type) as UnionType;
        const lower3 = this.tables.typing.lower(f.type) as UnionType;
        const filter2 = this.tables.typing.rec(lower3).members.filter((m) => m !== "null");
        const present = this.conversions().holds(x, lower2, filter2);
        const write = this.label();
        this.emit(`br i1 ${present}, label %${write}, label %${after}`);
        this.startBlock(write);
      }
      // An AggregateError's errors are shown as Node shows them, apart from its own fields.
      const key = f.name === "errors" && this.tables.typing.rec(t).generic?.name === "AggregateError" ? "[errors]" : f.name;
      const line3 = `call void @fsh_rt_insp_field(ptr ${node}, ptr ${this.cString(key)}, ptr ${shell ? blank(this) : this.inspectTree(x, f.type, depth)})`;
      this.emit(line3);
      this.emit(`br label %${after}`);
      this.startBlock(after);
    }
    if (fields.length === 0) return node;
    const [cause, held] = read(this, "cause");
    const option = this.tables.typing.lower(held) as UnionType;
    const dyn = this.tables.typing.rec(option).members.find((m) => m !== "null") as DynType;
    const [yes, after] = [this.label(), this.label()];
    const line4 = `br i1 ${this.conversions().holds(cause, option, [dyn])}, label %${yes}, label %${after}`;
    this.emit(line4);
    this.startBlock(yes);
    let inner: string;
    if (shell) inner = blank(this);
    else {
      const d = this.convert(cause, option, dyn);
      const [data, table] = [this.temp(), this.temp()];
      inner = this.temp();
      this.emit(`${data} = extractvalue ${DYN} ${d}, 0`);
      this.emit(`${table} = extractvalue ${DYN} ${d}, 1`);
      // The slot after its fields prints the boxed value as its own type does.
      const line5 = `${inner} = call ptr ${this.vslot(table, this.tables.typing.rec(this.tables.typing.rec(dyn).of).methods.length + this.tables.typing.rec(this.tables.typing.rec(dyn).of).fields.length)}(ptr ${data}, i64 ${depth})`;
      this.emit(line5);
    }
    const line6 = `call void @fsh_rt_insp_field(ptr ${node}, ptr ${this.cString("[cause]")}, ptr ${inner})`;
    this.emit(line6);
    this.emit(`br label %${after}`);
    this.startBlock(after);
    return node;
  }


  // A value past depth 2, as Node prints it there: its size, or its keys, with no parts inside.
  inspectShell(this: Mut<this>, v: string, t: Exclude<Type, string>, written: Type): string {
    const r = this.tables.typing.rec(t);
    const node = this.temp();
    if (r.kind === "array" || r.kind === "fixed") {
      let length = String((r as FixedRecord).size);
      if (r.kind === "array") {
        length = this.temp();
        this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      }
      this.emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${length})`);
      return node;
    }
    if (r.kind === "map" && r.dict === true) return this.inspectEntries(v, t as MapType, t, "0", true);
    if (r.kind === "map") {
      const size = this.temp();
      this.emit(`${size} = call i64 @fsh_rt_map_size(ptr ${v})`);
      this.emit(`${node} = call ptr @fsh_rt_insp_list(i32 ${r.set ? 5 : 4}, i64 ${size})`);
      return node;
    }
    const object = t as ObjectType;
    if (r.kind === "object" && this.tables.typing.isTuple(object)) {
      const line = `${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${this.tables.typing.rec(object).required === undefined && this.tables.typing.rec(object).rest === undefined ? `${this.tables.typing.rec(object).fields.length}` : this.tupleLength(v, object)})`;
      this.emit(line);
      return node;
    }
    const spelled = this.writtenShape(written, t) as ObjectType | undefined;
    const as = this.recOf(spelled)?.fields.length === this.tables.typing.rec(object).fields.length ? this.tables.typing.rec(spelled!).fields : this.tables.typing.rec(object).fields;
    const fields = r.kind === "class" ? this.jsonFields(this.classShape(written, t)) : this.objectJsonFields(object, as);
    // Past the depth, an Error is its header alone, or its class's name when it has more to show.
    if (r.kind === "class" && this.errorClass(t as ClassType)) return this.errorTree(v, t as ClassType, fields, "0", true);
    const embedded = r.kind === "class" ? this.embeddedField(t as ClassType) : undefined;
    if (embedded !== undefined) {
      const [x, size] = [this.temp(), this.temp()];
      this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${embedded.path.join(", ")}`);
      this.emit(`${size} = call i64 @fsh_rt_map_size(ptr ${x})`);
      this.emit(`${node} = call ptr @fsh_rt_insp_list(i32 ${this.tables.typing.rec(embedded.type).set ? 5 : 4}, i64 ${size})`);
      const line2 = `call void @fsh_rt_insp_named(ptr ${node}, ptr ${this.cString(this.tables.typing.rec(t as ClassType).name.replace(/[@<].*$/, ""))})`;
      this.emit(line2);
    } else {
      const line3 = `${node} = call ptr @fsh_rt_insp_object(ptr ${this.cString(r.kind === "class" ? r.name.replace(/[@<].*$/, "") : "")})`;
      this.emit(line3);
    }
    for (const f of fields) {
      const after = this.label();
      if (f.omit === true) {
        const x = this.temp();
        this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${f.path.join(", ")}`);
        const lower2 = this.tables.typing.lower(f.type) as UnionType;
        const lower3 = this.tables.typing.lower(f.type) as UnionType;
        const filter2 = this.tables.typing.rec(lower3).members.filter((m) => m !== "null");
        const present = this.conversions().holds(x, lower2, filter2);
        const write = this.label();
        this.emit(`br i1 ${present}, label %${write}, label %${after}`);
        this.startBlock(write);
      }
      const blank = this.temp();
      const line4 = `${blank} = call ptr @fsh_rt_insp_text(ptr ${this.cString("")})`;
      this.emit(line4);
      const line5 = `call void @fsh_rt_insp_field(ptr ${node}, ptr ${this.cString(f.name)}, ptr ${blank})`;
      this.emit(line5);
      this.emit(`br label %${after}`);
      this.startBlock(after);
    }
    return node;
  }


  // An array's first 100 elements, and how many it has.
  inspectElements(this: Mut<this>, v: string, t: ArrayType | FixedType, written: Type, depth: string, wide = false): string {
    const lower2 = this.tables.typing.lower(this.tables.typing.rec(t).element);
    const element = this.llvm(lower2);
    const [length, data] = [this.temp(), this.temp()];
    if (this.tables.typing.rec(t).kind === "array") {
      this.emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      this.emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
    } else {
      const slot = this.alloca(this.llvm(t));
      this.emit(`store ${this.llvm(t)} ${v}, ptr ${slot}`);
      this.emit(`${length} = add i64 0, ${this.tables.typing.rec(t as FixedType).size}`);
      this.emit(`${data} = getelementptr ${this.llvm(t)}, ptr ${slot}, i32 0, i32 0`);
    }
    const node = this.temp();
    this.emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${length})`);
    const [cap, kept] = [this.temp(), this.temp()];
    this.emit(`${cap} = icmp slt i64 ${length}, 100`);
    this.emit(`${kept} = select i1 ${cap}, i64 ${length}, i64 100`);
    const index = this.alloca("i64");
    this.emit(`store i64 0, ptr ${index}`);
    const [head, loop, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${kept}`);
    this.emit(`br i1 ${more}, label %${loop}, label %${done}`);
    this.startBlock(loop);
    const [at, x, next] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
    this.emit(`${x} = load ${element}, ptr ${at}`);
    // A Float32Array's elements print as the doubles JavaScript reads them as.
    let shown = x;
    if (wide) {
      shown = this.temp();
      this.emit(`${shown} = fpext float ${x} to double`);
    }
    const line = `call void @fsh_rt_insp_push(ptr ${node}, ptr ${this.inspectTree(shown, shown === x ? written : "f64", depth)})`;
    this.emit(line);
    this.emit(`${next} = add i64 ${i}, 1`);
    this.emit(`store i64 ${next}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    return node;
  }


  // A Map's or Set's live entries in order, its first 100, and how many it has.
  // A dictionary's entries are an object's fields, each value left blank past the depth as a
  // field's is, and are all printed, as an object's are.
  inspectEntries(this: Mut<this>, map: string, t: MapType, written: Type, depth: string, shell = false): string {
    const entry = this.entryType(t);
    const dict = this.tables.typing.rec(t).dict;
    const [size, node] = [this.temp(), this.temp()];
    this.emit(`${size} = call i64 @fsh_rt_map_size(ptr ${map})`);
    if (dict === true) {
      const line = `${node} = call ptr @fsh_rt_insp_object(ptr ${this.cString("")})`;
      this.emit(line);
    }
    else this.emit(`${node} = call ptr @fsh_rt_insp_list(i32 ${this.tables.typing.rec(t).set ? 5 : 4}, i64 ${size})`);
    const order = this.dictOrder(t, map);
    const [counter, taken] = [this.alloca("i64"), this.alloca("i64")];
    this.emit(`store i64 0, ptr ${counter}`);
    this.emit(`store i64 0, ptr ${taken}`);
    const [test, live, loop, next, end] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    const [i, used, more] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${counter}`);
    this.emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    // Node prints the first 100 entries, so the rest aren't built.
    const [shown, room, going] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${shown} = load i64, ptr ${taken}`);
    this.emit(`${room} = icmp slt i64 ${shown}, ${dict === true ? "9223372036854775807" : "100"}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${used}`);
    this.emit(`${going} = and i1 ${more}, ${room}`);
    this.emit(`br i1 ${going}, label %${live}, label %${end}`);
    this.startBlock(live);
    const [at, state, alive] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = ${this.entryAt(map, order, i)}`);
    this.emit(`${state} = load i64, ptr ${at}`);
    this.emit(`${alive} = icmp eq i64 ${state}, 1`);
    this.emit(`br i1 ${alive}, label %${loop}, label %${next}`);
    this.startBlock(loop);
    const counted = this.temp();
    this.emit(`${counted} = add i64 ${shown}, 1`);
    this.emit(`store i64 ${counted}, ptr ${taken}`);
    const [keyAt, key] = [this.temp(), this.temp()];
    this.emit(`${keyAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    const lower2 = this.tables.typing.lower(this.tables.typing.rec(t).key);
    const line2 = `${key} = load ${this.llvm(lower2)}, ptr ${keyAt}`;
    this.emit(line2);
    if (dict === true) {
      const x = this.temp();
      if (shell) {
        const line3 = `${x} = call ptr @fsh_rt_insp_text(ptr ${this.cString("")})`;
        this.emit(line3);
      }
      else {
        const valueAt = this.temp();
        this.emit(`${valueAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
        const lower3 = this.tables.typing.lower(this.tables.typing.rec(t).value);
        const line4 = `${x} = load ${this.llvm(lower3)}, ptr ${valueAt}`;
        this.emit(line4);
      }
      const line5 = `call void @fsh_rt_insp_entry(ptr ${node}, ptr ${key}, ptr ${shell ? x : this.inspectTree(x, written, depth)})`;
      this.emit(line5);
    } else {
      const line6 = `call void @fsh_rt_insp_push(ptr ${node}, ptr ${this.inspectTree(key, this.tables.typing.rec(t).key, depth)})`;
      this.emit(line6);
    }
    if (!this.tables.typing.rec(t).set && dict !== true) {
      const [valueAt, x] = [this.temp(), this.temp()];
      this.emit(`${valueAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
      const lower4 = this.tables.typing.lower(this.tables.typing.rec(t).value);
      const line7 = `${x} = load ${this.llvm(lower4)}, ptr ${valueAt}`;
      this.emit(line7);
      const line8 = `call void @fsh_rt_insp_push(ptr ${node}, ptr ${this.inspectTree(x, written, depth)})`;
      this.emit(line8);
    }
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const step = this.temp();
    this.emit(`${step} = add i64 ${i}, 1`);
    this.emit(`store i64 ${step}, ptr ${counter}`);
    this.emit(`br label %${test}`);
    this.startBlock(end);
    if ((order !== undefined && order !== "")) this.emit(`call void @fsh_rt_free(ptr ${order})`);
    return node;
  }


  // `JSON.parse<T>(s)`: s read as a T. A failure, or text left after the value, throws a
  // JsonError holding the reader's message.
  parseJsonCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const type = this.cur().types.get(e)!;
    const s = this.value(e.args[0]!);
    const r = this.temp();
    this.emit(`${r} = call ptr @fsh_rt_json_in(ptr ${s})`);
    const [ok, v] = this.jsonRead(r, type);
    const [check, extra, bad, good] = [this.label(), this.label(), this.label(), this.label()];
    this.emit(`br i1 ${ok}, label %${check}, label %${bad}`);
    this.startBlock(check);
    const [ended, whole] = [this.temp(), this.temp()];
    this.emit(`${ended} = call i32 @fsh_rt_json_end(ptr ${r})`);
    this.emit(`${whole} = icmp ne i32 ${ended}, 0`);
    this.emit(`br i1 ${whole}, label %${good}, label %${extra}`);
    this.startBlock(extra);
    this.dispose(v, type);
    this.emit(`br label %${bad}`);
    this.startBlock(bad);
    const [message, error] = [this.temp(), this.temp()];
    this.emit(`${message} = call ptr @fsh_rt_json_close(ptr ${r})`);
    const failure = this.cur().raises.get(e)!.from;
    this.emit(`${error} = insertvalue ${this.llvm(failure)} zeroinitializer, ptr ${message}, 0`);
    this.raised(e, error);
    this.startBlock(good);
    const none = this.temp();
    this.emit(`${none} = call ptr @fsh_rt_json_close(ptr ${r})`);
    this.emit(`call void @fsh_rt_str_release(ptr ${none})`);
    return v;
  }


  // Reads a value of a type through the function made for it, which reports whether it could.
  jsonRead(this: Mut<this>, r: string, type: Type): [ok: string, v: string] {
    const t = this.tables.typing.lower(type);
    let name = this.jsonReaders.get(t);
    if ((name === undefined || name === "")) {
      const described2 = this.tables.typing.described(t);
      name = `@fsh.json.read.${this.stableId("json.read", described2, typeOwner(t))}`;
      this.jsonReaders.set(t, name);
      const saved = this.setAside();
      const line = `store ${this.llvm(t)} ${this.readParts("%r", t)}, ptr %out`;
      this.emit(line);
      this.emit("ret i1 true");
      this.out.push(`define internal i1 ${name}(ptr %r, ptr %out) {`);
      this.out.push("entry:");
      for (const pushed of this.allocas) this.out.push(pushed);
      for (const pushed of this.body) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
      this.takeUp(saved);
    }
    const [slot, ok, v] = [this.alloca(this.llvm(t)), this.temp(), this.temp()];
    this.emit(`${ok} = call i1 ${name}(ptr ${r}, ptr ${slot})`);
    this.emit(`${v} = load ${this.llvm(t)}, ptr ${slot}`);
    return [ok, v];
  }


  // Goes on when a reading step succeeded, an i32 or i1 that isn't zero; otherwise the reading
  // function fails, after `undo` drops what it had made.
  jsonGuard(this: Mut<this>, ok: string, width: "i32" | "i1", undo: (cg: Mut<Codegen>) => void) {
    const [bad, good] = [this.label(), this.label()];
    let test = ok;
    if (width === "i32") {
      test = this.temp();
      this.emit(`${test} = icmp ne i32 ${ok}, 0`);
    }
    this.emit(`br i1 ${test}, label %${good}, label %${bad}`);
    this.startBlock(bad);
    undo(this);
    this.emit("ret i1 false");
    this.startBlock(good);
  }


  // Fails the reading function with "expected <what>" at the reader's place.
  jsonExpected(this: Mut<this>, r: string, what: string, undo: (cg: Mut<Codegen>) => void) {
    const ignored = this.temp();
    const line = `${ignored} = call i32 @fsh_rt_json_expected(ptr ${r}, ptr ${this.cString(what)})`;
    this.emit(line);
    undo(this);
    this.emit("ret i1 false");
    const label2 = this.label();
    this.startBlock(label2);
  }


  // A value of the type, read inside a reading function, which fails and returns where it can't.
  readParts(this: Mut<this>, r: string, t: Type): string {
    const literal = this.recOf(t);
    if (literal?.kind === "literal") return this.readLiteral(r, t as LiteralType);
    if (t === "null") {
      const ok = this.temp();
      this.emit(`${ok} = call i32 @fsh_rt_json_null(ptr ${r})`);
      this.jsonGuard(ok, "i32", noUndo);
      return "zeroinitializer";
    }
    if (t === "boolean") {
      const [slot, ok, v, b] = [this.alloca("i32"), this.temp(), this.temp(), this.temp()];
      this.emit(`${ok} = call i32 @fsh_rt_json_bool(ptr ${r}, ptr ${slot})`);
      this.jsonGuard(ok, "i32", noUndo);
      this.emit(`${v} = load i32, ptr ${slot}`);
      this.emit(`${b} = trunc i32 ${v} to i1`);
      return b;
    }
    if (t === "string") {
      const [slot, ok, v] = [this.alloca("ptr"), this.temp(), this.temp()];
      const line = `${ok} = call i32 @fsh_rt_json_text(ptr ${r}, ptr ${slot}, ptr ${this.cString("string")})`;
      this.emit(line);
      this.jsonGuard(ok, "i32", noUndo);
      this.emit(`${v} = load ptr, ptr ${slot}`);
      return v;
    }
    if (isFloat(t)) {
      const [slot, ok, v] = [this.alloca("double"), this.temp(), this.temp()];
      const line2 = `${ok} = call i32 @fsh_rt_json_float(ptr ${r}, ptr ${slot}, ptr ${this.cString(t)})`;
      this.emit(line2);
      this.jsonGuard(ok, "i32", noUndo);
      this.emit(`${v} = load double, ptr ${slot}`);
      if (t === "f64") return v;
      const narrow = this.temp();
      this.emit(`${narrow} = fptrunc double ${v} to float`);
      return narrow;
    }
    if (typeof t === "string" && isInteger(t)) {
      const { bits, signed } = integerInfo(t as Integer);
      const [slot, ok, v] = [this.alloca("i128"), this.temp(), this.temp()];
      const line3 = `${ok} = call i32 @fsh_rt_json_int(ptr ${r}, ptr ${slot}, i32 ${bits}, i32 ${signed ? 1 : 0}, ptr ${this.cString(t)})`;
      this.emit(line3);
      this.jsonGuard(ok, "i32", noUndo);
      this.emit(`${v} = load i128, ptr ${slot}`);
      if (bits === 128) return v;
      const narrow = this.temp();
      this.emit(`${narrow} = trunc i128 ${v} to i${bits}`);
      return narrow;
    }
    const c = this.tables.typing.rec(t as Exclude<Type, string>);
    if (c.kind === "recursive") {
      const [ok, v] = this.jsonRead(r, c.of);
      this.jsonGuard(ok, "i1", noUndo);
      return this.convert(v, c.of, t);
    }
    if (c.kind === "array") return this.readElements(r, t as Exclude<Type, string> as ArrayType, false, 0, noUndo);
    if (c.kind === "map") return this.readEntries(r, t as Exclude<Type, string> as MapType);
    if (c.kind === "union") return c.members.every((m) => this.recOf(m)?.kind === "variant") ? this.readVariant(r, t as Exclude<Type, string> as UnionType) : this.readMember(r, t as Exclude<Type, string> as UnionType);
    if (c.kind === "variant") return this.readVariant(r, t as Exclude<Type, string> as VariantType);
    if (c.kind === "object" && this.tables.typing.isTuple(t)) return this.readTuple(r, t as Exclude<Type, string> as ObjectType);
    let fields: JsonField[] = [];
    if (c.kind === "class") fields = this.jsonFields(t as Exclude<Type, string> as ClassType);
    else for (let i: usize = 0; i < c.fields.length; i++) fields.push({ name: c.fields[i]!.name, type: c.fields[i]!.type, path: [i] });
    return this.readObject(r, t as Exclude<Type, string>, fields);
  }


  // A literal type's value, read as its base and checked; the error points at where it starts.
  readLiteral(this: Mut<this>, r: string, t: LiteralType): string {
    const [mark, start] = [this.alloca("[3 x i64]"), this.temp()];
    this.emit(`${start} = call i32 @fsh_rt_json_peek(ptr ${r})`);
    this.emit(`call void @fsh_rt_json_save(ptr ${r}, ptr ${mark})`);
    const literal = this.tables.typing.rec(t).value;
    const what = typeof literal === "string" ? JSON.stringify(literal) : literalText(literal);
    const base: Type = typeof literal === "string" ? "string" : typeof literal === "boolean" ? "boolean" : "i64";
    const v = this.readParts(r, base);
    const same = this.temp();
    if (base === "string") {
      const found = this.temp();
      const line = `${found} = call i32 @fsh_rt_json_same(ptr ${v}, ptr ${this.cString(this.tables.typing.rec(t).value as string)}, i64 ${new TextEncoder().encode(this.tables.typing.rec(t).value as string).length})`;
      this.emit(line);
      this.emit(`call void @fsh_rt_str_release(ptr ${v})`);
      this.emit(`${same} = icmp ne i32 ${found}, 0`);
    } else if (base === "boolean") this.emit(`${same} = icmp eq i1 ${v}, ${literalText(literal)}`);
    else this.emit(`${same} = icmp eq i64 ${v}, ${literalText(literal)}`);
    this.jsonGuard(same, "i1", (cg) => {
      cg.emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
      const ignored = cg.temp();
      const line2 = `${ignored} = call i32 @fsh_rt_json_unlike(ptr ${r}, ptr ${cg.cString(what)})`;
      cg.emit(line2);
    });
    return "zeroinitializer";
  }


  // An array's elements, each pushed as it is read; a failure drops what was read. `after` reads
  // on from a rest tuple's fixed elements, `from` of them, which `undo` drops on a failure.
  // `opened`: a tuple's rest, read on from element `from` of an array already opened, with what
  // was read before it dropped by `earlier` if this part fails.
  readElements(this: Mut<this>, r: string, t: ArrayType, opened: boolean, from: usize, earlier: (cg: Mut<Codegen>) => void): string {
    const array = this.alloca(ARRAY);
    this.emit(`store ${ARRAY} zeroinitializer, ptr ${array}`);
    const undo = (cg: Mut<Codegen>) => {
      earlier(cg);
      const held = cg.temp();
      cg.emit(`${held} = load ${ARRAY}, ptr ${array}`);
      cg.dispose(held, t);
    };
    if (!opened) {
      const started = this.temp();
      const line = `${started} = call i32 @fsh_rt_json_open(ptr ${r}, i32 91, ptr ${this.cString("array")})`;
      this.emit(line);
      this.jsonGuard(started, "i32", noUndo);
    }
    const index = this.alloca("i64");
    this.emit(`store i64 ${from}, ptr ${index}`);
    const [head, item, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, first, more] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${first} = icmp eq i64 ${i}, 0`);
    const wide = this.temp();
    this.emit(`${wide} = zext i1 ${first} to i32`);
    this.emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 93, i32 ${wide})`);
    const [failed, ended] = [this.temp(), this.temp()];
    this.emit(`${failed} = icmp slt i32 ${more}, 0`);
    const [bad, ok] = [this.label(), this.label()];
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(bad);
    undo(this);
    this.emit("ret i1 false");
    this.startBlock(ok);
    this.emit(`${ended} = icmp eq i32 ${more}, 0`);
    this.emit(`br i1 ${ended}, label %${done}, label %${item}`);
    this.startBlock(item);
    const mark = this.temp();
    this.emit(`${mark} = call i64 @fsh_rt_json_index_path(ptr ${r}, i64 ${i})`);
    const [read, v] = this.jsonRead(r, this.tables.typing.rec(t).element);
    this.jsonGuard(read, "i1", undo);
    this.emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
    this.appended(array, this.tables.typing.rec(t).element, v);
    const next = this.temp();
    this.emit(`${next} = add i64 ${i}, 1`);
    this.emit(`store i64 ${next}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    const result = this.temp();
    this.emit(`${result} = load ${ARRAY}, ptr ${array}`);
    return result;
  }


  // A tuple's elements, exactly as many as it has, in order.
  readTuple(this: Mut<this>, r: string, t: ObjectType): string {
    const [order, rest] = this.tupleOrder(t);
    const opened = this.temp();
    const line = `${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 91, ptr ${this.cString("array")})`;
    this.emit(line);
    this.jsonGuard(opened, "i32", noUndo);
    let read: { v: string; type: Type; i: usize }[] = [];
    // Optional elements are read into slots, empty until read, since the array may end first.
    const required = this.tables.typing.rec(t).required ?? order.length;
    const slots = order.slice(required as i64).map(({ f, i }) => {
      const lower2 = this.tables.typing.lower(f.type);
      const llvm2 = this.llvm(lower2);
      const slot = this.alloca(llvm2);
      const lower3 = this.tables.typing.lower(f.type);
      const line2 = `store ${this.llvm(lower3)} ${this.convert("zeroinitializer", "null", f.type)}, ptr ${slot}`;
      this.emit(line2);
      return { slot, type: f.type, i };
    });
    const what = rest !== undefined ? `an array of at least ${order.length}` : required === order.length ? `an array of ${order.length}` : `an array of ${required} to ${order.length}`;
    const finish = this.label();
    let nAt: usize = 0;
    for (const { f, i } of order) {
      const n = nAt;
      nAt++;
      const right = this.tupleStep(r, n, 1, read, slots);
      const [bad, good] = [this.label(), this.label()];
      // Where an optional element would be, the array may end instead.
      this.emit(`br i1 ${right}, label %${good}, label %${(n as usize) < required ? bad : finish}`);
      if ((n as usize) < required) {
        this.startBlock(bad);
        this.jsonExpected(r, what, (cg: Mut<Codegen>) => cg.undoRead(read, slots));
        this.emit(`br label %${good}`);
      }
      this.startBlock(good);
      const mark = this.temp();
      this.emit(`${mark} = call i64 @fsh_rt_json_index_path(ptr ${r}, i64 ${n})`);
      const [ok, v] = this.jsonRead(r, f.type);
      this.jsonGuard(ok, "i1", (cg: Mut<Codegen>) => cg.undoRead(read, slots));
      this.emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
      if ((n as usize) < required) read.push({ v, type: f.type, i });
      else {
        const lower5 = this.tables.typing.lower(f.type);
        const line4 = `store ${this.llvm(lower5)} ${v}, ptr ${slots[n - required]!.slot}`;
        this.emit(line4);
      }
    }
    if (rest !== undefined) {
      // The fixed elements dominate the rest's reads, so its failures can drop them.
      read.push({ v: this.readElements(r, rest.f.type as ArrayType, true, order.length, (cg: Mut<Codegen>) => cg.undoRead(read, slots)), type: rest.f.type, i: rest.i });
    } else {
      const right = this.tupleStep(r, order.length, 0, read, slots);
      const [bad, good] = [this.label(), this.label()];
      this.emit(`br i1 ${right}, label %${good}, label %${bad}`);
      this.startBlock(bad);
      this.jsonExpected(r, what, (cg: Mut<Codegen>) => cg.undoRead(read, slots));
      this.emit(`br label %${good}`);
      this.startBlock(good);
    }
    this.emit(`br label %${finish}`);
    this.startBlock(finish);
    let parts: { v: string; type: Type; i: usize }[] = [...read];
    for (const x of slots) parts.push({ v: this.loadedSlot(x.slot, x.type), type: x.type, i: x.i });
    let agg = "undef";
    for (const x of parts) {
      const next = this.temp();
      const lower6 = this.tables.typing.lower(x.type);
      const line5 = `${next} = insertvalue ${this.llvm(t)} ${agg}, ${this.llvm(lower6)} ${x.v}, ${x.i}`;
      this.emit(line5);
      agg = next;
    }
    return agg;
  }

  // A value read out of a tuple element's slot.
  loadedSlot(this: Mut<this>, slot: string, type: Type): string {
    const v = this.temp();
    const lower4 = this.tables.typing.lower(type);
    const line3 = `${v} = load ${this.llvm(lower4)}, ptr ${slot}`;
    this.emit(line3);
    return v;
  }

  // Drops a tuple's elements read so far, when reading the rest fails.
  undoRead(this: Mut<this>, read: Ref<{ v: string; type: Type; i: usize }[]>, slots: Ref<{ slot: string; type: Type; i: usize }[]>): void {
    for (const x of read) this.dispose(x.v, x.type);
    for (const x of slots) {
      const loaded2 = this.loadedSlot(x.slot, x.type);
      this.dispose(loaded2, x.type);
    }
  }

  // Whether a tuple's element follows, or with `wanted` 0 its array ends, failing on bad text.
  tupleStep(this: Mut<this>, r: string, n: usize, wanted: 0 | 1, read: Ref<{ v: string; type: Type; i: usize }[]>, slots: Ref<{ slot: string; type: Type; i: usize }[]>): string {
    const [more, readable, right] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 93, i32 ${n === 0 ? 1 : 0})`);
    this.emit(`${readable} = icmp sge i32 ${more}, 0`);
    this.jsonGuard(readable, "i1", (cg: Mut<Codegen>) => cg.undoRead(read, slots));
    this.emit(`${right} = icmp eq i32 ${more}, ${wanted}`);
    return right;
  }


  // An object's fields by key, in any order, unknown keys passed over and a repeated key's
  // last value kept, as JavaScript reads them; a missing field is an error unless it may be
  // empty. A failure drops the fields read so far.
  readObject(this: Mut<this>, r: string, t: Exclude<Type, string>, fields: Ref<JsonField[]>) {
    const slots = fields.map((f) => {
      const lower2 = this.tables.typing.lower(f.type);
      const llvm2 = this.llvm(lower2);
      return ({ ...f, slot: this.alloca(llvm2), seen: this.alloca("i1") });
    });
    for (const f of slots) this.emit(`store i1 false, ptr ${f.seen}`);
    const undo = (cg: Mut<Codegen>) => {
      for (const f of slots.filter((f) => cg.needsDrop(f.type))) {
        const [was, drop, after, v] = [cg.temp(), cg.label(), cg.label(), cg.temp()];
        cg.emit(`${was} = load i1, ptr ${f.seen}`);
        cg.emit(`br i1 ${was}, label %${drop}, label %${after}`);
        cg.startBlock(drop);
        const lower3 = cg.tables.typing.lower(f.type);
        const line = `${v} = load ${cg.llvm(lower3)}, ptr ${f.slot}`;
        cg.emit(line);
        cg.dispose(v, f.type);
        cg.emit(`br label %${after}`);
        cg.startBlock(after);
      }
    };
    const opened = this.temp();
    const line2 = `${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 123, ptr ${this.cString("object")})`;
    this.emit(line2);
    this.jsonGuard(opened, "i32", noUndo);
    const first = this.alloca("i32");
    this.emit(`store i32 1, ptr ${first}`);
    const [head, entry, next, done] = [this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [isFirst, more, failed, ended] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${isFirst} = load i32, ptr ${first}`);
    this.emit(`store i32 0, ptr ${first}`);
    this.emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 ${isFirst})`);
    this.emit(`${failed} = icmp sge i32 ${more}, 0`);
    this.jsonGuard(failed, "i1", undo);
    this.emit(`${ended} = icmp eq i32 ${more}, 0`);
    this.emit(`br i1 ${ended}, label %${done}, label %${entry}`);
    this.startBlock(entry);
    const [keySlot, gotKey, key] = [this.alloca("ptr"), this.temp(), this.temp()];
    this.emit(`${gotKey} = call i32 @fsh_rt_json_key(ptr ${r}, ptr ${keySlot})`);
    this.jsonGuard(gotKey, "i32", undo);
    this.emit(`${key} = load ptr, ptr ${keySlot}`);
    for (const f of slots) {
      const [found, match, skip] = [this.temp(), this.label(), this.label()];
      const same = this.temp();
      const line3 = `${found} = call i32 @fsh_rt_json_same(ptr ${key}, ptr ${this.cString(f.name)}, i64 ${new TextEncoder().encode(f.name).length})`;
      this.emit(line3);
      this.emit(`${same} = icmp ne i32 ${found}, 0`);
      this.emit(`br i1 ${same}, label %${match}, label %${skip}`);
      this.startBlock(match);
      const mark = this.temp();
      this.emit(`${mark} = call i64 @fsh_rt_json_field_path(ptr ${r}, ptr ${key})`);
      this.emit(`call void @fsh_rt_str_release(ptr ${key})`);
      // A repeated key replaces the value read before.
      if (this.needsDrop(f.type)) {
        const [was, drop, after, old] = [this.temp(), this.label(), this.label(), this.temp()];
        this.emit(`${was} = load i1, ptr ${f.seen}`);
        this.emit(`store i1 false, ptr ${f.seen}`);
        this.emit(`br i1 ${was}, label %${drop}, label %${after}`);
        this.startBlock(drop);
        const lower4 = this.tables.typing.lower(f.type);
        const line4 = `${old} = load ${this.llvm(lower4)}, ptr ${f.slot}`;
        this.emit(line4);
        this.dispose(old, f.type);
        this.emit(`br label %${after}`);
        this.startBlock(after);
      }
      const [ok, v] = this.jsonRead(r, f.type);
      this.jsonGuard(ok, "i1", undo);
      this.emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
      const lower5 = this.tables.typing.lower(f.type);
      const line5 = `store ${this.llvm(lower5)} ${v}, ptr ${f.slot}`;
      this.emit(line5);
      this.emit(`store i1 true, ptr ${f.seen}`);
      this.emit(`br label %${head}`);
      this.startBlock(skip);
    }
    this.emit(`call void @fsh_rt_str_release(ptr ${key})`);
    const skipped = this.temp();
    this.emit(`${skipped} = call i32 @fsh_rt_json_skip(ptr ${r})`);
    this.jsonGuard(skipped, "i32", undo);
    this.emit(`br label %${next}`);
    this.startBlock(next);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    let agg = "undef";
    for (const f of slots) {
      const [was, have, absent, join, v] = [this.temp(), this.label(), this.label(), this.label(), this.temp()];
      this.emit(`${was} = load i1, ptr ${f.seen}`);
      this.emit(`br i1 ${was}, label %${join}, label %${absent}`);
      this.startBlock(absent);
      const lower6 = this.tables.typing.lower(f.type);
      const empty = this.tables.typing.isOption(lower6);
      if (empty) {
        const lower7 = this.tables.typing.lower(f.type);
        const llvm3 = this.llvm(lower7);
        const lower8 = this.tables.typing.lower(f.type);
        const line6 = `store ${llvm3} ${this.convert("zeroinitializer", "null", lower8)}, ptr ${f.slot}`;
        this.emit(line6);
      }
      else {
        const ignored = this.temp();
        const line7 = `${ignored} = call i32 @fsh_rt_json_missing(ptr ${r}, ptr ${this.cString(f.name)})`;
        this.emit(line7);
        undo(this);
        this.emit("ret i1 false");
        this.startBlock(have);
      }
      this.emit(`br label %${join}`);
      this.startBlock(join);
      const lower9 = this.tables.typing.lower(f.type);
      const line8 = `${v} = load ${this.llvm(lower9)}, ptr ${f.slot}`;
      this.emit(line8);
      const made = this.temp();
      const lower10 = this.tables.typing.lower(f.type);
      const line9 = `${made} = insertvalue ${this.llvm(t)} ${agg}, ${this.llvm(lower10)} ${v}, ${f.path.join(", ")}`;
      this.emit(line9);
      agg = made;
    }
    return agg;
  }


  // A union's value: each member tried in turn from the same place, the first that reads
  // winning; when none does, the error kept is from the one that read furthest. An enum's
  // members are read together, tagged as the enum is.
  readMember(this: Mut<this>, r: string, t: UnionType): string {
    const mark = this.alloca("[3 x i64]");
    const result = this.alloca(this.llvm(t));
    const done = this.label();
    this.emit(`call void @fsh_rt_json_save(ptr ${r}, ptr ${mark})`);
    // Each member in order, an enum's members together where its first one is.
    let groups = new Map<string, Type[]>();
    let parts: { member: Type; group: string }[] = [];
    const members2 = [...this.tables.typing.rec(t).members];
    for (const m of members2) {
      const variant = this.recOf(m);
      if (variant === undefined || variant.kind !== "variant") {
        parts.push({ member: m, group: "" });
        continue;
      }
      if (!groups.has(variant.enum)) {
        groups.set(variant.enum, []);
        parts.push({ member: m, group: variant.enum });
      }
      let group = groups.get(variant.enum)!;
      group.push(m);
    }
    for (const part of parts) {
      const m = part.group === "" ? part.member : this.tables.typing.unionType([...groups.get(part.group)!]);
      const [ok, v] = this.jsonRead(r, m);
      const [won, lost] = [this.label(), this.label()];
      this.emit(`br i1 ${ok}, label %${won}, label %${lost}`);
      this.startBlock(won);
      this.emit(`call void @fsh_rt_json_forget(ptr ${r})`);
      const line = `store ${this.llvm(t)} ${this.convert(v, m, t)}, ptr ${result}`;
      this.emit(line);
      this.emit(`br label %${done}`);
      this.startBlock(lost);
      this.emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
    }
    const line2 = `call void @fsh_rt_json_settle(ptr ${r}, ptr ${mark}, ptr ${this.cString(this.tables.typing.show(t))})`;
    this.emit(line2);
    this.emit("ret i1 false");
    this.startBlock(done);
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(t)}, ptr ${result}`);
    return v;
  }


  // A data enum's member, tagged as serde writes it: a bare name, or an object of one key, the
  // name, holding its value or an array of its values.
  readVariant(this: Mut<this>, r: string, t: UnionType | VariantType): string {
    const variants = this.tables.typing.rec(t).kind === "union" ? this.tables.typing.rec(t as UnionType).members.map((m) => m as VariantType) : [t as VariantType];
    const result = this.alloca(this.llvm(t));
    const [named, keyed, done] = [this.label(), this.label(), this.label()];
    const names = variants.map((v) => this.tables.typing.rec(v).member).join(", ");
    const mark = this.alloca("[3 x i64]");
    this.emit(`call void @fsh_rt_json_save(ptr ${r}, ptr ${mark})`);
    const [c, quoted] = [this.temp(), this.temp()];
    this.emit(`${c} = call i32 @fsh_rt_json_peek(ptr ${r})`);
    this.emit(`${quoted} = icmp eq i32 ${c}, 34`);
    this.emit(`br i1 ${quoted}, label %${named}, label %${keyed}`);
    // Pick the member a name says, or fail naming the ones there are.
    const pick = (cg: Mut<Codegen>, name: string, units: boolean, then: (cg: Mut<Codegen>, v: VariantType) => void) => {
      for (const v of variants.filter((v) => (cg.tables.typing.rec(v).fields.length === 0) === units)) {
        const [found, same, yes, no] = [cg.temp(), cg.temp(), cg.label(), cg.label()];
        const line = `${found} = call i32 @fsh_rt_json_same(ptr ${name}, ptr ${cg.cString(cg.tables.typing.rec(v).member)}, i64 ${new TextEncoder().encode(cg.tables.typing.rec(v).member).length})`;
        cg.emit(line);
        cg.emit(`${same} = icmp ne i32 ${found}, 0`);
        cg.emit(`br i1 ${same}, label %${yes}, label %${no}`);
        cg.startBlock(yes);
        cg.emit(`call void @fsh_rt_str_release(ptr ${name})`);
        then(cg, v);
        cg.emit(`br label %${done}`);
        cg.startBlock(no);
      }
      cg.emit(`call void @fsh_rt_str_release(ptr ${name})`);
      cg.emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
      cg.jsonExpected(r, `one of ${names}`, noUndo);
      cg.emit(`br label %${done}`);
    };
    this.startBlock(named);
    const name = this.readParts(r, "string");
    pick(this, name, true, (cg, v) => {
      const line2 = `store ${cg.llvm(t)} ${cg.convert("zeroinitializer", v, t)}, ptr ${result}`;
      cg.emit(line2);
    });
    this.startBlock(keyed);
    const opened = this.temp();
    const line3 = `${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 123, ptr ${this.cString(`one of ${names}`)})`;
    this.emit(line3);
    this.jsonGuard(opened, "i32", noUndo);
    const [more, one] = [this.temp(), this.temp()];
    this.emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 1)`);
    this.emit(`${one} = icmp sgt i32 ${more}, 0`);
    this.jsonGuard(one, "i1", (cg) => {
      cg.emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
      const ignored = cg.temp();
      const line4 = `${ignored} = call i32 @fsh_rt_json_expected(ptr ${r}, ptr ${cg.cString(`one of ${names}`)})`;
      cg.emit(line4);
    });
    const [keySlot, gotKey, key] = [this.alloca("ptr"), this.temp(), this.temp()];
    this.emit(`${gotKey} = call i32 @fsh_rt_json_key(ptr ${r}, ptr ${keySlot})`);
    this.jsonGuard(gotKey, "i32", noUndo);
    this.emit(`${key} = load ptr, ptr ${keySlot}`);
    const path = this.temp();
    this.emit(`${path} = call i64 @fsh_rt_json_field_path(ptr ${r}, ptr ${key})`);
    pick(this, key, false, (cg, v) => {
      let payload: string;
      if (cg.tables.typing.rec(v).fields.length === 1) {
        const lower4 = cg.tables.typing.lower(cg.tables.typing.rec(v).fields[0]!.type);
        payload = cg.readParts(r, lower4);
      } else {
        const tupleType2 = cg.tables.typing.tupleType(cg.tables.typing.rec(v).fields.map((f) => f.type));
        payload = cg.readTuple(r, tupleType2);
      }
      const made = cg.tables.typing.rec(v).fields.length === 1 ? (() => {
        const one = cg.temp();
        const lower2 = cg.tables.typing.lower(cg.tables.typing.rec(v).fields[0]!.type);
        const line5 = `${one} = insertvalue ${cg.llvm(v)} undef, ${cg.llvm(lower2)} ${payload}, 0`;
        cg.emit(line5);
        return one;
      })() : cg.tables.typing.rec(v).fields.reduce((agg, f, i) => {
        const [part, next] = [cg.temp(), cg.temp()];
        const tuple = cg.tables.typing.tupleType(cg.tables.typing.rec(v).fields.map((f) => f.type));
        cg.emit(`${part} = extractvalue ${cg.llvm(tuple)} ${payload}, ${cg.tables.typing.rec(tuple).fields.findIndex((g) => g.name === String(i))}`);
        const lower3 = cg.tables.typing.lower(f.type);
        const line6 = `${next} = insertvalue ${cg.llvm(v)} ${agg}, ${cg.llvm(lower3)} ${part}, ${i}`;
        cg.emit(line6);
        return next;
      }, "undef");
      const [closing, closed] = [cg.temp(), cg.temp()];
      cg.emit(`${closing} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 0)`);
      cg.emit(`${closed} = icmp eq i32 ${closing}, 0`);
      cg.jsonGuard(closed, "i1", (cg) => {
        cg.dispose(made, v);
        const ignored = cg.temp();
        const line7 = `${ignored} = call i32 @fsh_rt_json_expected(ptr ${r}, ptr ${cg.cString("an object of one key")})`;
        cg.emit(line7);
      });
      cg.emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${path})`);
      const line8 = `store ${cg.llvm(t)} ${cg.convert(made, v, t)}, ptr ${result}`;
      cg.emit(line8);
    });
    this.startBlock(done);
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(t)}, ptr ${result}`);
    return v;
  }


  // A string-keyed Map's entries, each key's last value kept.
  readEntries(this: Mut<this>, r: string, t: MapType): string {
    const map = this.mapNew(t, undefined);
    const undo = (cg: Mut<Codegen>) => cg.dispose(map, t);
    const opened = this.temp();
    const line = `${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 123, ptr ${this.cString("object")})`;
    this.emit(line);
    this.jsonGuard(opened, "i32", undo);
    const first = this.alloca("i32");
    this.emit(`store i32 1, ptr ${first}`);
    const [head, entry, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [isFirst, more, failed, ended] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${isFirst} = load i32, ptr ${first}`);
    this.emit(`store i32 0, ptr ${first}`);
    this.emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 ${isFirst})`);
    this.emit(`${failed} = icmp sge i32 ${more}, 0`);
    this.jsonGuard(failed, "i1", undo);
    this.emit(`${ended} = icmp eq i32 ${more}, 0`);
    this.emit(`br i1 ${ended}, label %${done}, label %${entry}`);
    this.startBlock(entry);
    const [keySlot, gotKey, key, mark] = [this.alloca("ptr"), this.temp(), this.temp(), this.temp()];
    this.emit(`${gotKey} = call i32 @fsh_rt_json_key(ptr ${r}, ptr ${keySlot})`);
    this.jsonGuard(gotKey, "i32", undo);
    this.emit(`${key} = load ptr, ptr ${keySlot}`);
    this.emit(`${mark} = call i64 @fsh_rt_json_field_path(ptr ${r}, ptr ${key})`);
    const [ok, v] = this.jsonRead(r, this.tables.typing.rec(t).value);
    this.jsonGuard(ok, "i1", (cg) => {
      cg.emit(`call void @fsh_rt_str_release(ptr ${key})`);
      undo(cg);
    });
    this.emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
    this.inserted(t, map, key, v);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    return map;
  }


  // A string-keyed Map's live entries, in the order they went in, as an object's fields.
  jsonEntries(this: Mut<this>, w: string, map: string, t: MapType, written: Type) {
    const entry = this.entryType(t);
    this.jsonRaw(w, "{");
    const order = this.dictOrder(t, map);
    const [counter, wrote] = [this.alloca("i64"), this.alloca("i1")];
    this.emit(`store i64 0, ptr ${counter}`);
    this.emit(`store i1 false, ptr ${wrote}`);
    const [test, live, loop, comma, item, next, end] = [this.label(), this.label(), this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    const [i, used, more] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${counter}`);
    this.emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    this.emit(`${more} = icmp slt i64 ${i}, ${used}`);
    this.emit(`br i1 ${more}, label %${live}, label %${end}`);
    this.startBlock(live);
    const [at, state, alive] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${at} = ${this.entryAt(map, order, i)}`);
    this.emit(`${state} = load i64, ptr ${at}`);
    this.emit(`${alive} = icmp eq i64 ${state}, 1`);
    this.emit(`br i1 ${alive}, label %${loop}, label %${next}`);
    this.startBlock(loop);
    const after = this.temp();
    this.emit(`${after} = load i1, ptr ${wrote}`);
    this.emit(`br i1 ${after}, label %${comma}, label %${item}`);
    this.startBlock(comma);
    this.jsonRaw(w, ",");
    this.emit(`br label %${item}`);
    this.startBlock(item);
    this.emit(`store i1 true, ptr ${wrote}`);
    const [keyAt, key, valueAt, x] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${keyAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    this.emit(`${key} = load ptr, ptr ${keyAt}`);
    this.emit(`call void @fsh_rt_json_string(ptr ${w}, ptr ${key})`);
    this.jsonRaw(w, ":");
    this.emit(`${valueAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
    const lower2 = this.tables.typing.lower(this.tables.typing.rec(t).value);
    const line = `${x} = load ${this.llvm(lower2)}, ptr ${valueAt}`;
    this.emit(line);
    this.jsonWrite(w, x, written);
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const step = this.temp();
    this.emit(`${step} = add i64 ${i}, 1`);
    this.emit(`store i64 ${step}, ptr ${counter}`);
    this.emit(`br label %${test}`);
    this.startBlock(end);
    if ((order !== undefined && order !== "")) this.emit(`call void @fsh_rt_free(ptr ${order})`);
    this.jsonRaw(w, "}");
  }


  // A union's value, written as the member its tag says it holds.
  jsonMember(this: Mut<this>, w: string, v: string, t: UnionType, written: Ref<Type[]>) {
    const tag = this.temp();
    this.emit(`${tag} = extractvalue ${this.llvm(t)} ${v}, 0`);
    const done = this.label();
    const cases = this.tables.typing.rec(t).members.map(() => this.label());
    this.emit(`switch i32 ${tag}, label %${done} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    let iAt: usize = 0;
    for (const m of this.tables.typing.rec(t).members) {
      const i = iAt;
      iAt++;
      this.startBlock(cases[i as usize]!);
      const member = this.tables.typing.lower(m);
      if (typeof member === "string" && (member === "null" || member === "never")) this.jsonRaw(w, "null");
      else if (this.recOf(member)?.kind === "literal") this.jsonScalar(w, "", member);
      else {
        const slot = this.alloca(this.llvm(t));
        this.emit(`store ${this.llvm(t)} ${v}, ptr ${slot}`);
        const [at, x] = [this.temp(), this.temp()];
        this.emit(`${at} = getelementptr ${this.llvm(t)}, ptr ${slot}, i32 0, i32 1`);
        this.emit(`${x} = load ${this.llvm(member)}, ptr ${at}, align 8`);
        this.jsonWrite(w, x, written[i as usize]!);
      }
      this.emit(`br label %${done}`);
    }
    this.startBlock(done);
  }


  // In an array's drop function: drops each element, then frees the buffer.
  // A recursive type's block, or a copy of it holding copies of what it owns. A block moved out
  // of its place left it empty, with nothing to drop or copy.
  dropBlock(this: Mut<this>, type: RecursiveType): string {
    const [held, done] = [this.label(), this.label()];
    const empty = this.temp();
    this.emit(`${empty} = icmp eq ptr %v, null`);
    this.emit(`br i1 ${empty}, label %${done}, label %${held}`);
    this.startBlock(held);
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(this.tables.typing.rec(type).of)}, ptr %v`);
    this.dispose(v, this.tables.typing.rec(type).of);
    this.emit("call void @fsh_rt_free(ptr %v)");
    this.emit(`br label %${done}`);
    this.startBlock(done);
    return "%v";
  }


  copyBlock(this: Mut<this>, type: RecursiveType): string {
    const [held, done] = [this.label(), this.label()];
    const empty = this.temp();
    this.emit(`${empty} = icmp eq ptr %v, null`);
    this.emit(`br i1 ${empty}, label %${done}, label %${held}`);
    this.startBlock(held);
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(this.tables.typing.rec(type).of)}, ptr %v`);
    const copied2 = this.copied(v, this.tables.typing.rec(type).of);
    const copy = this.convert(copied2, this.tables.typing.rec(type).of, type);
    const from = this.block;
    this.emit(`br label %${done}`);
    this.startBlock(done);
    const result = this.temp();
    this.emit(`${result} = phi ptr [ null, %entry ], [ ${copy}, %${from} ]`);
    return result;
  }


  dropArray(this: Mut<this>, type: ArrayType): string {
    const [data, length] = [this.temp(), this.temp()];
    this.emit(`${data} = extractvalue ${ARRAY} %v, 0`);
    this.emit(`${length} = extractvalue ${ARRAY} %v, 1`);
    if (this.needsDrop(this.tables.typing.rec(type).element)) {
      this.elements(this.tables.typing.rec(type).element, data, length, (cg, at) => {
        const v = cg.temp();
        cg.emit(`${v} = load ${cg.llvm(cg.tables.typing.rec(type).element)}, ptr ${at}`);
        cg.dispose(v, cg.tables.typing.rec(type).element);
      });
    }
    this.emit(`call void @fsh_rt_free(ptr ${data})`);
    return "%v";
  }


  // In an array's copy function: a new buffer just long enough, holding a copy of each element.
  copyArray(this: Mut<this>, type: ArrayType): string {
    const [data, length, copy] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${data} = extractvalue ${ARRAY} %v, 0`);
    this.emit(`${length} = extractvalue ${ARRAY} %v, 1`);
    const line = `${copy} = call ptr @fsh_rt_array_alloc(i64 ${this.bytes(this.tables.typing.rec(type).element, length)})`;
    this.emit(line);
    const t = this.llvm(this.tables.typing.rec(type).element);
    const element = this.tables.typing.rec(type).element;
    const held = this.recOf(element);
    const glued = held !== undefined && held.kind !== "handle" && held.kind !== "interior" && this.needsDrop(element);
    this.elements(element, data, length, (cg, at, i) => {
      const [v, to] = [cg.temp(), cg.temp()];
      cg.emit(`${v} = load ${t}, ptr ${at}`);
      cg.emit(`${to} = getelementptr ${t}, ptr ${copy}, i64 ${i}`);
      if (!glued) {
        const line2 = `store ${t} ${cg.copied(v, element)}, ptr ${to}`;
        cg.emit(line2);
        return;
      }
      // An element's copy may panic: the elements copied so far, and the buffer, go with it.
      const made = cg.temp();
      const line3 = `call ${t} ${cg.helper("copy", element as Exclude<Type, string>)}(${t} ${v})`;
      cg.unwinding(line3, made, (cg: Mut<Codegen>) => {
        const built2 = cg.built(copy, i, i);
        cg.dispose(built2, type);
      });
      cg.emit(`store ${t} ${made}, ptr ${to}`);
    });
    return this.built(copy, length, length);
  }


  // An array literal with spreads, built in order: each part goes in as it runs, a spread array
  // made for it giving up its elements and others giving clones then and there, before a later
  // part could change or move it. The array being built is owned by a scope of its own, so a
  // panic part way drops it.
  spreadArray(this: Mut<this>, written: Ref<Expr[]>, type: ArrayType): string {
    const out = this.alloca(ARRAY);
    this.scopes.push({ transient: false, held: [] });
    this.own(out, type);
    this.emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    for (const x of written) {
      if (x.kind !== "spread") {
        const owned2 = this.owned(x);
        this.appended(out, this.tables.typing.rec(type).element, owned2);
        continue;
      }
      const taken = this.fresh(x.value);
      const from = this.cur().types.get(x)!;
      const whole = taken ? this.owned(x.value) : this.value(x.value);
      const [data, length] = [this.temp(), this.temp()];
      this.emit(`${data} = extractvalue ${ARRAY} ${whole}, 0`);
      this.emit(`${length} = extractvalue ${ARRAY} ${whole}, 1`);
      this.elements(from, data, length, (cg, at) => {
        const v = cg.temp();
        cg.emit(`${v} = load ${cg.llvm(from)}, ptr ${at}`);
        const chosen = taken ? v : cg.copied(v, from);
        const convert2 = cg.convert(chosen, from, cg.tables.typing.rec(type).element);
        cg.appended(out, cg.tables.typing.rec(type).element, convert2);
      });
      if (taken) this.emit(`call void @fsh_rt_free(ptr ${data})`);
    }
    const v = this.temp();
    this.emit(`${v} = load ${ARRAY}, ptr ${out}`);
    this.emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    this.scopes.pop();
    return v;
  }


  // Puts `v` at the end of the array at `at`, growing it when it is full.
  appended(this: Mut<this>, at: string, element: Type, v: string) {
    const t = this.llvm(element);
    const line = `call void @fsh_rt_array_reserve(ptr ${at}, i64 ${this.bytes(element, "1")})`;
    this.emit(line);
    const [lengthAt, dataAt, length, data, slot, more] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    this.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${length}`);
    this.emit(`store ${t} ${v}, ptr ${slot}`);
    this.emit(`${more} = add i64 ${length}, 1`);
    this.emit(`store i64 ${more}, ptr ${lengthAt}`);
  }


  // `map`, `filter`, `find`, `some`, `every` and `reduce`: a loop calling the callback with each
  // element, a copy when it copies and otherwise a pointer to it, and its index. The array is
  // only read, so its length and data are read once. `some`, `every` and `find` stop at the
  // first element that decides them.
  callbackLoop(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, written: string, array: ArrayType, at: string): string | undefined {
    const backward = written === "findLast" || written === "findLastIndex" || written === "reduceRight";
    const method = written === "findLast" ? "find" : written === "findLastIndex" ? "findIndex" : written === "reduceRight" ? "reduce" : written;
    const callback: Ref<Expr> = e.args[0]!;
    const init = e.args.length > 1 ? e.args[1]! : undefined;
    const element = this.tables.typing.rec(array).element;
    const t = this.llvm(element);
    const closure = this.cur().types.get(callback) as ClosureType;
    const target = this.callOf(callback)!;
    const env = this.alloca(this.llvm(closure));
    const line = `store ${this.llvm(closure)} ${this.owned(callback)}, ptr ${env}`;
    this.emit(line);
    const result = method === "forEach" ? "void" : this.cur().types.get(e) ?? (method === "map" ? this.tables.typing.arrayType(this.tables.typing.rec(closure).returns) : method === "flatMap" ? this.tables.typing.lower(this.tables.typing.rec(closure).returns)
      : method === "filter" ? array : method === "find" ? this.tables.typing.unionType([element, "null"]) : method === "findIndex" ? "i64" : method === "reduce" ? this.tables.typing.rec(closure).params[0]! : "boolean");
    const building = method === "map" || method === "filter" || method === "flatMap";
    const out = result === "void" ? "" : this.alloca(this.llvm(result));
    const [lengthAt, dataAt, length, data, index] = [this.temp(), this.temp(), this.temp(), this.temp(), this.alloca("i64")];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    const elementAt = (cg: Mut<Codegen>, i: string) => {
      const slot = cg.temp();
      cg.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
      return slot;
    };
    const load = (cg: Mut<Codegen>, slot: string) => {
      const v = cg.temp();
      cg.emit(`${v} = load ${t}, ptr ${slot}`);
      return v;
    };
    const reducing = method === "reduce";
    let first = "0";
    if (building) this.emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    if (method === "findIndex") this.emit(`store i64 -1, ptr ${out}`);
    if (method === "find") {
      const line2 = `store ${this.llvm(result)} ${this.convert("zeroinitializer", "null", result)}, ptr ${out}`;
      this.emit(line2);
    }
    if (method === "some" || method === "every") this.emit(`store i1 ${method === "every"}, ptr ${out}`);
    if (reducing && init !== undefined) {
      const owned2 = this.owned(init);
      const get2 = this.cur().types.get(init)!;
      const line3 = `store ${this.llvm(result)} ${this.convert(owned2, get2, result)}, ptr ${out}`;
      this.emit(line3);
    }
    if (reducing && init === undefined) {
      // Without an initial value the first element starts, and an empty array has none.
      const [empty, fail, ok] = [this.temp(), this.label(), this.label()];
      this.emit(`${empty} = icmp eq i64 ${length}, 0`);
      this.emit(`br i1 ${empty}, label %${fail}, label %${ok}`);
      this.startBlock(fail);
      const line4 = `call void @fsh_rt_panic(ptr ${this.cString(`panicked at ${this.where({ start: e.start, end: e.end })}:\nreduce of empty array with no initial value\n`)})`;
      this.unwinding(line4);
      this.emit("unreachable");
      this.startBlock(ok);
      let start = "0";
      if (backward) {
        start = this.temp();
        this.emit(`${start} = sub i64 ${length}, 1`);
      }
      const elementAt2 = elementAt(this, start);
      const load2 = load(this, elementAt2);
      const copied2 = this.copied(load2, element);
      const line5 = `store ${this.llvm(result)} ${this.convert(copied2, element, result)}, ptr ${out}`;
      this.emit(line5);
      first = "1";
    }
    this.emit(`store i64 ${first}, ptr ${index}`);
    const [head, body, next, done] = [this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [k, more] = [this.temp(), this.temp()];
    this.emit(`${k} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${k}, ${length}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    let i = k;
    if (backward) {
      const last = this.temp();
      i = this.temp();
      this.emit(`${last} = sub i64 ${length}, 1`);
      this.emit(`${i} = sub i64 ${last}, ${k}`);
    }
    const slot = elementAt(this, i);
    const takes = this.tables.typing.rec(closure).params;
    const given = takes.length > (reducing ? 1 : 0) ? takes[reducing ? 1 : 0]! : undefined;
    let passed: string[];
    if (given === undefined) {
      passed = [];
    } else {
      if (this.isRef(given) && !this.isRef(element)) passed = [`ptr ${slot}`];
      else {
        const loaded = load(this, slot);
        const copy = this.copied(loaded, element);
        passed = [`${this.llvm(given)} ${this.convert(copy, element, given)}`];
      }
    }
    if (this.tables.typing.rec(closure).params.length > (reducing ? 2 : 1)) passed.push(`i64 ${i}`);
    if (reducing) {
      const acc = this.temp();
      this.emit(`${acc} = load ${this.llvm(result)}, ptr ${out}`);
      passed.unshift(`${this.llvm(this.tables.typing.rec(closure).params[0]!)} ${this.convert(acc, result, this.tables.typing.rec(closure).params[0]!)}`);
    }
    const slice2 = passed.slice(0, this.bodyAt(target).params.length as i64);
    // A panic in the callback drops what the loop has built and what the callback captured.
    const gives = this.invoke(target, env, slice2, exprKey(e), undefined, (cg: Mut<Codegen>) => {
      if (building) {
        const built = cg.temp();
        cg.emit(`${built} = load ${cg.llvm(result)}, ptr ${out}`);
        cg.dispose(built, result);
      }
      if (cg.needsDrop(closure)) {
        const unstash2 = cg.unstash(env, closure);
        cg.dispose(unstash2, closure);
      }
    });
    if (method === "map") this.appended(out, this.tables.typing.rec(closure).returns, gives!);
    else if (method === "forEach") {
      // What the callback gives is dropped; JavaScript's forEach ignores it.
      if (gives !== undefined && this.needsDrop(this.tables.typing.rec(closure).returns)) this.dispose(gives, this.tables.typing.rec(closure).returns);
    } else if (method === "flatMap") {
      const many = this.alloca(ARRAY);
      const line6 = `store ${ARRAY} ${this.convert(gives!, this.tables.typing.rec(closure).returns, result)}, ptr ${many}`;
      this.emit(line6);
      const line7 = `call void @fsh_rt_array_extend(ptr ${out}, ptr ${many}, i64 ${this.bytes(this.tables.typing.rec(result as ArrayType).element, "1")})`;
      this.emit(line7);
    }
    else if (reducing) {
      const line8 = `store ${this.llvm(result)} ${this.convert(gives!, this.tables.typing.rec(closure).returns, result)}, ptr ${out}`;
      this.emit(line8);
    }
    else {
      const [hit, miss] = [this.label(), next];
      // `every` stops at the first element its callback rejects; the others at one it accepts.
      if (method === "every") this.emit(`br i1 ${gives!}, label %${miss}, label %${hit}`);
      else this.emit(`br i1 ${gives}, label %${hit}, label %${miss}`);
      this.startBlock(hit);
      if (method === "filter") {
        const load3 = load(this, slot);
        const copied3 = this.copied(load3, element);
        this.appended(out, element, copied3);
        this.emit(`br label %${next}`);
      } else {
        if (method === "find") {
          const load4 = load(this, slot);
          const copied4 = this.copied(load4, element);
          const line9 = `store ${this.llvm(result)} ${this.convert(copied4, element, result)}, ptr ${out}`;
          this.emit(line9);
        }
        else if (method === "findIndex") this.emit(`store i64 ${i}, ptr ${out}`);
        else this.emit(`store i1 ${method === "some"}, ptr ${out}`);
        this.emit(`br label %${done}`);
      }
    }
    if (method === "map" || method === "flatMap" || method === "forEach" || reducing) this.emit(`br label %${next}`);
    this.startBlock(next);
    const after = this.temp();
    this.emit(`${after} = add i64 ${k}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    // What the callback left of its captures drops once, after the last call.
    if (this.needsDrop(closure)) {
      const unstash3 = this.unstash(env, closure);
      this.dispose(unstash3, closure);
    }
    if (result === "void") return undefined;
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(result)}, ptr ${out}`);
    if (!this.cur().types.has(e) && this.needsDrop(result)) this.pending.push({ v, type: result });
    return v;
  }


  // `at(i)`: a clone of the element `i` names, counting back from the end when it is negative,
  // or nothing outside the array.
  elementAt(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, array: ArrayType, at: string): string {
    const element = this.tables.typing.rec(array).element;
    const option = this.tables.typing.unionType([element, "null"]);
    const i = this.value(e.args[0]!);
    const [lengthAt, length, negative, fromEnd, k, low, high, outside] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${negative} = icmp slt i64 ${i}, 0`);
    this.emit(`${fromEnd} = add i64 ${length}, ${i}`);
    this.emit(`${k} = select i1 ${negative}, i64 ${fromEnd}, i64 ${i}`);
    this.emit(`${low} = icmp slt i64 ${k}, 0`);
    this.emit(`${high} = icmp sge i64 ${k}, ${length}`);
    this.emit(`${outside} = or i1 ${low}, ${high}`);
    const [some, none, end] = [this.label(), this.label(), this.label()];
    this.emit(`br i1 ${outside}, label %${none}, label %${some}`);
    this.startBlock(some);
    const [dataAt, data, slot, v] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    this.emit(`${slot} = getelementptr ${this.llvm(element)}, ptr ${data}, i64 ${k}`);
    this.emit(`${v} = load ${this.llvm(element)}, ptr ${slot}`);
    const copied2 = this.copied(v, element);
    const held = this.convert(copied2, element, option);
    const someEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(none);
    const nothing = this.convert("zeroinitializer", "null", option);
    const noneEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(end);
    const result = this.temp();
    this.emit(`${result} = phi ${this.llvm(option)} [ ${held}, %${someEnd} ], [ ${nothing}, %${noneEnd} ]`);
    if (this.cur().types.has(e)) {
      const get2 = this.cur().types.get(e)!;
      return this.convert(result, option, get2);
    }
    this.pending.push({ v: result, type: option });
    return result;
  }


  // `sort`: the runtime's merge sort, comparing through a function that calls the comparator
  // with the two elements, or orders numbers and strings when there is none.
  sorted(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, array: ArrayType, at: string): undefined {
    const element = this.tables.typing.rec(array).element;
    const compare: Ref<Expr> | undefined = (e.args.length > 0 ? e.args[0]! : undefined);
    const closure = (compare !== undefined ? (this.cur().types.get(compare) as ClosureType) : undefined);
    let env = "null";
    let through: string;
    if (compare !== undefined && closure !== undefined) {
      const target = this.callOf(compare)!;
      env = this.alloca(this.llvm(closure));
      const line = `store ${this.llvm(closure)} ${this.owned(compare)}, ptr ${env}`;
      this.emit(line);
      // Its own owner, since code emitted twice, as a `finally` is, makes two.
      const line3 = `${this.cur().symbol} ${compare.start}`;
      through = `@fsh.sort.compare.${this.stableId("sort.compare", line3, `unique ${this.taken.size}`)}`;
      this.thunk(through, "i32", (cg) => {
        const arg = (cg: Mut<Codegen>, p: string, given: Type | undefined): string[] => {
          if (given === undefined) return [];
          if (cg.isRef(given) && !cg.isRef(element)) return [`ptr ${p}`];
          const v = cg.temp();
          cg.emit(`${v} = load ${cg.llvm(element)}, ptr ${p}`);
          const copied2 = cg.copied(v, element);
          return [`${cg.llvm(given)} ${cg.convert(copied2, element, given)}`];
        };
        const takes = cg.tables.typing.rec(closure).params;
        const part = takes.length > 0 ? takes[0]! : undefined;
        const part2 = takes.length > 1 ? takes[1]! : undefined;
        const args = [...arg(cg, "%a", part), ...arg(cg, "%b", part2)];
        const slice2 = args.slice(0, cg.bodyAt(target).params.length as i64);
        const invoke2 = cg.invoke(target, "%p", slice2)!;
        const line2 = `ret i32 ${cg.sign(invoke2, cg.tables.typing.rec(closure).returns)}`;
        cg.emit(line2);
      }, ["ptr %a", "ptr %b"]);
    } else through = this.order(element);
    const [lengthAt, dataAt, length, data] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    // The scratch buffer is codegen's, so a comparator's panic frees it too.
    const [size, room, buffer] = [this.bytes(element, "1"), this.temp(), this.temp()];
    this.emit(`${room} = mul i64 ${length}, ${size}`);
    this.emit(`${buffer} = call ptr @fsh_rt_array_alloc(i64 ${room})`);
    const comparing: Type | undefined = closure;
    this.unwinding(`call void @fsh_rt_sort(ptr ${data}, i64 ${length}, i64 ${size}, ptr ${through}, ptr ${env}, ptr ${buffer})`, undefined, (cg: Mut<Codegen>) => {
      cg.emit(`call void @fsh_rt_free(ptr ${buffer})`);
      if (comparing !== undefined) cg.dropStashed(env, comparing);
    });
    this.emit(`call void @fsh_rt_free(ptr ${buffer})`);
    if (comparing !== undefined) this.dropStashed(env, comparing);
    return undefined;
  }


  // -1, 0 or 1 for a comparator's number, as its sign; NaN is 0, keeping the order.
  sign(this: Mut<this>, v: string, type: Type): string {
    const t = this.tables.typing.lower(type);
    const [less, more, some, result] = [this.temp(), this.temp(), this.temp(), this.temp()];
    const ty = this.llvm(t);
    if (isFloat(t)) {
      this.emit(`${less} = fcmp olt ${ty} ${v}, 0.0`);
      this.emit(`${more} = fcmp ogt ${ty} ${v}, 0.0`);
    } else {
      const signed = isInteger(t) && integerInfo(t).signed;
      this.emit(`${less} = icmp ${signed ? "slt" : "ult"} ${ty} ${v}, 0`);
      this.emit(`${more} = icmp ${signed ? "sgt" : "ugt"} ${ty} ${v}, 0`);
    }
    this.emit(`${some} = select i1 ${more}, i32 1, i32 0`);
    this.emit(`${result} = select i1 ${less}, i32 -1, i32 ${some}`);
    return result;
  }


  // The default order for an element type: numbers by value, strings by UTF-16 code units.
  order(this: Mut<this>, element: Type): string {
    const t = this.tables.typing.lower(element);
    const known = this.orders.get(this.tables.typing.keyOf(t));
    if ((known !== undefined && known !== "")) return known;
    const described2 = this.tables.typing.described(t);
    const name = `@fsh.sort.order.${this.stableId("sort.order", described2, this.tables.typing.keyOf(t))}`;
    this.orders.set(this.tables.typing.keyOf(t), name);
    this.thunk(name, "i32", (cg) => {
      const [a, b] = [cg.temp(), cg.temp()];
      cg.emit(`${a} = load ${cg.llvm(t)}, ptr %a`);
      cg.emit(`${b} = load ${cg.llvm(t)}, ptr %b`);
      if (t === "string") {
        const result = cg.temp();
        cg.emit(`${result} = call i32 @fsh_rt_str_compare(ptr ${a}, ptr ${b})`);
        cg.emit(`ret i32 ${result}`);
        return;
      }
      // A subtraction could overflow, so the two are compared instead.
      const [less, more, some, result] = [cg.temp(), cg.temp(), cg.temp(), cg.temp()];
      if (isFloat(t)) {
        cg.emit(`${less} = fcmp olt ${cg.llvm(t)} ${a}, ${b}`);
        cg.emit(`${more} = fcmp ogt ${cg.llvm(t)} ${a}, ${b}`);
      } else {
        const signed = isInteger(t) && integerInfo(t).signed;
        cg.emit(`${less} = icmp ${signed ? "slt" : "ult"} ${cg.llvm(t)} ${a}, ${b}`);
        cg.emit(`${more} = icmp ${signed ? "sgt" : "ugt"} ${cg.llvm(t)} ${a}, ${b}`);
      }
      cg.emit(`${some} = select i1 ${more}, i32 1, i32 0`);
      cg.emit(`${result} = select i1 ${less}, i32 -1, i32 ${some}`);
      cg.emit(`ret i32 ${result}`);
    }, ["ptr %a", "ptr %b"]);
    return name;
  }


  // `toReversed`, `toSorted`, `toSpliced` and `with`: a clone of the array, changed as `reverse`,
  // `sort`, `splice` and a write change theirs. The clone is held as a statement value until the
  // arguments and a comparator have run, so their panics drop it; until then it is unchanged, or
  // only permuted in its own buffer.
  copying(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, method: string, array: ArrayType, at: string): string {
    const element = this.tables.typing.rec(array).element;
    const t = this.llvm(element);
    const [lengthAt, length] = [this.temp(), this.temp()];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    // `with` checks its position, then writes over the clone's element, dropping the old one.
    let index: string | undefined = undefined;
    let given: string | undefined = undefined;
    const placed = method !== "with" ? undefined : this.delivered<[string, string]>((cg): [string, string] => {
      const operand = cg.value(e.args[0]!);
      const owned2 = cg.owned(e.args[1]!);
      const [i, v] = [operand, cg.hand(owned2, element)];
      const [negative, fromEnd, k, outside, fail, ok] = [cg.temp(), cg.temp(), cg.temp(), cg.temp(), cg.label(), cg.label()];
      cg.emit(`${negative} = icmp slt i64 ${i}, 0`);
      cg.emit(`${fromEnd} = add i64 ${length}, ${i}`);
      cg.emit(`${k} = select i1 ${negative}, i64 ${fromEnd}, i64 ${i}`);
      cg.emit(`${outside} = icmp uge i64 ${k}, ${length}`);
      cg.emit(`br i1 ${outside}, label %${fail}, label %${ok}`);
      cg.startBlock(fail);
      const line = `call void @fsh_rt_panic_index(ptr ${cg.cString(`panicked at ${cg.where({ start: e.start, end: e.end })}:\n`)}, i64 ${length}, i64 ${i})`;
      cg.unwinding(line);
      cg.emit("unreachable");
      cg.startBlock(ok);
      return [k, v];
    });
    if (placed !== undefined) [index, given] = placed;
    const whole = this.temp();
    this.emit(`${whole} = load ${ARRAY}, ptr ${at}`);
    const copy = this.alloca(ARRAY);
    if (given !== undefined) this.pending.push({ v: given, type: element });
    const held: { v: string; type: Type } = { v: this.copied(whole, array), type: array };
    this.emit(`store ${ARRAY} ${held.v}, ptr ${copy}`);
    this.pending.push({ v: held.v, type: held.type });
    if (method === "toReversed") this.changed(e, "reverse", array, copy);
    if (method === "toSorted") this.sorted(e, array, copy);
    if (method === "toSpliced" && e.args.length > 0) {
      const removed = this.changed(e, "splice", array, copy)!;
      if (this.cur().types.has(e)) this.dispose(removed, array);
    }
    this.pending = this.pending.filter((p) => !(p.v === held.v && p.type === held.type) && !(given !== undefined && p.v === given && p.type === element));
    if (index !== undefined) {
      const [dataAt, data, slot, old] = [this.temp(), this.temp(), this.temp(), this.temp()];
      this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${copy}, i32 0, i32 0`);
      this.emit(`${data} = load ptr, ptr ${dataAt}`);
      this.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${index}`);
      this.emit(`${old} = load ${t}, ptr ${slot}`);
      this.emit(`store ${t} ${given!}, ptr ${slot}`);
      this.dispose(old, element);
    }
    const v = this.temp();
    this.emit(`${v} = load ${ARRAY}, ptr ${copy}`);
    if (!this.cur().types.has(e)) this.pending.push({ v, type: array });
    return v;
  }


  // `shift`, `unshift`, `splice`, `reverse`, `fill` and `copyWithin`. Elements move in and out
  // bitwise, through the runtime's gap and take helpers; only `fill` and `copyWithin` make copies,
  // each stored before the element it replaces is dropped.
  changed(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, method: string, array: ArrayType, at: string): string | undefined {
    const element = this.tables.typing.rec(array).element;
    const t = this.llvm(element);
    const size = this.bytes(element, "1");
    // What the call takes over is dropped if a later argument panics before the call.
    const args = this.delivered((cg) => {
      let given: string[] = [];
      for (let i: usize = 0; i < e.args.length; i++) {
        const a: Ref<Expr> = e.args[i]!;
        if ((method === "splice" && i >= 2) || method === "unshift" || (method === "fill" && i === 0)) {
          const owned3 = cg.owned(a);
          given.push(cg.hand(owned3, element));
        } else given.push(cg.value(a));
      }
      return given;
    });
    const [lengthAt, length] = [this.temp(), this.temp()];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    // The values given, stored from index `from` on.
    const placed = (cg: Mut<Codegen>, values: string[], from: string) => {
      const [dataAt, data] = [cg.temp(), cg.temp()];
      cg.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
      cg.emit(`${data} = load ptr, ptr ${dataAt}`);
      let iAt: usize = 0;
      for (const v of values) {
        const i = iAt;
        iAt++;
        const [index, slot] = [cg.temp(), cg.temp()];
        cg.emit(`${index} = add i64 ${from}, ${i}`);
        cg.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${index}`);
        cg.emit(`store ${t} ${v}, ptr ${slot}`);
      }
    };
    if (method === "reverse") {
      this.emit(`call void @fsh_rt_array_reverse(ptr ${at}, i64 ${size})`);
      return undefined;
    }
    if (method === "unshift") {
      if (args.length === 0) return undefined;
      this.emit(`call void @fsh_rt_array_open(ptr ${at}, i64 0, i64 ${args.length}, i64 ${size})`);
      placed(this, args, "0");
      return undefined;
    }
    if (method === "shift") {
      const option = this.tables.typing.unionType([element, "null"]);
      const [empty, some, none, end] = [this.temp(), this.label(), this.label(), this.label()];
      this.emit(`${empty} = icmp eq i64 ${length}, 0`);
      this.emit(`br i1 ${empty}, label %${none}, label %${some}`);
      this.startBlock(some);
      const taken = this.alloca(ARRAY);
      this.emit(`call void @fsh_rt_array_take(ptr ${at}, i64 0, i64 1, i64 ${size}, ptr ${taken})`);
      const [dataAt, data, v] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${taken}, i32 0, i32 0`);
      this.emit(`${data} = load ptr, ptr ${dataAt}`);
      this.emit(`${v} = load ${t}, ptr ${data}`);
      this.emit(`call void @fsh_rt_free(ptr ${data})`);
      const held = this.convert(v, element, option);
      const someEnd = this.block;
      this.emit(`br label %${end}`);
      this.startBlock(none);
      const nothing = this.convert("zeroinitializer", "null", option);
      const noneEnd = this.block;
      this.emit(`br label %${end}`);
      this.startBlock(end);
      const result = this.temp();
      this.emit(`${result} = phi ${this.llvm(option)} [ ${held}, %${someEnd} ], [ ${nothing}, %${noneEnd} ]`);
      if (this.cur().types.has(e)) {
        const get2 = this.cur().types.get(e)!;
        return this.convert(result, option, get2);
      }
      this.pending.push({ v: result, type: option });
      return result;
    }
    if (method === "splice") {
      const start = this.position(args[0]!, length);
      const room = this.temp();
      this.emit(`${room} = sub i64 ${length}, ${start}`);
      let count = room;
      if (args.length > 1) {
        // A count below zero removes nothing, and one past the end removes what is there.
        const [negative, atLeast, over, kept] = [this.temp(), this.temp(), this.temp(), this.temp()];
        this.emit(`${negative} = icmp slt i64 ${args[1]!}, 0`);
        this.emit(`${atLeast} = select i1 ${negative}, i64 0, i64 ${args[1]!}`);
        this.emit(`${over} = icmp sgt i64 ${atLeast}, ${room}`);
        this.emit(`${kept} = select i1 ${over}, i64 ${room}, i64 ${atLeast}`);
        count = kept;
      }
      const removed = this.alloca(ARRAY);
      this.emit(`call void @fsh_rt_array_take(ptr ${at}, i64 ${start}, i64 ${count}, i64 ${size}, ptr ${removed})`);
      const items = args.slice(2);
      if (items.length > 0) {
        this.emit(`call void @fsh_rt_array_open(ptr ${at}, i64 ${start}, i64 ${items.length}, i64 ${size})`);
        placed(this, items, start);
      }
      const v = this.temp();
      this.emit(`${v} = load ${ARRAY}, ptr ${removed}`);
      if (!this.cur().types.has(e)) this.pending.push({ v, type: array });
      return v;
    }
    if (method === "copyWithin") {
      this.copiedWithin(args, element, length, at);
      return undefined;
    }
    // `fill`: a copy of the value in each slot of the range, then the value itself dropped.
    const given = args[0]!;
    const from = args.length > 1 ? this.position(args[1]!, length) : "0";
    const to = args.length > 2 ? this.position(args[2]!, length) : length;
    const index = this.alloca("i64");
    this.emit(`store i64 ${from}, ptr ${index}`);
    const [head, body, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more, dataAt, data, slot, old, after] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${to}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    const copy = this.copied(given, element);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    this.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
    this.emit(`${old} = load ${t}, ptr ${slot}`);
    this.emit(`store ${t} ${copy}, ptr ${slot}`);
    this.dispose(old, element);
    this.emit(`${after} = add i64 ${i}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    this.dispose(given, element);
    return undefined;
  }


  // `copyWithin(target, start, end?)`: a clone of each element of the range written over the
  // element `target - start` on, which drops. Copying back to front when the range runs over its
  // destination reads each element before it is written, as through a buffer.
  copiedWithin(this: Mut<this>, args: Ref<string[]>, element: Type, length: string, at: string) {
    const t = this.llvm(element);
    const to = this.position(args[0]!, length);
    const from = this.position(args[1]!, length);
    const end = args.length > 2 ? this.position(args[2]!, length) : length;
    const [span, room, shorter, count, after, ahead, overlaps, backward, last] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${span} = sub i64 ${end}, ${from}`);
    this.emit(`${room} = sub i64 ${length}, ${to}`);
    this.emit(`${shorter} = icmp slt i64 ${span}, ${room}`);
    this.emit(`${count} = select i1 ${shorter}, i64 ${span}, i64 ${room}`);
    this.emit(`${after} = add i64 ${from}, ${count}`);
    this.emit(`${ahead} = icmp slt i64 ${from}, ${to}`);
    this.emit(`${overlaps} = icmp slt i64 ${to}, ${after}`);
    this.emit(`${backward} = and i1 ${ahead}, ${overlaps}`);
    this.emit(`${last} = sub i64 ${count}, 1`);
    const index = this.alloca("i64");
    this.emit(`store i64 0, ptr ${index}`);
    const [head, body, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [k, more, back, j, dataAt, data, source, target, v, old, next] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${k} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${k}, ${count}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    this.emit(`${back} = sub i64 ${last}, ${k}`);
    this.emit(`${j} = select i1 ${backward}, i64 ${back}, i64 ${k}`);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    const [i, o] = [this.temp(), this.temp()];
    this.emit(`${i} = add i64 ${from}, ${j}`);
    this.emit(`${o} = add i64 ${to}, ${j}`);
    this.emit(`${source} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
    this.emit(`${target} = getelementptr ${t}, ptr ${data}, i64 ${o}`);
    this.emit(`${v} = load ${t}, ptr ${source}`);
    const copy = this.copied(v, element);
    this.emit(`${old} = load ${t}, ptr ${target}`);
    this.emit(`store ${t} ${copy}, ptr ${target}`);
    this.dispose(old, element);
    this.emit(`${next} = add i64 ${k}, 1`);
    this.emit(`store i64 ${next}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
  }


  // Where `lastIndexOf` searches back from, as an end past it: a negative position counts from
  // the end, and one past the last element starts at the last.
  lastFrom(this: Mut<this>, v: string, length: string): string {
    const [negative, fromEnd, k, last, past, kept, end] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${negative} = icmp slt i64 ${v}, 0`);
    this.emit(`${fromEnd} = add i64 ${length}, ${v}`);
    this.emit(`${k} = select i1 ${negative}, i64 ${fromEnd}, i64 ${v}`);
    this.emit(`${last} = sub i64 ${length}, 1`);
    this.emit(`${past} = icmp sgt i64 ${k}, ${last}`);
    this.emit(`${kept} = select i1 ${past}, i64 ${last}, i64 ${k}`);
    this.emit(`${end} = add i64 ${kept}, 1`);
    return end;
  }


  // `concat` and `flat`: a new array of clones, of this array's elements then each argument's,
  // or of the elements of each array this one holds.
  gathered(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, method: string, array: ArrayType, at: string): string {
    const result = this.cur().types.get(e) ?? (method === "concat" ? array : this.tables.typing.lower(this.tables.typing.rec(array).element));
    const out = this.alloca(ARRAY);
    this.emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    // Each element of the array at `from`, cloned onto the end of the result.
    if (method === "flat") {
      const inner = this.tables.typing.rec(array).element as ArrayType;
      const part = this.tables.typing.rec(array).element;
      this.cloneAll(out, at, part, this.tables.typing.rec(inner).element);
    } else {
      // The arguments run first, as in JavaScript, before anything is cloned.
      const sources = e.args.map((a) => this.value(a));
      const part3 = this.tables.typing.rec(array).element;
      this.cloneAll(out, at, part3, undefined);
      for (const from of sources) {
        const part4 = this.tables.typing.rec(array).element;
        this.cloneAll(out, from, part4, undefined);
      }
    }
    const v = this.temp();
    this.emit(`${v} = load ${ARRAY}, ptr ${out}`);
    if (!this.cur().types.has(e)) this.pending.push({ v, type: result });
    return v;
  }


  // A position as JavaScript reads one against a length: a negative one counts from the end,
  // and either is kept between 0 and the length.
  position(this: Mut<this>, v: string, length: string): string {
    const [negative, fromEnd, low, high, past, kept, result] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${negative} = icmp slt i64 ${v}, 0`);
    this.emit(`${fromEnd} = add i64 ${length}, ${v}`);
    this.emit(`${low} = icmp slt i64 ${fromEnd}, 0`);
    this.emit(`${high} = select i1 ${low}, i64 0, i64 ${fromEnd}`);
    this.emit(`${past} = icmp sgt i64 ${v}, ${length}`);
    this.emit(`${kept} = select i1 ${past}, i64 ${length}, i64 ${v}`);
    this.emit(`${result} = select i1 ${negative}, i64 ${high}, i64 ${kept}`);
    return result;
  }


  // `includes`, `indexOf`, `join` and `slice`: one loop over the elements from a start
  // position, reading each where it lives.
  readingLoop(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, method: string, array: ArrayType, at: string): string | undefined {
    const element = this.tables.typing.rec(array).element;
    const t = this.llvm(element);
    const [lengthAt, dataAt, length, data] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    const args = e.args.map((a) => this.value(a));
    const searching = method === "includes" || method === "indexOf" || method === "lastIndexOf";
    const from = method === "slice" ? (args.length > 0 ? args[0]! : undefined) : (args.length > 1 ? args[1]! : undefined);
    const start = method !== "join" && method !== "lastIndexOf" && (from !== undefined && from !== "") ? this.position(from, length) : "0";
    // `lastIndexOf` looks at every element up to where it starts searching back from, and keeps
    // the last it finds.
    const end = method === "slice" && args.length > 1 ? this.position(args[1]!, length) : method === "lastIndexOf" && (from !== undefined && from !== "") ? this.lastFrom(from, length) : length;
    const result: Type = searching ? (method === "includes" ? "boolean" : "i64") : method === "join" ? "string" : array;
    const out = this.alloca(this.llvm(result));
    if (searching) this.emit(`store ${this.llvm(result)} ${method === "includes" ? "false" : "-1"}, ptr ${out}`);
    else if (method === "join") {
      const line = `store ptr ${this.text("")}, ptr ${out}`;
      this.emit(line);
    }
    else this.emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    const index = this.alloca("i64");
    this.emit(`store i64 ${start}, ptr ${index}`);
    const [head, body, next, done] = [this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${end}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    const [slot, v] = [this.temp(), this.temp()];
    this.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
    this.emit(`${v} = load ${t}, ptr ${slot}`);
    if (searching) {
      const hit = this.label();
      let same = this.conversions().equals(v, element, args[0]!, this.valueType(e.args[0]!));
      // `includes` finds NaN, as JavaScript's SameValueZero does; `indexOf` never does.
      if (method === "includes" && isFloat(this.tables.typing.lower(element)) && isFloat(this.tables.typing.lower(this.valueType(e.args[0]!)))) {
        const [here, there, both, either] = [this.temp(), this.temp(), this.temp(), this.temp()];
        this.emit(`${here} = fcmp uno ${t} ${v}, ${v}`);
        const lower2 = this.tables.typing.lower(this.valueType(e.args[0]!));
        const line2 = `${there} = fcmp uno ${this.llvm(lower2)} ${args[0]!}, ${args[0]!}`;
        this.emit(line2);
        this.emit(`${both} = and i1 ${here}, ${there}`);
        this.emit(`${either} = or i1 ${same}, ${both}`);
        same = either;
      }
      this.emit(`br i1 ${same}, label %${hit}, label %${next}`);
      this.startBlock(hit);
      this.emit(`store ${this.llvm(result)} ${method === "includes" ? "true" : i}, ptr ${out}`);
      this.emit(`br label %${method === "lastIndexOf" ? next : done}`);
    } else if (method === "join") {
      // ponytail: each element copies the text so far, quadratic in the result's length; an
      // in-place append of a uniquely owned string makes it linear.
      const so = this.temp();
      this.emit(`${so} = load ptr, ptr ${out}`);
      const [first, separated, joined] = [this.temp(), this.label(), this.label()];
      this.emit(`${first} = icmp eq i64 ${i}, 0`);
      const from = this.block;
      this.emit(`br i1 ${first}, label %${joined}, label %${separated}`);
      this.startBlock(separated);
      const part = (args.length > 0 ? args[0]! : undefined) ?? this.text(",");
      const withSep = this.concat(so, part);
      this.emit(`call void @fsh_rt_str_release(ptr ${so})`);
      const sepEnd = this.block;
      this.emit(`br label %${joined}`);
      this.startBlock(joined);
      const before = this.temp();
      this.emit(`${before} = phi ptr [ ${so}, %${from} ], [ ${withSep}, %${sepEnd} ]`);
      const mark = this.pending.length;
      const base = this.tables.typing.lower(element);
      const plain = isInteger(base) || isFloat(base) || base === "boolean";
      let piece: string;
      if (plain) {
        piece = this.written(v, base);
      } else {
        const convert2 = this.convert(v, element, "string");
        piece = this.written(convert2, "string");
      }
      const made = this.pending.splice(mark as i64);
      const after = this.concat(before, piece);
      this.emit(`call void @fsh_rt_str_release(ptr ${before})`);
      for (const p of made) this.dispose(p.v, p.type);
      this.emit(`store ptr ${after}, ptr ${out}`);
      this.emit(`br label %${next}`);
    } else {
      const copied2 = this.copied(v, element);
      this.appended(out, element, copied2);
      this.emit(`br label %${next}`);
    }
    this.startBlock(next);
    const after = this.temp();
    this.emit(`${after} = add i64 ${i}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    const r = this.temp();
    this.emit(`${r} = load ${this.llvm(result)}, ptr ${out}`);
    if (!this.cur().types.has(e) && this.needsDrop(result)) this.pending.push({ v: r, type: result });
    return r;
  }


  // The size in bytes of `count` elements, as LLVM lays them out.
  bytes(this: Mut<this>, element: Type, count: string): string {
    const [end, size] = [this.temp(), this.temp()];
    this.emit(`${end} = getelementptr ${this.llvm(element)}, ptr null, i64 ${count}`);
    this.emit(`${size} = ptrtoint ptr ${end} to i64`);
    return size;
  }


  // An array value from its buffer, length and capacity.
  built(this: Mut<this>, data: string, length: string, capacity: string): string {
    const [a, b, c] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${a} = insertvalue ${ARRAY} undef, ptr ${data}, 0`);
    this.emit(`${b} = insertvalue ${ARRAY} ${a}, i64 ${length}, 1`);
    this.emit(`${c} = insertvalue ${ARRAY} ${b}, i64 ${capacity}, 2`);
    return c;
  }


  // Runs `each` with a pointer to each of the first `length` elements of a buffer, and its index.
  elements(this: Mut<this>, element: Type, data: string, length: string, each: (cg: Mut<Codegen>, at: string, i: string) => void) {
    const counter = this.alloca("i64");
    this.emit(`store i64 0, ptr ${counter}`);
    const [test, loop, end] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${test}`);
    this.startBlock(test);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${counter}`);
    this.emit(`${more} = icmp ult i64 ${i}, ${length}`);
    this.emit(`br i1 ${more}, label %${loop}, label %${end}`);
    this.startBlock(loop);
    const at = this.temp();
    this.emit(`${at} = getelementptr ${this.llvm(element)}, ptr ${data}, i64 ${i}`);
    each(this, at, i);
    const next = this.temp();
    this.emit(`${next} = add i64 ${i}, 1`);
    this.emit(`store i64 ${next}, ptr ${counter}`);
    this.emit(`br label %${test}`);
    this.startBlock(end);
  }


  // `push` moves its argument in at the end, growing the buffer when full; `pop` takes the last
  // element out as an Option, empty when there is none. Both work on the array where it lives.
  arrayCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string | undefined {
    const type = this.valueType(callee.object) as ArrayType;
    const t = this.llvm(this.tables.typing.rec(type).element);
    const at = this.receiver(callee.object);
    const [lengthAt, dataAt] = [this.temp(), this.temp()];
    const field = (cg: Mut<Codegen>, to: string, i: usize) => cg.emit(`${to} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 ${i}`);
    if (callee.name === "push") {
      const owned2 = this.owned(e.args[0]!);
      this.appended(at, this.tables.typing.rec(type).element, owned2);
      return undefined;
    }
    if (callee.name === "sort") return this.sorted(e, type, at);
    if (["toReversed", "toSorted", "toSpliced", "with"].includes(callee.name)) return this.copying(e, callee.name, type, at);
    if (callee.name === "at") return this.elementAt(e, type, at);
    if (callee.name === "reserve") {
      // A count below zero panics, which drops what is live here.
      const line = `call void @fsh_rt_array_grow(ptr ${at}, i64 ${this.value(e.args[0]!)}, i64 ${this.bytes(this.tables.typing.rec(type).element, "1")}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
      this.unwinding(line);
      return undefined;
    }
    if (callee.name === "shrinkToFit") {
      const line2 = `call void @fsh_rt_array_shrink(ptr ${at}, i64 ${this.bytes(this.tables.typing.rec(type).element, "1")})`;
      this.emit(line2);
      return undefined;
    }
    if (callee.name === "concat" || callee.name === "flat") return this.gathered(e, callee.name, type, at);
    if (["shift", "unshift", "splice", "reverse", "fill", "copyWithin"].includes(callee.name)) return this.changed(e, callee.name, type, at);
    if (["includes", "indexOf", "lastIndexOf", "join", "slice"].includes(callee.name)) return this.readingLoop(e, callee.name, type, at);
    if (callee.name !== "pop") return this.callbackLoop(e, callee.name, type, at);
    const option = this.tables.typing.unionType([this.tables.typing.rec(type).element, "null"]);
    field(this, lengthAt, 1);
    const [length, empty, some, none, end] = [this.temp(), this.temp(), this.label(), this.label(), this.label()];
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${empty} = icmp eq i64 ${length}, 0`);
    this.emit(`br i1 ${empty}, label %${none}, label %${some}`);
    this.startBlock(some);
    const [last, data, slot, v] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${last} = sub i64 ${length}, 1`);
    this.emit(`store i64 ${last}, ptr ${lengthAt}`);
    field(this, dataAt, 0);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    this.emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${last}`);
    this.emit(`${v} = load ${t}, ptr ${slot}`);
    const held = this.convert(v, this.tables.typing.rec(type).element, option);
    const someEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(none);
    const nothing = this.convert("zeroinitializer", "null", option);
    const noneEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(end);
    const result = this.temp();
    this.emit(`${result} = phi ${this.llvm(option)} [ ${held}, %${someEnd} ], [ ${nothing}, %${noneEnd} ]`);
    // Used as a statement, the call has no type of its own; what it took out drops after it.
    if (this.cur().types.has(e)) {
      const get2 = this.cur().types.get(e)!;
      return this.convert(result, option, get2);
    }
    this.pending.push({ v: result, type: option });
    return result;
  }


  // A pointer to an array's element, after the bounds check.
  // An array that is a place is read after the index runs, which may change it; a temporary
  // one runs first, as JavaScript runs an index's object. An index an assignment already ran is
  // reused, with the bounds checked again.
  element(this: Mut<this>, e: Ref<Extract<Expr, { kind: "index" }>>): string {
    const held = this.cur().types.get(e.object)!;
    const inline = this.recOf(this.referent(held));
    if (inline?.kind === "fixed") return this.fixedElement(e, this.referent(held) as FixedType);
    const type = this.valueType(e.object) as ArrayType;
    let index = this.fixed.get(e.index);
    let array: string;
    if (index === undefined && !this.lendable(e.object)) {
      array = this.value(e.object);
      index = this.value(e.index);
    } else {
      if (index === undefined) index = this.value(e.index);
      array = this.value(e.object);
    }
    const [data, length, at] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
    this.bounds(length, index, { start: e.start, end: e.end }, (this.tables.restStarts.get(e.object) ?? 0) as i64);
    this.emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
    this.emit(`${at} = getelementptr ${this.llvm(this.tables.typing.rec(type).element)}, ptr ${data}, i64 ${index}`);
    return at;
  }


  // `FixedArray.filled<T, N>(v)`: a copy of `v` in each slot but the last, which takes `v`
  // itself, filled in a loop so a large one stays small.
  fixedFilled(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, type: FixedType): string {
    const element = this.tables.typing.rec(type).element;
    const v = this.owned(e.args[0]!);
    if (this.tables.typing.rec(type).size === 0) {
      this.dispose(v, element);
      return "undef";
    }
    const at = this.alloca(this.llvm(type));
    const index = this.alloca("i64");
    this.emit(`store i64 0, ptr ${index}`);
    const [head, body, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp ult i64 ${i}, ${this.tables.typing.rec(type).size - 1}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    const [slot, after] = [this.temp(), this.temp()];
    this.emit(`${slot} = getelementptr ${this.llvm(type)}, ptr ${at}, i64 0, i64 ${i}`);
    const line = `store ${this.llvm(element)} ${this.copied(v, element)}, ptr ${slot}`;
    this.emit(line);
    this.emit(`${after} = add i64 ${i}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
    const last = this.temp();
    this.emit(`${last} = getelementptr ${this.llvm(type)}, ptr ${at}, i64 0, i64 ${this.tables.typing.rec(type).size - 1}`);
    this.emit(`store ${this.llvm(element)} ${v}, ptr ${last}`);
    const result = this.temp();
    this.emit(`${result} = load ${this.llvm(type)}, ptr ${at}`);
    if (!this.cur().types.has(e) && this.needsDrop(type)) this.pending.push({ v: result, type });
    return result;
  }


  // A pointer to a fixed array's element, after the bounds check against its known length: the
  // array is where it lives, through a reference, or a temporary spilled to a slot.
  fixedElement(this: Mut<this>, e: Ref<Extract<Expr, { kind: "index" }>>, type: FixedType): string {
    const held = this.cur().types.get(e.object)!;
    let index = this.fixed.get(e.index);
    let base: string;
    if (this.isRef(held)) {
      base = this.evaluate(e.object);
      if (index === undefined) index = this.value(e.index);
    } else if (this.lendable(e.object)) {
      if (index === undefined) index = this.value(e.index);
      base = this.address(e.object);
    } else {
      const v = this.value(e.object);
      if (index === undefined) index = this.value(e.index);
      base = this.alloca(this.llvm(type));
      this.emit(`store ${this.llvm(type)} ${v}, ptr ${base}`);
    }
    this.bounds(String(this.tables.typing.rec(type).size), index, { start: e.start, end: e.end });
    const at = this.temp();
    this.emit(`${at} = getelementptr ${this.llvm(type)}, ptr ${base}, i64 0, i64 ${index}`);
    return at;
  }


  // Whether an expression makes a value of its own, rather than reading one that lives somewhere.
  // A conditional or `??` makes one from whichever side it gives.
  fresh(this: Mut<this>, eGiven: Ref<Expr>): boolean {
    const e = this.unwrapped(eGiven);
    const get2 = this.cur().types.get(e);
    if (!this.needsDrop(get2)) return false;
    switch (e.kind) {
      case "call":
      case "new":
      case "object":
      case "arrow":
      case "comptime":
      case "template":
      case "conditional":
      case "array":
      case "match":
      case "pipe":
      case "yield":
        return true;
      // An awaited future gives its value over.
      // Every operator on a bigint makes a new one; a literal is a constant.
      case "unary":
        return e.op === "await" || this.cur().types.get(e) === "bigint";
      case "binary":
        return e.op === "+" || e.op === "??" || this.cur().types.get(e) === "bigint";
      case "member":
        return this.cur().calls.has(e) || this.cur().copiesOut.has(e) || this.tables.computed.has(e) || this.tables.jsMembers.has(e) || this.tables.jsStatics.has(e);
      // A JsValue read out of JS as a string, or a package's const.
      case "ident":
        return this.cur().copiesOut.has(e) || this.tables.jsExports.has(e);
      // A string's index makes a string; an array's reads an element.
      case "index":
        return !this.indexes(this.valueType(e.object));
      default:
        return false;
    }
  }


  // What `as`, `satisfies` and `unsafe` wrappers that convert nothing wrap.
  unwrapped<A extends Lifetime>(this: Mut<this>, eGiven: Ref<Expr, A>): Ref<Expr, A> {
    let e: Ref<Expr, A> = eGiven;
    while (this.wraps(e)) e = innerOf(e);
    return e;
  }

  // What a wrapper with no conversion of its own hands on, so it owns what its operand owns.
  handedOn<A extends Lifetime>(this: Mut<this>, eGiven: Ref<Expr, A>): Ref<Expr, A> {
    let e: Ref<Expr, A> = eGiven;
    while (this.wraps(e) && !this.cur().coercions.has(e)) e = innerOf(e);
    return e;
  }


  // A wrapper whose value is its operand's, made for the statement exactly when the operand's is.
  wraps(this: Mut<this>, e: Ref<Expr>): e is Extract<Expr, { kind: "as" | "satisfies" | "unsafe" }> {
    return e.kind === "satisfies" || e.kind === "unsafe" || (e.kind === "as" && this.widens(e));
  }


  // An expression's value for a place to own: one it made, the value of a place it moves out
  // of, which is left empty, or else a copy holding another reference to what it owns. A
  // conversion that leaves part of a value behind copies the part it keeps.
  owned(this: Mut<this>, e: Ref<Expr>): string {
    if (this.handedOn(e) !== e) {
      const handedOn2 = this.handedOn(e);
      return this.owned(handedOn2);
    }
    // A shared callback has no slot to empty: its closure stays the caller's to drop.
    if (this.pairOf(e) !== undefined) return this.value(e);
    const to = this.cur().coercions.get(e);
    // A value boxed into a Dyn: the block takes it, moved out of its place or made for it, or
    // else a copy of it. One boxed into a union's Dyn then goes into the union.
    // So is a stored callable held in one that throws more.
    const dyn = this.tables.boxedMembers.get(e) ?? (to !== undefined && this.isDyn(to) ? to : undefined);
    if (to !== undefined && dyn !== undefined && (!this.isDyn(this.cur().types.get(e)!) || this.relays(this.cur().types.get(e)!, dyn))) {
      const type = this.cur().types.get(e)!;
      let v = this.known.get(e) ?? this.evaluate(e);
      if (this.cur().consumes.has(e.id) && this.lendable(e)) {
        const chosen = e.kind === "member" ? this.stored(e) : type;
        const line = `store ${this.llvm(chosen)} zeroinitializer, ptr ${this.address(e)}`;
        this.emit(line);
      }
      else if (!this.fresh(e)) v = this.copied(v, type);
      if (to === dyn) {
        return this.box(v, type, dyn);
      }
      const box2 = this.box(v, type, dyn);
      return this.convert(box2, dyn, to);
    }
    // A value read out of a recursive type's block, when it is given up, leaves the block to be
    // freed.
    if (to !== undefined && !this.isRef(to) && this.unboxes(this.cur().types.get(e)!, to)) {
      const type = this.cur().types.get(e)!;
      const v = this.known.get(e) ?? this.evaluate(e);
      const out = this.convert(v, type, to);
      if (this.fresh(e)) this.freeBlocks(v, type);
      else if (this.cur().consumes.has(e.id) && this.lendable(e)) {
        this.freeBlocks(v, type);
        const placeType2 = this.placeType(e);
        const line2 = `store ${this.llvm(placeType2)} zeroinitializer, ptr ${this.address(e)}`;
        this.emit(line2);
      } else return this.copied(out, to);
      return out;
    }
    // A value moving into a recursive type's block is taken, or copied, first.
    if (to !== undefined && this.boxes(this.cur().types.get(e)!, to)) {
      const type = this.cur().types.get(e)!;
      let v = this.known.get(e) ?? this.evaluate(e);
      if (this.cur().consumes.has(e.id) && this.lendable(e)) this.take(e);
      else if (!this.fresh(e)) v = this.copied(v, type);
      return this.convert(v, type, to);
    }
    const whole = to === undefined || this.keepsAll(this.cur().types.get(e)!, to);
    // A Rust handle is never copied: one made here, or moved out of its place, is taken whole.
    const get2 = this.cur().types.get(e)!;
    const rust = this.holdsRust(get2);
    if ((whole || rust) && this.fresh(e)) return this.value(e, true);
    if (!rust && !this.needsDrop(this.cur().types.get(e)!) && this.holdsRust(this.valueType(e))) return this.value(e);
    // A value owning nothing meets a recursive type's blocks only as the blocks just made for it.
    if (to !== undefined && !this.needsDrop(this.referent(this.cur().types.get(e)!)) && this.tables.typing.holdsPart(to, (t) => this.recOf(t)?.kind === "recursive")) return this.value(e, true);
    const v = this.value(e);
    if ((whole || rust) && this.cur().consumes.has(e.id) && this.lendable(e)) {
      this.take(e);
      return v;
    }
    return e.kind === "string" ? v : this.copied(v, this.valueType(e));
  }


  // Leaves a place empty once its value is moved out. A value read out of a recursive type's
  // block leaves the block behind, which is freed.
  take(this: Mut<this>, e: Ref<Expr>) {
    const at = this.address(e);
    const place = this.placeType(e);
    if (place !== this.cur().types.get(e)) {
      const held = this.temp();
      this.emit(`${held} = load ${this.llvm(place)}, ptr ${at}`);
      this.freeBlocks(held, place);
    }
    this.emit(`store ${this.llvm(place)} zeroinitializer, ptr ${at}`);
  }


  // Where a place's value lives: in the place, or in the block a recursive type's place holds.
  blockOf(this: Mut<this>, at: string, place: Type): string {
    if (this.recOf(place)?.kind !== "recursive") return at;
    const block = this.temp();
    this.emit(`${block} = load ptr, ptr ${at}`);
    return block;
  }


  // The type a place holds its value as: a field's or an element's own, or the variable's.
  placeType(this: Mut<this>, e: Ref<Expr>): Type {
    if (e.kind === "member") return this.stored(e);
    if (e.kind === "index" && this.indexes(this.valueType(e.object))) {
      const object = this.valueType(e.object);
      return this.tables.typing.rec(this.referent(object) as ArrayType | FixedType).element;
    }
    return this.cur().types.get(e)!;
  }


  // Frees a value's own recursive block, or the one its union holds, without what is in it.
  freeBlocks(this: Mut<this>, v: string, type: Type) {
    const r = this.recOf(type);
    if (r?.kind === "recursive") {
      this.emit(`call void @fsh_rt_free(ptr ${v})`);
      return;
    }
    if (r?.kind !== "union") return;
    const blocks = r.members.filter((m) => this.recOf(m)?.kind === "recursive");
    if (blocks.length === 0) return;
    const tag = this.temp();
    this.emit(`${tag} = extractvalue ${this.llvm(type)} ${v}, 0`);
    const cases = blocks.map(() => this.label());
    const end = this.label();
    this.emit(`switch i32 ${tag}, label %${end} [ ${blocks.map((m, i) => `i32 ${r.members.indexOf(m)}, label %${cases[i as usize]!}`).join(" ")} ]`);
    let iAt: usize = 0;
    for (const m of blocks) {
      const i = iAt;
      iAt++;
      this.startBlock(cases[i as usize]!);
      const line = `call void @fsh_rt_free(ptr ${this.convert(v, type, m)})`;
      this.emit(line);
      this.emit(`br label %${end}`);
    }
    this.startBlock(end);
  }


  // Whether converting a value reads some of it out of a recursive type's block.
  unboxes(from: Type, to: Type): boolean {
    if (from === to) return false;
    const fromAll = membersOf(this.tables.typing, from);
    const toAll = membersOf(this.tables.typing, to);
    return fromAll.some((m) => this.recOf(m)?.kind === "recursive" && !toAll.includes(m));
  }


  // Whether converting a value moves some of it into a recursive type's block.
  boxes(from: Type, to: Type): boolean {
    if (from === to) return false;
    const fromAll = membersOf(this.tables.typing, this.referent(from));
    const toAll = membersOf(this.tables.typing, to);
    return toAll.some((m) => this.recOf(m)?.kind === "recursive") && fromAll.some((m) => !toAll.includes(m));
  }


  // Whether converting a value from one type to another keeps all it owns: putting it in a
  // union, taking a union's member out, or moving it to a union holding all its members.
  keepsAll(this: Mut<this>, from: Type, to: Type): boolean {
    const members = (cg: Mut<Codegen>, t: Type) => {
      const r = cg.recOf(t);
      return r?.kind === "union" ? r.members : [t];
    };
    // Types that lower to the same one convert as they are, as `convert` takes them.
    if (!this.needsDrop(from) || this.isDyn(to) || this.tables.typing.lower(from) === this.tables.typing.lower(to) || members(this, from).every((m) => members(this, to).includes(m)) || members(this, from).includes(to)) return true;
    return members(this, from).every((m) => members(this, to).some((t) => this.keepsPart(m, t)));
  }


  // Whether a member converts to another keeping all it owns: moved into a recursive type's
  // block, or an object whose fields each do.
  keepsPart(this: Mut<this>, from: Type, to: Type): boolean {
    const target = this.recOf(to);
    if (target !== undefined && target.kind === "recursive") return this.keepsAll(from, target.of);
    const source = this.recOf(from);
    if (source === undefined || source.kind !== "object" || target === undefined || target.kind !== "object") return false;
    return source.fields.every((f) => {
      const kept = this.tables.typing.field(to as ObjectType, f.name);
      return kept !== undefined ? this.keepsAll(f.type, kept.type) : !this.needsDrop(f.type);
    });
  }


  // A receiver copied into a slot for an owning method: the copy is its own, pending until the
  // call takes it.
  spill(this: Mut<this>, slot: string, type: Type, v: string): string {
    const copy = this.copied(v, type);
    this.pending.push({ v: copy, type });
    this.spills.push({ slot, type, v: copy });
    return copy;
  }


  // A value read for an operand. One read from a place takes a reference of its own while a
  // later operand that might change the place runs, released when the statement ends.
  operand(this: Mut<this>, e: Ref<Expr>, later: Ref<Expr[]>, from: usize): string {
    const v = this.value(e);
    let written = false;
    for (let i = from; i < later.length; i++) if (this.writes(later[i]!)) written = true;
    return this.kept(e, v, written);
  }

  // An operand evaluated before `later`, which may write what it reads.
  operandBefore(this: Mut<this>, e: Ref<Expr>, later: Ref<Expr>): string {
    const v = this.value(e);
    return this.kept(e, v, this.writes(later));
  }

  kept(this: Mut<this>, e: Ref<Expr>, v: string, written: boolean): string {
    const type = this.valueType(e);
    if (!this.needsDrop(type) || this.fresh(e) || e.kind === "string" || !written || this.holdsRust(type)) return v;
    const copy = this.copied(v, type);
    this.pending.push({ v: copy, type });
    return copy;
  }


  // Whether running an expression might change a place: it assigns, updates or calls.
  writes(e: Ref<Expr>): boolean {
    let found = false;
    walkWhile({ of: "expr", node: e }, (n) => {
      if (found) return false;
      // A call signature in a type, as in `as { (): T }`, counts too.
      if (n.of === "typeMember" && n.node.kind === "call") found = true;
      if (n.of !== "expr") return true;
      const x = n.node;
      if (x.kind === "arrow") return false;
      if (x.kind === "assign" || x.kind === "update" || x.kind === "call" || x.kind === "new") found = true;
      if (x.kind === "member" && this.cur().calls.has(x)) found = true;
      return true;
    });
    return found;
  }


  // Owned values handed to something not yet called or built: dropped if an error leaves before
  // it takes them.
  delivered<T>(this: Mut<this>, make: (cg: Mut<Codegen>) => T): T {
    const mark = this.handing.length;
    const result = make(this);
    const handed = this.handing.splice(mark as i64);
    this.pending = this.pending.filter((entry) => !handed.some((h) => h.v === entry.v && h.type === entry.type));
    return result;
  }

  // A value handed over inside `delivered`: pending until whatever takes it is called.
  hand(this: Mut<this>, v: string, type: Type): string {
    this.pending.push({ v, type });
    this.handing.push({ v, type });
    return v;
  }


  // Releases the values made since `mark` that nothing took over, newest first.
  settle(this: Mut<this>, mark: usize = this.floor) {
    let reversed = this.pending.splice(mark as i64);
    reversed.reverse();
    for (const { v, type } of reversed) this.dispose(v, type);
  }


  // A variable the innermost scope owns. Its slot starts empty, so dropping it before it is set,
  // or again after, does nothing.
  own(this: Mut<this>, at: string, type: Type, empty = true) {
    if (!this.needsDrop(type)) return;
    if (empty && !this.framed.has(at)) this.allocas.push(`  store ${this.llvm(type)} zeroinitializer, ptr ${at}`);
    this.scopes[this.scopes.length - 1]!.held.push({ slot: at, type });
  }


  // Drops what the scopes from `depth` inward own, innermost and newest first, emptying each.
  drop(this: Mut<this>, depth: usize) {
    let reversed = this.scopes.slice(depth as i64);
    reversed.reverse();
    for (const scope of reversed) {
      let held = [...scope.held];
      held.reverse();
      for (const { slot, type } of held) {
        const v = this.temp();
        this.emit(`${v} = load ${this.llvm(type)}, ptr ${slot}`);
        this.emit(`store ${this.llvm(type)} zeroinitializer, ptr ${slot}`);
        this.dispose(v, type);
      }
    }
  }


  /** @throws {CompileError} */
  scoped(this: Mut<this>, body: Ref<Stmt[]>) {
    this.scopes.push({ transient: false, held: [] });
    for (const each of body) this.statement(each);
    this.drop(this.scopes.length - 1);
    this.scopes.pop();
  }


  // Returns the call's result, or undefined for a call that returns nothing.
  compare(this: Mut<this>, type: string, a: string, b: string): string {
    const result = this.temp();
    this.emit(`${result} = ${type === "float" || type === "double" ? "fcmp oeq" : "icmp eq"} ${type} ${a}, ${b}`);
    return result;
  }


  // A method's receiver runs before its arguments, as in JavaScript. A method called in an
  // optional chain runs only when the chain isn't empty.
  call(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string | undefined {
    if (this.tables.fixedFills.has(e)) {
      const get2 = this.cur().types.get(e) as FixedType;
      return this.fixedFilled(e, get2);
    }
    if (this.tables.stringBuilds.has(e)) return this.stringBuilt(e, this.tables.stringBuilds.get(e)!);
    // A joined handle is the same task's pointer.
    if (this.tables.joinCalls.has(e)) return this.owned((e.callee as Extract<Expr, { kind: "member" }>).object);
    if (this.cur().absent?.has(e) === true) return this.absentCall(e);
    if (e.callee.kind === "member" && this.unwraps(e.callee.object)) return this.link(e, e.callee.object, (cg) => cg.run(e));
    return this.run(e);
  }


  // A call of an optional method this instance's type leaves out: `?.()` gives the empty Option
  // without running its arguments, and a plain call, which only a check that is false here
  // guards, is never reached.
  absentCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string | undefined {
    const type = this.cur().types.get(e);
    if (this.tables.optionalCalls.has(e)) {
      this.ranFor((e.callee as Extract<Expr, { kind: "member" }>).object);
      return (type !== undefined ? this.convert("zeroinitializer", "null", type) : undefined);
    }
    this.emit("unreachable");
    const label2 = this.label();
    this.startBlock(label2);
    return (type !== undefined ? "undef" : undefined);
  }


  // node:fs's blocking calls: what each gives, or a failure raised as the IoError the runtime's
  // parts make.
  syncFile(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, name: string): string | undefined {
    const path = this.operand(e.args[0]!, e.args, 1);
    if (name === "pathExists") {
      const [found, result] = [this.temp(), this.temp()];
      this.emit(`${found} = call i32 @fsh_rt_fs_exists(ptr ${path})`);
      this.emit(`${result} = icmp ne i32 ${found}, 0`);
      return result;
    }
    const parts = this.alloca("[4 x ptr]");
    const status = this.temp();
    // What a call fills in, read once it has succeeded.
    // What a call fills in, read once it has succeeded.
    let read: { how: string; type: string; slots: string[] } | undefined = undefined;
    switch (name) {
      case "fileReadSync":
      case "dirRead": {
        const out = this.alloca(ARRAY);
        this.emit(`${status} = call i32 @fsh_rt_fs_${name === "dirRead" ? "readdir" : "read_sync"}(ptr ${path}, ptr ${out}, ptr ${parts})`);
        read = { how: "load", type: ARRAY, slots: [out] };
        break;
      }
      case "fileWriteSync": {
        // The bytes are handed over, as to any call, and released once written.
        const [bytes, given] = [this.alloca(ARRAY), this.owned(e.args[1]!)];
        this.emit(`store ${ARRAY} ${given}, ptr ${bytes}`);
        this.emit(`${status} = call i32 @fsh_rt_fs_write_sync(ptr ${path}, ptr ${bytes}, ptr ${parts})`);
        const arrayType2 = this.tables.typing.arrayType("u8");
        this.dispose(given, arrayType2);
        break;
      }
      case "pathReal":
      case "pathRealNative":
      case "pathReadLink":
      case "dirTemp": {
        const out = this.alloca("ptr");
        const callee = name === "pathReal" ? "realpath" : name === "pathRealNative" ? "realpath_native" : name === "pathReadLink" ? "readlink" : "mkdtemp";
        this.emit(`${status} = call i32 @fsh_rt_fs_${callee}(ptr ${path}, ptr ${out}, ptr ${parts})`);
        read = { how: "load", type: "ptr", slots: [out] };
        break;
      }
      case "pathStat": {
        const [numbers, mtime, follow] = [this.alloca("[3 x i64]"), this.alloca("double"), this.temp()];
        const line = `${follow} = zext i1 ${this.value(e.args[1]!)} to i32`;
        this.emit(line);
        this.emit(`${status} = call i32 @fsh_rt_fs_stat(ptr ${path}, i32 ${follow}, ptr ${numbers}, ptr ${mtime}, ptr ${parts})`);
        read = { how: "stat", type: "", slots: [numbers, mtime] };
        break;
      }
      case "processSpawn": {
        const [args, input] = [this.alloca(ARRAY), this.alloca(ARRAY)];
        const line2 = `store ${ARRAY} ${this.operand(e.args[1]!, e.args, 2)}, ptr ${args}`;
        this.emit(line2);
        const cwd = this.operand(e.args[2]!, e.args, 3);
        const line3 = `store ${ARRAY} ${this.operand(e.args[3]!, e.args, 4)}, ptr ${input}`;
        this.emit(line3);
        const flags = this.operand(e.args[4]!, e.args, 5);
        const env = this.alloca(ARRAY);
        const line4 = `store ${ARRAY} ${this.value(e.args[5]!)}, ptr ${env}`;
        this.emit(line4);
        const [numbers, out, err] = [this.alloca("[3 x i64]"), this.alloca(ARRAY), this.alloca(ARRAY)];
        this.emit(`${status} = call i32 @fsh_rt_spawn_sync(ptr ${path}, ptr ${args}, ptr ${cwd}, ptr ${input}, i64 ${flags}, ptr ${env}, ptr ${numbers}, ptr ${out}, ptr ${err}, ptr ${parts})`);
        read = { how: "spawn", type: "", slots: [numbers, out, err] };
        break;
      }
      case "pathRemove": {
        const [recursive, force] = [this.temp(), this.temp()];
        const line5 = `${recursive} = zext i1 ${this.value(e.args[1]!)} to i32`;
        this.emit(line5);
        const line6 = `${force} = zext i1 ${this.value(e.args[2]!)} to i32`;
        this.emit(line6);
        this.emit(`${status} = call i32 @fsh_rt_fs_rm(ptr ${path}, i32 ${recursive}, i32 ${force}, ptr ${parts})`);
        break;
      }
      case "pathRename":
      case "fileCopy": {
        const to = this.operand(e.args[1]!, e.args, 2);
        const flags = name === "fileCopy" ? `i64 ${this.value(e.args[2]!)}, ` : "";
        this.emit(`${status} = call i32 @fsh_rt_fs_${name === "fileCopy" ? "copyfile" : "rename"}(ptr ${path}, ptr ${to}, ${flags}ptr ${parts})`);
        break;
      }
      case "pathLink": {
        const [to, symbolic] = [this.operand(e.args[1]!, e.args, 2), this.temp()];
        const line7 = `${symbolic} = zext i1 ${this.value(e.args[2]!)} to i32`;
        this.emit(line7);
        this.emit(`${status} = call i32 @fsh_rt_fs_link(ptr ${path}, ptr ${to}, i32 ${symbolic}, ptr ${parts})`);
        break;
      }
      case "pathUnlink":
        this.emit(`${status} = call i32 @fsh_rt_fs_unlink(ptr ${path}, ptr ${parts})`);
        break;
      case "pathAccess":
      case "pathChmod":
        const line8 = `${status} = call i32 @fsh_rt_fs_${name === "pathAccess" ? "access" : "chmod"}(ptr ${path}, i64 ${this.value(e.args[1]!)}, ptr ${parts})`;
        this.emit(line8);
        break;
      case "pathUtimes": {
        const follow = this.temp();
        const line9 = `${follow} = zext i1 ${this.value(e.args[3]!)} to i32`;
        this.emit(line9);
        const line10 = `${status} = call i32 @fsh_rt_fs_utimes(ptr ${path}, double ${this.value(e.args[1]!)}, double ${this.value(e.args[2]!)}, i32 ${follow}, ptr ${parts})`;
        this.emit(line10);
        break;
      }
      case "dirMake": {
        const [recursive, out] = [this.temp(), this.alloca("ptr")];
        const line11 = `${recursive} = zext i1 ${this.value(e.args[1]!)} to i32`;
        this.emit(line11);
        const line12 = `${status} = call i32 @fsh_rt_fs_mkdir(ptr ${path}, i32 ${recursive}, i64 ${this.value(e.args[2]!)}, ptr ${out}, ptr ${parts})`;
        this.emit(line12);
        read = { how: "mkdir", type: "", slots: [out] };
        break;
      }
    }
    const [failed, bad, good] = [this.temp(), this.label(), this.label()];
    this.emit(`${failed} = icmp ne i32 ${status}, 1`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${good}`);
    this.startBlock(bad);
    const part = this.cur().raises.get(e)!.from as ClassType;
    const ioError2 = this.ioError(parts, part);
    this.raised(e, ioError2);
    this.startBlock(good);
    if (read === undefined) return undefined;
    const result = this.syncRead(e, read);
    // Unused, as a statement, what a call gives is released when the statement ends.
    const list2: Type[] = ["i64", "i64", "i64", this.tables.typing.arrayType("u8"), this.tables.typing.arrayType("u8")];
    const gives: Record<string, Type> = { processSpawn: this.tables.typing.tupleType(list2), fileReadSync: this.tables.typing.arrayType("u8"), dirRead: this.tables.typing.arrayType("string"), pathReal: "string", pathRealNative: "string", pathReadLink: "string", dirTemp: "string", dirMake: this.tables.typing.unionType(["string", "null"]) };
    if (!this.cur().types.has(e) && gives[name] !== undefined) this.pending.push({ v: result, type: gives[name]! });
    return result;
  }


  // What a blocking call filled in, read once it succeeded.
  syncRead(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, read: Ref<{ how: string; type: string; slots: string[] }>): string {
    if (read.how === "load") {
      const v = this.temp();
      this.emit(`${v} = load ${read.type}, ptr ${read.slots[0]!}`);
      return v;
    }
    if (read.how === "stat") {
      const [numbers, mtime] = [read.slots[0]!, read.slots[1]!];
      const tuple = this.cur().types.get(e) as ObjectType;
      const number = (cg: Mut<Codegen>, i: usize) => {
        const [at, v] = [cg.temp(), cg.temp()];
        cg.emit(`${at} = getelementptr [3 x i64], ptr ${numbers}, i32 0, i32 ${i}`);
        cg.emit(`${v} = load i64, ptr ${at}`);
        return v;
      };
      const time = this.temp();
      this.emit(`${time} = load double, ptr ${mtime}`);
      let made = "zeroinitializer";
      const values = [number(this, 0), number(this, 1), time, number(this, 2)];
      for (let at: usize = 0; at < values.length; at++) {
        const field = `${at}`;
        const next = this.temp();
        this.emit(`${next} = insertvalue ${this.llvm(tuple)} ${made}, ${this.llvm(field === "2" ? "f64" : "i64")} ${values[at]!}, ${this.tables.typing.fieldPath(tuple, field).join(", ")}`);
        made = next;
      }
      return made;
    }
    if (read.how === "spawn") {
      const [numbers, out, err] = [read.slots[0]!, read.slots[1]!, read.slots[2]!];
      const list: Type[] = ["i64", "i64", "i64", this.tables.typing.arrayType("u8"), this.tables.typing.arrayType("u8")];
      const tuple = this.tables.typing.tupleType(list) as ObjectType;
      let made = "zeroinitializer";
      for (let i = 0; i < 5; i++) {
        const [at, v, next] = [this.temp(), this.temp(), this.temp()];
        if (i < 3) this.emit(`${at} = getelementptr [3 x i64], ptr ${numbers}, i32 0, i32 ${i}`);
        this.emit(`${v} = load ${i < 3 ? "i64" : ARRAY}, ptr ${i < 3 ? at : i === 3 ? out : err}`);
        this.emit(`${next} = insertvalue ${this.llvm(tuple)} ${made}, ${i < 3 ? "i64" : ARRAY} ${v}, ${this.tables.typing.fieldPath(tuple, String(i)).join(", ")}`);
        made = next;
      }
      return made;
    }
    const out = read.slots[0]!;
    const option = this.tables.typing.unionType(["string", "null"]);
    const [made, none, held] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${made} = load ptr, ptr ${out}`);
    this.emit(`${none} = icmp eq ptr ${made}, null`);
    const line13 = `${held} = select i1 ${none}, ${this.llvm(option)} ${this.convert("zeroinitializer", "null", option)}, ${this.llvm(option)} ${this.convert(made, "string", option)}`;
    this.emit(line13);
    return held;
  }


  // Each element of the array at `from` cloned onto the array at `out`; with `inner`, each element
  // is an array whose elements, of type `inner`, are cloned instead, as `flat` does.
  cloneAll(this: Mut<this>, out: string, from: string, element: Type, inner: Type | undefined): void {
    const [lengthAt, dataAt, length, data, index] = [this.temp(), this.temp(), this.temp(), this.temp(), this.alloca("i64")];
    this.emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${from}, i32 0, i32 1`);
    this.emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${from}, i32 0, i32 0`);
    this.emit(`${length} = load i64, ptr ${lengthAt}`);
    this.emit(`${data} = load ptr, ptr ${dataAt}`);
    this.emit(`store i64 0, ptr ${index}`);
    const [head, body, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more, slot, after] = [this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${length}`);
    this.emit(`br i1 ${more}, label %${body}, label %${done}`);
    this.startBlock(body);
    this.emit(`${slot} = getelementptr ${this.llvm(element)}, ptr ${data}, i64 ${i}`);
    if (inner !== undefined) this.cloneAll(out, slot, inner, undefined);
    else {
      const v = this.temp();
      this.emit(`${v} = load ${this.llvm(element)}, ptr ${slot}`);
      const copied2 = this.copied(v, element);
      this.appended(out, element, copied2);
    }
    this.emit(`${after} = add i64 ${i}, 1`);
    this.emit(`store i64 ${after}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
  }


  // `String.fromCharCode` and `String.fromCodePoint` over their gathered array, a temporary the
  // statement releases.
  stringBuilt(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, kind: "units" | "points"): string {
    const array = this.value(e.args[0]!);
    const [data, length, result] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
    this.emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
    if (kind === "units") this.emit(`${result} = call ptr @fsh_rt_str_from_units(ptr ${data}, i64 ${length})`);
    else {
      const line = `call ptr @fsh_rt_str_from_points(ptr ${data}, i64 ${length}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
      this.unwinding(line, result);
    }
    if (!this.cur().types.has(e)) this.pending.push({ v: result, type: "string" });
    return result;
  }


  // The slot of a parameter taken as a closure's address and code that `e` names.
  pairOf(e: Ref<Expr>): string | undefined {
    if (this.pairs.size === 0 || e.kind !== "ident") return undefined;
    const local = this.cur().locals.get(e);
    return local === undefined ? undefined : this.pairs.get(local);
  }


  run(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string | undefined {
    const target = this.callOf(e);
    const pair = (target !== undefined ? this.pairOf(e.callee) : undefined);
    if (pair !== undefined && target !== undefined) {
      const [both, env, code] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${both} = load ${PAIR}, ptr ${pair}`);
      this.emit(`${env} = extractvalue ${PAIR} ${both}, 0`);
      this.emit(`${code} = extractvalue ${PAIR} ${both}, 1`);
      const part4 = this.bodyAt(target).params.length;
      const values = this.argValues(e.args, target, part4);
      const result = this.invoke(target, env, values, exprKey(e), undefined, undefined, code);
      if ((result !== undefined && result !== "") && this.cur().types.has(e)) {
        const part5 = this.inst(target).returns;
        const get2 = this.cur().types.get(e)!;
        return this.convert(result!, part5, get2);
      }
      return result;
    }
    const js = this.tables.jsCalls.get(e);
    if (js !== undefined && target !== undefined) return this.jsCall(e, js, target);
    const statics = this.tables.jsStatics.get(e);
    if (statics !== undefined) return this.jsStatic(e, statics);
    if (target === undefined) {
      if (this.tables.formatCalls.has(e)) return this.formatted(e);
      if (this.tables.inspectCalls.has(e)) {
        const a: Ref<Expr> = e.args[0]!;
        const [slot, result] = [this.alloca(FARG), this.temp()];
        const chosen = a.kind === "string" ? this.text(a.value) : this.value(a);
        this.describe(slot, chosen, this.printedType(a), { text: false, depth: 2 });
        this.emit(`${result} = call ptr @fsh_rt_inspect(ptr ${slot})`);
        if (!this.cur().types.has(e)) this.pending.push({ v: result, type: "string" });
        return result;
      }
      // A print whose first argument may be a format prints what format gives.
      if (this.tables.printCalls.has(e) && this.formats(e.args)) {
        const line = this.formatted(e);
        // The statement releases the line, as it does a format call's value it drops.
        this.printer(printStream(e.callee)).write([[line, "string"]]);
        return undefined;
      }
      if (this.tables.printCalls.has(e)) {
        // Every argument runs before anything prints, as in JavaScript.
        const evaluated = e.args.map((a) => (a.kind === "string" ? "" : this.operand(a, e.args, e.args.indexOf(a) + 1)));
        this.printer(printStream(e.callee)).write(e.args.map((a, i) => (a.kind === "string" ? a.value : [evaluated[i]!, this.cur().spelled?.get(a) ?? this.valueType(a)])));
        return undefined;
      }
      // `Shape.Circle(1.5)`: a variant built from its payload, each value handed to it. Used as a
      // statement, it is dropped after it.
      const get7 = this.cur().types.get(e.callee);
      const built = this.recOf(get7);
      if (built?.kind === "variant") {
        const values = this.delivered((cg) => e.args.map((a, i) => {
            const owned2 = cg.owned(a);
            return cg.hand(owned2, built.fields[i]!.type);
          }));
        let result = "zeroinitializer";
        let iAt: usize = 0;
        for (const v of values) {
          const i = iAt;
          iAt++;
          const next = this.temp();
          const get8 = this.cur().types.get(e.callee) as VariantType;
          const line25 = `${next} = insertvalue ${this.llvm(get8)} ${result === "zeroinitializer" ? "undef" : result}, ${this.llvm(built.fields[i]!.type)} ${v}, ${i}`;
          this.emit(line25);
          result = next;
        }
        if (!this.cur().types.has(e)) this.pending.push({ v: result, type: this.cur().types.get(e.callee)! });
        return result;
      }
      // `ptrOf(r)` and `mutPtrOf(m)`: the address its argument is lent at.
      if (e.callee.kind === "ident" && (e.callee.name === "ptrOf" || e.callee.name === "mutPtrOf")) return this.value(e.args[0]!);
      if (e.callee.kind === "ident" && e.callee.name === "nullPtr") return "null";
      if (this.tables.maths.has(e)) return this.mathCall(e);
      if (this.tables.kindTests.has(e)) return this.conversions().test(e, false)!;
      if (this.tables.syncFileCalls.has(e)) return this.syncFile(e, this.tables.syncFileCalls.get(e)!);
      // `Promise.all` and `Promise.race`: their futures moved into the combined one's frame.
      if (this.tables.combinedCalls.has(e)) {
        const t = this.cur().types.get(e) as FutureType;
        if (e.args[0]!.kind !== "array") {
          const made = this.temp();
          const line2 = `${made} = insertvalue ${this.llvm(t)} zeroinitializer, ${ARRAY} ${this.owned(e.args[0]!)}, 1`;
          this.emit(line2);
          return made;
        }
        const list = ((e.args.length > 0 ? e.args[0]! : undefined) as Extract<Expr, { kind: "array" }>).elements as Expr[];
        const given = list.map((x) => this.owned(x));
        let frame = "zeroinitializer";
        let iAt2: usize = 0;
        for (const v of given) {
          const i = iAt2;
          iAt2++;
          const next = this.temp();
          this.emit(`${next} = insertvalue ${this.llvm(t)} ${frame}, ${this.llvm(this.valueType(list[i]!))} ${v}, ${1 + 3 * i}`);
          frame = next;
        }
        return frame;
      }
      if (this.tables.jsEvaluations.has(e)) {
        const made = this.temp();
        const line3 = `call ptr @fsh_rt_js_evaluate(ptr ${this.value(e.args[0]!)}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
        this.unwinding(line3, made);
        return made;
      }
      // The std's timers. A timer's callable goes to the runtime, the timer task started with
      // the first; the next one due is waited for as a leaf future holding only its state.
      const timer = this.tables.timerCalls.get(e);
      if (timer === "timerNext") {
        const frame = this.temp();
        const get9 = this.cur().types.get(e)!;
        const line26 = `${frame} = insertvalue ${this.llvm(get9)} zeroinitializer, i32 0, 0`;
        this.emit(line26);
        return frame;
      }
      if (timer === "timerClear") {
        const line4 = `call void @fsh_rt_timeout_clear(i64 ${this.value(e.args[0]!)})`;
        this.emit(line4);
        return undefined;
      }
      if (timer === "timerSet") {
        const callable = this.owned(e.args[0]!);
        const [ms, repeats] = [this.value(e.args[1]!), this.value(e.args[2]!)];
        const loop = this.valueType(e.args[3]!) as FutureType;
        const held = this.owned(e.args[3]!);
        const [block, table, repeat, claimed, id, start, skip, done] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.label(), this.label(), this.label()];
        this.emit(`${claimed} = call i32 @fsh_rt_timeouts_claim()`);
        const first = this.temp();
        this.emit(`${first} = icmp ne i32 ${claimed}, 0`);
        this.emit(`br i1 ${first}, label %${start}, label %${skip}`);
        this.startBlock(start);
        const [poll, drop, dropOutput] = this.taskGlue(loop);
        const [frame, task] = [this.alloca(this.llvm(loop)), this.temp()];
        this.emit(`store ${this.llvm(loop)} ${held}, ptr ${frame}`);
        this.unwinding(`call ptr @fsh_rt_spawn(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${this.sizeOf(this.llvm(loop))}, i64 ${this.sizeOf(this.pollType(loop))})`, task);
        this.emit(`call void @fsh_rt_timeouts_task(ptr ${task})`);
        this.emit(`br label %${done}`);
        this.startBlock(skip);
        this.dispose(held, loop);
        this.emit(`br label %${done}`);
        this.startBlock(done);
        this.emit(`${block} = extractvalue ${DYN} ${callable}, 0`);
        this.emit(`${table} = extractvalue ${DYN} ${callable}, 1`);
        this.emit(`${repeat} = zext i1 ${repeats} to i32`);
        this.emit(`${id} = call i64 @fsh_rt_timeout_set(ptr ${block}, ptr ${table}, i64 ${ms}, i32 ${repeat})`);
        return id;
      }
      // A file's future: the path, and a write's bytes, in its frame for the pool to take.
      if (this.tables.fileCalls.has(e)) {
        const future = this.cur().types.get(e) as FutureType;
        let frame = this.temp();
        const line5 = `${frame} = insertvalue ${this.llvm(future)} zeroinitializer, ptr ${this.owned(e.args[0]!)}, 1`;
        this.emit(line5);
        if (e.args.length > 1) {
          const next = this.temp();
          const line6 = `${next} = insertvalue ${this.llvm(future)} ${frame}, ${ARRAY} ${this.owned(e.args[1]!)}, 2`;
          this.emit(line6);
          frame = next;
        }
        return frame;
      }
      if (this.tables.clocks.has(e)) {
        const now = this.temp();
        const clock = this.tables.clocks.get(e);
        this.emit(clock === "Date.now" ? `${now} = call i64 @fsh_rt_date_now()` : `${now} = call double @fsh_rt_${clock === "Math.random" ? "math_random" : "performance_now"}()`);
        return now;
      }
      if (this.tables.jsonCalls.get(e) === "stringify") return this.stringifyCall(e);
      if (this.tables.jsonCalls.get(e) === "parse") return this.parseJsonCall(e);
      if (this.tables.parses.has(e)) return this.parseCall(e, this.tables.parses.get(e)!);
      if (this.tables.asserts.has(e)) return this.assertCall(e);
      if (this.tables.fixedPrints.has(e)) return this.toFixed(e);
      if (this.tables.integerCalls.has(e)) return this.integerMethodCall(e);
      if (this.tables.regexCalls.get(e) === "exec") return this.regexExec(e);
      if (this.tables.regexStringCalls.has(e)) return this.regexString(e, this.tables.regexStringCalls.get(e)!);
      if (this.tables.regexCalls.get(e) === "test") {
        const re = this.value((e.callee as Extract<Expr, { kind: "member" }>).object);
        const [found, yes] = [this.temp(), this.temp()];
        const line7 = `${found} = call i32 @fsh_rt_regex_test(ptr ${re}, ptr ${this.value(e.args[0]!)})`;
        this.emit(line7);
        this.emit(`${yes} = icmp ne i32 ${found}, 0`);
        return yes;
      }
      if (e.callee.kind === "ident" && e.callee.name === "fill length") {
        const n = this.value(e.args[0]!);
        if (!this.tables.lengthChecks.has(e)) return n;
        const [negative, fail, ok] = [this.temp(), this.label(), this.label()];
        this.emit(`${negative} = icmp slt i64 ${n}, 0`);
        this.emit(`br i1 ${negative}, label %${fail}, label %${ok}`);
        this.startBlock(fail);
        const line8 = `call void @fsh_rt_panic(ptr ${this.cString(`panicked at ${this.where({ start: e.start, end: e.end })}:\ninvalid array length\n`)})`;
        this.unwinding(line8);
        this.emit("unreachable");
        this.startBlock(ok);
        return n;
      }
      // `spawn(p)`: the future's frame moves into a new task, whose handle this gives.
      if (e.callee.kind === "ident" && (e.callee.name === "spawn" || e.callee.name === "timer spawn" || e.callee.name === "blocking spawn")) {
        const future = this.valueType(e.args[0]!) as FutureType;
        const [poll, drop, dropOutput] = this.taskGlue(future);
        const [frame, task] = [this.alloca(this.llvm(future)), this.temp()];
        const line9 = `store ${this.llvm(future)} ${this.owned(e.args[0]!)}, ptr ${frame}`;
        this.emit(line9);
        const spawning = { spawn: "fsh_rt_spawn", "timer spawn": "fsh_rt_spawn_now", "blocking spawn": "fsh_rt_spawn_blocking" }[e.callee.name];
        this.unwinding(`call ptr @${spawning}(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${this.sizeOf(this.llvm(future))}, i64 ${this.sizeOf(this.pollType(future))})`, task);
        if (!this.cur().types.has(e)) {
          const part = { v: task, type: this.tables.typing.handleType(this.tables.typing.rec(future).gives, this.tables.typing.rec(future).throws) };
          this.pending.push(part);
        }
        return task;
      }
      // `sleep(ms)`'s future holds the delay until its first poll makes it a deadline.
      if (e.callee.kind === "ident" && e.callee.name === "sleep") {
        const future = (this.cur().types.get(e) ?? SLEEP) as FutureType;
        const made = this.temp();
        const line10 = `${made} = insertvalue ${this.llvm(future)} zeroinitializer, i64 ${this.value(e.args[0]!)}, 1`;
        this.emit(line10);
        return this.signalled(e, future, made);
      }
      // `yieldNow()`'s future is its one state, not yet polled.
      if (e.callee.kind === "ident" && e.callee.name === "yieldNow") return "zeroinitializer";
      if (e.callee.kind === "ident" && e.callee.name === "cString") {
        const operand2 = this.value(e.args[0]!);
        return this.forC(operand2, e);
      }
      if (e.callee.kind === "ident" && e.callee.name === "shared" && !this.cur().locals.has(e.callee)) {
        const made = this.sharedNew(e, this.valueType(e) as SharedType);
        if (!this.cur().types.has(e)) this.pending.push({ v: made, type: this.valueType(e) });
        return made;
      }
      // `TcpListener.bind` and `TcpStream.connect` make a future holding the address, and the Unix
      // ones the path in the host's place; connect's frame also keeps the socket while it connects.
      if (e.callee.kind === "member" && e.callee.object.kind === "ident" && ["TcpListener", "TcpStream", "UnixListener", "UnixStream", "UdpSocket"].includes(e.callee.object.name) && !this.cur().types.has(e.callee.object)) {
        const future = this.cur().types.get(e) as FutureType;
        const first = this.tables.typing.leafOf.get(future)!.method === "connect" ? 2 : 1;
        const [host, made] = [this.owned(e.args[0]!), this.temp()];
        this.emit(`${made} = insertvalue ${this.llvm(future)} zeroinitializer, ptr ${host}, ${first}`);
        if (onPath(this.tables.typing, this.tables.typing.leafOf.get(future)!.of)) return this.signalled(e, future, made);
        const [port, frame] = [this.value(e.args[1]!), this.temp()];
        this.emit(`${frame} = insertvalue ${this.llvm(future)} ${made}, i64 ${port}, ${first + 1}`);
        return this.signalled(e, future, frame);
      }
      if (e.callee.kind === "member" && e.callee.object.kind === "ident" && e.callee.object.name === "AbortSignal" && !this.cur().types.has(e.callee.object)) {
        const made = this.temp();
        if (e.callee.name === "any") {
          const line11 = `${made} = call ptr @fsh_rt_signal_any(${this.signalList(e.args[0]!)})`;
          this.emit(line11);
        }
        else {
          const line12 = `${made} = call ptr @fsh_rt_signal_timeout(i64 ${this.value(e.args[0]!)})`;
          this.emit(line12);
        }
        if (!this.cur().types.has(e)) {
          const part2 = { v: made, type: this.tables.typing.blockType("AbortSignal") };
          this.pending.push(part2);
        }
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "nowMs" && !this.cur().calls.has(e)) {
        const made = this.temp();
        this.emit(`${made} = call i64 @fsh_rt_now_ms()`);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "shutdownSignal" && !this.cur().calls.has(e)) {
        const made = this.temp();
        this.emit(`${made} = call ptr @fsh_rt_signal_shutdown()`);
        if (!this.cur().types.has(e)) {
          const part3 = { v: made, type: this.tables.typing.blockType("AbortSignal") };
          this.pending.push(part3);
        }
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "unixUnlink" && !this.cur().calls.has(e)) {
        const line13 = `call void @fsh_rt_unix_unlink(ptr ${this.value(e.args[0]!)})`;
        this.emit(line13);
        return undefined;
      }
      if (e.callee.kind === "ident" && e.callee.name === "httpDate" && !this.cur().calls.has(e)) {
        const made = this.temp();
        this.emit(`${made} = call ptr @fsh_rt_http_date()`);
        if (!this.cur().types.has(e)) this.pending.push({ v: made, type: "string" });
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "utf8Encode" && !this.cur().calls.has(e)) {
        const [bytes, made] = [this.alloca(ARRAY), this.temp()];
        const line14 = `call void @fsh_rt_utf8_encode(ptr ${bytes}, ptr ${this.value(e.args[0]!)})`;
        this.emit(line14);
        this.emit(`${made} = load ${ARRAY}, ptr ${bytes}`);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "utf8Decode" && !this.cur().calls.has(e)) {
        const made = this.temp();
        const line15 = `${made} = call ptr @fsh_rt_utf8_decode(ptr ${this.value(e.args[0]!)})`;
        this.emit(line15);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "fromCString") {
        const made = this.temp();
        const line16 = `call ptr @fsh_rt_str_from_cstring(ptr ${this.value(e.args[0]!)})`;
        this.unwinding(line16, made);
        if (!this.cur().types.has(e)) this.pending.push({ v: made, type: "string" });
        return made;
      }
      // `Rc.ptrEq(a, b)` is given each Rc borrowed, a pointer to its handle.
      if (e.callee.kind === "member" && e.callee.object.kind === "ident" && e.callee.object.name === "Rc" && !this.cur().types.has(e.callee.object)) {
        const [a, b, result] = [this.temp(), this.temp(), this.temp()];
        const line17 = `${a} = load ptr, ptr ${this.value(e.args[0]!)}`;
        this.emit(line17);
        const line18 = `${b} = load ptr, ptr ${this.value(e.args[1]!)}`;
        this.emit(line18);
        this.emit(`${result} = icmp eq ptr ${a}, ${b}`);
        return result;
      }
      if (e.callee.kind === "member" && this.recOf(this.valueType(e.callee.object))?.kind === "pointer") return this.pointerCall(e, e.callee);
      if (e.callee.kind === "member" && this.recOf(this.referent(this.valueType(e.callee.object)))?.kind === "interior") return this.atomicCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name !== "clone" && this.recOf(this.referent(this.valueType(e.callee.object)))?.kind === "block") return this.blockCall(e, e.callee);
      if (this.tables.dynCalls.has(e)) return this.dynCall(e, e.callee);
      if (e.callee.kind === "member" && (e.callee.name === "downgrade" || e.callee.name === "upgrade") && this.recOf(this.referent(this.valueType(e.callee.object)))?.kind === "shared") return this.countedCall(e, e.callee);
      if (e.callee.kind === "member" && (e.callee.name === "update" || e.callee.name === "read") && this.recOf(this.referent(this.valueType(e.callee.object)))?.kind === "shared") {
        const t = this.referent(this.valueType(e.callee.object)) as SharedType;
        const block = this.temp();
        const line19 = `${block} = load ptr, ptr ${this.receiver(e.callee.object)}`;
        this.emit(line19);
        const lock = this.temp();
        const line20 = `${lock} = getelementptr ${this.sharedBlock(t)}, ptr ${block}, i32 0, i32 1`;
        this.emit(line20);
        const interiorType2 = this.tables.typing.interiorType("Lock", this.tables.typing.rec(t).of);
        return this.lockUpdate(e, interiorType2, lock, this.tables.typing.rec(t).which === "Rc");
      }
      // `BigInt(x)`: a new bigint of an integer, extended to 128 bits by its sign.
      if (e.callee.kind === "ident" && e.callee.name === "BigInt" && !this.cur().calls.has(e)) {
        const from = this.valueType(e.args[0]!);
        const v = this.value(e.args[0]!);
        if (from === "bigint") return this.copied(v, from);
        const { bits, signed } = integerInfo(from as Integer);
        let wide = v;
        if (bits < 128) {
          wide = this.temp();
          this.emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i128`);
        }
        const made = this.temp();
        this.emit(signed ? `${made} = call ptr @fsh_rt_big_from_i128(i128 ${wide})` : `${made} = call ptr @fsh_rt_big_from_u128(i128 ${wide}, i32 0)`);
        if (!this.cur().types.has(e)) this.pending.push({ v: made, type: "bigint" });
        return made;
      }
      if (e.callee.kind === "member" && e.callee.name === "toString" && this.referent(this.valueType(e.callee.object)) === "bigint") {
        const radix = e.args.length > 0 ? this.value(e.args[0]!) : "10";
        const made = this.temp();
        let big = this.value(e.callee.object);
        if (this.isRef(this.valueType(e.callee.object))) {
          const at = big;
          big = this.temp();
          this.emit(`${big} = load ptr, ptr ${at}`);
        }
        const line21 = `call ptr @fsh_rt_big_to_string(ptr ${big}, i64 ${radix}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
        this.unwinding(line21, made);
        if (!this.cur().types.has(e)) this.pending.push({ v: made, type: "string" });
        return made;
      }
      // `String(x)`: a number's new string, or another reference to a string. Used as a
      // statement, the call has no type of its own, and the string drops after it.
      if (e.callee.kind === "ident" && e.callee.name === "String") {
        const operand3 = this.value(e.args[0]!);
        const v = this.written(operand3, this.valueType(e.args[0]!));
        const made = this.pending.at(-1)?.v === v ? this.pending.pop() : undefined;
        const result = made !== undefined ? v : this.copied(v, "string");
        if (!this.cur().types.has(e)) this.pending.push({ v: result, type: "string" });
        return result;
      }
      if (e.callee.kind === "member" && e.callee.name !== "clone" && this.valueType(e.callee.object) === "string") return this.stringCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name !== "clone" && this.isArray(this.valueType(e.callee.object))) return this.arrayCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name !== "clone" && this.recOf(this.valueType(e.callee.object))?.kind === "map") return this.mapCall(e, e.callee);
      if (e.callee.kind === "member" && this.recOf(this.valueType(e.callee.object) as GeneratorType | undefined)?.async === true) {
        const made = this.temp();
        const get10 = this.cur().types.get(e)!;
        const line22 = `${made} = insertvalue ${this.llvm(get10)} zeroinitializer, ptr ${this.receiver(e.callee.object)}, 1`;
        this.emit(line22);
        return made;
      }
      const generator = e.callee.kind === "member" ? this.recOf(this.valueType(e.callee.object)) : undefined;
      if (e.callee.kind === "member" && generator?.kind === "generator") {
        const sent = (e.args.length > 0 ? this.owned(e.args[0]!) : undefined);
        const receiver2 = this.receiver(e.callee.object);
        const result = this.resume(this.valueType(e.callee.object) as GeneratorType, receiver2, e, sent);
        const type = this.tables.typing.nextResult(generator.yields);
        if (!this.cur().types.has(e) && this.needsDrop(type)) this.pending.push({ v: result, type });
        return result;
      }
      // The compiler's `clone()`: a copy holding another reference to what the value owns.
      const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
      const get11 = this.cur().types.get(e)!;
      if (this.isDyn(get11)) return this.dynCloned({ start: e.start, end: e.end }, object);
      const operand4 = this.value(object);
      const get3 = this.cur().types.get(object)!;
      const get4 = this.cur().types.get(e)!;
      const convert2 = this.convert(operand4, get3, get4);
      const get5 = this.cur().types.get(e)!;
      return this.copied(convert2, get5);
    }
    const object = e.callee.kind === "member" ? e.callee.object : e.callee.kind === "super" ? e.callee : undefined;
    const before = this.spills.length;
    // A nested function calling itself runs with the captures it was called with.
    let pointer: string | undefined;
    if (this.bodyAt(target).closure !== undefined) {
      pointer = (this.tables.selfCalls.has(e) ? "%env" : this.cur().envs?.has(e) === true ? this.envFor(target, this.cur().envs!.get(e)!.env) : this.inst(target).generator === undefined && this.inst(target).future === undefined && this.fresh(e.callee) && !this.unwraps(e.callee) ? this.calledClosure(e.callee) : this.receiver(e.callee));
    } else {
      pointer = this.bodyAt(target).self !== undefined && object !== undefined ? this.thisPointer(target, object) : undefined;
    }
    const mine = this.spills.splice(before);
    // A closure may take fewer parameters than the function type it was given as.
    const chosen3 = this.bodyAt(target).closure !== undefined ? this.bodyAt(target).params.length : e.args.length;
    const values = this.argValues(e.args, target, chosen3);
    // Calling a generator or async function makes its frame, holding the arguments, ready to start.
    const machine = this.inst(target).generator ?? this.inst(target).future;
    if (machine !== undefined) {
      let frame = "zeroinitializer";
      // An async arrow's frame starts with its own copy of the closure, and an async method's
      // with its object, then the arguments.
      const method = this.bodyAt(target).self !== undefined && !this.bodyAt(target).self!.constructor;
      const first = this.bodyAt(target).closure !== undefined || method === true ? 2 : 1;
      // The frame takes the call's spilled receiver, which then drops nothing of its own.
      this.pending = this.pending.filter((entry) => !mine.some((m) => m.v === entry.v && m.type === entry.type));
      if (method === true) {
        const owns = this.bodyAt(target).self!.owned;
        let self: string;
        if (owns === true) {
          const part6 = this.bodyAt(target).self!.type;
          self = this.unstash(pointer!, part6);
        } else {
          self = pointer!;
        }
        const next = this.temp();
        const line27 = `${next} = insertvalue ${this.llvm(machine)} ${frame}, ${owns === true ? this.llvm(this.bodyAt(target).self!.type) : "ptr"} ${self}, 1`;
        this.emit(line27);
        frame = next;
      }
      if (this.bodyAt(target).closure !== undefined) {
        const [env, next] = [this.temp(), this.temp()];
        const part9 = this.inst(target).closure!;
        const line28 = `${env} = load ${this.llvm(part9)}, ptr ${pointer}`;
        this.emit(line28);
        const part7 = this.inst(target).closure!;
        const part10 = this.inst(target).closure!;
        const line23 = `${next} = insertvalue ${this.llvm(machine)} ${frame}, ${this.llvm(part10)} ${this.copied(env, part7)}, 1`;
        this.emit(line23);
        frame = next;
      }
      let iAt3: usize = 0;
      for (const v of values) {
        const i = iAt3;
        iAt3++;
        const next = this.temp();
        this.emit(`${next} = insertvalue ${this.llvm(machine)} ${frame}, ${v}, ${i + first}`);
        frame = next;
      }
      if (!this.cur().types.has(e)) this.pending.push({ v: frame, type: machine });
      return frame;
    }
    // The call takes the copy; what it leaves, the parts of a derived instance its base's
    // method doesn't drop, is dropped once it returns or raises.
    this.pending = this.pending.filter((entry) => !mine.some((m) => m.v === entry.v && m.type === entry.type));
    // A function compiled once for every closure it is given takes each as its address and its
    // body's code, and leaves dropping it to the caller.
    const share = this.shares.get(target);
    const lent: { slot: string; type: Type }[] = [];
    for (const k of share?.at ?? []) {
      const a = e.args[k]!;
      if (this.pairOf(a) !== undefined) {
        values[k] = values[k]!.replace(/^.*? (%\S+)$/, `${PAIR} $1`);
        continue;
      }
      const type = this.valueType(a);
      const v = values[k]!.slice(this.llvm(type).length + 1);
      const slot = this.alloca(this.llvm(type));
      this.emit(`store ${this.llvm(type)} ${v}, ptr ${slot}`);
      const code = share!.code.get(k);
      const [half, both] = [this.temp(), this.temp()];
      this.emit(`${half} = insertvalue ${PAIR} undef, ptr ${slot}, 0`);
      const line24 = `${both} = insertvalue ${PAIR} ${half}, ptr ${code === undefined ? "null" : this.symbol(this.tables.arenas.instanceOf(code).id)}, 1`;
      this.emit(line24);
      values[k] = `${PAIR} ${both}`;
      lent.push({ slot, type });
    }
    const leftovers = mine.length === 0 && lent.length === 0 ? undefined : (cg: Mut<Codegen>) => {
      for (const { slot, type } of mine) {
        const unstash2 = cg.unstash(slot, type);
        cg.dispose(unstash2, type);
      }
      for (const { slot, type } of lent) {
        const unstash3 = cg.unstash(slot, type);
        cg.dispose(unstash3, type);
      }
    };
    const chosen2 = (share !== undefined ? this.symbol(share.template) : undefined);
    const result = this.invoke(target, pointer, values, exprKey(e), leftovers, undefined, chosen2);
    // A call through a type parameter returns what its bound's method declares.
    if ((result !== undefined && result !== "") && this.cur().types.has(e)) {
      const part8 = this.inst(target).returns;
      const get6 = this.cur().types.get(e)!;
      return this.convert(result, part8, get6);
    }
    return result;
  }


  // A call's arguments, typed, then an empty value for each optional parameter it leaves out.
  // Arguments past `taken` run for their effects only.
  argValues(this: Mut<this>, args: Ref<Expr[]>, target: InstanceId, taken: usize = args.length): string[] {
    // A comptime parameter's argument was computed while compiling, and isn't passed.
    const passed = (cg: Mut<Codegen>, i: usize) => i >= cg.bodyAt(target).params.length || cg.bodyAt(target).params[i]!.comptime !== true;
    const values = this.delivered((cg) => args.flatMap((a, i) => (!passed(cg, i as usize) ? [] : (i as usize) < taken ? [`${cg.llvm(cg.valueType(a))} ${cg.pairOf(a) !== undefined ? cg.owned(a) : cg.hand(cg.owned(a), cg.valueType(a))}`] : (cg.value(a), []))));
    // A left-out optional parameter is empty, and a left-out rest parameter an empty array.
    for (const p of this.bodyAt(target).params.slice(args.length)) {
      const get2 = this.inst(target).locals.get(p)!;
      const type = this.loc(get2).type;
      values.push(`${this.llvm(type)} ${p.rest ? "zeroinitializer" : this.convert("zeroinitializer", "null", type)}`);
    }
    return values;
  }


  // A string method's call. The string is read before its arguments run, as in JavaScript. In
  // an optional chain, the result is the chain's Option.
  stringCall(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, callee: Ref<Extract<Expr, { kind: "member" }>>): string {
    const s = this.operand(callee.object, e.args, 0);
    const args = e.args.map((a) => this.value(a));
    const result = this.temp();
    // A call used as a statement has no type of its own; a string it makes is released when the
    // statement ends.
    const given = (cg: Mut<Codegen>, v: string, type: Type) => {
      if (cg.cur().types.has(e)) {
        const get2 = cg.cur().types.get(e)!;
        return cg.convert(v, type, get2);
      }
      if (cg.needsDrop(type)) cg.pending.push({ v, type });
      return v;
    };
    switch (callee.name) {
      case "charCodeAt":
        this.inBounds(s, args[0]!, { start: e.start, end: e.end });
        this.emit(`${result} = call i16 @fsh_rt_str_unit(ptr ${s}, i64 ${args[0]!})`);
        return given(this, result, "u16");
      case "slice":
      case "substring":
        this.emit(`${result} = call ptr @fsh_rt_str_${callee.name}(ptr ${s}, i64 ${args[0]!}, i64 ${args.length > 1 ? args[1]! : "0"}, i32 ${args.length - 1})`);
        return given(this, result, "string");
      // Past either end, an Option's empty value: the runtime says so with NULL or -1.
      case "at": {
        const [raw, none] = [this.temp(), this.temp()];
        this.emit(`${raw} = call ptr @fsh_rt_str_at_or_null(ptr ${s}, i64 ${args[0]!})`);
        this.emit(`${none} = icmp eq ptr ${raw}, null`);
        const option = this.tables.typing.unionType(["string", "null"]);
        const line = `${result} = select i1 ${none}, ${this.llvm(option)} ${this.convert("zeroinitializer", "null", option)}, ${this.llvm(option)} ${this.convert(raw, "string", option)}`;
        this.emit(line);
        return given(this, result, option);
      }
      case "codePointAt": {
        const [raw, none, point] = [this.temp(), this.temp(), this.temp()];
        this.emit(`${raw} = call i64 @fsh_rt_str_code_point_at(ptr ${s}, i64 ${args[0]!})`);
        this.emit(`${none} = icmp slt i64 ${raw}, 0`);
        this.emit(`${point} = trunc i64 ${raw} to i32`);
        const option = this.tables.typing.unionType(["u32", "null"]);
        const line2 = `${result} = select i1 ${none}, ${this.llvm(option)} ${this.convert("zeroinitializer", "null", option)}, ${this.llvm(option)} ${this.convert(point, "u32", option)}`;
        this.emit(line2);
        return given(this, result, option);
      }
      case "charAt":
        this.emit(`${result} = call ptr @fsh_rt_str_char_at(ptr ${s}, i64 ${args[0]!})`);
        return given(this, result, "string");
      // A missing position is the end, which the runtime clamps to.
      case "lastIndexOf":
        this.emit(`${result} = call i64 @fsh_rt_str_last_index_of(ptr ${s}, ptr ${args[0]!}, i64 ${(args.length > 1 ? args[1]! : undefined) ?? "9223372036854775807"})`);
        return given(this, result, "i64");
      // A missing position is the start, or for endsWith, the end, which the runtime clamps to.
      case "indexOf":
        this.emit(`${result} = call i64 @fsh_rt_str_index_of(ptr ${s}, ptr ${args[0]!}, i64 ${args.length > 1 ? args[1]! : "0"})`);
        return given(this, result, "i64");
      case "includes": {
        const found = this.temp();
        this.emit(`${found} = call i64 @fsh_rt_str_index_of(ptr ${s}, ptr ${args[0]!}, i64 ${args.length > 1 ? args[1]! : "0"})`);
        this.emit(`${result} = icmp sge i64 ${found}, 0`);
        return given(this, result, "boolean");
      }
      // An array comes back through memory, as C and LLVM return aggregates differently.
      case "split": {
        const out = this.alloca(ARRAY);
        this.emit(`call void @fsh_rt_str_split(ptr ${out}, ptr ${s}, ptr ${(args.length > 0 ? args[0]! : undefined) ?? "null"}, i64 ${(args.length > 1 ? args[1]! : undefined) ?? "4294967295"})`);
        this.emit(`${result} = load ${ARRAY}, ptr ${out}`);
        const arrayType2 = this.tables.typing.arrayType("string");
        return given(this, result, arrayType2);
      }
      case "replace":
      case "replaceAll":
        this.emit(`${result} = call ptr @fsh_rt_str_${callee.name === "replace" ? "replace" : "replace_all"}(ptr ${s}, ptr ${args[0]!}, ptr ${args[1]!})`);
        return given(this, result, "string");
      // Each join makes a new string, the one before it released.
      case "concat": {
        if (args.length === 0) {
          this.emit(`call void @fsh_rt_str_retain(ptr ${s})`);
          return given(this, s, "string");
        }
        let joined = this.concat(s, args[0]!);
        for (const a of args.slice(1)) {
          const next = this.concat(joined, a);
          this.emit(`call void @fsh_rt_str_release(ptr ${joined})`);
          joined = next;
        }
        return given(this, joined, "string");
      }
      case "padStart":
      case "padEnd":
        // These two may panic, so a panic in them drops what is live here.
        const line3 = `call ptr @fsh_rt_str_pad(ptr ${s}, i64 ${args[0]!}, ptr ${(args.length > 1 ? args[1]! : undefined) ?? "null"}, i32 ${callee.name === "padStart" ? 1 : 0}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
        this.unwinding(line3, result);
        return given(this, result, "string");
      case "repeat":
        const line4 = `call ptr @fsh_rt_str_repeat(ptr ${s}, i64 ${args[0]!}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
        this.unwinding(line4, result);
        return given(this, result, "string");
      case "toUpperCase":
      case "toLowerCase":
        this.emit(`${result} = call ptr @fsh_rt_str_case(ptr ${s}, i32 ${callee.name === "toUpperCase" ? 1 : 0})`);
        return given(this, result, "string");
      case "trim":
      case "trimStart":
      case "trimEnd":
        this.emit(`${result} = call ptr @fsh_rt_str_trim(ptr ${s}, i32 ${callee.name === "trimStart" ? 1 : callee.name === "trimEnd" ? 2 : 3})`);
        return given(this, result, "string");
      case "startsWith":
      case "endsWith": {
        const yes = this.temp();
        const name = callee.name === "startsWith" ? "starts_with" : "ends_with";
        this.emit(`${yes} = call i32 @fsh_rt_str_${name}(ptr ${s}, ptr ${args[0]!}, i64 ${(args.length > 1 ? args[1]! : undefined) ?? (callee.name === "startsWith" ? 0 : "9223372036854775807")})`);
        this.emit(`${result} = icmp ne i32 ${yes}, 0`);
        return given(this, result, "boolean");
      }
    }
    throw new Error(`internal error: no lowering for the string method ${callee.name}`);
  }


  // The "panicked at" line for a panic the runtime raises at an expression.
  panicAt(this: Mut<this>, at: Ref<Span>): string {
    return this.cString(`panicked at ${this.where(at)}:\n`);
  }


  // A type predicate's answer narrows its argument, and a wrong one would have the narrowed code
  // read the union's payload as a member it doesn't hold, so its tag is checked against the
  // answer in every build, as an index is against the length.
  predicateCheck(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, answer: string) {
    const { index, type, yes, no } = this.cur().predicates!.get(e)!;
    // Only a variable or a field is narrowed by a predicate's answer, so only one needs its answer
    // checked. A field is read again, which runs nothing: a field read through a getter isn't one
    // a check narrows. One moved into the call is gone, and nothing reads it after.
    const arg = (index < e.args.length ? e.args[index]! : undefined);
    if (arg === undefined || (arg.kind !== "ident" && arg.kind !== "member")) return;
    if (arg.kind === "member" && this.cur().consumes.has(arg.id)) return;
    let v: string, whole: Type;
    if (arg.kind === "member") [v, whole] = [this.value(arg), this.valueType(arg)];
    else {
      const local = this.resolved(arg);
      [v, whole] = [this.temp(), this.loc(local).type];
      const line = `${v} = load ${this.llvm(whole)}, ptr ${this.slot(local)}`;
      this.emit(line);
    }
    while (this.recOf(whole)?.kind === "ref" || this.recOf(whole)?.kind === "recursive") {
      const held = this.recOf(whole)!;
      const inner = this.temp();
      const next = held.kind === "ref" ? held.to : held.kind === "recursive" ? held.of : whole;
      this.emit(`${inner} = load ${this.llvm(next)}, ptr ${v}`);
      [v, whole] = [inner, next];
    }
    const union = this.recOf(whole);
    if (union?.kind !== "union") return;
    // An `unknown` holding any number holds JavaScript's `number`, read as an f64.
    const [held, wrong, bad] = [this.conversions().holdsWhere(v, whole as UnionType, { by: "gives", type, unknown: union.unknown === true }), this.temp(), this.temp()];
    this.emit(`${wrong} = xor i1 ${answer}, ${held}`);
    this.emit(`${bad} = select i1 ${answer}, i1 ${yes ? wrong : "false"}, i1 ${no ? wrong : "false"}`);
    const [fail, ok] = [this.label(), this.label()];
    this.emit(`br i1 ${bad}, label %${fail}, label %${ok}`);
    this.startBlock(fail);
    const [said, saidNot] = [this.label(), this.label()];
    this.emit(`br i1 ${answer}, label %${said}, label %${saidNot}`);
    // A name spelling a long type argument list is shortened as symbols are.
    const name = shortened(this.bodyAt(this.callOf(e)!).name);
    function shown(x: Expr): string {
      return (x.kind === "member" ? `${shown(x.object)}.${x.name}` : x.kind === "ident" ? x.name : "this");
    }
    const ats: string[] = [said, saidNot];
    const iss: string[] = ["is", "is not"];
    for (let k: usize = 0; k < ats.length; k++) {
      const at = ats[k]!;
      const is = iss[k]!;
      this.startBlock(at);
      const tag = this.temp();
      this.emit(`${tag} = extractvalue ${this.llvm(whole as UnionType)} ${v}, 0`);
      const cases = union.members.map(() => this.label());
      this.emit(`switch i32 ${tag}, label %${cases[0]!} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      let iAt: usize = 0;
      for (const m of union.members) {
        const i = iAt;
        iAt++;
        this.startBlock(cases[i]!);
        const line2 = `call void @fsh_rt_panic(ptr ${this.cString(`panicked at ${this.where({ start: e.start, end: e.end })}:\nthe type predicate '${name}' said '${shown(arg)}' ${is} '${brief(this.tables.typing.show(type))}', but it holds a '${brief(this.tables.typing.show(m))}'\n`)})`;
        this.unwinding(line2);
        this.emit("unreachable");
      }
    }
    this.startBlock(ok);
  }


  // `file:line:col` of an expression, in the program or the std library.
  where(at: Ref<Span>): string {
    const place = sourceOf(this.src, this.file, at.start, this.sources);
    const { line, col } = locate(place.src, place.offset);
    return `${place.file}:${line}:${col}`;
  }


  units(this: Mut<this>, s: string): string {
    const result = this.temp();
    this.emit(`${result} = call i64 @fsh_rt_str_units(ptr ${s})`);
    return result;
  }


  // Panics, as Rust's indexing does, unless a `usize` index is below the string's UTF-16 length.
  inBounds(this: Mut<this>, s: string, index: string, at: Ref<Span>) {
    const units2 = this.units(s);
    this.bounds(units2, index, at);
  }


  // Panics, as Rust's indexing does, unless a `usize` index is below a length. A rest tuple's
  // array is named as the tuple, its `before` fixed elements counted in.
  bounds(this: Mut<this>, length: string, index: string, at: Ref<Span>, before = 0) {
    const [outside, fail, ok] = [this.temp(), this.label(), this.label()];
    this.emit(`${outside} = icmp uge i64 ${index}, ${length}`);
    this.emit(`br i1 ${outside}, label %${fail}, label %${ok}`);
    this.startBlock(fail);
    const [told, asked] = before === 0 ? [length, index] : [this.temp(), this.temp()];
    if (before !== 0) {
      this.emit(`${told} = add i64 ${length}, ${before}`);
      this.emit(`${asked} = add i64 ${index}, ${before}`);
    }
    const line = `call void @fsh_rt_panic_bounds(ptr ${this.cString(`panicked at ${this.where(at)}:\n`)}, i64 ${told}, i64 ${asked})`;
    this.unwinding(line);
    this.emit("unreachable");
    this.startBlock(ok);
  }


  assign(this: Mut<this>, e: Ref<Extract<Expr, { kind: "assign" }>>): string {
    const target = bare(e.target);
    // A handle's property is written in JS, with a new JS value of what is assigned; the
    // assignment's own value is what the property holds, a handle as the new JS value.
    if (this.tables.jsMembers.has(target) && target.kind === "member") {
      const object = this.jsHandle(target.object);
      const shape = this.tables.typing.jsShape(this.referent(this.valueType(target.object)));
      const name = target.name;
      const declared = shape !== undefined ? this.tables.typing.rec(shape).fields.find((f) => f.name === name) : undefined;
      const empty = declared?.optional !== undefined ? "undefined" : "null";
      // A callback or a future goes as the stored callable or Promise it meets, as an argument does.
      const held = this.cur().coercions.get(e.value) ?? this.cur().types.get(e.value)!;
      const kept = this.isCallback(held) || this.isPromised(held);
      const type = this.cur().types.get(e)!;
      this.jsSite = { start: e.value.start, end: e.value.end };
      const v = kept ? this.owned(e.value) : this.jsOperand(e.value);
      const chosen2 = kept ? held : this.cur().types.get(e.value)!;
      const box = this.toJs(v, chosen2, empty);
      const handle = this.recOf(type)?.kind === "block";
      if (handle) {
        this.emit(`call void @fsh_rt_block_retain(ptr ${box})`);
        this.pending.push({ v: box, type });
      }
      const line = `call void @fsh_rt_js_set(ptr ${object}, ptr ${this.text(target.name)}, ptr ${box}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
      this.unwinding(line);
      // A callback or a Promise is only written as a statement, whose value nothing reads.
      if (kept) return "zeroinitializer";
      if (handle) {
        return box;
      }
      const get2 = this.cur().types.get(e.value)!;
      return this.convert(v, get2, type);
    }
    const op = ASSIGNMENTS[e.op]!;
    // `&&=` and `||=` skip the right side as `&&` and `||` do, and assign only when they
    // run it, which matters when the target is a setter.
    if (op === "&&" || op === "||") {
      const operand2 = this.value(target);
      return this.logical(op, operand2, (cg) => {
        const operand3 = cg.value(e.value);
        return cg.store(target, operand3);
      });
    }
    // The target is read before the right-hand side runs, as in JavaScript.
    const type = this.cur().types.get(e)!;
    if (op === "+" && type === "string") {
      const operand4 = this.operandBefore(target, e.value);
      const operand5 = this.value(e.value);
      const written2 = this.written(operand5, this.valueType(e.value));
      const concat2 = this.concat(operand4, written2);
      return this.store(target, concat2);
    }
    let chosen: string;
    if (op === "=") {
      chosen = this.owned(e.value);
    } else {
      const operand6 = this.value(target);
      const operand7 = this.value(e.value);
      chosen = this.numeric(op, operand6, operand7, { start: e.start, end: e.end }, type);
    }
    return this.store(target, chosen);
  }


  // Runs an assignment to a target, having first run the indexes into arrays along its path,
  // outermost first, so each runs once and before the value, as in JavaScript.
  fixing(this: Mut<this>, target: Ref<Expr>, run: (cg: Mut<Codegen>) => string): string {
    let nodes: Ref<Expr>[] = [];
    let walk = bare(target);
    while (walk.kind === "member" || walk.kind === "index") {
      const e = walk;
      if (e.kind === "index" && this.indexes(this.valueType(e.object))) nodes.unshift(e.index);
      walk = bare(partOf(e));
    }
    for (const index of nodes) {
      const operand = this.value(index);
      this.fixed.set(index, operand);
    }
    const result = run(this);
    for (const index of nodes) this.fixed.delete(index);
    return result;
  }


  // A field read, or a getter's result.
  member(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): string {
    const statics = this.tables.jsStatics.get(e);
    if (statics !== undefined) return this.jsStatic(e, statics)!;
    if (this.tables.jsMembers.has(e)) {
      const jsHandle2 = this.jsHandle(e.object);
      const get2 = this.cur().types.get(e)!;
      return this.jsGet(jsHandle2, e.name, get2, `property '${e.name}' of '${this.tables.typing.show(this.referent(this.valueType(e.object)))}' is`, { start: e.start, end: e.end });
    }
    if (this.cur().copiesOut.has(e)) return this.copyOut(e);
    if (this.tables.computed.has(e)) {
      const get12 = this.cur().types.get(e.object)!;
      const referent2 = this.referent(get12);
      return this.isDyn(referent2) ? this.dynField(e) : this.blockProperty(e);
    }
    const getter = this.callOf(e);
    if (getter !== undefined) {
      const thisPointer2 = this.thisPointer(getter, e.object);
      const invoke2 = this.invoke(getter, thisPointer2, [])!;
      const part = this.inst(getter).returns;
      const get3 = this.cur().types.get(e)!;
      return this.convert(invoke2, part, get3);
    }
    // An enum member's value is known, and the enum's name is no value to evaluate.
    if (!this.cur().types.has(e.object)) return "zeroinitializer";
    // Inside a shared value's block only this field is read: its neighbours change unlocked.
    if (this.inBlock(e)) {
      const read = this.temp();
      const stored2 = this.stored(e);
      const line = `${read} = load ${this.llvm(stored2)}, ptr ${this.address(e)}`;
      this.emit(line);
      const stored3 = this.stored(e);
      const get4 = this.cur().types.get(e)!;
      return this.convert(read, stored3, get4);
    }
    // Through a reference, the value it points to.
    const shared = this.cur().coercions.get(e.object) ?? this.cur().types.get(e.object)!;
    const whole = (cg: Mut<Codegen>) => {
      if (!cg.inBlock(e.object)) return cg.value(e.object);
      const read = cg.temp();
      const stored4 = cg.stored(e.object);
      const line2 = `${read} = load ${cg.llvm(stored4)}, ptr ${cg.address(e.object)}`;
      cg.emit(line2);
      return read;
    };
    if (shared === "string") {
      const whole2 = whole(this);
      const units2 = this.units(whole2);
      const get5 = this.cur().types.get(e)!;
      return this.convert(units2, "usize", get5);
    }
    // A fixed array's length is known while compiling; what it is read from still runs, and an
    // index into it is still checked.
    const sharedRec = this.recOf(shared);
    if (sharedRec?.kind === "fixed") {
      if (e.object.kind !== "ident" && e.object.kind !== "this") whole(this);
      const get6 = this.cur().types.get(e)!;
      return this.convert(String(sharedRec.size), "usize", get6);
    }
    if (sharedRec?.kind === "map") {
      const size = this.temp();
      const line4 = `${size} = call i64 @fsh_rt_map_size(ptr ${whole(this)})`;
      this.emit(line4);
      const get7 = this.cur().types.get(e)!;
      return this.convert(size, "usize", get7);
    }
    if (sharedRec?.kind === "array") {
      const length = this.temp();
      const line5 = `${length} = extractvalue ${ARRAY} ${whole(this)}, ${e.name === "capacity" ? 2 : 1}`;
      this.emit(line5);
      const get8 = this.cur().types.get(e)!;
      return this.convert(length, "usize", get8);
    }
    if (sharedRec?.kind === "union") {
      const whole3 = whole(this);
      return this.conversions().unionField(whole3, shared as UnionType, e.name, this.cur().types.get(e)!);
    }
    if (this.tables.typing.isTuple(shared) && e.name === "length") {
      const whole4 = whole(this);
      const tupleLength2 = this.tupleLength(whole4, shared as ObjectType);
      const get9 = this.cur().types.get(e)!;
      return this.convert(tupleLength2, "usize", get9);
    }
    const object = shared as ObjectType | ClassType;
    const result = this.temp();
    const line3 = `${result} = extractvalue ${this.llvm(object)} ${this.value(e.object)}, ${this.tables.typing.fieldPath(object, e.name).join(", ")}`;
    this.emit(line3);
    // A field read through an interface or object parameter takes the type its bound declares. A
    // class's field keeps its type as written, `?` markers included, which lowering drops. One a
    // check narrowed is read as declared first.
    const field = this.tables.typing.lower(this.tables.typing.field(object, e.name)!.type);
    const declared = this.cur().narrowedFields?.get(e);
    if (declared === undefined) {
      const get10 = this.cur().types.get(e)!;
      return this.convert(result, field, get10);
    }
    const convert2 = this.convert(result, field, declared);
    const get11 = this.cur().types.get(e)!;
    return this.convert(convert2, declared, get11);
  }


  // A nested function's environment built for one call, in a slot of its own.
  envFor(this: Mut<this>, target: InstanceId, env: Ref<LocalId[]>): string {
    const part = this.inst(target).closure!;
    const llvm2 = this.llvm(part);
    const at = this.alloca(llvm2);
    const part2 = this.inst(target).closure!;
    const froms: (LocalId | "this")[] = [...env];
    const line = `store ${this.llvm(part2)} ${this.environment(target, froms)}, ptr ${at}`;
    this.emit(line);
    return at;
  }


  // A closure's environment, from the bindings standing here for what it captures, in order:
  // where each lives, or a copy, or the value moved in.
  environment(this: Mut<this>, inner: InstanceId, froms: Ref<(LocalId | "this")[]>): string {
    let result = "undef";
    let iAt: usize = 0;
    for (const id of froms) {
      const i = iAt;
      iAt++;
      const type = this.tables.typing.rec(this.inst(inner).closure!).fields[i as usize]!.type;
      let part = id === "this" ? "%this" : this.slot(id);
      // A closure holding a variable's value holds a copy, or moves it in, emptying it.
      if (!this.isRef(type)) {
        part = this.temp();
        const line = `${part} = load ${this.llvm(type)}, ptr ${this.slot(id as LocalId)}`;
        this.emit(line);
        if (this.tables.typing.isCopy(type)) part = this.copied(part, type);
        else {
          const line2 = `store ${this.llvm(type)} zeroinitializer, ptr ${this.slot(id as LocalId)}`;
          this.emit(line2);
        }
      }
      const next = this.temp();
      const part2 = this.inst(inner).closure!;
      const line3 = `${next} = insertvalue ${this.llvm(part2)} ${result}, ${this.llvm(type)} ${part}, ${i}`;
      this.emit(line3);
      result = next;
    }
    return froms.length === 0 ? "zeroinitializer" : result;
  }


  // A tuple's fixed elements in order, with where each is in its fields, and its rest array's.
  tupleOrder(t: ObjectType): [{ f: Field; i: usize }[], { f: Field; i: usize } | undefined] {
    let fixed: { f: Field; i: usize }[] = [];
    let rest: { f: Field; i: usize } | undefined = undefined;
    const fields = this.tables.typing.rec(t).fields;
    for (let i: usize = 0; i < fields.length; i++) {
      const f = copyField(fields[i]!);
      if (f.name !== "...") fixed.push({ f, i });
      else if (rest === undefined) rest = { f, i };
    }
    fixed.sort((a, b) => parseInt(a.f.name)! - parseInt(b.f.name)!);
    return [fixed, rest];
  }


  // `write`, for a tuple's element `n`, only when it is within `length`, when one is known.
  present(this: Mut<this>, length: string | undefined, n: usize, write: (cg: Mut<Codegen>) => void) {
    if (length === undefined) {
      write(this);
      return;
    }
    const [within, yes, after] = [this.temp(), this.label(), this.label()];
    this.emit(`${within} = icmp ult i64 ${n}, ${length}`);
    this.emit(`br i1 ${within}, label %${yes}, label %${after}`);
    this.startBlock(yes);
    write(this);
    this.emit(`br label %${after}`);
    this.startBlock(after);
  }


  // A tuple's length: its required elements, then up to the last optional one there.
  tupleLength(this: Mut<this>, v: string, t: ObjectType): string {
    const count = this.tables.typing.elementsOf(t).length;
    let length = String(this.tables.typing.rec(t).required ?? count);
    for (let i = this.tables.typing.rec(t).required ?? count; i < count; i++) {
      const [x, next] = [this.temp(), this.temp()];
      this.emit(`${x} = extractvalue ${this.llvm(t)} ${v}, ${this.tables.typing.fieldPath(t, String(i)).join(", ")}`);
      const union = this.tables.typing.field(t, String(i))!.type as UnionType;
      const line = `${next} = select i1 ${this.conversions().holds(x, union, this.tables.typing.rec(union).members.filter((m) => m !== "null"))}, i64 ${i + 1}, i64 ${length}`;
      this.emit(line);
      length = next;
    }
    if (this.tables.typing.rec(t).rest !== undefined) {
      const [many, more, sum] = [this.temp(), this.temp(), this.temp()];
      this.emit(`${many} = extractvalue ${this.llvm(t)} ${v}, ${this.tables.typing.fieldPath(t, "...").join(", ")}`);
      this.emit(`${more} = extractvalue ${ARRAY} ${many}, 1`);
      this.emit(`${sum} = add i64 ${length}, ${more}`);
      length = sum;
    }
    return length;
  }


  // Whether a field read reaches into a shared value's block through its interior-mutable
  // fields, where it is read in place.
  inBlock(eGiven: Ref<Expr>): boolean {
    let walk: Ref<Expr> = eGiven;
    while (walk.kind === "member" && !this.cur().calls.has(walk)) {
      const e = walk;
      if (e.kind !== "member") return false;
      walk = e.object;
      const get2 = this.cur().types.get(e.object)!;
      const holder = this.referent(get2);
      const kind = this.recOf(holder)?.kind;
      if (kind === "shared") return !this.cur().copiesOut.has(e);
      if (kind !== "object" && kind !== "class") return false;
    }
    return false;
  }


  // A shared value's block, and a pointer to one of its value's fields.
  sharedField(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): [string, SharedType, string] {
    const holder = this.cur().types.get(e.object)!;
    const t = this.referent(holder) as SharedType;
    const block = this.isRef(holder) ? this.temp() : this.value(e.object);
    if (this.isRef(holder)) {
      const line = `${block} = load ptr, ptr ${this.value(e.object)}`;
      this.emit(line);
    }
    const at = this.temp();
    const path = this.tables.typing.fieldPath(this.tables.typing.rec(t).of as ObjectType | ClassType, e.name).map((i) => `i32 ${i}`).join(", ");
    const line2 = `${at} = getelementptr ${this.sharedBlock(t)}, ptr ${block}, i32 0, i32 1, i32 1, ${path}`;
    this.emit(line2);
    return [block, t, at];
  }


  // A shared value's plain field, copied out while its lock is held.
  // An Rc's field is copied without its word: only this thread reaches it, and between two of its
  // steps an `update` running here has left the value whole.
  copyOut(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): string {
    const [block, t, at] = this.sharedField(e);
    const type = this.cur().types.get(e)!;
    if (this.tables.typing.rec(t).which === "Rc") {
      const read = this.temp();
      this.emit(`${read} = load ${this.llvm(type)}, ptr ${at}`);
      return this.copied(read, type);
    }
    const lock = this.temp();
    const line = `${lock} = getelementptr ${this.sharedBlock(t)}, ptr ${block}, i32 0, i32 1`;
    this.emit(line);
    this.takeLock(lock, { start: e.start, end: e.end });
    const read = this.temp();
    this.emit(`${read} = load ${this.llvm(type)}, ptr ${at}`);
    const copy = this.copied(read, type);
    this.emit(`call void @fsh_rt_unlock(ptr ${lock})`);
    return copy;
  }


  // Whether an expression is an Option a link of an optional chain reads through.
  unwraps(object: Ref<Expr>): boolean {
    const option = this.cur().types.get(object);
    return option !== undefined && this.tables.typing.isOption(option) && this.cur().coercions.has(object);
  }


  // A link of an optional chain: empty when the Option it reads through is, and otherwise
  // `compute`, which reads what the Option holds. Its result is already the link's Option.
  link(this: Mut<this>, e: Ref<Expr>, object: Ref<Expr>, compute: (cg: Mut<Codegen>) => string | undefined): string | undefined {
    const option = this.cur().types.get(object) as UnionType;
    const raw = this.evaluate(object);
    if (this.fresh(object)) this.pending.push({ v: raw, type: option });
    this.known.set(exprKey(object), raw);
    const [some, none, end] = [this.label(), this.label(), this.label()];
    const line = `br i1 ${this.conversions().holds(raw, option, ["null"])}, label %${none}, label %${some}`;
    this.emit(line);
    this.startBlock(some);
    const mark = this.pending.length;
    const got = compute(this);
    this.settle(mark);
    const someEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(none);
    const type = this.cur().types.get(e);
    const empty = got !== undefined && type !== undefined ? this.convert("zeroinitializer", "null", type) : undefined;
    const noneEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(end);
    this.known.delete(object);
    if (got === undefined || type === undefined || empty === undefined) return undefined;
    const result = this.temp();
    this.emit(`${result} = phi ${this.llvm(type)} [ ${got}, %${someEnd} ], [ ${empty}, %${noneEnd} ]`);
    return result;
  }


  // A pointer to the instance a method works on: its receiver, or the base embedded in it
  // that declares the method.
  thisPointer(this: Mut<this>, target: InstanceId, object: Ref<Expr>): string {
    let held: Type;
    if (this.unwraps(object)) {
      held = this.cur().coercions.get(object)!;
    } else {
      const get2 = this.cur().types.get(object)!;
      held = this.tables.typing.unfold(this.referent(get2));
    }
    const part = this.bodyAt(target).self?.owned;
    const receiver2 = this.receiver(object, part);
    const part2 = this.bodyAt(target).owner!;
    return this.upcast(receiver2, held as ClassType, part2);
  }


  // Calls a function with its arguments' values, after the instance when it is a method.
  // `after` runs once the call returns, and before an error it raises goes on.
  // `after` runs once the call is over, however it ended; `unwound` only when it panicked.
  invoke(this: Mut<this>, target: InstanceId, pointer: string | undefined, args: Ref<string[]>, at?: Expr, after?: (cg: Mut<Codegen>) => void, unwound?: (cg: Mut<Codegen>) => void, via?: string): string | undefined {
    const cleanup = after !== undefined || unwound !== undefined ? (cg: Mut<Codegen>) => (after?.(cg), unwound?.(cg)) : undefined;
    const type = this.inst(target).returns;
    if (this.bodyAt(target).rust !== undefined) return this.rustInvoke(target, pointer, args, at!, cleanup, after);
    const values = (pointer !== undefined && pointer !== "") ? [`ptr ${pointer}`, ...args] : args;
    // A narrow value crosses to C widened, both ways.
    const passed = this.bodyAt(target).foreign === true ? values.map((v, i) => v.replace(/^\S+ /, `${crossing(this.tables.typing, this.inst(target).signature![i]!)} `)) : values;
    const call = `call ${this.bodyAt(target).foreign === true ? crossed(this.tables.typing, type) : this.resultType(target)} ${via ?? this.symbol(target)}(${passed.join(", ")})`;
    if (type === "void" && this.inst(target).throws === undefined) {
      this.unwinding(call, undefined, cleanup);
      after?.(this);
      return undefined;
    }
    const result = this.temp();
    this.unwinding(call, result, cleanup);
    if (this.inst(target).throws === undefined) {
      after?.(this);
      return result;
    }
    const resultType2 = this.resultType(target);
    const chosen = this.bodyAt(target).self?.constructor === true ? undefined : unwound;
    return this.unpacked(resultType2, result, type, at!, after, chosen);
  }


  // A throwing call's result: a call that failed raises its error where this function sends
  // it; one that didn't gives its value.
  unpacked(this: Mut<this>, shape: string, result: string, type: Type, at: Ref<Expr>, after?: (cg: Mut<Codegen>) => void, unwound?: (cg: Mut<Codegen>) => void): string | undefined {
    const [failed, bad, ok] = [this.temp(), this.label(), this.label()];
    this.emit(`${failed} = extractvalue ${shape} ${result}, 0`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(bad);
    const error = this.temp();
    this.emit(`${error} = extractvalue ${shape} ${result}, 2`);
    after?.(this);
    unwound?.(this);
    this.raised(at, error);
    this.startBlock(ok);
    after?.(this);
    if (type === "void") return undefined;
    const got = this.temp();
    this.emit(`${got} = extractvalue ${shape} ${result}, 1`);
    return got;
  }


  // A call of a Rust function's shim: the handle a method works on, read from where it is held,
  // then each argument as it crosses, owned strings and arrays given up once Rust has made its
  // own of them; what it gives made into a Fish value; and a panic in it raised at the call.
  rustInvoke(this: Mut<this>, target: InstanceId, pointer: string | undefined, args: Ref<string[]>, at: Ref<Expr>, cleanup?: (cg: Mut<Codegen>) => void, after?: (cg: Mut<Codegen>) => void): string | undefined {
    const load = (cg: Mut<Codegen>, type: string, from: string) => {
      const v = cg.temp();
      cg.emit(`${v} = load ${type}, ptr ${from}`);
      return v;
    };
    const part = (cg: Mut<Codegen>, whole: string, i: usize) => {
      const v = cg.temp();
      cg.emit(`${v} = extractvalue ${ARRAY} ${whole}, ${i}`);
      return v;
    };
    let passed: string[] = [];
    let given: (() => void)[] = [];
    if ((pointer !== undefined && pointer !== "") && this.bodyAt(target).self !== undefined && !this.bodyAt(target).self!.constructor) {
      passed.push(`ptr ${load(this, "ptr", pointer)}`);
      // A method taking its object over leaves the place it was in empty, as one in Fish does.
      if (this.bodyAt(target).self!.owned === true) this.emit(`store ptr null, ptr ${pointer}`);
    }
    // An owned array is given up once Rust has its elements: Rust has made its own strings and
    // numbers, and taken the Rust values, which leave only the buffer.
    const giveUp = (cg: Mut<Codegen>, v: string, c: Extract<Crossing, { kind: "array" }>, t: Type) => {
      if (c.element.kind !== "handle") {
        cg.dispose(v, t);
        return;
      }
      const emptied = cg.temp();
      cg.emit(`${emptied} = insertvalue ${ARRAY} ${v}, i64 0, 1`);
      cg.dispose(emptied, t);
    };
    function pass(cg: Mut<Codegen>, c: Crossing, t: Type, v: string): string[] {
      switch (c.kind) {
        case "plain":
          return [`${crossing(cg.tables.typing, t)} ${v}`];
        case "handle":
          return [`ptr ${v}`];
        case "string":
          given.push(() => cg.dispose(v, t));
          return [`ptr ${v}`];
        case "lent":
          return [`ptr ${load(cg, "ptr", v)}`];
        case "array": {
          const whole = c.lent ? load(cg, ARRAY, v) : v;
          if (!c.lent) given.push(() => giveUp(cg, v, c, t));
          return [`ptr ${part(cg, whole, 0)}`, `i64 ${part(cg, whole, 1)}`];
        }
        case "option": {
          const none = cg.conversions().holds(v, t as UnionType, ["null"]);
          const inner = cg.convert(v, t, c.inner);
          if (c.of.kind === "string") given.push(() => cg.dispose(v, t));
          if (c.of.kind === "array" && !c.of.lent) {
            const array = c.of;
            given.push(() => {
              const [some, done] = [cg.label(), cg.label()];
              cg.emit(`br i1 ${none}, label %${done}, label %${some}`);
              cg.startBlock(some);
              giveUp(cg, inner, array, c.inner);
              cg.emit(`br label %${done}`);
              cg.startBlock(done);
            });
          }
          if (c.of.kind === "plain" || c.of.kind === "array") {
            const some = cg.temp();
            cg.emit(`${some} = xor i1 ${none}, true`);
            const chosen = c.of.kind === "array" ? spilled(cg, inner) : inner;
            return [`i1 zeroext ${some}`, ...pass(cg, c.of.kind === "array" ? { ...c.of, lent: true } : c.of, c.inner, chosen)];
          }
          const p = cg.temp();
          cg.emit(`${p} = select i1 ${none}, ptr null, ptr ${inner}`);
          return [`ptr ${p}`];
        }
      }
    }
    // An Option's array is read where it is spilled, as a lent one is.
    const spilled = (cg: Mut<Codegen>, v: string) => {
      const slot = cg.alloca(ARRAY);
      cg.emit(`store ${ARRAY} ${v}, ptr ${slot}`);
      return slot;
    };
    for (let i: usize = 0; i < args.length; i++) {
      const a = args[i]!;
      const part2 = this.inst(target).signature![i]!;
      const rustCrossing2 = rustCrossing(this.tables.typing, part2);
      const crossed2 = pass(this, rustCrossing2, part2, a.slice(a.lastIndexOf(" ") + 1));
      for (const x of crossed2) passed.push(x);
    }
    const gives = rustGiven(this.tables.typing, this.tables.arenas, this.inst(target));
    const shim = shimGives(this.tables.typing, gives);
    const out = (shim.out !== undefined && shim.out !== "") ? this.alloca(shim.out) : undefined;
    if ((out !== undefined && out !== "")) passed.push(`ptr ${out}`);
    const err = this.inst(target).throws !== undefined ? this.alloca("ptr") : undefined;
    if ((err !== undefined && err !== "")) {
      this.emit(`store ptr null, ptr ${err}`);
      passed.push(`ptr ${err}`);
    }
    const caught = this.alloca("ptr");
    this.emit(`store ptr null, ptr ${caught}`);
    passed.push(`ptr ${caught}`);
    const call = `call ${shim.returns} ${this.symbol(target)}(${passed.join(", ")})`;
    const result = shim.returns === "void" ? undefined : this.temp();
    this.unwinding(call, result, cleanup);
    for (const g of given) {
      g();
    }
    this.rustPanic(caught, { start: at.start, end: at.end });
    after?.(this);
    if ((err !== undefined && err !== "")) {
      const part3 = this.inst(target).throws!;
      this.rustErr(err, part3, at);
    }
    if (gives === undefined) return undefined;
    const type = this.bodyAt(target).self?.constructor === true ? this.bodyAt(target).owner! : this.inst(target).returns;
    if (gives.kind !== "option") return gives.kind === "array" ? load(this, ARRAY, out!) : result;
    const some = gives.of.kind === "plain" || gives.of.kind === "array" ? result! : this.temp();
    if (some !== result) this.emit(`${some} = icmp ne ptr ${result}, null`);
    let inner: string;
    if (gives.of.kind === "plain") {
      const llvm2 = this.llvm(gives.inner);
      inner = load(this, llvm2, out!);
    } else {
      inner = gives.of.kind === "array" ? load(this, ARRAY, out!) : result!;
    }
    const made = this.temp();
    const line = `${made} = select i1 ${some}, ${this.llvm(type)} ${this.convert(inner, gives.inner, type)}, ${this.llvm(type)} ${this.convert("zeroinitializer", "null", type)}`;
    this.emit(line);
    return made;
  }


  // A Rust `Err` the shim handed back, raised at the call: the Rust value itself, or Fish's
  // `Error` with the Rust error's text as its message.
  rustErr(this: Mut<this>, err: string, thrown: Type, at: Ref<Expr>) {
    const [error, failed, bad, ok] = [this.temp(), this.temp(), this.label(), this.label()];
    this.emit(`${error} = load ptr, ptr ${err}`);
    this.emit(`${failed} = icmp ne ptr ${error}, null`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(bad);
    if (rustClassOf(this.tables.typing, thrown) !== undefined) this.raised(at, error);
    else {
      const made = this.tables.typing.rec(thrown as ClassType).fields.reduce((whole, f, i) => {
        const v = f.name === "name" ? this.text("Error") : f.name === "message" ? error : f.name === "cause" ? this.convert("zeroinitializer", "null", f.type) : undefined;
        if (v === undefined) throw new Error(`internal error: Error has a field '${f.name}' a Rust error doesn't fill`);
        const next = this.temp();
        this.emit(`${next} = insertvalue ${this.llvm(thrown)} ${whole}, ${this.llvm(f.type)} ${v}, ${i}`);
        return next;
      }, "undef");
      this.raised(at, made);
    }
    this.startBlock(ok);
  }


  // A panic a Rust function's shim caught, raised as a Fish panic at the call.
  rustPanic(this: Mut<this>, caught: string, at: Ref<Span>) {
    const [message, failed, bad, ok] = [this.temp(), this.temp(), this.label(), this.label()];
    this.emit(`${message} = load ptr, ptr ${caught}`);
    this.emit(`${failed} = icmp ne ptr ${message}, null`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(bad);
    const line = `call void @fsh_rt_panic_rust(ptr ${this.panicAt(at)}, ptr ${message})`;
    this.unwinding(line);
    this.emit("unreachable");
    this.startBlock(ok);
  }


  // The future an async function's poll, or an async generator's resume, answers as.
  pollOf(this: Mut<this>, i: InstanceId): FutureType {
    const future = this.inst(i).future;
    if (future !== undefined) return future;
    const generator = this.inst(i).generator!;
    return this.tables.typing.leafFuture("next", generator);
  }


  // What a generator gives back from a `yield` or its end: what `next()` gives, which an async
  // one's resume gives as ready.
  yieldedAs(this: Mut<this>, answer: string): string {
    const part = this.cur().generator;
    const g = this.recOf(part);
    if (g?.kind === "generator" && g.async === true) {
      const pollOf2 = this.pollOf(this.current);
      return this.polled(pollOf2, 1, answer);
    }
    if (g?.kind !== "generator" || g.throws === undefined) return answer;
    const made = this.temp();
    const resultType2 = this.resultType(this.current);
    const nextResult2 = this.tables.typing.nextResult(g.yields);
    const line = `${made} = insertvalue ${resultType2} zeroinitializer, ${this.llvm(nextResult2)} ${answer}, 1`;
    this.emit(line);
    return made;
  }


  // The IR type a function returns: its value, or for a throwing one, whether it failed, then
  // its value (`{}` for none) and its error.
  resultType(this: Mut<this>, i: InstanceId): string {
    const part = this.inst(i).generator;
    if (this.recOf(part)?.async === true) {
      const pollOf2 = this.pollOf(i);
      return this.pollType(pollOf2);
    }
    if (this.inst(i).generator !== undefined) {
      const g = this.tables.typing.rec(this.inst(i).generator!);
      if (g.throws !== undefined) {
        const nextResult2 = this.tables.typing.nextResult(g.yields);
        return this.throwing(nextResult2, g.throws);
      }
      const nextResult3 = this.tables.typing.nextResult(g.yields);
      return this.llvm(nextResult3);
    }
    if (this.inst(i).future !== undefined) {
      const part2 = this.inst(i).future!;
      return this.pollType(part2);
    }
    if (this.inst(i).throws === undefined) {
      const part3 = this.inst(i).returns;
      return this.llvm(part3);
    }
    const part4 = this.inst(i).returns;
    const part5 = this.inst(i).throws!;
    return this.throwing(part4, part5);
  }


  throwing(returns: Type, throws: Type): string {
    return `{ i1, ${returns === "void" ? "{}" : this.llvm(returns)}, ${this.llvm(throws)} }`;
  }



  // Opens the region of a `try` with a `finally`, the innermost until its `finally` is emitted.
  enter(this: Mut<this>): void {
    const label = this.label();
    const chosen = this.alloca("i32");
    this.finallies.push({ label, chosen, exits: [], start: this.labels, handlers: this.handlers.length, depth: this.scopes.length, floor: this.floor, slots: new Map<string, { slot: string; type: Type }>() });
  }


  // Leaves a region the way `key` names, through its `finally`, which then resumes it.
  // The innermost region's way out named `key`, added the first time it is taken.
  exit(this: Mut<this>, key: string, resume: (cg: Mut<Codegen>) => void) {
    const at = this.finallies.length - 1;
    let i = this.finallies[at]!.exits.findIndex((e) => e.key === key);
    if (i < 0) {
      this.finallies[at]!.exits.push({ key: key, resume: resume });
      i = (this.finallies[at]!.exits.length - 1) as i64;
    }
    this.emit(`store i32 ${i}, ptr ${this.finallies[at]!.chosen}`);
    this.emit(`br label %${this.finallies[at]!.label}`);
  }


  // A slot a region keeps a value in while its `finally` runs.
  stash(this: Mut<this>, key: string, type: Type, v: string): string {
    const at = this.finallies.length - 1;
    let slot = this.finallies[at]!.slots.get(key)?.slot;
    if (slot === undefined || slot === "") {
      slot = this.alloca(this.llvm(type));
      this.finallies[at]!.slots.set(key, { slot, type });
    }
    this.emit(`store ${this.llvm(type)} ${v}, ptr ${slot}`);
    return slot;
  }


  // Takes a value back out of a region's slot, leaving it empty.
  unstash(this: Mut<this>, slot: string, type: Type): string {
    const v = this.temp();
    this.emit(`${v} = load ${this.llvm(type)}, ptr ${slot}`);
    this.emit(`store ${this.llvm(type)} zeroinitializer, ptr ${slot}`);
    return v;
  }


  // Jumps to a label outside the scopes from `depth` inward, dropping what they own, through
  // each `finally` whose region it leaves.
  jump(this: Mut<this>, to: string, depth: usize): void {
    const inner = this.finallies.length > 0 ? this.finallies[this.finallies.length - 1]! : undefined;
    if (inner !== undefined && (parseInt(to.slice(1))! as usize) < inner.start) {
      this.drop(inner.depth);
      this.exit(`jump ${to}`, (cg: Mut<Codegen>) => cg.jump(to, depth));
      return;
    }
    this.drop(depth);
    this.emit(`br label %${to}`);
  }


  // Leaves the function being emitted with a value, or with none, through any `finally`.
  leave(this: Mut<this>, v: string | undefined): void {
    const inner = this.finallies.length > 0;
    this.drop(inner ? this.finallies[this.finallies.length - 1]!.depth : 0);
    const gives = this.cur().future !== undefined ? this.tables.typing.rec(this.cur().future!).gives : this.cur().returns;
    if (inner) {
      const kept = v === undefined ? undefined : this.stash("return", gives, v);
      this.exit("return", (cg: Mut<Codegen>) => {
        const chosen = kept !== undefined ? cg.unstash(kept, gives) : undefined;
        cg.leave(chosen);
      });
      return;
    }
    // A generator or a future that finishes stays finished; a future gives its value as it does.
    if (this.resuming !== undefined) {
      this.emit("store i32 -1, ptr %state");
      if (this.cur().future !== undefined) {
        const resultType2 = this.resultType(this.current);
        const part = this.cur().future!;
        const line = `ret ${resultType2} ${this.polled(part, 1, v)}`;
        this.emit(line);
        return;
      }
      this.emit(`br label %${this.resuming.done}`);
      return;
    }
    if (this.cur().throws === undefined) {
      let chosen2: string;
      if (v === undefined) {
        chosen2 = "ret void";
      } else {
        const part2 = this.cur().returns;
        chosen2 = `ret ${this.llvm(part2)} ${v}`;
      }
      this.emit(chosen2);
      return;
    }
    const type = this.resultType(this.current);
    let result = this.temp();
    this.emit(`${result} = insertvalue ${type} undef, i1 false, 0`);
    if (v !== undefined) {
      const next = this.temp();
      const part3 = this.cur().returns;
      const line2 = `${next} = insertvalue ${type} ${result}, ${this.llvm(part3)} ${v}, 1`;
      this.emit(line2);
      result = next;
    }
    this.emit(`ret ${type} ${result}`);
  }


  // An error raised by a `throw` or a failed call, which goes to the innermost catch, or else
  // leaves the function with it.
  raised(this: Mut<this>, at: Ref<Expr | Stmt>, error: string) {
    const { from, to, wrapper, param, via } = this.cur().raises.get(at)!;
    if (via === undefined) {
      const convert2 = this.convert(error, from, to);
      this.route(convert2, to);
      return;
    }
    // Wrapped by the error class's static `from` first.
    const list = [`${this.llvm(param!)} ${this.convert(error, from, param!)}`];
    const wrapped = this.invoke(this.tables.arenas.instanceOf(via).id, undefined, list)!;
    const convert3 = this.convert(wrapped, wrapper!, to);
    this.route(convert3, to);
  }


  // Sends an error of type `to` to the innermost catch, through any `finally` in between, or
  // else leaves the function with it.
  // What the statement made so far, and what the scopes left own, are dropped on the way; in a
  // match arm's block, so are the values pending in the expressions it leaves.
  route(this: Mut<this>, error: string, to: Type): void {
    const region = this.finallies.length > 0 ? this.finallies[this.finallies.length - 1]! : undefined;
    const toRegion = region !== undefined && this.handlers.length <= region.handlers;
    const kept = region !== undefined && toRegion ? region.floor : this.handlers.length > 0 ? this.handlers[this.handlers.length - 1]!.floor : 0;
    let reversed = this.pending.slice(kept as i64);
    reversed.reverse();
    for (const { v, type } of reversed) this.dispose(v, type);
    if (region !== undefined && toRegion) {
      this.drop(region.depth);
      const kept = this.stash("error", to, error);
      this.exit("error", (cg: Mut<Codegen>) => {
        const unstash2 = cg.unstash(kept, to);
        cg.route(unstash2, to);
      });
      return;
    }
    const handler = this.handlers.at(-1);
    this.drop(handler?.depth ?? 0);
    if (handler !== undefined) {
      this.emit(`store ${this.llvm(to)} ${error}, ptr ${handler.slot}`);
      this.emit(`br label %${handler.label}`);
      return;
    }
    if (this.cur().future !== undefined) {
      this.emit("store i32 -1, ptr %state");
      const resultType3 = this.resultType(this.current);
      const part = this.cur().future!;
      const line = `ret ${resultType3} ${this.polled(part, 2, undefined, error)}`;
      this.emit(line);
      return;
    }
    // A generator that throws is finished, as in JavaScript.
    if (this.cur().generator !== undefined) this.emit("store i32 -1, ptr %state");
    const part2 = this.cur().generator;
    if (this.recOf(part2)?.async === true) {
      const resultType2 = this.resultType(this.current);
      const pollOf2 = this.pollOf(this.current);
      const line2 = `ret ${resultType2} ${this.polled(pollOf2, 2, undefined, error)}`;
      this.emit(line2);
      return;
    }
    const type = this.resultType(this.current);
    const [a, b] = [this.temp(), this.temp()];
    this.emit(`${a} = insertvalue ${type} undef, i1 true, 0`);
    this.emit(`${b} = insertvalue ${type} ${a}, ${this.llvm(to)} ${error}, 2`);
    this.emit(`ret ${type} ${b}`);
  }


  // What polling a future gives: a tag, pending (0), ready (1) or failed (2), then the value it
  // gives and the error it throws, each `{}` when there is none.
  pollType(f: FutureType | HandleType): string {
    const r = this.tables.typing.rec(f);
    return `{ i8, ${r.gives === "void" ? "{}" : this.llvm(r.gives)}, ${r.throws !== undefined ? this.llvm(r.throws) : "{}"} }`;
  }


  // A poll result with `tag`, and the value or the error it carries.
  polled(this: Mut<this>, f: FutureType, tag: u8, v?: string, error?: string): string {
    let made = this.temp();
    this.emit(`${made} = insertvalue ${this.pollType(f)} zeroinitializer, i8 ${tag}, 0`);
    const parts: (string | undefined)[] = [v, error];
    const ats: usize[] = [1, 2];
    const types: (Type | undefined)[] = [this.tables.typing.rec(f).gives, this.tables.typing.rec(f).throws];
    for (let k: usize = 0; k < parts.length; k++) {
      const part = parts[k];
      const at = ats[k]!;
      const type = types[k];
      if (part === undefined || type === undefined || type === "void") continue;
      const next = this.temp();
      this.emit(`${next} = insertvalue ${this.pollType(f)} ${made}, ${this.llvm(type)} ${part}, ${at}`);
      made = next;
    }
    return made;
  }


  // `await p`: the future moves into its slot in the frame, and is polled there, here and at
  // each later poll of this one until it is done. While it is pending, so is this future. Its
  // value comes out, or its error is raised; either way it is finished, and dropped.
  awaitFuture(this: Mut<this>, e: Ref<Extract<Expr, { kind: "unary" }>>): string | undefined {
    const inner = this.valueType(e.operand) as FutureType | HandleType | DynType;
    const field = this.cur().frame!.awaits.get(e)!;
    const at = `%await${field}`;
    const line = `store ${this.llvm(inner)} ${this.owned(e.operand)}, ptr ${at}`;
    this.emit(line);
    this.settle();
    this.scopes[this.scopes.length - 1]!.held.push({ slot: at, type: inner });
    return this.suspend(inner, at, field, e);
  }


  // Polls the future in frame field `field`, at `at`, until it is done, this future or async
  // generator pending meanwhile; then it is finished and dropped, and gives its value, or its
  // error is raised at `e`.
  suspend(this: Mut<this>, inner: FutureType | HandleType | DynType, at: string, field: usize, e: Ref<Expr>): string | undefined {
    // A boxed future polls as a future giving what its Promise does, and throws nothing.
    const shape = this.tables.typing.rec(inner).kind === "dyn" ? this.tables.typing.handleType(this.tables.typing.promiseElement(this.tables.typing.rec(inner as DynType).of)!, undefined) : (inner as FutureType | HandleType);
    const poll = this.label();
    if (this.resuming !== undefined) this.resuming.resumes.push(poll);
    const resumed = this.resuming!.resumes.length;
    if (!this.awaitsOf.has(this.current)) this.awaitsOf.set(this.current, []);
    this.awaitsOf.get(this.current)!.push({ state: resumed, field, type: inner });
    this.emit(`br label %${poll}`);
    this.startBlock(poll);
    const step = this.pollStep(inner, at, { start: e.start, end: e.end });
    this.startBlock(step.waiting);
    // `yieldNow` asks to be polled again at once, behind whatever else is waiting.
    if (inner === YIELD_NOW) this.emit("call void @fsh_rt_wake(ptr %cx)");
    this.emit(`store i32 ${resumed}, ptr %state`);
    const resultType2 = this.resultType(this.current);
    const pollOf2 = this.pollOf(this.current);
    const line = `ret ${resultType2} ${this.polled(pollOf2, 0)}`;
    this.emit(line);
    const finish = (cg: Mut<Codegen>) => {
      const old = cg.temp();
      cg.emit(`${old} = load ${cg.llvm(inner)}, ptr ${at}`);
      cg.emit(`store ${cg.llvm(inner)} zeroinitializer, ptr ${at}`);
      cg.dispose(old, inner);
    };
    if (this.tables.typing.rec(shape).throws !== undefined) {
      this.startBlock(step.failed);
      const error = step.error(this);
      finish(this);
      this.raised(e, error);
    } else if (inner !== YIELD_NOW && inner !== SLEEP) {
      this.startBlock(step.failed);
      this.emit("unreachable");
    }
    this.startBlock(step.ready);
    const v = step.value(this);
    finish(this);
    return v;
  }


  // A combined future's poll: each future not yet done is polled in turn, and one done keeps its
  // value, its outcome for `allSettled`, or its error for `any`. `race` is done with the first to
  // settle, `any` with the first success or the last error, `all` with the last or the first
  // error, `allSettled` with the last; then the ones still waiting are cancelled where they wait,
  // and the awaiter's drop of this frame drops them.
  combinePoll(this: Mut<this>, t: FutureType): string {
    const known = this.combinePolls.get(t);
    if ((known !== undefined && known !== "")) return known;
    const line = `${this.tables.typing.described(t)} ${this.tables.typing.combinedOf.get(t)!.at.start}`;
    const name = `@fsh.combine.${this.stableId("combine", line, typeOwner(t))}`;
    this.combinePolls.set(t, name);
    const { kind, futures, at, array } = this.tables.typing.combinedOf.get(t)!;
    if (array !== undefined) return this.combineArray(t, name, kind, array, { start: at.start, end: at.end });
    const saved = this.setAside();
    const field = (cg: Mut<Codegen>, i: usize) => {
      const p = cg.temp();
      cg.emit(`${p} = getelementptr ${cg.llvm(t)}, ptr %frame, i32 0, i32 ${i}`);
      return p;
    };
    const valueOf = (cg: Mut<Codegen>, f: FutureType | HandleType | DynType): Type => {
      const fr = cg.tables.typing.rec(f);
      const gives = fr.kind === "dyn" ? cg.tables.typing.promiseElement(fr.of)! : fr.gives;
      return gives === "void" ? "null" : gives;
    };
    // What each future's slot keeps: its value, its outcome, or for `any` its error.
    const kept = (cg: Mut<Codegen>, i: usize) => cg.tables.typing.rec(t).frame[2 + 3 * i]!.type;
    const finishWith = (cg: Mut<Codegen>, tag: u8, v?: string, error?: string) => {
      const line2 = `ret ${cg.pollType(t)} ${cg.polled(t, tag, v, error)}`;
      cg.emit(line2);
    };
    const finished = (cg: Mut<Codegen>, at: string, f: Type) => {
      const old = cg.temp();
      cg.emit(`${old} = load ${cg.llvm(f)}, ptr ${at}`);
      cg.emit(`store ${cg.llvm(f)} zeroinitializer, ptr ${at}`);
      cg.dispose(old, f);
    };
    const cancelOthers = (cg: Mut<Codegen>, except: usize) => futures.forEach((f, j) => {
      if (j !== except) {
        const field2 = field(cg, 3 + 3 * j);
        cg.whileWaiting(field2, (cg) => {
          const field3 = field(cg, 1 + 3 * j);
          cg.cancelAt(field3, f);
        });
      }
    });
    let iAt: usize = 0;
    for (const f of futures) {
      const i = iAt;
      iAt++;
      const [futureAt, valueAt, doneAt] = [field(this, 1 + 3 * i), field(this, 2 + 3 * i), field(this, 3 + 3 * i)];
      const [d, over, skip, go] = [this.temp(), this.temp(), this.label(), this.label()];
      const fr = this.tables.typing.rec(f);
      const thrown = fr.kind === "dyn" ? undefined : fr.throws;
      const valueOf2 = valueOf(this, f);
      const outcome = this.tables.typing.settledParts(valueOf2, thrown);
      const keep = (cg: Mut<Codegen>, v: string, from: Type) => {
        const kept2 = kept(cg, i);
        const llvm2 = cg.llvm(kept2);
        const kept3 = kept(cg, i);
        const line3 = `store ${llvm2} ${cg.convert(v, from, kept3)}, ptr ${valueAt}`;
        cg.emit(line3);
      };
      this.emit(`${d} = load i32, ptr ${doneAt}`);
      this.emit(`${over} = icmp eq i32 ${d}, 2`);
      this.emit(`br i1 ${over}, label %${skip}, label %${go}`);
      this.startBlock(go);
      this.emit(`store i32 1, ptr ${doneAt}`);
      const step = this.pollStep(f, futureAt, { start: at.start, end: at.end });
      this.startBlock(step.waiting);
      // `yieldNow` asks to be polled again at once, behind whatever else is waiting.
      if (f === YIELD_NOW) this.emit("call void @fsh_rt_wake(ptr %cx)");
      this.emit(`br label %${skip}`);
      this.startBlock(step.ready);
      const v = step.value(this) ?? "zeroinitializer";
      finished(this, futureAt, f);
      this.emit(`store i32 2, ptr ${doneAt}`);
      if (kind === "race" || kind === "any") {
        cancelOthers(this, i);
        const valueOf3 = valueOf(this, f);
        const convert2 = this.convert(v, valueOf3, this.tables.typing.rec(t).gives);
        finishWith(this, 1, convert2);
      } else {
        if (kind === "allSettled") {
          const objectOf2 = this.objectOf(outcome.fulfilled, { value: v });
          keep(this, objectOf2, outcome.fulfilled);
        }
        else {
          const valueOf4 = valueOf(this, f);
          keep(this, v, valueOf4);
        }
        this.emit(`br label %${skip}`);
      }
      this.startBlock(step.failed);
      if (thrown !== undefined) {
        const error = step.error(this);
        finished(this, futureAt, f);
        this.emit(`store i32 2, ptr ${doneAt}`);
        if (kind === "all" || kind === "race") {
          cancelOthers(this, i);
          const convert3 = this.convert(error, thrown, this.tables.typing.rec(t).throws!);
          finishWith(this, 2, undefined, convert3);
        } else {
          // An outcome, or for `any` an error kept for its AggregateError.
          if (kind === "allSettled") {
            const objectOf3 = this.objectOf(outcome.rejected!, { reason: error });
            keep(this, objectOf3, outcome.rejected!);
          }
          else keep(this, error, thrown);
          this.emit(`br label %${skip}`);
        }
      } else this.emit("unreachable");
      this.startBlock(skip);
    }
    if (kind === "race") finishWith(this, 0);
    else {
      let all = "true";
      let iAt2: usize = 0;
      for (const _ of futures) {
        const i = iAt2;
        iAt2++;
        const [d, over, both] = [this.temp(), this.temp(), this.temp()];
        const line4 = `${d} = load i32, ptr ${field(this, 3 + 3 * i)}`;
        this.emit(line4);
        this.emit(`${over} = icmp eq i32 ${d}, 2`);
        this.emit(`${both} = and i1 ${all}, ${over}`);
        all = both;
      }
      const [waiting, ready] = [this.label(), this.label()];
      this.emit(`br i1 ${all}, label %${ready}, label %${waiting}`);
      this.startBlock(waiting);
      finishWith(this, 0);
      this.startBlock(ready);
      // What the slots keep moves out of the frame: into the tuple, or, for an `any` every one of
      // whose futures failed, into its AggregateError.
      const moved = futures.map((_, i) => {
        const [valueAt, v] = [field(this, 2 + 3 * i), this.temp()];
        const kept4 = kept(this, i);
        const line5 = `${v} = load ${this.llvm(kept4)}, ptr ${valueAt}`;
        this.emit(line5);
        const kept5 = kept(this, i);
        const line6 = `store ${this.llvm(kept5)} zeroinitializer, ptr ${valueAt}`;
        this.emit(line6);
        return v;
      });
      if (kind === "any") {
        if (this.tables.typing.rec(t).throws === undefined) this.emit("unreachable");
        else {
          const map2 = moved.map((v, i) => [v, kept(this, i)] as const);
          const aggregated2 = this.aggregated(this.tables.typing.rec(t).throws as ClassType, map2);
          finishWith(this, 2, undefined, aggregated2);
        }
      } else {
        const tuple = this.tables.typing.rec(t).gives as ObjectType;
        let made = "zeroinitializer";
        let iAt3: usize = 0;
        for (const v of moved) {
          const i = iAt3;
          iAt3++;
          const next = this.temp();
          const kept6 = kept(this, i);
          const line7 = `${next} = insertvalue ${this.llvm(tuple)} ${made}, ${this.llvm(kept6)} ${v}, ${this.tables.typing.fieldPath(tuple, String(i)).join(", ")}`;
          this.emit(line7);
          made = next;
        }
        finishWith(this, 1, made);
      }
    }
    this.out.push(`define internal ${this.pollType(t)} ${name}(ptr %frame, ptr %cx) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUp(saved);
    return name;
  }


  // `combinePoll` over an array of `Promise<T>` values. Its first poll makes the values array and
  // a flag per future, every one zero.
  combineArray(this: Mut<this>, t: FutureType, name: string, kind: "all" | "race" | "allSettled" | "any", array: ArrayType, at: Ref<Span>): string {
    const saved = this.setAside();
    const dyn = this.tables.typing.rec(array).element as DynType;
    const given = this.tables.typing.promiseElement(this.tables.typing.rec(dyn).of)!;
    const value = given === "void" ? "null" : given;
    // What the values array keeps: each value, or for `allSettled` its outcome.
    const keptType = this.tables.typing.rec(this.tables.typing.rec(t).frame[2]!.type as ArrayType).element;
    const element = this.llvm(keptType);
    const field = (cg: Mut<Codegen>, i: usize) => {
      const p = cg.temp();
      cg.emit(`${p} = getelementptr ${cg.llvm(t)}, ptr %frame, i32 0, i32 ${i}`);
      return p;
    };
    const [futuresAt, valuesAt, flagsAt] = [field(this, 1), field(this, 2), field(this, 3)];
    const part = (cg: Mut<Codegen>, at: string, i: usize) => {
      const p = cg.temp();
      cg.emit(`${p} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 ${i}`);
      return p;
    };
    const [futures, n] = [this.temp(), this.temp()];
    const line3 = `${futures} = load ptr, ptr ${part(this, futuresAt, 0)}`;
    this.emit(line3);
    const line4 = `${n} = load i64, ptr ${part(this, futuresAt, 1)}`;
    this.emit(line4);
    const [state, fresh, first, go] = [this.temp(), this.temp(), this.label(), this.label()];
    this.emit(`${state} = load i32, ptr %frame`);
    this.emit(`${fresh} = icmp eq i32 ${state}, 0`);
    this.emit(`br i1 ${fresh}, label %${first}, label %${go}`);
    this.startBlock(first);
    this.emit("store i32 1, ptr %frame");
    const [bytes, values, flags] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${bytes} = mul i64 ${n}, ${this.sizeOf(element)}`);
    this.emit(`${values} = call ptr @fsh_rt_array_zeroed(i64 ${bytes})`);
    this.emit(`${flags} = call ptr @fsh_rt_array_zeroed(i64 ${n})`);
    const slots: string[] = [valuesAt, flagsAt];
    const datas: string[] = [values, flags];
    for (let k: usize = 0; k < slots.length; k++) {
      const slot = slots[k]!;
      const data = datas[k]!;
      const line5 = `store ptr ${data}, ptr ${part(this, slot, 0)}`;
      this.emit(line5);
      const line6 = `store i64 ${n}, ptr ${part(this, slot, 1)}`;
      this.emit(line6);
      const line7 = `store i64 ${n}, ptr ${part(this, slot, 2)}`;
      this.emit(line7);
    }
    this.emit(`br label %${go}`);
    this.startBlock(go);
    const [valuesData, flagsData] = [this.temp(), this.temp()];
    const line8 = `${valuesData} = load ptr, ptr ${part(this, valuesAt, 0)}`;
    this.emit(line8);
    const line9 = `${flagsData} = load ptr, ptr ${part(this, flagsAt, 0)}`;
    this.emit(line9);
    const finishWith = (cg: Mut<Codegen>, tag: u8, v?: string, error?: string) => {
      const line = `ret ${cg.pollType(t)} ${cg.polled(t, tag, v, error)}`;
      cg.emit(line);
    };
    // Each index below `n`, in a loop of its own.
    const each = (cg: Mut<Codegen>, body: (cg: Mut<Codegen>, i: string, next: string) => void) => {
      const index = cg.alloca("i64");
      cg.emit(`store i64 0, ptr ${index}`);
      const [head, loop, next, done] = [cg.label(), cg.label(), cg.label(), cg.label()];
      cg.emit(`br label %${head}`);
      cg.startBlock(head);
      const [i, more] = [cg.temp(), cg.temp()];
      cg.emit(`${i} = load i64, ptr ${index}`);
      cg.emit(`${more} = icmp slt i64 ${i}, ${n}`);
      cg.emit(`br i1 ${more}, label %${loop}, label %${done}`);
      cg.startBlock(loop);
      body(cg, i, next);
      cg.startBlock(next);
      const step = cg.temp();
      cg.emit(`${step} = add i64 ${i}, 1`);
      cg.emit(`store i64 ${step}, ptr ${index}`);
      cg.emit(`br label %${head}`);
      cg.startBlock(done);
    };
    const flagOf = (cg: Mut<Codegen>, i: string) => {
      const [p, f] = [cg.temp(), cg.temp()];
      cg.emit(`${p} = getelementptr i8, ptr ${flagsData}, i64 ${i}`);
      cg.emit(`${f} = load i8, ptr ${p}`);
      return [p, f] as const;
    };
    const futureOf_ = (cg: Mut<Codegen>, i: string) => {
      const p = cg.temp();
      cg.emit(`${p} = getelementptr ${DYN}, ptr ${futures}, i64 ${i}`);
      return p;
    };
    const cancelOthers = (cg: Mut<Codegen>, except: string) => each(cg, (cg, j, next) => {
      const [, f] = flagOf(cg, j);
      const [waiting, other, both, yes] = [cg.temp(), cg.temp(), cg.temp(), cg.label()];
      cg.emit(`${waiting} = icmp eq i8 ${f}, 1`);
      cg.emit(`${other} = icmp ne i64 ${j}, ${except}`);
      cg.emit(`${both} = and i1 ${waiting}, ${other}`);
      cg.emit(`br i1 ${both}, label %${yes}, label %${next}`);
      cg.startBlock(yes);
      const futureOf_2 = futureOf_(cg, j);
      cg.cancelAt(futureOf_2, dyn);
      cg.emit(`br label %${next}`);
    });
    each(this, (cg, i, next) => {
      const [flagAt, f] = flagOf(cg, i);
      const [over, poll] = [cg.temp(), cg.label()];
      cg.emit(`${over} = icmp eq i8 ${f}, 2`);
      cg.emit(`br i1 ${over}, label %${next}, label %${poll}`);
      cg.startBlock(poll);
      cg.emit(`store i8 1, ptr ${flagAt}`);
      const slot = futureOf_(cg, i);
      const step = cg.pollStep(dyn, slot, at);
      cg.startBlock(step.waiting);
      cg.emit(`br label %${next}`);
      cg.startBlock(step.ready);
      const v = step.value(cg) ?? "zeroinitializer";
      const old = cg.temp();
      cg.emit(`${old} = load ${DYN}, ptr ${slot}`);
      cg.emit(`store ${DYN} zeroinitializer, ptr ${slot}`);
      cg.dispose(old, dyn);
      cg.emit(`store i8 2, ptr ${flagAt}`);
      if (kind === "race" || kind === "any") {
        cancelOthers(cg, i);
        finishWith(cg, 1, v);
      } else {
        const p = cg.temp();
        const outcome = cg.tables.typing.settledParts(value, undefined).fulfilled;
        cg.emit(`${p} = getelementptr ${element}, ptr ${valuesData}, i64 ${i}`);
        const line2 = `store ${element} ${kind === "allSettled" ? cg.objectOf(outcome, { value: v }) : v}, ptr ${p}`;
        cg.emit(line2);
        cg.emit(`br label %${next}`);
      }
      cg.startBlock(step.failed);
      cg.emit("unreachable");
    });
    // A boxed future can't fail, so an `any` fails only over an empty array, as JavaScript rejects.
    if (kind === "race") finishWith(this, 0);
    else if (kind === "any") {
      const [empty, none, waiting] = [this.temp(), this.label(), this.label()];
      this.emit(`${empty} = icmp eq i64 ${n}, 0`);
      this.emit(`br i1 ${empty}, label %${none}, label %${waiting}`);
      this.startBlock(none);
      const aggregateOf2 = this.aggregateOf(this.tables.typing.rec(t).throws as ClassType, "null", "0");
      finishWith(this, 2, undefined, aggregateOf2);
      this.startBlock(waiting);
      finishWith(this, 0);
    } else {
      const count = this.alloca("i64");
      this.emit(`store i64 0, ptr ${count}`);
      each(this, (cg, i, next) => {
        const [, f] = flagOf(cg, i);
        const [over, c, added] = [cg.temp(), cg.temp(), cg.temp()];
        cg.emit(`${over} = icmp eq i8 ${f}, 2`);
        cg.emit(`${c} = load i64, ptr ${count}`);
        cg.emit(`${added} = add i64 ${c}, 1`);
        const [yes] = [cg.label()];
        cg.emit(`br i1 ${over}, label %${yes}, label %${next}`);
        cg.startBlock(yes);
        cg.emit(`store i64 ${added}, ptr ${count}`);
        cg.emit(`br label %${next}`);
      });
      const [c, all, ready, waiting] = [this.temp(), this.temp(), this.label(), this.label()];
      this.emit(`${c} = load i64, ptr ${count}`);
      this.emit(`${all} = icmp eq i64 ${c}, ${n}`);
      this.emit(`br i1 ${all}, label %${ready}, label %${waiting}`);
      this.startBlock(waiting);
      finishWith(this, 0);
      this.startBlock(ready);
      // The values move out of the frame.
      const v = this.temp();
      this.emit(`${v} = load ${ARRAY}, ptr ${valuesAt}`);
      this.emit(`store ${ARRAY} zeroinitializer, ptr ${valuesAt}`);
      finishWith(this, 1, v);
    }
    this.out.push(`define internal ${this.pollType(t)} ${name}(ptr %frame, ptr %cx) ${this.unwinds} {`);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUp(saved);
    return name;
  }


  // An object of `type` with the given fields, the rest, as a literal's, empty.
  objectOf(this: Mut<this>, type: ObjectType, given: Ref<Record<string, string>>): string {
    let made = "zeroinitializer";
    for (const [name, v] of Object.entries(given)) {
      const next = this.temp();
      this.emit(`${next} = insertvalue ${this.llvm(type)} ${made}, ${this.llvm(this.tables.typing.field(type, name)!.type)} ${v}, ${this.tables.typing.fieldPath(type, name).join(", ")}`);
      made = next;
    }
    return made;
  }


  // An `any`'s AggregateError: JavaScript's message, and each error in the list's order.
  aggregated(this: Mut<this>, type: ClassType, errors: Ref<(readonly [string, Type])[]>): string {
    const list = this.tables.typing.field(type, "errors")!.type as ArrayType;
    const element = this.llvm(this.tables.typing.rec(list).element);
    const [bytes, data] = [this.temp(), this.temp()];
    this.emit(`${bytes} = mul i64 ${errors.length}, ${this.sizeOf(element)}`);
    this.emit(`${data} = call ptr @fsh_rt_array_alloc(i64 ${bytes})`);
    let iAt: usize = 0;
    for (const [v, from] of errors) {
      const i = iAt;
      iAt++;
      const at = this.temp();
      this.emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
      const line = `store ${element} ${this.convert(v, from, this.tables.typing.rec(list).element)}, ptr ${at}`;
      this.emit(line);
    }
    return this.aggregateOf(type, data, String(errors.length));
  }


  aggregateOf(this: Mut<this>, type: ClassType, data: string, n: string): string {
    const [a, b, c, made, done] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
    this.emit(`${a} = insertvalue ${ARRAY} undef, ptr ${data}, 0`);
    this.emit(`${b} = insertvalue ${ARRAY} ${a}, i64 ${n}, 1`);
    this.emit(`${c} = insertvalue ${ARRAY} ${b}, i64 ${n}, 2`);
    this.emit(`${made} = insertvalue ${this.llvm(type)} zeroinitializer, ${ARRAY} ${c}, ${this.tables.typing.fieldPath(type, "errors").join(", ")}`);
    const [named] = [this.temp()];
    const line = `${done} = insertvalue ${this.llvm(type)} ${made}, ptr ${this.text("All promises were rejected")}, ${this.tables.typing.fieldPath(type, "message").join(", ")}`;
    this.emit(line);
    const line2 = `${named} = insertvalue ${this.llvm(type)} ${done}, ptr ${this.text("AggregateError")}, ${this.tables.typing.fieldPath(type, "name").join(", ")}`;
    this.emit(line2);
    return named;
  }


  // `then` where a combined future's flag at `doneAt` says its future is waiting.
  whileWaiting(this: Mut<this>, doneAt: string, then: (cg: Mut<Codegen>) => void) {
    const [d, waiting, yes, after] = [this.temp(), this.temp(), this.label(), this.label()];
    this.emit(`${d} = load i32, ptr ${doneAt}`);
    this.emit(`${waiting} = icmp eq i32 ${d}, 1`);
    this.emit(`br i1 ${waiting}, label %${yes}, label %${after}`);
    this.startBlock(yes);
    then(this);
    this.emit(`br label %${after}`);
    this.startBlock(after);
  }


  // Cancels the future of type `t` at `at`, paused where it waits: it leaves the waiters of what
  // it waits on, as an abort does, passing on a wake it was given, so nothing it waited on wakes
  // the task for it or loses a wake meant for another. Its drop comes after.
  cancelAt(this: Mut<this>, at: string, t: Type) {
    const r = this.recOf(t);
    // A boxed future through its vtable: the slot after its poll.
    if (r?.kind === "dyn" && this.tables.typing.promiseElement(r.of) !== undefined) {
      const [dyn, data, table, slot, fn] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
      this.emit(`${dyn} = load ${DYN}, ptr ${at}`);
      this.emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      this.emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      this.emit(`${slot} = getelementptr ptr, ptr ${table}, i64 4`);
      this.emit(`${fn} = load ptr, ptr ${slot}`);
      this.emit(`call void ${fn}(ptr ${data}, ptr %cx)`);
      return;
    }
    if (r?.kind !== "future" || t === YIELD_NOW) return;
    const frame = r.frame;
    const load = (cg: Mut<Codegen>, i: usize, of: string) => {
      const [p, v] = [cg.temp(), cg.temp()];
      cg.emit(`${p} = getelementptr ${cg.llvm(t)}, ptr ${at}, i32 0, i32 ${i}`);
      cg.emit(`${v} = load ${of}, ptr ${p}`);
      return [p, v] as const;
    };
    const leaf = this.tables.typing.leafOf.get(t as FutureType);
    if (t === SLEEP || leaf?.method === "sleep") this.emit(`call void @fsh_rt_sleep_cancel(ptr %cx, ptr ${at})`);
    else if (leaf?.method === "acquire") {
      const line3 = `call void @fsh_rt_semaphore_leave(ptr ${load(this, 1, "ptr")[1]}, ptr %cx, ptr ${at})`;
      this.emit(line3);
    }
    else if (leaf?.method === "send" || leaf?.method === "receive") {
      const line4 = `call void @fsh_rt_channel_leave(ptr ${load(this, 1, "ptr")[1]}, ptr %cx, ptr ${at})`;
      this.emit(line4);
    }
    else if (leaf !== undefined && ["connect", "accept", "read", "write", "sendTo", "receiveFrom"].includes(leaf.method)) {
      const line5 = `call void @fsh_rt_socket_leave(ptr ${load(this, 1, "ptr")[1]}, ptr %cx)`;
      this.emit(line5);
    }
    else if (leaf?.method === "next") {
      const instance = this.generatorOf.get(leaf.of as GeneratorType)!;
      this.cancelled.add(instance);
      const line = `call void ${this.cancelSymbol(instance)}(ptr ${load(this, 1, "ptr")[1]}, ptr %cx)`;
      this.emit(line);
    }
    if (leaf?.signal === true) {
      const [flag] = load(this, frame.length - 1, "i32");
      const line6 = `call void @fsh_rt_signal_leave(ptr ${load(this, frame.length - 2, "ptr")[1]}, ptr ${flag}, ptr %cx)`;
      this.emit(line6);
    }
    if (leaf !== undefined || t === SLEEP) return;
    const combined = this.tables.typing.combinedOf.get(t as FutureType);
    if (combined?.array !== undefined) {
      this.combinedArrayCancel(at, t as FutureType, combined.array);
      return;
    }
    if (combined !== undefined) {
      let jAt: usize = 0;
      for (const f of combined.futures) {
        const j = jAt;
        jAt++;
        const [doneAt, futureAt] = [this.temp(), this.temp()];
        this.emit(`${doneAt} = getelementptr ${this.llvm(t)}, ptr ${at}, i32 0, i32 ${3 + 3 * j}`);
        this.emit(`${futureAt} = getelementptr ${this.llvm(t)}, ptr ${at}, i32 0, i32 ${1 + 3 * j}`);
        this.whileWaiting(doneAt, (cg) => cg.cancelAt(futureAt, f));
      }
      return;
    }
    const instance = this.futureOf.get(t as FutureType);
    if (instance === undefined) return;
    this.cancelled.add(instance);
    const line2 = `call void ${this.cancelSymbol(instance)}(ptr ${at}, ptr %cx)`;
    this.emit(line2);
  }


  // A combined future over an array cancels each future its flags say is waiting.
  combinedArrayCancel(this: Mut<this>, at: string, t: FutureType, array: ArrayType) {
    const field = (cg: Mut<Codegen>, i: usize, j: usize, of: string) => {
      const [p, q, v] = [cg.temp(), cg.temp(), cg.temp()];
      cg.emit(`${p} = getelementptr ${cg.llvm(t)}, ptr ${at}, i32 0, i32 ${i}`);
      cg.emit(`${q} = getelementptr ${ARRAY}, ptr ${p}, i32 0, i32 ${j}`);
      cg.emit(`${v} = load ${of}, ptr ${q}`);
      return v;
    };
    const [futures, flags, n] = [field(this, 1, 0, "ptr"), field(this, 3, 0, "ptr"), field(this, 3, 1, "i64")];
    const index = this.alloca("i64");
    this.emit(`store i64 0, ptr ${index}`);
    const [head, loop, yes, next, done] = [this.label(), this.label(), this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const [i, more] = [this.temp(), this.temp()];
    this.emit(`${i} = load i64, ptr ${index}`);
    this.emit(`${more} = icmp slt i64 ${i}, ${n}`);
    this.emit(`br i1 ${more}, label %${loop}, label %${done}`);
    this.startBlock(loop);
    const [flagAt, f, waiting] = [this.temp(), this.temp(), this.temp()];
    this.emit(`${flagAt} = getelementptr i8, ptr ${flags}, i64 ${i}`);
    this.emit(`${f} = load i8, ptr ${flagAt}`);
    this.emit(`${waiting} = icmp eq i8 ${f}, 1`);
    this.emit(`br i1 ${waiting}, label %${yes}, label %${next}`);
    this.startBlock(yes);
    const slot = this.temp();
    this.emit(`${slot} = getelementptr ${DYN}, ptr ${futures}, i64 ${i}`);
    this.cancelAt(slot, this.tables.typing.rec(array).element);
    this.emit(`br label %${next}`);
    this.startBlock(next);
    const step = this.temp();
    this.emit(`${step} = add i64 ${i}, 1`);
    this.emit(`store i64 ${step}, ptr ${index}`);
    this.emit(`br label %${head}`);
    this.startBlock(done);
  }


  cancelSymbol(this: Mut<this>, i: InstanceId): string {
    return this.symbol(i).replace(/^@"fsh\./, '@"fsh.cancel.');
  }


  // An async instance's cancel: the future it awaits in the state it is paused in is cancelled.
  cancelFunction(this: Mut<this>, i: InstanceId) {
    const saved = this.setAside();
    const awaits = this.awaitsOf.get(i) ?? [];
    const [state, done] = [this.temp(), this.label()];
    const cases = awaits.map(() => this.label());
    this.emit(`${state} = load i32, ptr %frame`);
    this.emit(`switch i32 ${state}, label %${done} [ ${awaits.map((a, n) => `i32 ${a.state}, label %${cases[n]!}`).join(" ")} ]`);
    let nAt: usize = 0;
    for (const a of awaits) {
      const n = nAt;
      nAt++;
      this.startBlock(cases[n]!);
      const p = this.temp();
      const part = this.inst(i).future ?? this.inst(i).generator!;
      const line2 = `${p} = getelementptr ${this.llvm(part)}, ptr %frame, i32 0, i32 ${a.field}`;
      this.emit(line2);
      this.cancelAt(p, a.type);
      this.emit(`br label %${done}`);
    }
    this.startBlock(done);
    this.emit("ret void");
    const line = `define internal void ${this.cancelSymbol(i)}(ptr %frame, ptr %cx) ${this.unwinds} {`;
    this.out.push(line);
    this.out.push("entry:");
    for (const pushed of this.allocas) this.out.push(pushed);
    for (const pushed of this.body) this.out.push(pushed);
    this.out.push("}");
    this.out.push("");
    this.takeUp(saved);
  }


  // One poll of the future in slot `at`: the blocks it goes on to, waiting, ready or failed,
  // and, called in those blocks, the value it gave and the error it threw. `e` places a panic.
  pollStep(this: Mut<this>, inner: FutureType | HandleType | DynType, at: string, e: Ref<Span>): { waiting: string; ready: string; failed: string; value: (cg: Mut<Codegen>) => string | undefined; error: (cg: Mut<Codegen>) => string } {
    const shape = this.tables.typing.rec(inner).kind === "dyn" ? this.tables.typing.handleType(this.tables.typing.promiseElement(this.tables.typing.rec(inner as DynType).of)!, undefined) : (inner as FutureType | HandleType);
    const [result, tag, waiting, ready, failed] = [this.temp(), this.temp(), this.label(), this.label(), this.label()];
    const leaf = this.tables.typing.rec(inner).kind === "future" ? this.tables.typing.leafOf.get(inner as FutureType) : undefined;
    let given: string | undefined;
    // What is read only once it is ready, as reading it before would read nothing.
    let readied: (() => string | undefined) | undefined;
    let reason: string | undefined;
    // A joined task's panic reason, when it panicked.
    let why: string | undefined;
    // The poll result as the runtime gives it: a joined task's is its own, throwing no TaskPanic.
    const handle = this.tables.typing.rec(inner).kind === "handle" ? this.tables.typing.rec(inner as HandleType) : undefined;
    const polledAs = handle?.joined !== undefined ? handle.joined.base : shape;
    if (leaf?.method === "next") {
      // An async generator's `next()`: its resume, run where the generator lives.
      const [slot, generator] = [this.temp(), this.temp()];
      this.emit(`${slot} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 1`);
      this.emit(`${generator} = load ptr, ptr ${slot}`);
      const target = this.generatorOf.get(leaf.of as GeneratorType)!;
      const line = `call ${this.pollType(shape)} ${this.symbol(target)}(ptr ${generator}, ptr %cx)`;
      this.unwinding(line, result);
      this.emit(`${tag} = extractvalue ${this.pollType(shape)} ${result}, 0`);
      this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
    } else if (leaf !== undefined) {
      // A semaphore's, channel's or socket's wait, or a sleep given a signal, polled by the
      // runtime, which wakes the task when it may go on. A send moves its value in, leaving its
      // slot empty.
      const [slot, handle, outcome] = [this.temp(), this.temp(), this.temp()];
      // The timer task's wait holds nothing but its state.
      if (leaf.method !== "timerNext") this.emit(`${slot} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 1`);
      if (leaf.method !== "sleep" && leaf.method !== "timerNext") this.emit(`${handle} = load ptr, ptr ${slot}`);
      // A socket's poll gives its result through `made`, and on failure the system's reason
      // through `reason`, for the IoError its awaiter is thrown; an abort leaves it null.
      const socket = ["bind", "connect", "accept", "read", "write", "sendTo", "receiveFrom", "udpConnect"].includes(leaf.method);
      const file = leaf.method === "readFile" || leaf.method === "writeFile";
      if (socket || file) {
        reason = this.alloca("[4 x ptr]");
        this.emit(`store [4 x ptr] zeroinitializer, ptr ${reason}`);
      }
      // One given a signal joins its waiters first, and stops if it has aborted, leaving the
      // waiters it joined; once done any other way, it leaves the signal's.
      let signal: [string, string] | undefined;
      if (leaf.signal) {
        const n = this.tables.typing.rec(inner as FutureType).frame.length;
        const [at1, sig, flag, aborted, yes, cancel, go] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.label(), this.label()];
        this.emit(`${at1} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 ${n - 2}`);
        this.emit(`${sig} = load ptr, ptr ${at1}`);
        this.emit(`${flag} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 ${n - 1}`);
        this.emit(`${aborted} = call i32 @fsh_rt_signal_enter(ptr ${sig}, ptr ${flag}, ptr %cx)`);
        this.emit(`${yes} = icmp ne i32 ${aborted}, 0`);
        this.emit(`br i1 ${yes}, label %${cancel}, label %${go}`);
        this.startBlock(cancel);
        if (leaf.method === "acquire") this.emit(`call void @fsh_rt_semaphore_leave(ptr ${handle}, ptr %cx, ptr ${at})`);
        if (leaf.method === "send" || leaf.method === "receive") this.emit(`call void @fsh_rt_channel_leave(ptr ${handle}, ptr %cx, ptr ${at})`);
        if (leaf.method === "sleep") this.emit(`call void @fsh_rt_sleep_cancel(ptr %cx, ptr ${at})`);
        if (socket) this.emit(`call void @fsh_rt_socket_leave(ptr ${handle}, ptr %cx)`);
        this.emit(`call void @fsh_rt_signal_leave(ptr ${sig}, ptr ${flag}, ptr %cx)`);
        this.emit(`br label %${failed}`);
        this.startBlock(go);
        signal = [sig, flag];
      }
      if (socket) {
        const [made, field] = [this.alloca(leaf.method === "read" || leaf.method === "receiveFrom" ? ARRAY : "ptr"), (i: usize) => {
          const [ptr, v] = [this.temp(), this.temp()];
          this.emit(`${ptr} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 ${i}`);
          return [ptr, v] as const;
        }];
        if (leaf.method === "accept") this.emit(`${outcome} = call i32 @fsh_rt_tcp_accept(ptr ${handle}, ptr %cx, ptr ${made}, ptr ${reason})`);
        else if (leaf.method === "sendTo" || leaf.method === "udpConnect") {
          const first = leaf.method === "sendTo" ? 3 : 2;
          const [hostAt, host] = field(first);
          const [portAt, port] = field(first + 1);
          this.emit(`${host} = load ptr, ptr ${hostAt}`);
          this.emit(`${port} = load i64, ptr ${portAt}`);
          if (leaf.method === "udpConnect") this.emit(`${outcome} = call i32 @fsh_rt_udp_connect(ptr ${handle}, ptr ${host}, i64 ${port}, ptr ${reason})`);
          else this.emit(`${outcome} = call i32 @fsh_rt_udp_send(ptr ${handle}, ptr ${field(2)[0]}, ptr ${host}, i64 ${port}, ptr %cx, ptr ${reason})`);
        } else if (leaf.method === "receiveFrom") {
          // `receive()` gives the bytes alone; `receiveFrom()` the sender's address with them.
          const from = leaf.of === "void";
          const [hostAt, portAt] = [this.alloca("ptr"), this.alloca("i64")];
          this.emit(`${outcome} = call i32 @fsh_rt_udp_receive(ptr ${handle}, ptr %cx, ptr ${made}, ptr ${from ? hostAt : "null"}, ptr ${portAt}, ptr ${reason})`);
          const bytes = this.temp();
          this.emit(`${bytes} = load ${ARRAY}, ptr ${made}`);
          given = bytes;
          if (from) {
            const [host, port, withBytes, withHost, withPort] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
            this.emit(`${host} = load ptr, ptr ${hostAt}`);
            this.emit(`${port} = load i64, ptr ${portAt}`);
            this.emit(`${withBytes} = insertvalue ${this.llvm(this.tables.typing.rec(shape).gives)} undef, ${ARRAY} ${bytes}, 0`);
            this.emit(`${withHost} = insertvalue ${this.llvm(this.tables.typing.rec(shape).gives)} ${withBytes}, ptr ${host}, 1`);
            this.emit(`${withPort} = insertvalue ${this.llvm(this.tables.typing.rec(shape).gives)} ${withHost}, i64 ${port}, 2`);
            given = withPort;
          }
        } else if (leaf.method === "read") {
          const [maxAt, max] = field(2);
          this.emit(`${max} = load i64, ptr ${maxAt}`);
          this.emit(`${outcome} = call i32 @fsh_rt_tcp_read(ptr ${handle}, i64 ${max}, ptr %cx, ptr ${made}, ptr ${reason})`);
        } else if (leaf.method === "write") {
          const [bytesAt] = field(2);
          const [writtenAt] = field(3);
          this.emit(`${outcome} = call i32 @fsh_rt_tcp_write(ptr ${handle}, ptr ${bytesAt}, ptr ${writtenAt}, ptr %cx, ptr ${reason})`);
        } else {
          const first = leaf.method === "bind" ? 1 : 2;
          const [hostAt, host] = field(first);
          const [portAt, port] = field(first + 1);
          this.emit(`${host} = load ptr, ptr ${hostAt}`);
          this.emit(`${port} = load i64, ptr ${portAt}`);
          if (leaf.method === "bind" && leaf.of !== "void" && !onPath(this.tables.typing, leaf.of)) this.emit(`${outcome} = call i32 @fsh_rt_udp_bind(ptr ${host}, i64 ${port}, ptr ${made}, ptr ${reason})`);
          else if (leaf.method === "bind" && onPath(this.tables.typing, leaf.of)) this.emit(`${outcome} = call i32 @fsh_rt_unix_bind(ptr ${host}, ptr ${made}, ptr ${reason})`);
          else if (leaf.method === "bind") this.emit(`${outcome} = call i32 @fsh_rt_tcp_bind(ptr ${host}, i64 ${port}, ptr ${made}, ptr ${reason})`);
          else if (leaf.of !== "void") this.emit(`${outcome} = call i32 @fsh_rt_unix_connect(ptr ${slot}, ptr ${host}, ptr %cx, ptr ${made}, ptr ${reason})`);
          else this.emit(`${outcome} = call i32 @fsh_rt_tcp_connect(ptr ${slot}, ptr ${host}, i64 ${port}, ptr %cx, ptr ${made}, ptr ${reason})`);
        }
        if (!["write", "sendTo", "udpConnect", "receiveFrom"].includes(leaf.method)) {
          given = this.temp();
          this.emit(`${given} = load ${leaf.method === "read" ? ARRAY : "ptr"}, ptr ${made}`);
        }
      } else if (file) {
        // A file's job runs on the runtime's blocking pool, its frame the path, a write's bytes,
        // and the job once handed over.
        const reading = leaf.method === "readFile";
        const [made, jobAt] = [this.alloca(ARRAY), this.temp()];
        this.emit(`store ${ARRAY} zeroinitializer, ptr ${made}`);
        this.emit(`${jobAt} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 ${reading ? 2 : 3}`);
        let bytesAt = "null";
        if (!reading) {
          bytesAt = this.temp();
          this.emit(`${bytesAt} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        }
        this.emit(`${outcome} = call i32 @fsh_rt_file_poll(ptr ${handle}, ptr ${bytesAt}, ptr ${jobAt}, i32 ${reading ? 0 : 1}, ptr %cx, ptr ${made}, ptr ${reason})`);
        if (reading) {
          given = this.temp();
          this.emit(`${given} = load ${ARRAY}, ptr ${made}`);
        }
      } else if (leaf.method === "timerNext") {
        // The next timer's callable, or none once the program is done with timers.
        // Ended with nothing, it is ready all the same.
        const [made, raw, dyn, option, got, nothing] = [this.alloca("[2 x ptr]"), this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
        this.emit(`${raw} = call i32 @fsh_rt_timeout_next(ptr %cx, ptr ${made})`);
        this.emit(`${dyn} = load ${DYN}, ptr ${made}`);
        this.emit(`${got} = icmp eq i32 ${raw}, 1`);
        this.emit(`${nothing} = icmp eq i32 ${raw}, 2`);
        const line2 = `${option} = select i1 ${got}, ${this.llvm(this.tables.typing.rec(shape).gives)} ${this.convert(dyn, leaf.of, this.tables.typing.rec(shape).gives)}, ${this.llvm(this.tables.typing.rec(shape).gives)} ${this.convert("zeroinitializer", "null", this.tables.typing.rec(shape).gives)}`;
        this.emit(line2);
        given = option;
        this.emit(`${outcome} = select i1 ${nothing}, i32 1, i32 ${raw}`);
      } else if (leaf.method === "jsAwait") {
        // A JS promise: what it settled with, read as its declaration says once it fulfilled,
        // or what it rejected with, for the JsError its awaiter is thrown.
        const [waitingAt, made] = [this.temp(), this.alloca("ptr")];
        this.emit(`${waitingAt} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        this.emit(`${outcome} = call i32 @fsh_rt_js_await(ptr ${handle}, ptr ${waitingAt}, ptr %cx, ptr ${made})`);
        reason = made;
        readied = () => {
          const box = this.temp();
          this.emit(`${box} = load ptr, ptr ${made}`);
          if (leaf.of !== "void") return this.fromJs(box, leaf.of, "the awaited promise fulfilled with", e);
          this.emit(`call void @fsh_rt_js_release(ptr ${box})`);
          return undefined;
        };
      } else if (leaf.method === "sleep") {
        this.emit(`${outcome} = call i32 @fsh_rt_sleep(ptr ${at}, ptr %cx)`);
      } else if (leaf.method === "acquire") {
        const [permit, made] = [this.alloca("ptr"), this.temp()];
        this.emit(`${outcome} = call i32 @fsh_rt_semaphore_acquire(ptr ${handle}, ptr %cx, ptr ${permit}, ptr ${at})`);
        this.emit(`${made} = load ptr, ptr ${permit}`);
        given = made;
      } else if (leaf.method === "send") {
        const [moving, closed] = [this.temp(), this.temp()];
        this.emit(`${moving} = getelementptr ${this.llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        this.emit(`${outcome} = call i32 @fsh_rt_channel_send(ptr ${handle}, ptr ${moving}, ptr %cx, ptr ${at})`);
        this.emit(`${closed} = icmp eq i32 ${outcome}, 3`);
        this.lowering().panicIf(closed, "send on a closed channel", e);
      } else {
        const buffer = this.alloca(this.llvm(leaf.of));
        this.emit(`${outcome} = call i32 @fsh_rt_channel_receive(ptr ${handle}, ptr ${buffer}, ptr %cx, ptr ${at})`);
        // What it gives is an Option: the value, or empty once the channel is closed and drained.
        const [got, read, option] = [this.temp(), this.temp(), this.temp()];
        this.emit(`${got} = icmp eq i32 ${outcome}, 1`);
        this.emit(`${read} = load ${this.llvm(leaf.of)}, ptr ${buffer}`);
        const line3 = `${option} = select i1 ${got}, ${this.llvm(this.tables.typing.rec(shape).gives)} ${this.convert(read, leaf.of, this.tables.typing.rec(shape).gives)}, ${this.llvm(this.tables.typing.rec(shape).gives)} ${this.convert("zeroinitializer", "null", this.tables.typing.rec(shape).gives)}`;
        this.emit(line3);
        given = option;
      }
      this.emit(`${tag} = trunc i32 ${outcome} to i8`);
      if (signal === undefined) this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${ready} i8 5, label %${failed} ]`);
      else {
        const [over, broke] = [this.label(), this.label()];
        this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${over} i8 2, label %${over} i8 5, label %${broke} ]`);
        this.startBlock(over);
        this.emit(`call void @fsh_rt_signal_leave(ptr ${signal[0]}, ptr ${signal[1]}, ptr %cx)`);
        this.emit(`br label %${ready}`);
        this.startBlock(broke);
        this.emit(`call void @fsh_rt_signal_leave(ptr ${signal[0]}, ptr ${signal[1]}, ptr %cx)`);
        this.emit(`br label %${failed}`);
      }
    } else if (inner === YIELD_NOW) {
      // Pending the first time it is polled, done the next.
      const [state, fresh] = [this.temp(), this.temp()];
      this.emit(`${state} = load i32, ptr ${at}`);
      this.emit(`store i32 1, ptr ${at}`);
      this.emit(`${fresh} = icmp eq i32 ${state}, 0`);
      this.emit(`br i1 ${fresh}, label %${waiting}, label %${ready}`);
    } else if (inner === SLEEP) {
      const done = this.temp();
      this.emit(`${done} = call i32 @fsh_rt_sleep(ptr ${at}, ptr %cx)`);
      this.emit(`${tag} = trunc i32 ${done} to i8`);
      this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} ]`);
    } else if (this.tables.typing.rec(inner).kind === "handle") {
      // A spawned task: the runtime copies its result out once it is done.
      // Awaited plainly, a task that panicked panics its awaiter; joined, it fails with its reason.
      const base = handle!.joined?.base ?? (inner as HandleType);
      const [buffer, task, outcome] = [this.alloca(this.pollType(base)), this.temp(), this.temp()];
      this.emit(`${task} = load ptr, ptr ${at}`);
      if (handle!.joined !== undefined) {
        why = this.alloca("ptr");
        this.emit(`${outcome} = call i32 @fsh_rt_join(ptr ${task}, ptr %cx, ptr ${buffer}, ptr null, ptr ${why})`);
      } else {
        const line4 = `call i32 @fsh_rt_join(ptr ${task}, ptr %cx, ptr ${buffer}, ptr ${this.panicAt(e)}, ptr null)`;
        this.unwinding(line4, outcome);
      }
      this.emit(`${result} = load ${this.pollType(base)}, ptr ${buffer}`);
      this.emit(`${tag} = trunc i32 ${outcome} to i8`);
      this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} i8 3, label %${failed} ]`);
    } else if (this.tables.typing.rec(inner).kind === "dyn") {
      // Through its vtable: the slot after drop, copy and clone is the future's own poll.
      const [dyn, data, table, slot, fn] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp()];
      this.emit(`${dyn} = load ${DYN}, ptr ${at}`);
      this.emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      this.emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      this.emit(`${slot} = getelementptr ptr, ptr ${table}, i64 3`);
      this.emit(`${fn} = load ptr, ptr ${slot}`);
      this.unwinding(`call ${this.pollType(shape)} ${fn}(ptr ${data}, ptr %cx)`, result);
      this.emit(`${tag} = extractvalue ${this.pollType(shape)} ${result}, 0`);
      this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} ]`);
    } else {
      const fn = this.tables.typing.combinedOf.has(inner as FutureType) ? this.combinePoll(inner as FutureType) : this.symbol(this.futureOf.get(inner as FutureType)!);
      this.unwinding(`call ${this.pollType(shape)} ${fn}(ptr ${at}, ptr %cx)`, result);
      this.emit(`${tag} = extractvalue ${this.pollType(shape)} ${result}, 0`);
      this.emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
    }
    const error = (cg: Mut<Codegen>) => {
      const thrown = cg.tables.typing.rec(shape).throws!;
      let error = "";
      if (leaf?.method === "jsAwait") {
        error = cg.jsError(reason!, thrown as ClassType);
      } else if (leaf !== undefined && (reason !== undefined && reason !== "") && !leaf.signal) {
        error = cg.ioError(reason, thrown as ClassType);
      } else if (leaf !== undefined && (reason !== undefined && reason !== "")) {
        // Given a signal, it throws either: an AbortError when it was aborted, leaving no reason.
        const members = cg.tables.typing.rec(thrown as UnionType).members as ClassType[];
        const [io, aborted] = [members.find((m) => cg.tables.typing.rec(m).name === "IoError")!, members.find((m) => cg.tables.typing.rec(m).name === "AbortError")!];
        const [text, none, ioAt, abortAt, join, made] = [cg.temp(), cg.temp(), cg.label(), cg.label(), cg.label(), cg.temp()];
        cg.emit(`${text} = load ptr, ptr ${reason}`);
        cg.emit(`${none} = icmp eq ptr ${text}, null`);
        cg.emit(`br i1 ${none}, label %${abortAt}, label %${ioAt}`);
        cg.startBlock(ioAt);
        const ioError2 = cg.ioError(reason, io);
        const asIo = cg.convert(ioError2, io, thrown);
        const fromIo = cg.block;
        cg.emit(`br label %${join}`);
        cg.startBlock(abortAt);
        const abortError2 = cg.abortError(aborted);
        const asAbort = cg.convert(abortError2, aborted, thrown);
        const fromAbort = cg.block;
        cg.emit(`br label %${join}`);
        cg.startBlock(join);
        cg.emit(`${made} = phi ${cg.llvm(thrown)} [ ${asIo}, %${fromIo} ], [ ${asAbort}, %${fromAbort} ]`);
        error = made;
      } else if (leaf !== undefined && leaf.method !== "next") error = cg.abortError(thrown);
      else if ((why !== undefined && why !== "")) error = cg.joinError(why, tag, result, cg.tables.typing.rec(inner as HandleType).joined!, thrown);
      else {
        error = cg.temp();
        cg.emit(`${error} = extractvalue ${cg.pollType(shape)} ${result}, 2`);
      }
      return error;
    };
    const value = (cg: Mut<Codegen>) => {
      let v: string | undefined = readied !== undefined ? readied() : given;
      if (cg.tables.typing.rec(shape).gives !== "void" && (leaf === undefined || leaf.method === "next")) {
        v = cg.temp();
        cg.emit(`${v} = extractvalue ${cg.pollType(polledAs)} ${result}, 1`);
      }
      return v;
    };
    return { waiting, ready, failed, value, error };
  }


  // What a joined task's await throws: a TaskPanic holding the reason it panicked with, when its
  // outcome `tag` is 3, or else the error it threw itself.
  joinError(this: Mut<this>, why: string, tag: string, result: string, joined: Ref<{ base: HandleType; panic: Type }>, thrown: Type): string {
    const [base, panicked] = [joined.base, joined.panic as ClassType];
    const make = (cg: Mut<Codegen>) => {
      const [reason, made] = [cg.temp(), cg.temp()];
      cg.emit(`${reason} = load ptr, ptr ${why}`);
      cg.emit(`${made} = insertvalue ${cg.llvm(panicked)} zeroinitializer, ptr ${reason}, ${cg.tables.typing.rec(panicked).fields.findIndex((f) => f.name === "message")}`);
      return cg.convert(made, panicked, thrown);
    };
    if (this.tables.typing.rec(base).throws === undefined) return make(this);
    const [isPanic, onPanic, onThrow, join, made] = [this.temp(), this.label(), this.label(), this.label(), this.temp()];
    this.emit(`${isPanic} = icmp eq i8 ${tag}, 3`);
    this.emit(`br i1 ${isPanic}, label %${onPanic}, label %${onThrow}`);
    this.startBlock(onPanic);
    const asPanic = make(this);
    const fromPanic = this.block;
    this.emit(`br label %${join}`);
    this.startBlock(onThrow);
    const own = this.temp();
    this.emit(`${own} = extractvalue ${this.pollType(base)} ${result}, 2`);
    const asOwn = this.convert(own, this.tables.typing.rec(base).throws!, thrown);
    const fromOwn = this.block;
    this.emit(`br label %${join}`);
    this.startBlock(join);
    this.emit(`${made} = phi ${this.llvm(thrown)} [ ${asPanic}, %${fromPanic} ], [ ${asOwn}, %${fromOwn} ]`);
    return made;
  }


  // The C entry point. An error escaping Fish's `main` is printed to stderr, exiting with 1.
  // A C function under an export's name, calling it. A panic can't unwind into C, so one that
  // reaches here aborts, its message already printed.
  exported(this: Mut<this>, i: InstanceId): string[] {
    const params = this.bodyAt(i).params.map((p, n) => {
      const get2 = this.inst(i).locals.get(p)!;
      return [this.loc(get2).type, `%a${n}`] as const;
    });
    // A library's panics all unwind, the runtime's default, whichever way the build chose: the
    // abort happens here, before C sees the unwind.
    const part = this.inst(i).returns;
    const call = `${this.inst(i).returns === "void" ? "" : "%r = "}invoke ${this.llvm(part)} ${this.symbol(i)}(${params.map(([t, a]) => `${this.llvm(t)} ${a}`).join(", ")})`;
    const head = `define ${crossed(this.tables.typing, this.inst(i).returns)} @"${this.bodyAt(i).name}"(${params.map(([t, a]) => `${crossing(this.tables.typing, t)} ${a}`).join(", ")}) ${UNWINDS} {`;
    let done: string;
    if (this.inst(i).returns === "void") {
      done = "  ret void";
    } else {
      const part2 = this.inst(i).returns;
      done = `  ret ${this.llvm(part2)} %r`;
    }
    return [head, "entry:", `  ${call} to label %ok unwind label %pad`, "ok:", done, "pad:", "  %caught = landingpad { ptr, i32 } cleanup", "  call void @abort()", "  unreachable", "}", ""];
  }


  entry(this: Mut<this>): string[] {
    if (this.inst(this.main).future !== undefined) {
      const part = this.inst(this.main).future!;
      return this.driver(part);
    }
    // The runtime keeps the program's arguments for `process.argv`.
    if (this.inst(this.main).throws === undefined) return [`define i32 @main(i32 %argc, ptr %argv) ${this.unwinds} {`, "  call void @fsh_rt_args(i32 %argc, ptr %argv)", '  call void @"fsh.main"()', "  ret i32 0", "}"];
    this.current = this.main;
    [this.allocas, this.body, this.temps, this.labels, this.block] = [[], [], 0, 0, "entry"];
    const type = this.resultType(this.main);
    const [result, failed, bad, ok, error] = [this.temp(), this.temp(), this.label(), this.label(), this.temp()];
    this.emit("call void @fsh_rt_args(i32 %argc, ptr %argv)");
    this.emit(`${result} = call ${type} @"fsh.main"()`);
    this.emit(`${failed} = extractvalue ${type} ${result}, 0`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(ok);
    this.emit("ret i32 0");
    this.startBlock(bad);
    this.emit(`${error} = extractvalue ${type} ${result}, 2`);
    // Output printed before the error stays ahead of it, as a panic's does.
    this.emit("call i32 @fflush(ptr null)");
    this.printer(2).write(["Error:", [error, this.inst(this.main).throws!]]);
    const part2 = this.inst(this.main).throws!;
    this.dispose(error, part2);
    this.emit("ret i32 1");
    return [`define i32 @main(i32 %argc, ptr %argv) ${this.unwinds} {`, "entry:", ...this.allocas, ...this.body, "}"];
  }


  // An async `main`, run by the runtime as its first task; an error it gives is reported as a
  // throwing `main`'s is.
  driver(this: Mut<this>, future: FutureType): string[] {
    const [poll, drop, dropOutput] = this.taskGlue(future);
    this.current = this.main;
    [this.allocas, this.body, this.temps, this.labels, this.block] = [[], [], 0, 0, "entry"];
    const type = this.pollType(future);
    const [frame, out, outcome, result, failed, ok, bad] = [this.temp(), this.temp(), this.temp(), this.temp(), this.temp(), this.label(), this.label()];
    this.allocas.push(`  ${frame} = alloca ${this.llvm(future)}`);
    this.allocas.push(`  store ${this.llvm(future)} zeroinitializer, ptr ${frame}`);
    this.allocas.push(`  ${out} = alloca ${type}`);
    this.emit("call void @fsh_rt_args(i32 %argc, ptr %argv)");
    this.emit(`${outcome} = call i32 @fsh_rt_run(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${this.sizeOf(this.llvm(future))}, i64 ${this.sizeOf(type)}, ptr ${out})`);
    this.emit(`${failed} = icmp eq i32 ${outcome}, 2`);
    this.emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    this.startBlock(ok);
    this.emit("ret i32 0");
    this.startBlock(bad);
    this.emit(`${result} = load ${type}, ptr ${out}`);
    if (this.tables.typing.rec(future).throws !== undefined) {
      const error = this.temp();
      this.emit(`${error} = extractvalue ${type} ${result}, 2`);
      this.emit("call i32 @fflush(ptr null)");
      this.printer(2).write(["Error:", [error, this.tables.typing.rec(future).throws!]]);
      this.dispose(error, this.tables.typing.rec(future).throws!);
      this.emit("ret i32 1");
    } else this.emit("unreachable");
    return [`define i32 @main(i32 %argc, ptr %argv) ${this.unwinds} {`, "entry:", ...this.allocas, ...this.body, "}"];
  }


  // A JsError from the box of what JS threw at `thrown`: named, its message read from the value,
  // which it keeps.
  jsError(this: Mut<this>, thrown: string, error: ClassType): string {
    const [box, message] = [this.temp(), this.temp()];
    this.emit(`${box} = load ptr, ptr ${thrown}`);
    this.emit(`${message} = call ptr @fsh_rt_js_message(ptr ${box})`);
    let made = "zeroinitializer";
    const put = (cg: Mut<Codegen>, name: string, v: string) => {
      const next = cg.temp();
      cg.emit(`${next} = insertvalue ${cg.llvm(error)} ${made}, ${cg.llvm(cg.tables.typing.field(error, name)!.type)} ${v}, ${cg.tables.typing.fieldPath(error, name).join(", ")}`);
      made = next;
    };
    const text2 = this.text("JsError");
    put(this, "name", text2);
    put(this, "message", message);
    const convert2 = this.convert("zeroinitializer", "null", this.tables.typing.field(error, "cause")!.type);
    put(this, "cause", convert2);
    put(this, "value", box);
    return made;
  }


  // An IoError from the parts the runtime gave at `parts`: its message, code, system call and
  // path, the path empty where the runtime gave none.
  ioError(this: Mut<this>, parts: string, io: ClassType): string {
    const part = (cg: Mut<Codegen>, i: usize) => {
      const [at, v] = [cg.temp(), cg.temp()];
      cg.emit(`${at} = getelementptr [4 x ptr], ptr ${parts}, i32 0, i32 ${i}`);
      cg.emit(`${v} = load ptr, ptr ${at}`);
      return v;
    };
    const [message, code, syscall, path] = [part(this, 0), part(this, 1), part(this, 2), part(this, 3)];
    // A part the runtime left out is an empty string, or for the path, no path.
    const orEmpty = (cg: Mut<Codegen>, v: string) => {
      const [none, given] = [cg.temp(), cg.temp()];
      cg.emit(`${none} = icmp eq ptr ${v}, null`);
      const line = `${given} = select i1 ${none}, ptr ${cg.text("")}, ptr ${v}`;
      cg.emit(line);
      return given;
    };
    const option = this.tables.typing.rec(io).fields.find((f) => f.name === "path")!.type;
    const [none, held] = [this.temp(), this.temp()];
    this.emit(`${none} = icmp eq ptr ${path}, null`);
    const line2 = `${held} = select i1 ${none}, ${this.llvm(option)} ${this.convert("zeroinitializer", "null", option)}, ${this.llvm(option)} ${this.convert(path, "string", option)}`;
    this.emit(line2);
    let made = "zeroinitializer";
    const names: string[] = ["message", "code", "syscall", "path"];
    const vs: string[] = [orEmpty(this, message), orEmpty(this, code), orEmpty(this, syscall), held];
    for (let k: usize = 0; k < names.length; k++) {
      const name = names[k]!;
      const v = vs[k]!;
      const index = this.tables.typing.rec(io).fields.findIndex((f) => f.name === name);
      const next = this.temp();
      this.emit(`${next} = insertvalue ${this.llvm(io)} ${made}, ${this.llvm(this.tables.typing.rec(io).fields[index as usize]!.type)} ${v}, ${index}`);
      made = next;
    }
    return made;
  }


  // The size of an LLVM type in bytes, as a constant.
  sizeOf(type: string): string {
    return `ptrtoint (ptr getelementptr (${type}, ptr null, i32 1) to i64)`;
  }


  // What the runtime needs to run a future as a task, made once per future type: a poll that
  // writes the result into the task's output and says pending (0), ready (1), failed (2) or
  // panicked (3); a drop of the frame where it stopped; and a drop of the output it gave.
  taskGlue(this: Mut<this>, future: FutureType): [string, string, string] {
    const name = (cg: Mut<Codegen>, kind: string) => cg.symbol(cg.futureOf.get(future)!).replace(/^@"fsh\./, `@"task.${kind}.`);
    if (!this.glued.has(future)) {
      this.glued.add(future);
      const [frame, type] = [this.llvm(future), this.pollType(future)];
      const output = `getelementptr i8, ptr %frame, i64 ${this.sizeOf(frame)}`;
      const caught = this.panic === "abort" ? [] : ["pad:", "  %caught = landingpad { ptr, i32 } cleanup", "  ret i32 3"];
      const call = this.panic === "abort" ? `  %r = call ${type} ${this.symbol(this.futureOf.get(future)!)}(ptr %frame, ptr %task)` : `  %r = invoke ${type} ${this.symbol(this.futureOf.get(future)!)}(ptr %frame, ptr %task) to label %polled unwind label %pad`;
      const [dropFrame, dropOutput] = [this.helperBody((cg, v) => cg.dispose(v, future)), this.outputDrop(future)];
      const line = `define internal i32 ${name(this, "poll")}(ptr %task, ptr %frame) ${UNWINDS} {`;
      const line2 = `define internal void ${name(this, "drop")}(ptr %frame) ${this.unwinds} {`;
      const line3 = `define internal void ${name(this, "output")}(ptr %out) ${this.unwinds} {`;
      this.out.push(line);
      this.out.push("entry:");
      this.out.push(call);
      const more = (this.panic === "abort" ? [] : ["polled:"]);
      for (const pushed of more) this.out.push(pushed);
      this.out.push("  %tag = extractvalue " + type + " %r, 0");
      this.out.push("  %done = icmp ne i8 %tag, 0");
      this.out.push("  br i1 %done, label %finished, label %waiting");
      this.out.push("waiting:");
      this.out.push("  ret i32 0");
      this.out.push("finished:");
      this.out.push(`  %out = ${output}`);
      this.out.push(`  store ${type} %r, ptr %out`);
      this.out.push("  %outcome = zext i8 %tag to i32");
      this.out.push("  ret i32 %outcome");
      for (const pushed of caught) this.out.push(pushed);
      this.out.push("}");
      this.out.push("");
      this.out.push(line2);
      this.out.push("entry:");
      this.out.push(`  %v = load ${frame}, ptr %frame`);
      for (const pushed of dropFrame) this.out.push(pushed);
      this.out.push("  ret void");
      this.out.push("}");
      this.out.push("");
      this.out.push(line3);
      this.out.push("entry:");
      this.out.push(`  %v = load ${type}, ptr %out`);
      for (const pushed of dropOutput) this.out.push(pushed);
      this.out.push("  ret void");
      this.out.push("}");
      this.out.push("");
    }
    return [name(this, "poll"), name(this, "drop"), name(this, "output")];
  }


  // The instructions dropping `%v` of `type`, as a helper's body.
  helperBody(drop: (cg: Mut<Codegen>, v: string) => void): string[] {
    const saved = this.setAsideBody();
    drop(this, "%v");
    const lines = [...this.allocas, ...this.body];
    this.takeUpBody(saved);
    return lines;
  }


  // Drops the value or the error in a finished future's poll result.
  outputDrop(this: Mut<this>, future: FutureType): string[] {
    return this.helperBody((cg, v) => {
      const type = cg.pollType(future);
      const [tag, ready, failed, end] = [cg.temp(), cg.label(), cg.label(), cg.label()];
      cg.emit(`${tag} = extractvalue ${type} ${v}, 0`);
      cg.emit(`switch i8 ${tag}, label %${end} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
      cg.startBlock(ready);
      if (cg.needsDrop(cg.tables.typing.rec(future).gives)) {
        const value = cg.temp();
        cg.emit(`${value} = extractvalue ${type} ${v}, 1`);
        cg.dispose(value, cg.tables.typing.rec(future).gives);
      }
      cg.emit(`br label %${end}`);
      cg.startBlock(failed);
      if (cg.tables.typing.rec(future).throws !== undefined && cg.needsDrop(cg.tables.typing.rec(future).throws)) {
        const error = cg.temp();
        cg.emit(`${error} = extractvalue ${type} ${v}, 2`);
        cg.dispose(error, cg.tables.typing.rec(future).throws!);
      }
      cg.emit(`br label %${end}`);
      cg.startBlock(end);
    });
  }


  // A pointer to the base embedded in an instance of `from`, through as many bases as it
  // takes to reach `to`.
  upcast(this: Mut<this>, ptr: string, from: ClassType, to: ClassType): string {
    for (let t = from; t !== to; t = this.tables.typing.rec(t).base!) {
      const next = this.temp();
      this.emit(`${next} = getelementptr ${this.llvm(t)}, ptr ${ptr}, i32 0, i32 0`);
      ptr = next;
    }
    return ptr;
  }


  // Where a method's receiver lives. A temporary, such as a call's or a getter's result,
  // gets a slot. A method that `owns` its object drops it: one in place is left empty, and one
  // in a slot is a copy of its own.
  receiver(this: Mut<this>, object: Ref<Expr>, owns = false): string {
    if (object.kind === "super") {
      const get2 = this.cur().types.get(object) as ClassType;
      return this.upcast("%this", this.self!, get2);
    }
    // A reference already points where the receiver lives, or at the block it lives in.
    const get4 = this.cur().types.get(object)!;
    if (this.isRef(get4)) {
      const evaluate2 = this.evaluate(object);
      const part = this.tables.typing.rec(this.cur().types.get(object) as RefType).to;
      return this.blockOf(evaluate2, part);
    }
    // In an optional chain, what the Option holds: in place when it is one member of it.
    if (this.unwraps(object)) {
      const option = this.cur().types.get(object) as UnionType;
      const held = this.cur().coercions.get(object)!;
      if (this.lendable(object) && this.tables.typing.rec(option).members.includes(held)) {
        const at = this.temp();
        const line = `${at} = getelementptr ${this.llvm(option)}, ptr ${this.address(object)}, i32 0, i32 1`;
        this.emit(line);
        return at;
      }
      // A variable narrowed to fewer members still holds its value in its own union's payload.
      const local = object.kind === "ident" ? this.localAt(object) : undefined;
      const whole = local !== undefined ? this.loc(local).type : undefined;
      const union = this.recOf(whole);
      if (local !== undefined && union?.kind === "union" && union.members.includes(held)) {
        const at = this.temp();
        const part2 = this.loc(local).type;
        const line2 = `${at} = getelementptr ${this.llvm(part2)}, ptr ${this.slot(local)}, i32 0, i32 1`;
        this.emit(line2);
        return at;
      }
      const copy = this.alloca(this.llvm(held));
      const read = this.value(object);
      const v = owns ? this.spill(copy, held, read) : read;
      this.emit(`store ${this.llvm(held)} ${v}, ptr ${copy}`);
      return copy;
    }
    if (this.lendable(object)) {
      const address2 = this.address(object);
      const stored2 = this.stored(object);
      return this.blockOf(address2, stored2);
    }
    const get5 = this.cur().types.get(object)!;
    const type = this.llvm(get5);
    const spilled = this.alloca(type);
    // A Rust handle made for the call moves into it, the call taking it over.
    if (owns && this.holdsRust(this.cur().types.get(object)!)) {
      if (!this.fresh(object)) assert(false, "internal error: a Rust handle taken over by a method is read from a place nothing empties");
      const line3 = `store ${type} ${this.value(object, true)}, ptr ${spilled}`;
      this.emit(line3);
      return spilled;
    }
    const read = this.value(object);
    let v: string;
    if (owns) {
      const get3 = this.cur().types.get(object)!;
      v = this.spill(spilled, get3, read);
    } else {
      v = read;
    }
    this.emit(`store ${type} ${v}, ptr ${spilled}`);
    return spilled;
  }


  // A closure made for its call, as in `(() => f(xs))()`, moves into the slot the call runs on.
  // Its body may move a capture out of that slot, so what it leaves is dropped from the slot
  // once the call returns, not from the value as it was made.
  calledClosure(this: Mut<this>, callee: Ref<Expr>): string {
    const type = this.valueType(callee);
    const slot = this.alloca(this.llvm(type));
    const copy = this.value(callee, true);
    this.emit(`store ${this.llvm(type)} ${copy}, ptr ${slot}`);
    this.pending.push({ v: copy, type });
    this.spills.push({ slot, type, v: copy });
    return slot;
  }


  // An expression's value, copied down to the declared type it meets when that is narrower.
  // A value the expression made is released when the statement ends, unless `consume` takes it.
  value(this: Mut<this>, e: Ref<Expr>, consume = false): string {
    const to = this.cur().coercions.get(e);
    const type = this.cur().types.get(e)!;
    const [ref, given] = [this.recOf(to), this.recOf(type)];
    if (ref?.kind === "ref" && given?.kind !== "ref") return this.borrowed(e, ref.to);
    // A narrowed reference read at the type it was declared with is the pointer it holds.
    if (ref?.kind === "ref" && given?.kind === "ref" && e.kind === "ident" && !this.known.has(e)) {
      const local = this.localAt(e);
      if (local !== undefined && this.loc(local).type !== type && this.tables.typing.lower(this.loc(local).type) === this.tables.typing.lower(to!)) {
        const held = this.temp();
        const line = `${held} = load ptr, ptr ${this.slot(local)}`;
        this.emit(line);
        return held;
      }
    }
    const lent = this.tables.typing.optionRef(to);
    if (lent !== undefined && type !== "null" && this.tables.typing.optionRef(type) === undefined && given?.kind !== "ref") {
      const borrowed2 = this.borrowed(e, this.tables.typing.rec(lent).to);
      return this.convert(borrowed2, lent, to!);
    }
    const result = this.known.get(e) ?? this.evaluate(e);
    // Nothing runs after a value of `never`, so it stands for any value at all.
    if (type === "never") return "undef";
    // A value meeting a Dyn, or a recursive type, moves into its block; a temporary then drops
    // as what it became.
    if (to !== undefined && this.boxes(type, to)) {
      const boxed = this.convert(result, type, to);
      if (!consume && this.fresh(e) && !this.known.has(e)) this.pending.push({ v: boxed, type: to });
      return boxed;
    }
    const dyn = this.tables.boxedMembers.get(e) ?? (to !== undefined && this.isDyn(to) ? to : undefined);
    if (to !== undefined && dyn !== undefined && !this.isDyn(type)) {
      let boxed: string;
      if (to === dyn) {
        boxed = this.box(result, type, dyn);
      } else {
        const box2 = this.box(result, type, dyn);
        boxed = this.convert(box2, dyn, to);
      }
      if (!consume && this.fresh(e) && !this.known.has(e)) this.pending.push({ v: boxed, type: to });
      return boxed;
    }
    // A temporary taken out of a recursive type's block leaves the block to be freed.
    if (consume && to !== undefined && !this.isRef(to) && this.unboxes(type, to) && this.fresh(e) && !this.known.has(e)) {
      const out = this.convert(result, type, to);
      this.freeBlocks(result, type);
      return out;
    }
    if (!consume && this.fresh(e) && !this.known.has(e)) this.pending.push({ v: result, type });
    return to !== undefined ? this.convert(result, type, to) : result;
  }


  // The type of what `value` gives for an expression: its own, or what it is converted to.
  valueType(e: Ref<Expr>): Type {
    return this.cur().coercions.get(e) ?? this.cur().types.get(e)!;
  }


  // A pointer to a value lent to a reference: where a place holding exactly that type lives,
  // or else a slot holding a copy converted to it.
  borrowed(this: Mut<this>, e: Ref<Expr>, to: Type): string {
    let direct = false;
    if (this.lendable(e)) {
      const held = this.stored(e);
      direct = held === to || this.tables.typing.unfold(held) === to || this.tables.typing.lower(held) === this.tables.typing.lower(to);
    }
    if (direct) {
      const address2 = this.address(e);
      const stored2 = this.stored(e);
      return this.blockOf(address2, stored2);
    }
    const slot = this.alloca(this.llvm(to));
    const made = this.evaluate(e);
    if (this.fresh(e)) this.pending.push({ v: made, type: this.cur().types.get(e)! });
    const get2 = this.cur().types.get(e)!;
    const line = `store ${this.llvm(to)} ${this.convert(made, get2, to)}, ptr ${slot}`;
    this.emit(line);
    return slot;
  }


  // The calls an expression makes are made from its site, once its operands' own calls are done.
  evaluate(this: Mut<this>, e: Ref<Expr>): string {
    const outer = this.siteNow();
    this.site = { start: e.start, end: e.end };
    const v = this.evaluated(e);
    this.site = outer;
    return v;
  }


  evaluated(this: Mut<this>, e: Ref<Expr>): string {
    const pair = this.pairOf(e);
    if (pair !== undefined) {
      const v = this.temp();
      this.emit(`${v} = load ${PAIR}, ptr ${pair}`);
      return v;
    }
    switch (e.kind) {
      case "int": {
        const type = this.cur().types.get(e)!;
        return isFloat(type) ? floatConstant(Number(e.value), type) : String(e.value);
      }
      case "float":
        return floatConstant(e.value, this.cur().types.get(e) as "f32" | "f64");
      case "bigint":
        return this.bigConstant(e.value);
      case "regex":
        const get2 = this.cur().types.get(e) as RegexType;
        return this.regex(get2);
      // The operand's value, which whoever asked for the wrapper's drops when it is fresh.
      case "satisfies":
        return this.value(e.expr, true);
      case "as": {
        const [from, to] = [this.cur().coercions.get(e.expr) ?? this.cur().types.get(e.expr)!, this.cur().types.get(e)!];
        // A widening 'as' is its operand, converted by the coercion the checker gave it.
        if (this.widens(e)) return this.value(e.expr, true);
        if (this.recOf(from)?.kind === "union") {
          const v = this.value(e.expr);
          const declared = this.recOf(to);
          const kept = declared?.kind === "union" ? declared.members : [to];
          const union = from as UnionType;
          const rejected = this.tables.typing.rec(union).members.filter((m) => !kept.includes(m) && !kept.includes(this.tables.typing.unfold(m)));
          const holds2 = this.conversions().holds(v, union, rejected);
          this.lowering().panicIf(holds2, `'as ${this.tables.typing.show(to)}' failed: union held another member`, { start: e.start, end: e.end });
          return this.convert(v, union, to);
        }
        if (from === "bigint") {
          const operand2 = this.value(e.expr);
          return this.bigTo(operand2, to);
        }
        const pointer = (cg: Mut<Codegen>, t: Type) => cg.recOf(t)?.kind === "pointer";
        if (!pointer(this, from) && !pointer(this, to)) {
          const operand3 = this.value(e.expr);
          return this.cast(operand3, from, to as Numeric);
        }
        // A raw pointer is an address: another pointer is the same one, and an integer is its
        // number.
        if (pointer(this, from) && pointer(this, to)) return this.value(e.expr);
        // An integer becomes an address as a `usize` would, sign-extending a narrower signed one.
        const converted = this.temp();
        if (pointer(this, to)) {
          const operand4 = this.value(e.expr);
          const line = `${converted} = inttoptr i64 ${this.cast(operand4, from, "usize")} to ptr`;
          this.emit(line);
        }
        else {
          const line2 = `${converted} = ptrtoint ptr ${this.value(e.expr)} to ${this.llvm(to)}`;
          this.emit(line2);
        }
        return converted;
      }
      case "bool":
        return String(e.value);
      case "comptime":
        const get3 = this.cur().types.get(e)!;
        this.bakeable(get3, { start: e.start, end: e.end });
        const part2 = this.current;
        const comptimeValue2 = comptimeValue(this, part2, e);
        const get4 = this.cur().types.get(e)!;
        return this.bake(comptimeValue2, get4);
      // A string literal on its own has only its literal type, which takes no space.
      case "string":
        return "zeroinitializer";
      case "null":
        return "zeroinitializer";
      // Nothing after a throw expression runs, so the value it stands for is never read.
      case "throw":
        const owned2 = this.owned(e.value);
        this.raised(e, owned2);
        const label2 = this.label();
        this.startBlock(label2);
        return "undef";
      case "index": {
        const object = this.valueType(e.object);
        if (this.indexes(object)) {
          const held = this.referent(object) as ArrayType | FixedType;
          const v = this.temp();
          const line3 = `${v} = load ${this.llvm(this.tables.typing.rec(held).element)}, ptr ${this.element(e)}`;
          this.emit(line3);
          const get5 = this.cur().types.get(e)!;
          return this.convert(v, this.tables.typing.rec(held).element, get5);
        }
        const s = this.operandBefore(e.object, e.index);
        const index = this.value(e.index);
        this.inBounds(s, index, { start: e.start, end: e.end });
        const result = this.temp();
        this.emit(`${result} = call ptr @fsh_rt_str_at(ptr ${s}, i64 ${index})`);
        return result;
      }
      // The elements run first, then fill a buffer just long enough.
      case "array": {
        const made = this.cur().types.get(e)!;
        const fixed = this.recOf(made);
        // A fixed array's literal is its elements in place.
        if (fixed?.kind === "fixed") {
          const values = this.delivered((cg) => (e.elements as Expr[]).map((x) => {
              const owned3 = cg.owned(x);
              return cg.hand(owned3, fixed.element);
            }));
          return values.reduce((whole, v, i) => {
            const next = this.temp();
            this.emit(`${next} = insertvalue ${this.llvm(made)} ${whole}, ${this.llvm(fixed.element)} ${v}, ${i}`);
            return next;
          }, "undef");
        }
        const type = made as ArrayType;
        const t = this.llvm(this.tables.typing.rec(type).element);
        if (e.elements.some((x) => x?.kind === "spread")) return this.spreadArray(e.elements as Expr[], type);
        const values = this.delivered((cg) => (e.elements as Expr[]).map((x) => {
            const owned4 = cg.owned(x);
            return cg.hand(owned4, cg.tables.typing.rec(type).element);
          }));
        const n = String(values.length);
        const data = this.temp();
        const line4 = `${data} = call ptr @fsh_rt_array_alloc(i64 ${this.bytes(this.tables.typing.rec(type).element, n)})`;
        this.emit(line4);
        let iAt: usize = 0;
        for (const v of values) {
          const i = iAt;
          iAt++;
          const at = this.temp();
          this.emit(`${at} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
          this.emit(`store ${t} ${v}, ptr ${at}`);
        }
        return this.built(data, n, n);
      }
      case "template": {
        // Text alone is a literal, which takes no space.
        if (e.exprs.length === 0) return "zeroinitializer";
        const parts: string[] = [];
        let iAt2: usize = 0;
        for (const q of e.quasis) {
          const i = iAt2;
          iAt2++;
          if (q !== "") parts.push(this.text(q));
          const x = (i < e.exprs.length ? e.exprs[i]! : undefined);
          if (x !== undefined) {
            const operand5 = this.operand(x, e.exprs, i + 1);
            parts.push(this.written(operand5, this.valueType(x)));
          }
        }
        const array = this.alloca(`[${parts.length} x ptr]`);
        let iAt3: usize = 0;
        for (const part of parts) {
          const i = iAt3;
          iAt3++;
          const at = this.temp();
          this.emit(`${at} = getelementptr [${parts.length} x ptr], ptr ${array}, i32 0, i32 ${i}`);
          this.emit(`store ptr ${part}, ptr ${at}`);
        }
        const result = this.temp();
        this.emit(`${result} = call ptr @fsh_rt_str_join(ptr ${array}, i64 ${parts.length})`);
        return result;
      }
      case "nonNull": {
        // An overload's body narrows the implementation's value to the signature's return type.
        if (e.narrows !== undefined) {
          const [from, to] = [this.valueType(e.expr), this.cur().types.get(e)!];
          const v = this.value(e.expr);
          if (from === to) return v;
          const declared = this.recOf(to);
          const kept = declared?.kind === "union" ? declared.members : [to];
          const union = from as UnionType;
          const holds3 = this.conversions().holds(v, union, this.tables.typing.rec(union).members.filter((m) => !kept.includes(m)));
          this.lowering().panicIf(holds3, "the implementation returned a value this overload signature doesn't declare", { start: e.start, end: e.end });
          return this.convert(v, union, to);
        }
        if (redundantBang(e)) return this.value(e.expr);
        // An optional interface parameter a call left out is only ever empty.
        if (this.valueType(e.expr) === "null") {
          this.value(e.expr);
          this.lowering().panicIf("true", (e as { reason?: string }).reason ?? "called `Option::unwrap()` on a `None` value", { start: e.start, end: e.end });
          return "undef";
        }
        // Through a reference, the Option it points to.
        const option = this.valueType(e.expr) as UnionType;
        const v = this.value(e.expr);
        // The checker's own unwraps, as of an iterator helper's count, say why they panic.
        const holds4 = this.conversions().holds(v, option, ["null"]);
        this.lowering().panicIf(holds4, (e as { reason?: string }).reason ?? "called `Option::unwrap()` on a `None` value", { start: e.start, end: e.end });
        const get6 = this.cur().types.get(e)!;
        return this.convert(v, option, get6);
      }
      case "ident": {
        // A top-level const: a scalar or string baked where it is read, an aggregate read through
        // a pointer to its global.
        const read = this.callOf(e);
        if (read !== undefined && this.bodyAt(read).comptime === "const") {
          const get17 = this.cur().types.get(e)!;
          if (this.isRef(get17)) return this.constantGlobal(read);
          const baked = comptimeBody(this, read);
          const get7 = this.cur().types.get(e)!;
          return this.bake(baked, get7);
        }
        // A nested function used as a value is its closure, made here.
        const built = this.cur().envs?.get(e);
        if (built !== undefined) return this.environment(this.tables.arenas.instanceOf(built.of).id, built.env);
        const exported = this.tables.jsExports.get(e);
        if (exported !== undefined) {
          const jsExport2 = this.jsExport(exported, { start: e.start, end: e.end });
          const get8 = this.cur().types.get(e)!;
          return this.fromJs(jsExport2, get8, `'${exported.name}' from '${exported.module}' is`, { start: e.start, end: e.end });
        }
        // `undefined` is the empty value, unless a variable takes the name.
        if (!this.cur().locals.has(e)) return "zeroinitializer";
        const local = this.resolved(e);
        const t = this.temp();
        const part4 = this.loc(local).type;
        const line5 = `${t} = load ${this.llvm(part4)}, ptr ${this.slot(local)}`;
        this.emit(line5);
        if (this.cur().copiesOut.has(e)) {
          // The box, through a reference and out of a union holding it.
          let [held, type] = [t, this.loc(local).type];
          if (this.isRef(type)) {
            const through = this.temp();
            this.emit(`${through} = load ${this.llvm(this.referent(type))}, ptr ${held}`);
            [held, type] = [through, this.referent(type)];
          }
          const union = this.recOf(type);
          if (union?.kind === "union") held = this.convert(held, type, union.members.find((t) => this.tables.typing.isPlainJs(t))!);
          const get9 = this.cur().types.get(e)!;
          return this.jsRead(held, get9);
        }
        // Where a check narrowed the variable, its value comes out of the union.
        const part3 = this.loc(local).type;
        const get10 = this.cur().types.get(e)!;
        return this.convert(t, part3, get10);
      }
      case "member":
        if (this.tables.maths.has(e)) return floatConstant(MATH_CONSTANTS[e.name]!, "f64");
        const held = this.cur().types.has(e.object) ? this.tables.typing.lower(this.valueType(e.object)) : undefined;
        const pattern = this.recOf(held);
        if (pattern?.kind === "regex") {
          const t = pattern;
          if (e.name === "source") return this.text(t.source);
          if (e.name === "flags") return this.text([..."dgimsuvy"].filter((f) => t.flags.includes(f)).join(""));
          return t.flags.includes(REGEX_FLAGS[e.name]!) ? "1" : "0";
        }
        return this.unwraps(e.object) ? this.link(e, e.object, (cg) => cg.member(e))! : this.member(e);
      // A closure's value is each variable it holds, and a pointer to each it borrows, or to `this`.
      case "arrow": {
        const inner = this.callOf(e)!;
        const list = [...this.inst(inner).captures!.values()];
        return this.environment(inner, list);
      }
      case "object": {
        const type = this.cur().types.get(e) as ObjectType;
        if (e.props.some((p) => p.kind === "spread")) return this.spreadObject(e, type);
        // Properties run in source order, then fill the fields in their sorted order.
        const values = this.delivered((cg) => new Map(e.props.map((p) => {
          const [name, v] = cg.property(p, type);
          return [name, cg.hand(v, cg.tables.typing.field(type, name)!.type)];
        })));
        let result = "undef";
        let iAt4: usize = 0;
        for (const f of this.tables.typing.rec(type).fields) {
          const i = iAt4;
          iAt4++;
          const next = this.temp();
          this.emit(`${next} = insertvalue ${this.llvm(type)} ${result}, ${this.llvm(f.type)} ${values.get(f.name)}, ${i}`);
          result = next;
        }
        return result;
      }
      case "this": {
        const result = this.temp();
        const get18 = this.cur().types.get(e)!;
        const line9 = `${result} = load ${this.llvm(get18)}, ptr %this`;
        this.emit(line9);
        return result;
      }
      case "new": {
        if (this.tables.regexNews.has(e)) {
          const get11 = this.cur().types.get(e) as RegexType;
          return this.regex(get11);
        }
        const made = this.tables.jsNews.get(e);
        if (made !== undefined) {
          const c = this.jsExport(made, { start: e.start, end: e.end });
          const args = e.args ?? [];
          const [argv, box] = [this.jsArgv(args, this.optionalAt(e)), this.temp()];
          const line6 = `call ptr @fsh_rt_js_new(ptr ${c}, i64 ${args.length}, ptr ${argv}, ptr ${this.panicAt({ start: e.start, end: e.end })})`;
          this.unwinding(line6, box);
          const get12 = this.cur().types.get(e)!;
          return this.fromJs(box, get12, `'new ${made.name}' from '${made.module}' gave`, { start: e.start, end: e.end });
        }
        const get19 = this.cur().types.get(e);
        const newed = this.recOf(get19);
        if (newed?.kind === "interior") {
          const get13 = this.cur().types.get(e) as InteriorType;
          return this.interiorNew(e, get13);
        }
        if (newed?.kind === "block") {
          const get14 = this.cur().types.get(e) as BlockType;
          return this.blockNew(e, get14);
        }
        if (newed?.kind === "map") {
          const get15 = this.cur().types.get(e) as MapType;
          return this.mapNew(get15, e.args?.[0]);
        }
        if (newed?.kind === "shared") {
          const get16 = this.cur().types.get(e) as SharedType;
          return this.sharedNew(e, get16);
        }
        // A Rust type's constructor gives the handle to the value it boxed.
        if (this.bodyAt(this.callOf(e)!).rust !== undefined) {
          const argValues2 = this.argValues(e.args ?? [], this.callOf(e)!);
          return this.invoke(this.callOf(e)!, undefined, argValues2, exprKey(e))!;
        }
        // The constructor fills in a slot, which then holds the new instance. The slot starts
        // empty, so a field's first assignment has nothing to drop.
        const type = this.cur().types.get(e) as ClassType;
        const instance = this.alloca(this.llvm(type));
        this.emit(`store ${this.llvm(type)} zeroinitializer, ptr ${instance}`);
        // A panic in the constructor drops the fields it has set. One that throws has set none.
        const argValues3 = this.argValues(e.args ?? [], this.callOf(e)!);
        this.invoke(this.callOf(e)!, instance, argValues3, exprKey(e), undefined, (cg) => {
          const unstash2 = cg.unstash(instance, type);
          cg.dispose(unstash2, type);
        });
        const result = this.temp();
        this.emit(`${result} = load ${this.llvm(type)}, ptr ${instance}`);
        return result;
      }
      case "call": {
        const result = this.call(e);
        if ((result === undefined || result === "")) throw new Error("internal error: void call used as a value");
        if (this.cur().predicates?.has(e) === true) this.predicateCheck(e, result);
        return result;
      }
      case "unary": {
        if (e.op === "await") return this.awaitFuture(e)!;
        const type = this.cur().types.get(e)!;
        // A negative literal is a constant, which may be the type's minimum.
        if (e.op === "-" && (e.operand.kind === "int" || e.operand.kind === "float")) {
          return isFloat(type) ? floatConstant(-Number(e.operand.value), type) : String(-e.operand.value);
        }
        const operand = this.value(e.operand);
        if (type === "bigint") {
          const result = this.temp();
          this.emit(`${result} = call ptr @fsh_rt_big_${e.op === "-" ? "neg" : "not"}(ptr ${operand})`);
          return result;
        }
        if (e.op === "-" && isFloat(type)) {
          const result = this.temp();
          this.emit(`${result} = fneg ${this.llvm(type)} ${operand}`);
          return result;
        }
        if (e.op === "-") return this.lowering().arithmetic("-", "0", operand, { start: e.start, end: e.end }, type as Integer, "negate");
        const result = this.temp();
        this.emit(`${result} = xor ${this.llvm(type)} ${operand}, ${e.op === "~" ? -1 : "true"}`);
        return result;
      }
      case "assign":
        return this.fixing(e.target, (cg) => cg.assign(e));
      case "yield":
        return this.yielded(e, true);
      case "match":
        return this.lowerMatch(e, true)!;
      case "unsafe":
        return this.value(e.expr, true);
      case "pipe":
        return this.lowerPipe(e, true)!;
      case "update":
        return this.fixing(e.operand, (cg) => {
          const old = cg.value(e.operand);
          const type = cg.cur().types.get(e)!;
          if (type === "bigint") {
            // The old value outlives the store that releases the place's hold on it.
            const kept = cg.copied(old, type);
            const bigConstant2 = cg.bigConstant(1n);
            const result = cg.bigOperate(e.op === "++" ? "+" : "-", old, bigConstant2, { start: e.start, end: e.end });
            cg.store(e.operand, result);
            if (e.prefix) {
              cg.emit(`call void @fsh_rt_big_release(ptr ${kept})`);
              return result;
            }
            cg.pending.push({ v: kept, type });
            return kept;
          }
          const result = cg.numeric(e.op === "++" ? "+" : "-", old, isFloat(type) ? floatConstant(1, type) : "1", { start: e.start, end: e.end }, type);
          cg.store(e.operand, result);
          return e.prefix ? result : old;
        });
      case "conditional": {
        const cond = this.value(e.cond);
        const get20 = this.cur().types.get(e)!;
        const lent = this.isRef(get20);
        const kept: { slot: string; type: Type }[] = [];
        // Each side gives a value of its own when the result owns memory.
        const side = (cg: Mut<Codegen>, x: Expr) => {
          const mark = cg.pending.length;
          const get21 = cg.cur().types.get(e);
          const v = cg.needsDrop(get21) ? cg.owned(x) : cg.value(x);
          // A side lent out of the conditional lends what it made, which lasts the statement.
          if (lent) {
            for (const made of cg.pending.splice(mark)) {
              const slot = cg.alloca(cg.llvm(made.type));
              cg.allocas.push(`  store ${cg.llvm(made.type)} zeroinitializer, ptr ${slot}`);
              cg.emit(`store ${cg.llvm(made.type)} ${made.v}, ptr ${slot}`);
              kept.push({ slot, type: made.type });
            }
          } else cg.settle(mark);
          return v;
        };
        if (!this.cur().types.has(e.then)) return side(this, e.else);
        if (!this.cur().types.has(e.else)) return side(this, e.then);
        const [then, otherwise, end] = [this.label(), this.label(), this.label()];
        this.emit(`br i1 ${cond}, label %${then}, label %${otherwise}`);
        this.startBlock(then);
        const a = side(this, e.then);
        const thenEnd = this.block;
        this.emit(`br label %${end}`);
        this.startBlock(otherwise);
        const b = side(this, e.else);
        const otherwiseEnd = this.block;
        this.emit(`br label %${end}`);
        this.startBlock(end);
        const result = this.temp();
        const get22 = this.cur().types.get(e)!;
        const line10 = `${result} = phi ${this.llvm(get22)} [ ${a}, %${thenEnd} ], [ ${b}, %${otherwiseEnd} ]`;
        this.emit(line10);
        // Only the side that ran filled its slot; the other's reads as nothing to drop.
        for (const { slot, type } of kept) {
          const v = this.temp();
          this.emit(`${v} = load ${this.llvm(type)}, ptr ${slot}`);
          this.emit(`store ${this.llvm(type)} zeroinitializer, ptr ${slot}`);
          this.pending.push({ v, type });
        }
        return result;
      }
      case "binary": {
        if (this.tables.presenceTests.has(e)) return this.presence(e);
        if (e.op === "&&" || e.op === "||") {
          const operand6 = this.value(e.left);
          return this.logical(e.op, operand6, (cg) => cg.value(e.right));
        }
        if (e.op === "??") {
          const lowered = this.tables.typing.lower(this.valueType(e.left));
          if (!this.tables.typing.isOption(lowered)) return this.owned(e.left);
        }
        if (e.op === "??") return this.orElse(e);
        if (e.op === "+" && this.cur().types.get(e) === "string") {
          const operand7 = this.operandBefore(e.left, e.right);
          const written2 = this.written(operand7, this.valueType(e.left));
          const operand8 = this.value(e.right);
          const written3 = this.written(operand8, this.valueType(e.right));
          return this.concat(written2, written3);
        }
        const empty = this.tables.jsEmptyTests.get(e);
        if (empty !== undefined) {
          const [found, same] = [this.temp(), this.temp()];
          let box = this.value(empty[0]);
          if (this.isRef(this.valueType(empty[0]))) {
            const loaded = this.temp();
            this.emit(`${loaded} = load ptr, ptr ${box}`);
            box = loaded;
          }
          const line7 = `${found} = call i32 @fsh_rt_js_typeof(ptr ${box}, ptr ${this.text(empty[1])})`;
          this.emit(line7);
          this.emit(`${same} = icmp ${e.op === "===" ? "ne" : "eq"} i32 ${found}, 0`);
          return same;
        }
        const first = (cg: Mut<Codegen>, x: Expr) => (x === e.left ? cg.operandBefore(x, e.right) : cg.value(x));
        const tested = this.conversions().test(e, true);
        if ((tested !== undefined && tested !== "")) return tested;
        const condition = COMPARISON[e.op];
        const [a, b] = [first(this, e.left), this.value(e.right)];
        // A literal, as a literal type argument is, compares by value, and two types of different
        // bases, as an instance's argument and a value of its bound may have, are never equal.
        const [lt, rt] = [this.tables.typing.lower(this.valueType(e.left)), this.tables.typing.lower(this.valueType(e.right))];
        if ((e.op === "===" || e.op === "!==") && (lt !== rt || this.recOf(lt)?.kind === "literal")) {
          const same = this.mixedNumbers(a, lt, b, rt) ?? this.conversions().equals(a, lt, b, rt);
          if (e.op === "===") return same;
          const differ = this.temp();
          this.emit(`${differ} = xor i1 ${same}, true`);
          return differ;
        }
        // An operand keeps a literal type only when both are the same string literal.
        const type = this.cur().coercions.get(e.left) ?? this.cur().types.get(e.left)!;
        if ((condition === undefined || condition === "")) return this.numeric(e.op, a, b, { start: e.start, end: e.end }, type);
        // Empty values are always equal.
        if (type === "null") return String(e.op === "===");
        // Raw pointers compare by address.
        if (this.recOf(type)?.kind === "pointer") {
          const same = this.temp();
          this.emit(`${same} = icmp ${condition} ptr ${a}, ${b}`);
          return same;
        }
        // Values holding objects, arrays or instances compare part by part.
        if (compound(this.tables.typing, type)) {
          const same = this.deepEquals(a, b, type);
          if (e.op === "===") return same;
          const differ = this.temp();
          this.emit(`${differ} = xor i1 ${same}, true`);
          return differ;
        }
        const result = this.temp();
        if (isFloat(type)) {
          this.emit(`${result} = fcmp ${FLOAT_COMPARISON[e.op]} ${this.llvm(type)} ${a}, ${b}`);
          return result;
        }
        // Strings and bigints compare by the runtime's order: below, equal or above zero.
        if (type === "string" || type === "bigint") {
          const order = this.temp();
          this.emit(`${order} = call i32 @fsh_rt_${type === "string" ? "str" : "big"}_compare(ptr ${a}, ptr ${b})`);
          this.emit(`${result} = icmp ${condition} i32 ${order}, 0`);
          return result;
        }
        // An ordering of unsigned numbers compares them as unsigned.
        const unsigned = isInteger(type) && !integerInfo(type).signed && condition.startsWith("s");
        this.emit(`${result} = icmp ${unsigned ? `u${condition.slice(1)}` : condition} ${this.llvm(type)} ${a}, ${b}`);
        return result;
      }
      // A quote is made only while compiling; one reached when the program runs panics.
      case "tagged": {
        const line8 = `call void @fsh_rt_panic(ptr ${this.cString(`panicked at ${this.where({ start: e.start, end: e.end })}:\na quote builds syntax while compiling, so it can't run in the program\n`)})`;
        this.unwinding(line8);
        this.emit("unreachable");
        const label3 = this.label();
        this.startBlock(label3);
        return "undef";
      }
      default:
        throw new Error(`internal error: no lowering for ${e.kind}`);
    }
  }


  // A property's name and value.
  // A shorthand's variable may be narrowed, or an enum member the field widens, so its value
  // is converted to the field's type.
  // An object literal with spreads, built in order: each part's fields go in as it runs, a named
  // source cloned then and there, before a later part could change or move it, and a source made
  // for the literal taken apart. A field a later part replaces is dropped; until the object is
  // made, every value gathered is dropped if a later part panics. A spread gives an instance's
  // public fields only.
  spreadObject(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>, type: ObjectType): string {
    let got = new Map<string, { v: string; type: Type }>();
    const put = (cg: Mut<Codegen>, name: string, v: string, t: Type) => {
      const old = got.get(name);
      if (old !== undefined) {
        cg.pending = cg.pending.filter((entry) => entry !== old);
        cg.dispose(old.v, old.type);
      }
      const entry = { v, type: t };
      cg.pending.push(entry);
      got.set(name, entry);
    };
    for (const p of e.props) {
      if (p.kind === "property") {
        const owned2 = this.owned(p.value);
        const valueType2 = this.valueType(p.value);
        put(this, p.key as string, owned2, valueType2);
        continue;
      }
      if (p.kind === "shorthand") {
        const local = this.resolved(p);
        const to = this.tables.typing.field(type, p.name)!.type;
        // A shorthand lent to a reference field points at its variable.
        if (this.isRef(to) && !this.isRef(this.loc(local).type)) {
          const slot2 = this.slot(local);
          put(this, p.name, slot2, to);
          continue;
        }
        const shorthand2 = this.shorthand(p, local);
        const part2 = this.loc(local).type;
        put(this, p.name, shorthand2, part2);
        continue;
      }
      if (p.kind !== "spread") throw new Error("internal error: unchecked property");
      const held = this.cur().types.get(p.value)!;
      // The source's own type in this instance, its fields laid out as this instance has them.
      const source = this.tables.typing.lower(this.referent(held)) as ObjectType | ClassType;
      const taken = this.fresh(p.value);
      let whole = taken ? this.owned(p.value) : this.value(p.value);
      if (this.isRef(held)) {
        const read = this.temp();
        this.emit(`${read} = load ${this.llvm(source)}, ptr ${whole}`);
        whole = read;
      }
      const fields = this.tables.typing.rec(source).kind === "class" ? this.tables.typing.allFields(source as ClassType) : this.tables.typing.rec(source).fields;
      for (const f of fields) {
        const v = this.temp();
        this.emit(`${v} = extractvalue ${this.llvm(source)} ${whole}, ${this.tables.typing.fieldPath(source, f.name).join(", ")}`);
        const shown = this.tables.typing.rec(source).kind !== "class" || (f.access ?? "public") === "public";
        if (shown) {
          const chosen = taken ? v : this.copied(v, f.type);
          put(this, f.name, chosen, f.type);
        }
        else if (taken) this.dispose(v, f.type);
      }
    }
    let result = "undef";
    let iAt: usize = 0;
    for (const f of this.tables.typing.rec(type).fields) {
      const i = iAt;
      iAt++;
      const part = got.get(f.name)!;
      const next = this.temp();
      const line = `${next} = insertvalue ${this.llvm(type)} ${result}, ${this.llvm(f.type)} ${this.convert(part.v, part.type, f.type)}, ${i}`;
      this.emit(line);
      result = next;
    }
    const made = new Set(got.values());
    this.pending = this.pending.filter((entry) => !made.has(entry as { v: string; type: Type }));
    return result;
  }


  property(this: Mut<this>, p: Ref<ObjectProp>, object: ObjectType): [string, string] {
    if (p.kind === "property") return [p.key as string, this.owned(p.value)];
    if (p.kind !== "shorthand") assert(false, "internal error: unchecked property");
    const local = this.resolved(p);
    const to = this.tables.typing.field(object, p.name)!.type;
    // A shorthand lent to a reference field points at its variable.
    if (this.isRef(to) && !this.isRef(this.loc(local).type)) return [p.name, this.slot(local)];
    const part3 = this.loc(local).type;
    if (this.holdsRust(part3)) {
      const shorthand2 = this.shorthand(p, local);
      const part = this.loc(local).type;
      return [p.name, this.convert(shorthand2, part, to)];
    }
    const result = this.temp();
    const part4 = this.loc(local).type;
    const line = `${result} = load ${this.llvm(part4)}, ptr ${this.slot(local)}`;
    this.emit(line);
    const part2 = this.loc(local).type;
    const convert2 = this.convert(result, part2, to);
    return [p.name, this.copied(convert2, to)];
  }


  // A shorthand property's value: its variable's, copied, or for a Rust value, moved out of it, as
  // the property written out moves it.
  shorthand(this: Mut<this>, p: Ref<Extract<ObjectProp, { kind: "shorthand" }>>, local: LocalId): string {
    const read = this.temp();
    const part2 = this.loc(local).type;
    const line = `${read} = load ${this.llvm(part2)}, ptr ${this.slot(local)}`;
    this.emit(line);
    const part3 = this.loc(local).type;
    if (!this.holdsRust(part3)) {
      const part = this.loc(local).type;
      return this.copied(read, part);
    }
    if (!this.cur().consumes.has(p.id)) assert(false, "internal error: a Rust value in a shorthand property isn't moved");
    const part4 = this.loc(local).type;
    const line2 = `store ${this.llvm(part4)} zeroinitializer, ptr ${this.slot(local)}`;
    this.emit(line2);
    return read;
  }


  // Writes a value to a place, giving the assignment's value: what was written, or, for a setter,
  // which keeps what it is given, a copy of its own released when the statement ends.
  store(this: Mut<this>, targetGiven: Ref<Expr>, result: string): string {
    const target = bare(targetGiven);
    const setter = this.setterOf(target);
    if (setter !== undefined && target.kind === "member") {
      const type = this.cur().types.get(target)!;
      // A Rust value goes to the setter alone: the checker refuses such an assignment's value.
      if (this.holdsRust(type)) {
        const thisPointer2 = this.thisPointer(setter, target.object);
        this.invoke(setter, thisPointer2, [`${this.llvm(type)} ${result}`]);
        return result;
      }
      const kept = this.copied(result, type);
      if (this.needsDrop(type)) this.pending.push({ v: kept, type });
      const thisPointer3 = this.thisPointer(setter, target.object);
      this.invoke(setter, thisPointer3, [`${this.llvm(type)} ${result}`]);
      return kept;
    }
    // A whole value written through a mutable reference goes where it points.
    const type = this.cur().types.get(target)!;
    if (this.isRef(type) && this.cur().coercions.has(target)) {
      // Through the reference as stored, unless an update keeps the member it was narrowed to.
      const whole = target.kind === "ident" && type === this.loc(this.resolved(target)).type;
      const pointer = whole ? this.temp() : this.evaluate(target);
      if (whole) {
        const line = `${pointer} = load ptr, ptr ${this.slot(this.resolved(target))}`;
        this.emit(line);
      }
      this.replace(pointer, this.referent(type), result);
      return result;
    }
    // An element or a field kept in a recursive type's block takes the value into a new block.
    const place = this.placeType(target);
    const address2 = this.address(target);
    const chosen = place !== type && this.boxes(type, place) ? this.convert(result, type, place) : result;
    this.replace(address2, place, chosen);
    return result;
  }


  // Writes a value into a place, dropping the one it held.
  replace(this: Mut<this>, at: string, type: Type, v: string) {
    const old = this.temp();
    if (this.needsDrop(type)) this.emit(`${old} = load ${this.llvm(type)}, ptr ${at}`);
    this.emit(`store ${this.llvm(type)} ${v}, ptr ${at}`);
    if (this.needsDrop(type)) this.dispose(old, type);
  }


  // Where a value of `want` lives inside a place holding a `whole`: a union narrowed to one
  // member keeps it in place as its payload, and one narrowed into a member that holds itself
  // keeps it in that member's block.
  narrowedPlace(this: Mut<this>, at: string, whole: Type, want: Type): string {
    if (whole === want || typeof whole === "string") return at;
    const r = this.tables.typing.rec(whole);
    if (r.kind === "recursive") {
      const block = this.temp();
      this.emit(`${block} = load ptr, ptr ${at}`);
      return this.narrowedPlace(block, r.of, want);
    }
    if (r.kind !== "union") return at;
    const payload = this.temp();
    this.emit(`${payload} = getelementptr ${this.llvm(whole)}, ptr ${at}, i32 0, i32 1`);
    if (r.members.includes(want)) return payload;
    // A member holding itself keeps its value in a block, which a field of a class points to.
    const holder = r.members.find((m) => {
      const block = this.recOf(m);
      if (block?.kind !== "recursive") return false;
      const of = this.recOf(block.of);
      return block.of === want || (of?.kind === "union" && of.members.includes(want));
    });
    return holder !== undefined ? this.narrowedPlace(payload, holder, want) : payload;
  }


  // Where an assignment target lives: a variable's slot, or a field inside one.
  address(this: Mut<this>, targetGiven: Ref<Expr>): string {
    const target = bare(targetGiven);
    if (target.kind === "this") return "%this";
    if (target.kind === "index") return this.element(target);
    if (target.kind !== "member") {
      const local = this.resolved(target);
      const slot2 = this.slot(local);
      const part = this.loc(local).type;
      const get2 = this.cur().types.get(target)!;
      return this.narrowedPlace(slot2, part, get2);
    }
    const get4 = this.cur().types.get(target.object)!;
    const referent2 = this.referent(get4);
    if (this.recOf(referent2)?.kind === "shared") return this.sharedField(target)[2];
    const holder = this.stored(target.object);
    const object = this.tables.typing.unfold(this.referent(holder)) as ObjectType | ClassType;
    // Through a reference, the field is inside what it points to, and in a recursive type's
    // block, inside the block. A reference to a recursive member, as a narrowed `Mut` gives,
    // points at the place holding the block, not at the block.
    let base = this.isRef(holder) ? this.evaluate(target.object) : this.address(target.object);
    if (this.recOf(this.referent(holder))?.kind === "recursive") {
      const block = this.temp();
      this.emit(`${block} = load ptr, ptr ${base}`);
      base = block;
    }
    const result = this.temp();
    const path = this.tables.typing.fieldPath(object, target.name).map((i) => `i32 ${i}`).join(", ");
    this.emit(`${result} = getelementptr ${this.llvm(object)}, ptr ${base}, i32 0, ${path}`);
    if (this.inPayload(target)) {
      const get3 = this.cur().types.get(target)!;
      return this.narrowedPlace(result, this.tables.typing.field(object, target.name)!.type, get3);
    }
    return result;
  }


  // A field read a check narrowed to one member, whose place is inside its union's payload,
  // where it is stored as it is read.
  inPayload(this: Mut<this>, e: Ref<Expr>): boolean {
    const declared = this.cur().narrowedFields?.get(e);
    if (declared === undefined || e.kind !== "member" || this.recOf(this.cur().types.get(e))?.kind === "union") return false;
    const stored2 = this.stored(e.object);
    const referent2 = this.referent(stored2);
    const holder = this.tables.typing.unfold(referent2) as ObjectType | ClassType;
    const unfolded2 = this.tables.typing.unfolded(this.tables.typing.field(holder, e.name)!.type);
    return this.tables.typing.lower(unfolded2) === this.tables.typing.lower(declared);
  }


  // Whether an expression names somewhere a value lives: a variable, `this`, or a field of one,
  // but not a variable narrowed to part of a union, an enum's member or a union's shared field.
  lendable(this: Mut<this>, eGiven: Ref<Expr>): boolean {
    let e: Ref<Expr> = eGiven;
    let through = false;
    for (e = bare(e); e.kind === "member" && !this.cur().calls.has(e); e = bare(partOf(e))) {
      const at = e;
      if (at.kind !== "member") break;
      through = true;
      // A field narrowed to several members is read as a copy, laid out as the narrower union.
      if (this.cur().narrowedFields?.has(at) === true && !this.inPayload(at)) return false;
      // A string's or an array's `length` is computed, not a field.
      // A recursive member's fields live in its block, which is a place too.
      let object: Type | undefined;
      if (this.cur().types.has(at.object)) {
        const get2 = this.cur().types.get(at.object)!;
        object = this.tables.typing.unfold(this.referent(get2));
      } else {
        object = undefined;
      }
      // A shared value's interior-mutable field lives in its block, wherever the handle is.
      const kind = this.recOf(object)?.kind;
      if (kind === "shared") return !this.cur().copiesOut.has(at);
      if (kind !== "object" && kind !== "class") return false;
    }
    if (e.kind === "this") return true;
    // A field of what a call's reference points at lives there, as one through a variable does.
    if (through && e.kind === "call" && this.isRef(this.cur().types.get(e)!)) return true;
    // An array's element lives in its buffer, wherever the array itself is.
    if (e.kind === "index") return this.indexes(this.valueType(e.object));
    // A JsValue read out of JS lives nowhere until the read makes it.
    if (this.cur().copiesOut.has(e)) return false;
    const local = e.kind === "ident" ? this.localAt(e) : undefined;
    const type = this.cur().types.get(e);
    return local !== undefined && (type === this.loc(local).type || this.recOf(type)?.kind !== "union");
  }


  // The type a place is stored as. Read through a type parameter's bound, a field may have a
  // wider type than the one it is stored with.
  stored(this: Mut<this>, eGiven: Ref<Expr>): Type {
    const e = bare(eGiven);
    if (e.kind === "index" && this.indexes(this.valueType(e.object))) return this.placeType(e);
    if (e.kind !== "member" || this.cur().calls.has(e)) return this.cur().types.get(e)!;
    const stored2 = this.stored(e.object);
    const referent2 = this.referent(stored2);
    const holder = this.tables.typing.unfold(referent2);
    // A shared value's field is stored in its block's value.
    const shared = this.recOf(holder);
    const object = shared?.kind === "shared" ? shared.of : holder;
    return this.inPayload(e) ? this.cur().types.get(e)! : this.tables.typing.field(object as ObjectType | ClassType, e.name)!.type;
  }


  // The right side runs only when the left side does not already decide the result.
  // What the left Option holds, or the right side, run only when the left is empty.
  orElse(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): string {
    const option = this.valueType(e.left) as UnionType;
    const type = this.cur().types.get(e)!;
    // A Rust value is moved out of the left side, which is left empty, never copied.
    const rust = this.holdsRust(option);
    const v = rust && this.fresh(e.left) ? this.value(e.left, true) : this.value(e.left);
    if (rust && !this.fresh(e.left)) {
      if (!this.cur().consumes.has(e.left.id) || !this.lendable(e.left)) assert(false, "internal error: a Rust value on the left of '??' isn't moved");
      this.take(e.left);
    }
    const [some, none, end] = [this.label(), this.label(), this.label()];
    const line = `br i1 ${this.conversions().holds(v, option, ["null"])}, label %${none}, label %${some}`;
    this.emit(line);
    this.startBlock(some);
    // The result is a value of its own, like a conditional's.
    let kept: string;
    if (rust) {
      kept = this.convert(v, option, type);
    } else {
      const convert2 = this.convert(v, option, type);
      kept = this.copied(convert2, type);
    }
    const someEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(none);
    const mark = this.pending.length;
    const fallback = this.needsDrop(type) ? this.owned(e.right) : this.value(e.right);
    this.settle(mark);
    const noneEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(end);
    const result = this.temp();
    this.emit(`${result} = phi ${this.llvm(type)} [ ${kept}, %${someEnd} ], [ ${fallback}, %${noneEnd} ]`);
    return result;
  }


  logical(this: Mut<this>, op: "&&" | "||", a: string, right: (cg: Mut<Codegen>) => string): string {
    const from = this.block;
    const rhs = this.label();
    const end = this.label();
    this.emit(op === "&&" ? `br i1 ${a}, label %${rhs}, label %${end}` : `br i1 ${a}, label %${end}, label %${rhs}`);
    this.startBlock(rhs);
    const mark = this.pending.length;
    const b = right(this);
    this.settle(mark);
    const rhsEnd = this.block;
    this.emit(`br label %${end}`);
    this.startBlock(end);
    const result = this.temp();
    this.emit(`${result} = phi i1 [ ${op === "||"}, %${from} ], [ ${b}, %${rhsEnd} ]`);
    return result;
  }


  concat(this: Mut<this>, a: string, b: string): string {
    const result = this.temp();
    this.emit(`${result} = call ptr @fsh_rt_str_concat(ptr ${a}, ptr ${b})`);
    return result;
  }


  // A value as a string, written as JavaScript's `String(x)` would; a number's is a new string,
  // released when the statement ends.
  written(this: Mut<this>, v: string, type: Type): string {
    if (type === "string") return v;
    if (type === "bigint") {
      const digits = this.temp();
      this.emit(`${digits} = call ptr @fsh_rt_big_text(ptr ${v}, i64 10)`);
      this.pending.push({ v: digits, type: "string" });
      return digits;
    }
    if (type === "boolean") {
      const result = this.temp();
      const line = `${result} = select i1 ${v}, ptr ${this.text("true")}, ptr ${this.text("false")}`;
      this.emit(line);
      return result;
    }
    let from = isFloat(type) ? type : "i64";
    let wide = v;
    if (isInteger(type)) {
      const { bits, signed } = integerInfo(type);
      if (!signed) from = "u64";
      if (bits === 128) {
        const result = this.temp();
        this.emit(`${result} = call ptr @fsh_rt_str_from_${signed ? "i" : "u"}128(i128 ${v})`);
        this.pending.push({ v: result, type: "string" });
        return result;
      }
      if (bits < 64) {
        wide = this.temp();
        this.emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
    }
    const result = this.temp();
    this.emit(`${result} = call ptr @fsh_rt_str_from_${from}(${from === "f32" ? "float" : from === "f64" ? "double" : "i64"} ${wide})`);
    this.pending.push({ v: result, type: "string" });
    return result;
  }


  // A value computed while compiling, built as a value of its type: scalars and strings as
  // constants, aggregates assembled from their baked parts.
  bake(this: Mut<this>, tagged: Ref<Value>, type: Type): string {
    const r = this.recOf(type);
    // A regex comptime made is its flags and pattern, as the interpreter holds it.
    if (r?.kind === "regex") {
      const held = untagged(tagged) as string;
      const slash = held.indexOf("/");
      const [flags, pattern] = [held.slice(0, slash), held.slice(slash + 1)];
      const part2 = parsePattern(pattern, flags, this.tables.regex).captures;
      const regexType2 = this.tables.typing.regexType(pattern, flags, part2);
      return this.regex(regexType2);
    }
    if (r?.kind === "union") {
      const member = memberOf(this.tables.typing, tagged, type as UnionType);
      const bake2 = this.bake(untagged(tagged), member);
      return this.convert(bake2, member, type);
    }
    const v = untagged(tagged);
    // A literal type, or the empty value, takes no space.
    if ((r?.kind === "literal") || v === null) return "zeroinitializer";
    if (typeof v === "string") return this.text(v);
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") return floatConstant(v, type as "f32" | "f64");
    if (typeof v === "bigint" && type === "bigint") return this.bigConstant(v);
    if (typeof v === "bigint") return String(v);
    // An Atomic is its value; an atomic boolean a byte. A lock is its word, free, then its value.
    if (v !== undefined && v.kind === "interior" && r?.kind === "interior") {
      if (isLock(r)) {
        const made = this.temp();
        const line = `${made} = insertvalue ${this.llvm(type)} zeroinitializer, ${this.llvm(r.of)} ${this.bake(v.value, r.of)}, 1`;
        this.emit(line);
        return made;
      }
      return this.llvm(type) === "i8" ? (v.value === true ? "1" : "0") : this.bake(v.value, r.of);
    }
    // A table is built at start-up, each entry inserted in the order comptime made it.
    if (v !== undefined && v.kind === "map" && r?.kind === "map") {
      const made = this.emptyMap(type as MapType);
      for (const [k, x] of v.entries.values()) {
        const bake3 = this.bake(k, r.key);
        const chosen = r.set ? undefined : this.bake(x, r.value);
        this.inserted(type as MapType, made, bake3, chosen);
      }
      return made;
    }
    if (v !== undefined && v.kind === "array" && r?.kind === "array") {
      const n = String(v.items.length);
      const [data, t] = [this.temp(), this.llvm(r.element)];
      const line2 = `${data} = call ptr @fsh_rt_array_alloc(i64 ${this.bytes(r.element, n)})`;
      this.emit(line2);
      // Numbers are copied from constant data, so a large table is one copy, not a store each.
      if (v.items.length > 0 && (isInteger(r.element) || isFloat(r.element))) {
        const element = r.element;
        const items = v.items.map((x) => `${t} ${typeof untagged(x) === "number" ? floatConstant(untagged(x) as f64, element as "f32" | "f64") : String(untagged(x))}`);
        const contents = `[${n} x ${t}] [${items.join(", ")}]`;
        const table = `@.table.${this.stableId("table", contents)}`;
        if (!this.emittedTables.has(table)) this.globals.push(`${table} = private unnamed_addr constant ${contents}`);
        this.emittedTables.add(table);
        this.intrinsics.add("declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)");
        const line3 = `call void @llvm.memcpy.p0.p0.i64(ptr ${data}, ptr ${table}, i64 ${this.bytes(element, n)}, i1 false)`;
        this.emit(line3);
        return this.built(data, n, n);
      }
      let iAt: usize = 0;
      for (const item of v.items) {
        const i = iAt;
        iAt++;
        const at = this.temp();
        this.emit(`${at} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
        const line4 = `store ${t} ${this.bake(item, r.element)}, ptr ${at}`;
        this.emit(line4);
      }
      return this.built(data, n, n);
    }
    if (v !== undefined && r !== undefined && (r.kind === "object" || r.kind === "class" || r.kind === "variant")) {
      const parts: [Type, Value][] = [];
      if (r.kind === "class" && r.base !== undefined) parts.push([r.base, v]);
      let iAt2: usize = 0;
      for (const f of r.fields) {
        const i = iAt2;
        iAt2++;
        parts.push([f.type, v.kind === "variant" ? v.args[i] : v.kind === "record" ? v.fields.get(f.name) : undefined]);
      }
      let made = "zeroinitializer";
      let iAt3: usize = 0;
      for (const [part, x] of parts) {
        const i = iAt3;
        iAt3++;
        const next = this.temp();
        const line5 = `${next} = insertvalue ${this.llvm(type)} ${made}, ${this.llvm(part)} ${this.bake(x, part)}, ${i}`;
        this.emit(line5);
        made = next;
      }
      return made;
    }
    throw new Error(`internal error: no baked form for a comptime value of type ${this.tables.typing.keyOf(type)}`);
  }


  // A literal's string block: a count below zero, so it is never freed, its length, a pointer
  // to its bytes, no base, its UTF-16 length, and no breadcrumbs.
  // `re.exec(s)`: the runtime writes each group's start and end, and the match is built from
  // slices of s, with null for a group that took no part.
  regexExec(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
    const regexT = this.tables.typing.lower(this.valueType(object)) as RegexType;
    let option = this.cur().types.get(e) as UnionType | undefined;
    if (option === undefined) {
      const matched = this.tables.typing.matchType(regexT);
      option = this.tables.typing.unionType([matched, "null"]) as UnionType;
    }
    const re = this.value(object);
    const operand = this.value(e.args[0]!);
    const result = this.execOf(regexT, option, re, operand);
    if (!this.cur().types.has(e)) this.pending.push({ v: result, type: option });
    return result;
  }


  // The first match of a regex in s, or null.
  execOf(this: Mut<this>, regexT: RegexType, option: UnionType, re: string, s: string): string {
    const match = this.tables.typing.rec(option).members.find((m) => m !== "null") as ObjectType;
    const groups = this.tables.typing.rec(regexT).captures.length + 1;
    const [out, found, yes] = [this.alloca(`[${groups * 2} x i64]`), this.temp(), this.temp()];
    this.emit(`${found} = call i32 @fsh_rt_regex_match(ptr ${re}, ptr ${s}, ptr ${out})`);
    this.emit(`${yes} = icmp ne i32 ${found}, 0`);
    const [made, none, done] = [this.label(), this.label(), this.label()];
    this.emit(`br i1 ${yes}, label %${made}, label %${none}`);
    this.startBlock(made);
    const matchValue2 = this.matchValue(regexT, match, s, out);
    const some = this.convert(matchValue2, match, option);
    const filled = this.block;
    this.emit(`br label %${done}`);
    this.startBlock(none);
    const nothing = this.convert("zeroinitializer", "null", option);
    this.emit(`br label %${done}`);
    this.startBlock(done);
    const result = this.temp();
    this.emit(`${result} = phi ${this.llvm(option)} [ ${some}, %${filled} ], [ ${nothing}, %${none} ]`);
    return result;
  }


  // A match built from the starts and ends the runtime wrote at `slots`: slices of s, with null
  // for a group that took no part.
  matchValue(this: Mut<this>, regexT: RegexType, match: ObjectType, s: string, slots: string): string {
    const at = (cg: Mut<Codegen>, k: usize) => {
      const [p, v] = [cg.temp(), cg.temp()];
      cg.emit(`${p} = getelementptr i64, ptr ${slots}, i64 ${k}`);
      cg.emit(`${v} = load i64, ptr ${p}`);
      return v;
    };
    // A group's text, or null when it took no part; one of a name's groups that took part.
    const capture = (cg: Mut<Codegen>, indexes: usize[], type: Type) => {
      if (type === "string") {
        const v = cg.temp();
        const line = `${v} = call ptr @fsh_rt_str_slice(ptr ${s}, i64 ${at(cg, indexes[0]! * 2)}, i64 ${at(cg, indexes[0]! * 2 + 1)}, i32 2)`;
        cg.emit(line);
        return v;
      }
      let result = cg.convert("zeroinitializer", "null", type);
      for (const i of indexes) {
        const start = at(cg, i * 2);
        const [took, yes, next, from] = [cg.temp(), cg.label(), cg.label(), cg.block];
        cg.emit(`${took} = icmp sge i64 ${start}, 0`);
        cg.emit(`br i1 ${took}, label %${yes}, label %${next}`);
        cg.startBlock(yes);
        const text = cg.temp();
        const line2 = `${text} = call ptr @fsh_rt_str_slice(ptr ${s}, i64 ${start}, i64 ${at(cg, i * 2 + 1)}, i32 2)`;
        cg.emit(line2);
        const some = cg.convert(text, "string", type);
        const filled = cg.block;
        cg.emit(`br label %${next}`);
        cg.startBlock(next);
        const merged = cg.temp();
        cg.emit(`${merged} = phi ${cg.llvm(type)} [ ${result}, %${from} ], [ ${some}, %${filled} ]`);
        result = merged;
      }
      return result;
    };
    let built = "undef";
    let iAt: usize = 0;
    for (const f of this.tables.typing.rec(match).fields) {
      const i = iAt;
      iAt++;
      let v: string;
      if (/^\d+$/.test(f.name)) v = capture(this, [Number(f.name)], f.type);
      else if (f.name === "index") v = at(this, 0);
      else if (f.name === "input") v = this.copied(s, "string");
      else {
        const named = f.type as ObjectType;
        let inner = "undef";
        let jAt: usize = 0;
        for (const g of this.tables.typing.rec(named).fields) {
          const j = jAt;
          jAt++;
          const indexes = this.tables.typing.rec(regexT).captures.flatMap((c, k) => (c.name === g.name ? [k + 1] : []));
          const next = this.temp();
          const line3 = `${next} = insertvalue ${this.llvm(named)} ${inner}, ${this.llvm(g.type)} ${capture(this, indexes, g.type)}, ${j}`;
          this.emit(line3);
          inner = next;
        }
        v = inner;
      }
      const next = this.temp();
      this.emit(`${next} = insertvalue ${this.llvm(match)} ${built}, ${this.llvm(f.type)} ${v}, ${i}`);
      built = next;
    }
    return built;
  }


  // A string method given a regex: search, match, matchAll, split, replace and replaceAll.
  regexString(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, name: string): string {
    const callee = e.callee;
    if (callee.kind !== "member") return "";
    const regexT = this.tables.typing.lower(this.valueType(e.args[0]!)) as RegexType;
    const s = this.operand(callee.object, e.args, 0);
    const re = this.value(e.args[0]!);
    // A call used as a statement has no type of its own; what it makes, from this instance's
    // regex, is dropped at its end.
    const type = this.cur().types.get(e) ?? regexStringType(this.tables.typing, name, regexT, this.tables.typing.rec(regexT).any === true);
    const call = (cg: Mut<Codegen>, line: string) => {
      const v = cg.temp();
      cg.emit(`${v} = call ${line}`);
      return v;
    };
    let result: string;
    if (name === "search") result = call(this, `i64 @fsh_rt_regex_search(ptr ${re}, ptr ${s})`);
    else if (name === "match" && !this.tables.typing.rec(regexT).flags.includes("g")) result = this.execOf(regexT, type as UnionType, re, s);
    else if (name === "match") {
      const out = this.alloca(ARRAY);
      const found = call(this, `i32 @fsh_rt_regex_match_all(ptr ${out}, ptr ${re}, ptr ${s})`);
      const [yes, list] = [this.temp(), this.temp()];
      this.emit(`${yes} = icmp ne i32 ${found}, 0`);
      this.emit(`${list} = load ${ARRAY}, ptr ${out}`);
      const v = this.temp();
      const arrayType2 = this.tables.typing.arrayType("string");
      const line2 = `${v} = select i1 ${yes}, ${this.llvm(type)} ${this.convert(list, arrayType2, type)}, ${this.llvm(type)} ${this.convert("zeroinitializer", "null", type)}`;
      this.emit(line2);
      result = v;
    } else if (name === "split") {
      const out = this.alloca(ARRAY);
      const element = this.recOf(this.tables.typing.rec(type as ArrayType).element);
      const tagged = element?.kind === "union";
      const tags = tagged ? [element.members.indexOf("null"), element.members.indexOf("string")] : [0, 0];
      const limit = e.args.length > 1 ? this.value(e.args[1]!) : "-1";
      this.emit(`call void @fsh_rt_regex_split(ptr ${out}, ptr ${re}, ptr ${s}, i64 ${limit}, i32 ${tagged ? 1 : 0}, i32 ${tags[0]!}, i32 ${tags[1]!})`);
      result = this.temp();
      this.emit(`${result} = load ${ARRAY}, ptr ${out}`);
    } else result = this.regexLoop(e, name, regexT, re, s, type);
    if (!this.cur().types.has(e) && this.needsDrop(type)) this.pending.push({ v: result, type });
    return result;
  }


  // matchAll and replace, which go through the matches one at a time: matchAll builds each
  // into an array, replace puts what replaces each, from a pattern or a function, between the
  // text around them.
  regexLoop(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>, name: string, regexT: RegexType, re: string, s: string, type: Type): string {
    // A regex whose flags aren't known here says in its program whether it is global.
    const global = name === "matchAll" || this.tables.typing.rec(regexT).flags.includes("g") ? 1 : this.tables.typing.rec(regexT).any === true ? -1 : 0;
    const it = this.temp();
    this.emit(`${it} = call ptr @fsh_rt_regex_iter(ptr ${re}, ptr ${s}, i32 ${global})`);
    const given = (e.args.length > 1 ? e.args[1]! : undefined);
    const callback = given?.kind === "arrow" ? given : undefined;
    const closure = (callback !== undefined ? (this.cur().types.get(callback) as ClosureType) : undefined);
    const env = callback !== undefined ? this.alloca(this.llvm(closure!)) : "";
    if (callback !== undefined) {
      const line = `store ${this.llvm(closure!)} ${this.owned(callback)}, ptr ${env}`;
      this.emit(line);
    }
    const pattern = name.startsWith("replace") && callback === undefined ? this.value(given!) : undefined;
    const list = name === "matchAll" ? this.alloca(ARRAY) : undefined;
    if ((list !== undefined && list !== "")) this.emit(`store ${ARRAY} zeroinitializer, ptr ${list}`);
    const [head, body, done] = [this.label(), this.label(), this.label()];
    this.emit(`br label %${head}`);
    this.startBlock(head);
    const more = this.temp();
    this.emit(`${more} = call i32 @fsh_rt_regex_next(ptr ${it})`);
    const yes = this.temp();
    this.emit(`${yes} = icmp ne i32 ${more}, 0`);
    this.emit(`br i1 ${yes}, label %${body}, label %${done}`);
    this.startBlock(body);
    const slots = this.temp();
    this.emit(`${slots} = call ptr @fsh_rt_regex_slots(ptr ${it})`);
    if ((list !== undefined && list !== "")) {
      const matchValue2 = this.matchValue(regexT, this.tables.typing.rec(type as ArrayType).element as ObjectType, s, slots);
      this.appended(list, this.tables.typing.rec(type as ArrayType).element, matchValue2);
    }
    else if ((pattern !== undefined && pattern !== "")) this.emit(`call void @fsh_rt_regex_put_pattern(ptr ${it}, ptr ${pattern})`);
    else {
      const target = this.callOf(callback!)!;
      const match = this.tables.typing.matchType(regexT);
      const whole = this.matchValue(regexT, match, s, slots);
      const parts = this.tables.typing.elementsOf(match);
      const groups = this.tables.typing.field(match, "groups");
      const kept = groups !== undefined ? this.alloca(this.llvm(groups.type)) : undefined;
      const passed = this.tables.typing.rec(closure!).params.map((p, i) => {
        if (i < parts.length) {
          const part = this.temp();
          this.emit(`${part} = extractvalue ${this.llvm(match)} ${whole}, ${this.tables.typing.rec(match).fields.findIndex((f) => f.name === String(i))}`);
          const copied2 = this.copied(part, parts[i]!);
          return `${this.llvm(p)} ${this.convert(copied2, parts[i]!, p)}`;
        }
        if (i === parts.length) {
          const index = this.temp();
          this.emit(`${index} = extractvalue ${this.llvm(match)} ${whole}, ${this.tables.typing.rec(match).fields.findIndex((f) => f.name === "index")}`);
          return `i64 ${index}`;
        }
        if (i === parts.length + 1) return `ptr ${this.copied(s, "string")}`;
        const g = this.temp();
        this.emit(`${g} = extractvalue ${this.llvm(match)} ${whole}, ${this.tables.typing.rec(match).fields.findIndex((f) => f.name === "groups")}`);
        this.emit(`store ${this.llvm(groups!.type)} ${g}, ptr ${kept}`);
        return `ptr ${kept}`;
      });
      // The match is read back from a slot in the landing pad: at -O0 a value carried in
      // registers into one may be lost.
      const stash = this.alloca(this.llvm(match));
      this.emit(`store ${this.llvm(match)} ${whole}, ptr ${stash}`);
      const unwound = (cg: Mut<Codegen>) => {
        const held = cg.temp();
        cg.emit(`${held} = load ${cg.llvm(match)}, ptr ${stash}`);
        cg.dispose(held, match);
        cg.emit(`call void @fsh_rt_regex_close(ptr ${it})`);
        if (cg.needsDrop(closure!)) {
          const unstash2 = cg.unstash(env, closure!);
          cg.dispose(unstash2, closure!);
        }
      };
      const slice2 = passed.slice(0, this.bodyAt(target).params.length);
      const gives = this.invoke(target, env, slice2, exprKey(e), undefined, unwound)!;
      const text = this.convert(gives, this.tables.typing.rec(closure!).returns, "string");
      this.emit(`call void @fsh_rt_regex_put(ptr ${it}, ptr ${text})`);
      this.dispose(text, "string");
      this.dispose(whole, match);
    }
    this.emit(`br label %${head}`);
    this.startBlock(done);
    if (callback !== undefined && this.needsDrop(closure!)) {
      const unstash3 = this.unstash(env, closure!);
      this.dispose(unstash3, closure!);
    }
    if ((list !== undefined && list !== "")) {
      this.emit(`call void @fsh_rt_regex_close(ptr ${it})`);
      const v = this.temp();
      this.emit(`${v} = load ${ARRAY}, ptr ${list}`);
      return v;
    }
    const made = this.temp();
    this.emit(`${made} = call ptr @fsh_rt_regex_finish(ptr ${it})`);
    return made;
  }


  // A regex is a pointer to its compiled program, one constant per pattern and flags.
  /** @throws {RegexSyntaxError} */
  regex(this: Mut<this>, t: RegexType): string {
    const key = `${this.tables.typing.rec(t).flags}/${this.tables.typing.rec(t).pattern}`;
    const made = this.regexes.get(key);
    if ((made !== undefined && made !== "")) return made;
    const program = compileRegex(parsePattern(this.tables.typing.rec(t).pattern, this.tables.typing.rec(t).flags, this.tables.regex), this.tables.regex);
    const name = `@.regex.${this.stableId("regex", key)}`;
    this.globals.push(`${name} = private unnamed_addr constant [${program.length} x i32] [${program.map((w) => `i32 ${w | 0}`).join(", ")}]`);
    this.regexes.set(key, name);
    return name;
  }


  // A bigint known while compiling, as a constant the runtime never counts or frees.
  bigConstant(this: Mut<this>, value: bigint): string {
    const key = String(value);
    const made = this.bigConstants.get(`${value}`);
    if ((made !== undefined && made !== "")) return made;
    let limbs: bigint[] = [];
    for (let m = value < 0n ? -value : value; m > 0n; m >>= 32n) limbs.push(m & 0xffffffffn);
    const name = `@.bigint.${this.stableId("bigint constant", key, key)}`;
    this.bigConstants.set(`${value}`, name);
    const words = limbs.length === 0 ? "i32 0" : limbs.map((l) => `i32 ${BigInt.asIntN(32, l)}`).join(", ");
    this.globals.push(`${name} = private unnamed_addr constant { i64, i32, i64, [${Math.max(limbs.length, 1)} x i32] } { i64 -1, i32 ${value < 0n ? 1 : 0}, i64 ${limbs.length}, [${Math.max(limbs.length, 1)} x i32] [${words}] }`);
    return name;
  }


  text(this: Mut<this>, value: string): string {
    const made = this.texts.get(value);
    if ((made !== undefined && made !== "")) return made;
    const bytes = wtf8(value);
    let lit = "";
    for (const b of bytes) {
      const plain = b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
      lit += plain ? String.fromCharCode(b as u16) : "\\" + hexByte(b as usize);
    }
    const name = `@.text.${this.stableId("text constant", lit, value)}`;
    this.texts.set(value, name);
    this.globals.push(`${name}.bytes = private unnamed_addr constant [${bytes.length} x i8] c"${lit}"`);
    // Non-ASCII text longer than one breadcrumb's stride gets its breadcrumbs, as the runtime
    // would make them.
    const crumbs = bytes.length !== value.length && value.length > STRIDE ? breadcrumbs(value) : undefined;
    if (crumbs !== undefined) this.globals.push(`${name}.crumbs = private unnamed_addr constant [${crumbs.length} x i64] [${crumbs.map((c) => `i64 ${c}`).join(", ")}]`);
    this.globals.push(`${name} = private unnamed_addr constant { i64, i64, ptr, ptr, i64, ptr } { i64 -1, i64 ${bytes.length}, ptr ${name}.bytes, ptr null, i64 ${value.length}, ptr ${crumbs !== undefined ? `${name}.crumbs` : "null"} }`);
    return name;
  }


  cString(this: Mut<this>, s: string): string {
    const bytes = new TextEncoder().encode(s + "\0");
    let lit = "";
    for (const b of bytes) {
      const plain = b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
      lit += plain ? String.fromCharCode(b as u16) : "\\" + hexByte(b as usize);
    }
    // Keyed by its bytes, which two strings with lone surrogates may share.
    const made = this.cStrings.get(lit);
    if ((made !== undefined && made !== "")) return made;
    const name = `@.str.${this.stableId("str", lit)}`;
    this.cStrings.set(lit, name);
    this.globals.push(`${name} = private unnamed_addr constant [${bytes.length} x i8] c"${lit}"`);
    return name;
  }
}

// The LLVM IR of a checked program.
/** @throws {CompileError} */
export function codegen(checked: Checked, options: Options): string {
  return new Codegen(checked, options).module();
}

// The runtime's breadcrumb stride, in UTF-16 units.
const STRIDE: usize = 64;

// Where every STRIDE-th UTF-16 unit of a string is: its character's byte offset times two,
// plus one when the unit is a pair's second half.
function breadcrumbs(text: string): usize[] {
  let crumbs: usize[] = [];
  let at = 0;
  for (let unit = 0; unit < text.length; unit++) {
    const c = text.charCodeAt(unit);
    const second = c >= 0xdc00 && c < 0xe000 && unit > 0 && text.charCodeAt(unit - 1) >= 0xd800 && text.charCodeAt(unit - 1) < 0xdc00;
    if (unit % STRIDE === 0) crumbs.push((at * 2 + (second ? 1 : 0)) as usize);
    const paired = c >= 0xd800 && c < 0xdc00 && text.charCodeAt(unit + 1) >= 0xdc00 && text.charCodeAt(unit + 1) < 0xe000;
    if (!paired) at += second ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return crumbs;
}

// A string's WTF-8 bytes: UTF-8, with a lone surrogate in its 3-byte form.
function wtf8(text: string): u8[] {
  let out: u8[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i) as u32;
    const next = text.charCodeAt(i + 1);
    if (c >= 0xd800 && c < 0xdc00 && next >= 0xdc00 && next < 0xe000) {
      c = 0x10000 + ((c - 0xd800) << 10) + ((next as u32) - 0xdc00);
      i++;
    }
    if (c < 0x80) out.push(c as u8);
    else if (c < 0x800) {
      out.push((0xc0 | (c >> 6)) as u8);
      out.push((0x80 | (c & 63)) as u8);
    } else if (c < 0x10000) {
      out.push((0xe0 | (c >> 12)) as u8);
      out.push((0x80 | ((c >> 6) & 63)) as u8);
      out.push((0x80 | (c & 63)) as u8);
    } else {
      out.push((0xf0 | (c >> 18)) as u8);
      out.push((0x80 | ((c >> 12) & 63)) as u8);
      out.push((0x80 | ((c >> 6) & 63)) as u8);
      out.push((0x80 | (c & 63)) as u8);
    }
  }
  return out;
}
