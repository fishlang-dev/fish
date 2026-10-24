import { selfCalls, selfOf, type Checked, type Instance, type Local, type Type } from "./check.ts";
import { computed, dynCalls, dynMembers, fixedFills, isPrint, lengthChecks, MATH_CONSTANTS, MATH_FLOAT, maths, parses, fixedPrints, type DynTable } from "./values.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { lowering } from "./arithmetic.ts";
import { CompileError, locate, sourceOf, type Source } from "./diag.ts";
import { comptimeBlock, comptimeBody, comptimeParameter, comptimeValue, memberOf, untagged, type Value } from "./comptime.ts";
import { print, RUNTIME, write } from "./runtime.ts";
import type { BinaryOp, Expr, ObjectProp, Param, Pattern, Span, Stmt } from "./parser.ts";
import { ARRAY, DYN, conversions, llvm } from "./layout.ts";
import { made, type PatternInfo } from "./match.ts";
import { allFields, arrayType, elementsOf, type ClosureType, type FixedType, type RefType, lower, show, field, fieldPath, handleType, holdsPart, sharesDyn, INTEGERS, isCopy, nextResult, SLEEP, unionType, YIELD_NOW, type ArrayType, type MapType, type FutureType, type HandleType, type GeneratorType, type InteriorType, type PointerType, type SharedType, type BlockType, type DynType, type Method, type Field, keyOf, promiseElement, lentPromise, stored as storedType, blockType, interiorType, leafOf, isFloat, isInteger, isOption, type ClassType, type Integer, type Numeric, type ObjectType, type UnionType } from "./typing.ts";

const isRef = (t: Type) => typeof t !== "string" && t.kind === "ref";

const isArray = (t: Type): t is ArrayType => typeof t !== "string" && t.kind === "array";
// Whether indexing a value reads an element: an array's, or a fixed array's, through a
// reference too.
const indexes = (t: Type): boolean => {
  const held = typeof t !== "string" && t.kind === "ref" ? t.to : t;
  return typeof held !== "string" && (held.kind === "array" || held.kind === "fixed");
};

// What a reference points to, or the type itself.
const isDyn = (t: Type): t is DynType => typeof t !== "string" && t.kind === "dyn";
const referent = (t: Type): Type => (typeof t !== "string" && t.kind === "ref" ? t.to : t);

const COMPARISON: Partial<Record<BinaryOp, string>> = {
  "===": "eq", "!==": "ne", "<": "slt", "<=": "sle", ">": "sgt", ">=": "sge",
};

// Float comparisons are false for NaN, except `!==`, as in JavaScript.
const FLOAT_COMPARISON: Partial<Record<BinaryOp, string>> = {
  "===": "oeq", "!==": "une", "<": "olt", "<=": "ole", ">": "ogt", ">=": "oge",
};

const FLOAT_ARITHMETIC: Partial<Record<BinaryOp, string>> = { "+": "fadd", "-": "fsub", "*": "fmul", "/": "fdiv", "%": "frem" };

// Every function has unwind tables, and when panics unwind, the C personality, whose cleanups
// run a panic's drops.
const UNWINDS = "uwtable personality ptr @__gcc_personality_v0";

// A float constant as LLVM writes one exactly: the bits of the double holding it, which for
// an f32 must be a float's value.
function floatConstant(value: number, type: "f32" | "f64"): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, type === "f32" ? Math.fround(value) : value);
  return `0x${view.getBigUint64(0).toString(16).toUpperCase().padStart(16, "0")}`;
}

// An instance's name in the IR. A generic class's instance is named by its type arguments,
// which may hold quotes, so those are escaped as LLVM spells them.
const symbol = (i: Instance) => (i.body.foreign ? `@"${i.body.name}"` : `@"fsh.${i.symbol.replace(/["\\]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()}`)}"`);

// The Math functions LLVM has intrinsics for; the other float ones are libm's.
const MATH_INTRINSICS = new Set(["floor", "ceil", "trunc", "sqrt", "exp", "log", "log2", "log10", "sin", "cos", "pow"]);

// The C functions the runtime prelude already declares, which a `declare function` reuses.
const DECLARED = new Set(RUNTIME.flatMap((line) => /^declare [^@]*@([\w.]+)\(/.exec(line)?.[1] ?? []));

// How a narrow value crosses to C, which expects it widened by its caller: a boolean, a byte
// holding 0 or 1, and unsigned integers zero-extended, signed ones sign-extended.
const extension = (type: Type) => (type === "boolean" || type === "u8" || type === "u16" ? "zeroext" : type === "i8" || type === "i16" ? "signext" : "");
const crossing = (type: Type) => [llvm(type), extension(type)].filter(Boolean).join(" ");
const crossed = (type: Type) => [extension(type), llvm(type)].filter(Boolean).join(" ");

// A library has no C `main`; each export gets a C function under its own name instead.
// `sources` holds the program's files other than the entry, for panic locations.
export type Options = { src: string; file: string; release: boolean; panic: "unwind" | "abort"; library?: boolean; sources?: Source[] };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
export function codegen({ instances }: Checked, { src, file, release, panic, library = false, sources = [] }: Options): string {
  const unwinds = panic === "abort" ? "uwtable" : UNWINDS;
  const globals: string[] = [];
  const out: string[] = [];
  // Allocas go in the entry block, where mem2reg promotes them and loops don't grow the stack.
  let allocas: string[] = [];
  let body: string[] = [];
  let temps = 0;
  let labels = 0;
  // The label of the block being emitted into, which a phi names as its predecessor.
  let block = "entry";
  // The instance being emitted, and the tables its checking produced.
  let current = instances[0]!;
  let { types, locals, calls, setters, coercions, jumps } = current;
  // The class of the constructor or method being emitted, whose instance `%this` points to.
  let self: ClassType | undefined;
  // In a closure, where each variable it captures lives, loaded from its environment.
  let captured = new Map<Local, string>();
  // The value of an Option an optional chain's link has already evaluated, to read through.
  const known = new Map<Expr, string>();
  // The catch blocks enclosing the code being emitted, innermost last: where each starts, and
  // the slot its error goes in.
  const handlers: { label: string; slot: string; depth: number; floor: number }[] = [];
  // The `finally` regions enclosing the code being emitted, innermost last.
  const finallies: Region[] = [];
  // Where a `break` and a `continue` go for each statement they can name.
  const exits = new Map<Stmt, { exit: string; next?: string; depth: number }>();
  // Values the statement being emitted made and nothing took over, released when it ends.
  // Each keeps a slot it is stored in across a call that may panic, for its landing pad.
  let pending: { v: string; type: Type; slot?: string }[] = [];
  // Where the statement being lowered starts in `pending`: a statement in a match arm's block
  // runs inside an expression whose own values are pending below it.
  let floor = 0;
  // The scopes matches and pipes open for themselves.
  const transient = new WeakSet<object>();
  // The slot each C string in a loop's condition or update was given when the loop began.
  const reserved = new Map<Expr, string>();
  // The generator being emitted: its type, its frame's LLVM type, the block each `yield`
  // resumes at in order, where it starts, and where it gives that it has finished.
  let resuming: { type: GeneratorType | FutureType; frame: string; resumes: string[]; start: string; done: string } | undefined;
  // Slots that are fields of a generator's frame: they outlive one `next()` and start empty.
  let framed = new Set<string>();
  // Where a `return` in each match arm's block puts the value it gives, when the match gives one.
  const arms = new Map<Stmt, { slot: string; type: Type } | undefined>();
  // What each enclosing scope owns, outermost first, dropped as it ends or is left.
  let scopes: { slot: string; type: Type }[][] = [];
  // Receivers copied into slots for owning methods, whose leftovers drop after the call.
  const spills: { slot: string; type: Type; copy: { v: string; type: Type } }[] = [];
  // The index values an assignment ran ahead of its value, by index expression.
  const fixed = new Map<Expr, string>();
  // Each literal's string block, made once.
  const texts = new Map<string, string>();
  // The function dropping, or copying, what a value of each type owns, made once.
  const glue = { drop: new Map<Type, string>(), copy: new Map<Type, string>() };
  // The global each top-level const holding an aggregate lives in.
  const constantGlobals = new Map<Instance, string>();
  // Whether the one thunk copying a Dyn that can't be copied is made.
  let uncopyable = false;
  const elementDrops = new Map<Type, string>();
  const vtables = new Map<string, string>();
  // The functions `sort` compares through: one per comparator, and one per element type for the
  // default order.
  const orders = new Map<string, string>();
  let comparators = 0;
  const builder = { emit, temp, label, startBlock, cString, alloca, text, mayPanic: (call: string) => unwinding(call) };
  const intrinsics = new Set<string>();
  // The C functions the program declares itself, which the libm functions Math uses may be.
  const foreign = new Set<string>();
  const { operate, arithmetic, panicIf } = lowering(builder, where, release, intrinsics);
  const { convert, test, equals, unionField, holds } = conversions(builder);

  // The instance each generator type resumes, and each future type polls.
  const generatorOf = new Map(instances.flatMap((i) => (i.generator ? [[i.generator, i] as const] : [])));
  const futureOf = new Map(instances.flatMap((i) => (i.future ? [[i.future, i] as const] : [])));
  // The future types whose task glue is made.
  const glued = new Set<FutureType>();

  // Top-level consts and comptime blocks run while compiling, every one of them, so one that
  // fails is reported even when nothing reads it; none is compiled.
  for (const instance of instances) {
    if (!instance.body.comptime || !instance.concrete) continue;
    if (instance.body.comptime === "const") bakeable(instance.returns, instance.body, true);
    comptimeBody(instance);
  }

  for (const instance of instances) {
    if (instance.body.comptime) continue;
    // A C function is declared under its own name, unless the runtime already declares it.
    if (instance.body.foreign) {
      const returns = crossed(instance.returns);
      foreign.add(instance.body.name);
      if (!DECLARED.has(instance.body.name)) out.push(`declare ${returns} ${symbol(instance)}(${instance.signature!.map(crossing).join(", ")})`, "");
      continue;
    }
    current = instance;
    ({ types, locals, calls, setters, coercions, jumps } = instance);
    const f = instance.body;
    self = f.self?.type;
    allocas = [];
    body = [];
    temps = 0;
    labels = 0;
    block = "entry";
    pending = [];
    floor = 0;
    reserved.clear();
    scopes = [[]];
    const type = instance.returns;
    framed = new Set();
    const machine = instance.generator ?? instance.future;
    resuming = machine && { type: machine, frame: llvm(machine), resumes: [], start: label(), done: label() };
    // A generator's variables, and its loops' state, are fields of the frame each `next()` is
    // given, which already holds its parameters.
    if (resuming) {
      const field = (at: string, i: number) => {
        allocas.push(`  ${at} = getelementptr ${resuming!.frame}, ptr %frame, i32 0, i32 ${i}`);
        framed.add(at);
      };
      field("%state", 0);
      // An async arrow's captures are its frame's copy of the closure; an async method's object is
      // borrowed through its frame, or held in it under `Own<this>`.
      if (f.closure) {
        field("%env", 1);
        // Its copy of the captures is the future's own, dropped once the body is done.
        own("%env", instance.closure!);
      }
      if (f.self && !f.self.constructor) {
        if (f.self.owned) field("%this", 1);
        else allocas.push(`  %this.at = getelementptr ${resuming.frame}, ptr %frame, i32 0, i32 1`, "  %this = load ptr, ptr %this.at");
      }
      for (const [local, i] of instance.frame!.locals) field(slot(local), i);
      for (const i of instance.frame!.loops.values()) [i, i + 1].forEach((j) => field(`%loop.${j}`, j));
      for (const i of instance.frame!.awaits.values()) field(`%await.${i}`, i);
      startBlock(resuming.start);
    }
    // Parameters are copied into slots like any other binding.
    const params = f.params.flatMap((p) => {
      const local = resolved(p);
      reserve(local);
      own(slot(local), local.type);
      if (resuming) return [""];
      // A comptime parameter isn't passed: its instance knows its value.
      if (p.comptime) return void emit(`store ${llvm(local.type)} ${bake(comptimeParameter(instance, p), local.type)}, ptr ${slot(local)}`), [];
      emit(`store ${llvm(local.type)} %"${local.name}.arg", ptr ${slot(local)}`);
      return [`${llvm(local.type)} %"${local.name}.arg"`];
    });
    // A constructor or method works on its instance through a pointer, and a closure on what
    // it captured.
    if (f.self) params.unshift("ptr %this");
    if (f.closure) params.unshift("ptr %env");
    // A method owning its object drops it, unless the object moves out first.
    if (f.self?.owned) own("%this", f.self.type, false);
    captured = new Map();
    // A capture the closure holds lives in its environment; a borrowed one, where it points.
    [...(instance.captures ?? [])].forEach(([alias, from], i) => {
      const at = temp();
      // In a future the entry block is the only one every poll passes through.
      const line = `${at} = getelementptr ${llvm(instance.closure!)}, ptr %env, i32 0, i32 ${i}`;
      if (resuming) allocas.push(`  ${line}`);
      else emit(line);
      if (!isRef(instance.closure!.fields[i]!.type)) return captured.set(alias, at);
      const pointer = from === "this" ? "%this" : temp();
      const load = `${pointer} = load ptr, ptr ${at}`;
      if (resuming) allocas.push(`  ${load}`);
      else emit(load);
      captured.set(alias, pointer);
    });
    if (f.closure) self = selfOf(f)?.type;
    f.body.forEach(statement);
    // The last block is unreachable when every path returned; the checker guarantees it for values.
    if (type === "void" || resuming) leave(undefined);
    else emit("unreachable");
    if (resuming) {
      // Each `next()` or poll goes on from where the last stopped: the start, a `yield` or an
      // `await`, or the end. A finished future is never polled again.
      startBlock(resuming.done);
      if (resuming.type.kind === "generator") emit(`ret ${resultType(instance)} ${answer(undefined, resuming.type.yields)}`);
      else emit("unreachable");
      const resumes = [resuming.start, ...resuming.resumes].map((at, i) => `i32 ${i}, label %${at}`).join(" ");
      allocas.push("  %resumed = load i32, ptr %state", `  switch i32 %resumed, label %${resuming.done} [ ${resumes} ]`);
      const takes = resuming.type.kind === "future" ? "ptr %frame, ptr %cx" : "ptr %frame";
      out.push(`define internal ${resultType(instance)} ${symbol(instance)}(${takes}) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
      continue;
    }
    // Fish's own functions stay inside this module, so two libraries never clash over them.
    out.push(`define internal ${resultType(instance)} ${symbol(instance)}(${params.join(", ")}) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
  }
  const main = instances.find((i) => i.symbol === "main")!;
  // Built before the module is put together, since its message adds a global.
  const start = library ? instances.filter((i) => i.body.exported).flatMap(exported) : entry();
  const filled = fillConstants();

  return [
    ...globals,
    // The runtime reads which way a panic goes. A library leaves it to the runtime's default, so
    // two libraries in one program don't both define it; its exports abort on a panic anyway.
    ...(library ? [] : [`@fsh_panic_abort = constant i32 ${panic === "abort" ? 1 : 0}`]),
    "",
    ...RUNTIME,
    ...[...intrinsics].filter((line) => !foreign.has(/@([\w.]+)\(/.exec(line)![1]!)),
    "",
    ...out,
    ...start,
    ...filled,
    "",
  ].join("\n");

  // A top-level const holding an aggregate lives in a global, filled once before main runs (or
  // as a library loads) and only ever read; its arrays and strings are never freed.
  function constantGlobal(c: Instance): string {
    const made = constantGlobals.get(c);
    if (made) return made;
    const name = `@"fsh.const.${c.body.name.slice("const ".length)}"`;
    constantGlobals.set(c, name);
    globals.push(`${name} = internal global ${llvm(c.returns)} zeroinitializer`);
    return name;
  }

  // The globals are filled before main; the runtime drops them at exit, before its leak check.
  function fillConstants(): string[] {
    if (constantGlobals.size === 0) return [];
    const made = (name: string, fill: () => void) => {
      const saved = { allocas, body, temps, labels, block, pending, scopes };
      [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
      fill();
      emit("ret void");
      const lines = [`define internal void ${name}() {`, "entry:", ...allocas, ...body, "}", ""];
      ({ allocas, body, temps, labels, block, pending, scopes } = saved);
      return lines;
    };
    const filler = made('@"fsh.constants"', () => {
      for (const [c, name] of constantGlobals) emit(`store ${llvm(c.returns)} ${bake(comptimeBody(c), c.returns)}, ptr ${name}`);
      emit('call void @fsh_rt_constants(ptr @"fsh.constants.drop")');
    });
    const dropper = made('@"fsh.constants.drop"', () => {
      for (const [c, name] of constantGlobals) {
        const v = temp();
        emit(`${v} = load ${llvm(c.returns)}, ptr ${name}`);
        dispose(v, c.returns);
      }
    });
    return [...filler, ...dropper, '@llvm.global_ctors = appending global [1 x { i32, ptr, ptr }] [{ i32, ptr, ptr } { i32 65535, ptr @"fsh.constants", ptr null }]'];
  }

  // Comptime gives what can be built into the program: numbers, booleans, strings, and arrays,
  // objects, instances, unions and enums of them; a top-level const may also hold an Atomic or
  // a Lock.
  function bakeable(type: Type, at: Span, constant = false) {
    // The first part of a type comptime can't make, or undefined.
    const fault = (t: Type): Type | undefined => {
      if (typeof t === "string") return t === "void" ? t : undefined;
      if (t.kind === "literal") return undefined;
      const parts = t.kind === "union" ? t.members : t.kind === "array" ? [t.element] : t.kind === "object" || t.kind === "variant" ? t.fields.map((f) => f.type)
        : t.kind === "class" ? [...(t.base ? [t.base] : []), ...t.fields.map((f) => f.type)] : t.kind === "interior" && constant && t.which !== "Cell" ? [t.of] : undefined;
      if (!parts) return t;
      for (const p of parts) {
        const found = fault(p);
        if (found) return found;
      }
      return undefined;
    };
    const part = fault(type);
    if (!part) return;
    const inside = part === type ? "" : ` (in '${show(type)}')`;
    const what = isRef(type) ? "a top-level const is already computed while compiling; read it without 'comptime'" : `'${show(part)}'${inside} can't be computed while compiling: comptime makes numbers, booleans, strings, and arrays, objects, instances, unions and enums of them`;
    throw new CompileError(what, at.start, at.end);
  }

  // Rust's `as`: integers truncate or extend by the source's signedness, floats round toward
  // zero into integers, saturating with NaN as 0, and widen or narrow between themselves.
  function cast(v: string, from: Type, to: Numeric): string {
    if (from === to || llvm(from) === llvm(to) && isInteger(from) && isInteger(to)) return v;
    const result = temp();
    const [a, b] = [llvm(from), llvm(to)];
    if (from === "boolean") emit(`${result} = zext i1 ${v} to ${b}`);
    else if (isInteger(from) && isInteger(to)) {
      const [wide, narrow] = [INTEGERS[from].bits, INTEGERS[to].bits];
      emit(`${result} = ${narrow < wide ? "trunc" : INTEGERS[from].signed ? "sext" : "zext"} ${a} ${v} to ${b}`);
    } else if (isInteger(from)) emit(`${result} = ${INTEGERS[from].signed ? "sitofp" : "uitofp"} ${a} ${v} to ${b}`);
    else if (isInteger(to)) {
      const intrinsic = `@llvm.fpto${INTEGERS[to].signed ? "s" : "u"}i.sat.${b}.${a === "double" ? "f64" : "f32"}`;
      intrinsics.add(`declare ${b} ${intrinsic}(${a})`);
      emit(`${result} = call ${b} ${intrinsic}(${a} ${v})`);
    } else emit(`${result} = ${to === "f64" ? "fpext" : "fptrunc"} ${a} ${v} to ${b}`);
    return result;
  }

  // A binary operator on numbers: floats never overflow, and integers are checked as Rust's are.
  function numeric(op: BinaryOp, a: string, b: string, at: Expr, type: Type): string {
    if (!isFloat(type)) return operate(op, a, b, at, type as Integer);
    const result = temp();
    if (op === "**") {
      const intrinsic = `@llvm.pow.${type}`;
      intrinsics.add(`declare ${llvm(type)} ${intrinsic}(${llvm(type)}, ${llvm(type)})`);
      emit(`${result} = call ${llvm(type)} ${intrinsic}(${llvm(type)} ${a}, ${llvm(type)} ${b})`);
      return result;
    }
    emit(`${result} = ${FLOAT_ARITHMETIC[op]} ${llvm(type)} ${a}, ${b}`);
    return result;
  }

  // `Math` on f64 lowers to LLVM's intrinsics or to libm; `abs`, `sign`, `min` and `max` keep
  // their numeric type, a float `min` or `max` giving NaN for any NaN and telling -0 from 0, as
  // JavaScript does.
  function mathCall(e: Extract<Expr, { kind: "call" }>): string {
    const name = (e.callee as Extract<Expr, { kind: "member" }>).name;
    const type = types.get(e) as Numeric;
    const t = llvm(type);
    const args = e.args.map((a) => value(a));
    const r = () => temp();
    const call = (fn: string, xs: string[], of = t) => {
      const result = r();
      intrinsics.add(`declare ${of} ${fn}(${xs.map(() => of).join(", ")})`);
      emit(`${result} = call ${of} ${fn}(${xs.map((x) => `${of} ${x}`).join(", ")})`);
      return result;
    };
    const op = (line: string) => {
      const result = r();
      emit(`${result} = ${line}`);
      return result;
    };
    if (MATH_INTRINSICS.has(name)) return call(`@llvm.${name}.f64`, args);
    if (name in MATH_FLOAT && name !== "round") return call(`@${name}`, args);
    const [x] = args as [string];
    const float = isFloat(type);
    const number = (n: number) => (float ? floatConstant(n, type) : String(n));
    if (name === "round") {
      const down = call("@llvm.floor.f64", [x]);
      const up = op(`fcmp oge double ${op(`fsub double ${x}, ${down}`)}, ${floatConstant(0.5, "f64")}`);
      const rounded = op(`select i1 ${up}, double ${op(`fadd double ${down}, ${floatConstant(1, "f64")}`)}, double ${down}`);
      return call("@llvm.copysign.f64", [rounded, x]);
    }
    const signed = !float && INTEGERS[type as Integer].signed;
    const less = float ? "fcmp olt" : signed ? "icmp slt" : "icmp ult";
    const more = float ? "fcmp ogt" : signed ? "icmp sgt" : "icmp ugt";
    if (name === "abs") {
      if (float) return call(`@llvm.fabs.${type}`, [x]);
      if (!signed) return x;
      const negative = op(`icmp slt ${t} ${x}, 0`);
      const [neg, done, start] = [label(), label(), block];
      emit(`br i1 ${negative}, label %${neg}, label %${done}`);
      startBlock(neg);
      const negated = arithmetic("-", "0", x, e, type as Integer, "negate");
      const from = block;
      emit(`br label %${done}`);
      startBlock(done);
      return op(`phi ${t} [ ${x}, %${start} ], [ ${negated}, %${from} ]`);
    }
    if (name === "sign") {
      const zero = float ? x : "0";
      const below = op(`select i1 ${op(`${less} ${t} ${x}, ${number(0)}`)}, ${t} ${signed || float ? number(-1) : "0"}, ${t} ${zero}`);
      return op(`select i1 ${op(`${more} ${t} ${x}, ${number(0)}`)}, ${t} ${number(1)}, ${t} ${below}`);
    }
    const better = name === "min" ? less : more;
    return args.reduce((a, b) => {
      const pick = op(`select i1 ${op(`${better} ${t} ${a}, ${b}`)}, ${t} ${a}, ${t} ${b}`);
      if (!float) return pick;
      const bits = type === "f32" ? "i32" : "i64";
      const joined = op(`${name === "min" ? "or" : "and"} ${bits} ${op(`bitcast ${t} ${a} to ${bits}`)}, ${op(`bitcast ${t} ${b} to ${bits}`)}`);
      const zeros = op(`select i1 ${op(`fcmp oeq ${t} ${a}, ${b}`)}, ${t} ${op(`bitcast ${bits} ${joined} to ${t}`)}, ${t} ${pick}`);
      return op(`select i1 ${op(`fcmp uno ${t} ${a}, ${a}`)}, ${t} ${a}, ${t} ${zeros}`);
    });
  }

  // `x.toFixed(digits)`: a float from its exact value, an integer exactly; digits past 100
  // panic, as JavaScript throws a RangeError.
  function toFixed(e: Extract<Expr, { kind: "call" }>): string {
    const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
    const type = lower(valueType(object)) as Numeric;
    const x = value(object);
    const digits = e.args[0] ? value(e.args[0]) : "0";
    if (e.args[0]) panicIf(op(`icmp ugt i64 ${digits}, 100`), "toFixed() digits argument must be between 0 and 100", e.args[0]);
    const result = temp();
    if (isFloat(type)) {
      const wide = type === "f32" ? op(`fpext float ${x} to double`) : x;
      emit(`${result} = call ptr @fsh_rt_to_fixed(double ${wide}, i64 ${digits})`);
    } else {
      const { signed, bits } = INTEGERS[type as Integer];
      const wide = bits === 64 ? x : op(`${signed ? "sext" : "zext"} ${llvm(type)} ${x} to i64`);
      emit(`${result} = call ptr @fsh_rt_int_to_fixed(i64 ${wide}, i32 ${signed ? 1 : 0}, i64 ${digits})`);
    }
    if (!types.has(e)) pending.push({ v: result, type: "string" });
    return result;

    function op(line: string) {
      const v = temp();
      emit(`${v} = ${line}`);
      return v;
    }
  }

  // A number parsed by the runtime, or null where JavaScript would give NaN.
  function parseCall(e: Extract<Expr, { kind: "call" }>, name: "parseInt" | "parseFloat" | "Number"): string {
    const number = name === "parseInt" ? "i64" : "f64";
    const s = operand(e.args[0]!, e.args.slice(1));
    const radix = e.args[1] ? value(e.args[1]) : "0";
    const [out, ok, read, found] = [alloca(llvm(number)), temp(), temp(), temp()];
    const args = name === "parseInt" ? `ptr ${s}, i64 ${radix}, ptr ${out}` : `ptr ${s}, ptr ${out}`;
    emit(`${ok} = call i32 @fsh_rt_parse_${name === "Number" ? "number" : name === "parseInt" ? "int" : "float"}(${args})`);
    emit(`${read} = load ${llvm(number)}, ptr ${out}`);
    emit(`${found} = icmp ne i32 ${ok}, 0`);
    const type = types.get(e) ?? unionType([number, "null"]);
    const result = temp();
    emit(`${result} = select i1 ${found}, ${llvm(type)} ${convert(read, number, type)}, ${llvm(type)} ${convert("zeroinitializer", "null", type)}`);
    return result;
  }

  function emit(line: string) {
    body.push(`  ${line}`);
  }

  function alloca(type: string): string {
    const slot = temp();
    allocas.push(`  ${slot} = alloca ${type}`);
    return slot;
  }

  function temp(): string {
    return `%t${temps++}`;
  }

  function label(): string {
    return `L${labels++}`;
  }

  function startBlock(name: string) {
    body.push(`${name}:`);
    block = name;
  }

  // A pipe's hidden topic is named `%`, which an LLVM name can't start with.
  // A loop's condition and update run again after its body, which may leave first: each C
  // string they make gets its slot in the loop's scope up front, so every way out drops it.
  function reserveC(e: Expr | undefined) {
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object" || (node as Expr).kind === "arrow") return;
      const call = node as Expr;
      if (call.kind === "call" && call.callee.kind === "ident" && call.callee.name === "cString" && !calls.has(call) && !reserved.has(call)) {
        const held = alloca(ARRAY);
        allocas.push(`  store ${ARRAY} zeroinitializer, ptr ${held}`);
        scopes.at(-1)!.push({ slot: held, type: arrayType("u8") });
        reserved.set(call, held);
      }
      Object.values(node).forEach(visit);
    };
    visit(e);
  }

  // A scope a match or a pipe opens for itself, which ends with the expression.
  function passing(scope: { slot: string; type: Type }[]) {
    transient.add(scope);
    return scope;
  }

  // A C string's buffer, owned by the enclosing block as an array of bytes it frees at its end;
  // a scope a match or a pipe opens isn't a block. A loop's condition makes one each time round,
  // so the slot drops what it holds first. C would read only up to a NUL inside, so a string
  // holding one can't cross, as Rust's `CString` refuses it.
  function forC(s: string, at: Expr): string {
    const [made, old, refused] = [temp(), temp(), temp()];
    unwinding(`call ptr @fsh_rt_str_cstring(ptr ${s})`, made);
    emit(`${refused} = icmp eq ptr ${made}, null`);
    panicIf(refused, "a string holding NUL can't cross to C, which would read only up to it", at);
    let held = reserved.get(at);
    if (!held) {
      held = alloca(ARRAY);
      allocas.push(`  store ${ARRAY} zeroinitializer, ptr ${held}`);
      scopes.findLast((scope) => !transient.has(scope))!.push({ slot: held, type: arrayType("u8") });
    }
    emit(`${old} = load ${ARRAY}, ptr ${held}`);
    dispose(old, arrayType("u8"));
    const array = temp();
    emit(`${array} = insertvalue ${ARRAY} zeroinitializer, ptr ${made}, 0`);
    emit(`store ${ARRAY} ${array}, ptr ${held}`);
    return made;
  }

  // A raw pointer's method: a load or a store of what it points at, the address `n` elements
  // along, or whether it is null.
  function pointerCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string | undefined {
    const p = valueType(callee.object) as PointerType;
    const at = value(callee.object);
    const result = temp();
    switch (callee.name) {
      case "read":
        emit(`${result} = load ${llvm(p.to)}, ptr ${at}`);
        return result;
      case "write":
        emit(`store ${llvm(p.to)} ${value(e.args[0]!)}, ptr ${at}`);
        return undefined;
      case "offset":
        emit(`${result} = getelementptr ${llvm(p.to)}, ptr ${at}, i64 ${value(e.args[0]!)}`);
        return result;
      default:
        emit(`${result} = icmp eq ptr ${at}, null`);
        return result;
    }
  }

  // A new Atomic, Cell or Lock: what it holds, a boolean widened to a byte in an Atomic, and a
  // Lock's word unlocked.
  function interiorNew(e: Extract<Expr, { kind: "new" }>, t: InteriorType): string {
    const v = owned(e.args![0]!);
    const result = temp();
    if (t.which === "Lock") emit(`${result} = insertvalue ${llvm(t)} { i32 0, ${llvm(t.of)} poison }, ${llvm(t.of)} ${v}, 1`);
    else if (llvm(t) !== llvm(t.of)) emit(`${result} = zext i1 ${v} to i8`);
    else return v;
    return result;
  }

  // An Atomic's method, as one sequentially consistent atomic instruction on where it lives.
  function atomicCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string | undefined {
    const t = referent(valueType(callee.object)) as InteriorType;
    const at = receiver(callee.object);
    if (t.which === "Cell") return cellCall(e, callee, t, at);
    if (t.which === "Lock") return lockUpdate(e, t, at);
    const ty = llvm(t);
    const align = `align ${ty === "i8" ? 1 : ty === "i16" ? 2 : ty === "i32" ? 4 : 8}`;
    const byte = ty !== llvm(t.of);
    const args = e.args.map((a) => {
      const v = value(a);
      if (!byte) return v;
      const wide = temp();
      emit(`${wide} = zext i1 ${v} to i8`);
      return wide;
    });
    const result = temp();
    switch (callee.name) {
      case "load":
        emit(`${result} = load atomic ${ty}, ptr ${at} seq_cst, ${align}`);
        break;
      case "store":
        emit(`store atomic ${ty} ${args[0]}, ptr ${at} seq_cst, ${align}`);
        return undefined;
      case "compareExchange": {
        const pair = temp();
        emit(`${pair} = cmpxchg ptr ${at}, ${ty} ${args[0]}, ${ty} ${args[1]} seq_cst seq_cst`);
        emit(`${result} = extractvalue { ${ty}, i1 } ${pair}, 0`);
        break;
      }
      default: {
        const op = { add: "add", sub: "sub", exchange: "xchg" }[callee.name]!;
        emit(`${result} = atomicrmw ${op} ptr ${at}, ${ty} ${args[0]} seq_cst`);
      }
    }
    if (!byte) return result;
    const narrow = temp();
    emit(`${narrow} = trunc i8 ${result} to i1`);
    return narrow;
  }

  // Gives up a shared value's count; the last drops the value and frees the block.
  function dropShared(t: SharedType) {
    const [last, held, at, value] = [temp(), temp(), temp(), temp()];
    const [free, done] = [label(), label()];
    emit(`${last} = call i32 @fsh_rt_shared_release(ptr %v)`);
    emit(`${held} = icmp ne i32 ${last}, 0`);
    emit(`br i1 ${held}, label %${free}, label %${done}`);
    startBlock(free);
    emit(`${at} = getelementptr ${sharedBlock(t)}, ptr %v, i32 0, i32 1, i32 1`);
    emit(`${value} = load ${llvm(t.of)}, ptr ${at}`);
    dispose(value, t.of);
    emit("call void @fsh_rt_free(ptr %v)");
    emit(`br label %${done}`);
    startBlock(done);
  }

  // Takes a lock word, panicking if this thread already holds it, which would wait forever.
  function takeLock(word: string, at: Span) {
    const [taken, held] = [temp(), temp()];
    emit(`${taken} = call i32 @fsh_rt_lock(ptr ${word})`);
    emit(`${held} = icmp ne i32 ${taken}, 0`);
    panicIf(held, "this lock is already held by an `update` running here; use the value its callback is given", at);
  }

  // A wait's frame given an AbortSignal, its last argument: a count on it goes in the frame.
  function signalled(e: Extract<Expr, { kind: "call" }>, future: FutureType, frame: string): string {
    if (!leafOf.get(future)?.signal) return frame;
    const [handle, next] = [temp(), temp()];
    emit(`${handle} = load ptr, ptr ${value(e.args.at(-1)!)}`);
    emit(`${next} = insertvalue ${llvm(future)} ${frame}, ptr ${copied(handle, blockType("AbortSignal"))}, ${future.frame.length - 2}`);
    return next;
  }

  // A new `AbortError`, its message a literal.
  function abortError(type: Type): string {
    const made = temp();
    emit(`${made} = insertvalue ${llvm(type)} zeroinitializer, ptr ${text("This operation was aborted")}, 0`);
    return made;
  }

  // `c.signal`, another handle to a controller's signal, and `signal.aborted`.
  function blockProperty(e: Extract<Expr, { kind: "member" }>): string {
    const holder = types.get(e.object)!;
    const handle = isRef(holder) ? temp() : value(e.object);
    if (isRef(holder)) emit(`${handle} = load ptr, ptr ${value(e.object)}`);
    if (e.name === "signal") return copied(handle, types.get(e)!);
    if (e.name === "port") {
      const port = temp();
      emit(`${port} = call i64 @fsh_rt_tcp_port(ptr ${handle})`);
      return port;
    }
    const [aborted, yes] = [temp(), temp()];
    emit(`${aborted} = call i32 @fsh_rt_signal_aborted(ptr ${handle})`);
    emit(`${yes} = icmp ne i32 ${aborted}, 0`);
    return yes;
  }

  // `new Semaphore(n)` and `new Channel<T>(capacity)`: a block in the runtime with one count.
  function blockNew(e: Extract<Expr, { kind: "new" }>, t: BlockType): string {
    const made = temp();
    if (t.which === "AbortController") {
      emit(`${made} = call ptr @fsh_rt_signal_new()`);
      return made;
    }
    const n = value(e.args![0]!);
    if (t.which === "Semaphore") {
      const negative = temp();
      emit(`${negative} = icmp slt i64 ${n}, 0`);
      panicIf(negative, "a semaphore's number of slots can't be negative", e);
      emit(`${made} = call ptr @fsh_rt_semaphore_new(i64 ${n})`);
      return made;
    }
    const small = temp();
    emit(`${small} = icmp slt i64 ${n}, 1`);
    panicIf(small, "a channel's capacity must be at least 1", e);
    // The ring is allocated whole, so its size in bytes must fit.
    // ponytail: the ring is allocated up front, grow it on demand if large capacities matter
    const [end, size, wide, most, large] = [temp(), temp(), temp(), temp(), temp()];
    emit(`${end} = getelementptr ${llvm(t.of)}, ptr null, i64 1`);
    emit(`${size} = ptrtoint ptr ${end} to i64`);
    emit(`${wide} = icmp eq i64 ${size}, 0`);
    emit(`${most} = select i1 ${wide}, i64 1, i64 ${size}`);
    const limit = temp();
    emit(`${limit} = udiv i64 ${(1n << 47n).toString()}, ${most}`);
    emit(`${large} = icmp sgt i64 ${n}, ${limit}`);
    panicIf(large, "a channel's capacity is too large to allocate", e);
    emit(`${made} = call ptr @fsh_rt_channel_new(i64 ${n}, i64 ${size}, ptr ${elementDrop(t.of)})`);
    return made;
  }

  // A map's entry: its state, hash and key bits for the runtime, then its key and value.
  function entryType(t: MapType): string {
    return `{ i64, i64, i64, ${llvm(t.key)}, ${t.set ? "{}" : llvm(t.value)} }`;
  }

  // The byte offset of part `i` of an LLVM struct type, or with no `i`, the type's size.
  function offsetOf(type: string, i?: number): string {
    const [at, n] = [temp(), temp()];
    emit(i === undefined ? `${at} = getelementptr ${type}, ptr null, i64 1` : `${at} = getelementptr ${type}, ptr null, i64 0, i32 ${i}`);
    emit(`${n} = ptrtoint ptr ${at} to i64`);
    return n;
  }

  // A key as the runtime hashes and compares it: a string's pointer, an integer widened to 64
  // bits, or a union's member index.
  function keyBits(v: string, key: Type): string {
    const k = lower(key);
    if (k === "string") {
      const bits = temp();
      emit(`${bits} = ptrtoint ptr ${v} to i64`);
      return bits;
    }
    if (isInteger(k)) {
      if (INTEGERS[k].bits === 64) return v;
      const bits = temp();
      emit(`${bits} = ${INTEGERS[k].signed ? "sext" : "zext"} ${llvm(k)} ${v} to i64`);
      return bits;
    }
    if (typeof k !== "string" && k.kind === "union") {
      const [tag, bits] = [temp(), temp()];
      emit(`${tag} = extractvalue ${llvm(k)} ${v}, 0`);
      emit(`${bits} = zext i32 ${tag} to i64`);
      return bits;
    }
    return "0";
  }

  // `new Map<K, V>()` and `new Set<T>()`: an empty table, told how to drop its keys and values.
  // With `from`, the array whose pairs or members it takes over, a later key replacing an earlier.
  function mapNew(t: MapType, from: Expr | undefined): string {
    const entry = entryType(t);
    // The array runs first, so a panic in it has no table to leave behind.
    const whole = from && owned(from);
    const [size, keyAt, valueAt] = [offsetOf(entry), offsetOf(entry, 3), offsetOf(entry, 4)];
    const drop = (part: Type) => (needsDrop(part) ? elementDrop(part) : "null");
    const made = temp();
    emit(`${made} = call ptr @fsh_rt_map_new(i64 ${size}, i64 ${keyAt}, i64 ${valueAt}, i32 ${lower(t.key) === "string" ? 1 : 0}, ptr ${drop(t.key)}, ptr ${t.set ? "null" : drop(t.value)})`);
    if (!from || !whole) return made;
    const array = (coercions.get(from) ?? types.get(from)) as ArrayType;
    const et = llvm(array.element);
    const [data, length] = [temp(), temp()];
    emit(`${data} = extractvalue ${ARRAY} ${whole}, 0`);
    emit(`${length} = extractvalue ${ARRAY} ${whole}, 1`);
    elements(array.element, data, length, (at) => {
      const element = temp();
      emit(`${element} = load ${et}, ptr ${at}`);
      if (t.set) return inserted(t, made, element);
      const [key, v] = [temp(), temp()];
      emit(`${key} = extractvalue ${et} ${element}, 0`);
      emit(`${v} = extractvalue ${et} ${element}, 1`);
      inserted(t, made, key, v);
    });
    emit(`call void @fsh_rt_free(ptr ${data})`);
    return made;
  }

  // Puts an owned key, and for a Map its owned value, into the table: a key already there keeps
  // its first copy and its place in the order, as JavaScript's does, and its old value is dropped.
  function inserted(t: MapType, map: string, key: string, v?: string) {
    const entry = entryType(t);
    const [kt, vt] = [llvm(t.key), llvm(t.value)];
    const valueAt = (at: string) => {
      const slot = temp();
      emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
      return slot;
    };
    const [found, at, was, there, replace, fresh, done] = [alloca("i32"), temp(), temp(), temp(), label(), label(), label()];
    emit(`${at} = call ptr @fsh_rt_map_insert(ptr ${map}, i64 ${keyBits(key, t.key)}, ptr ${found})`);
    emit(`${was} = load i32, ptr ${found}`);
    emit(`${there} = icmp ne i32 ${was}, 0`);
    emit(`br i1 ${there}, label %${replace}, label %${fresh}`);
    startBlock(replace);
    dispose(key, t.key);
    if (v !== undefined) {
      const [slot, old] = [valueAt(at), temp()];
      emit(`${old} = load ${vt}, ptr ${slot}`);
      dispose(old, t.value);
      emit(`store ${vt} ${v}, ptr ${slot}`);
    }
    emit(`br label %${done}`);
    startBlock(fresh);
    const keySlot = temp();
    emit(`${keySlot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    emit(`store ${kt} ${key}, ptr ${keySlot}`);
    if (v !== undefined) emit(`store ${vt} ${v}, ptr ${valueAt(at)}`);
    emit(`br label %${done}`);
    startBlock(done);
  }

  // A copy of the map in %v: the table copied whole, then each live entry's value and key copied
  // in place. A value's copy may panic, and the copy so far goes with it.
  function copyMap(t: MapType): string {
    const entry = entryType(t);
    const [copy, used, index] = [temp(), temp(), alloca("i64")];
    emit(`${copy} = call ptr @fsh_rt_map_copy(ptr %v)`);
    emit(`${used} = call i64 @fsh_rt_map_used(ptr ${copy})`);
    emit(`store i64 0, ptr ${index}`);
    const [head, body, live, next, done] = [label(), label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp ult i64 ${i}, ${used}`);
    emit(`br i1 ${more}, label %${body}, label %${done}`);
    startBlock(body);
    const [at, state, copying] = [temp(), temp(), temp()];
    emit(`${at} = call ptr @fsh_rt_map_at(ptr ${copy}, i64 ${i})`);
    emit(`${state} = load i64, ptr ${at}`);
    emit(`${copying} = icmp eq i64 ${state}, 3`);
    emit(`br i1 ${copying}, label %${live}, label %${next}`);
    startBlock(live);
    if (!t.set && needsDrop(t.value)) {
      const [slot, v, made] = [temp(), temp(), temp()];
      const vt = llvm(t.value);
      emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
      emit(`${v} = load ${vt}, ptr ${slot}`);
      if (typeof t.value !== "string" && t.value.kind !== "handle" && t.value.kind !== "interior") {
        unwinding(`call ${vt} ${helper("copy", t.value)}(${vt} ${v})`, made, () => emit(`call void @fsh_rt_map_free(ptr ${copy})`));
        emit(`store ${vt} ${made}, ptr ${slot}`);
      } else emit(`store ${vt} ${copied(v, t.value)}, ptr ${slot}`);
    }
    const [keySlot, k] = [temp(), temp()];
    const kt = llvm(t.key);
    emit(`${keySlot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    emit(`${k} = load ${kt}, ptr ${keySlot}`);
    const key = copied(k, t.key);
    emit(`store ${kt} ${key}, ptr ${keySlot}`);
    emit(`call void @fsh_rt_map_copied(ptr ${copy}, i64 ${i}, i64 ${keyBits(key, t.key)})`);
    emit(`br label %${next}`);
    startBlock(next);
    const after = temp();
    emit(`${after} = add i64 ${i}, 1`);
    emit(`store i64 ${after}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    return copy;
  }

  // A Map's or a Set's method on the table its receiver holds. `set` and `add` give the receiver
  // back, a `Mut` borrow of where the table lives.
  function mapCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string | undefined {
    const t = valueType(callee.object) as MapType;
    const entry = entryType(t);
    const at = receiver(callee.object);
    const map = temp();
    emit(`${map} = load ptr, ptr ${at}`);
    const [kt, vt] = [llvm(t.key), t.set ? "{}" : llvm(t.value)];
    const part = (e: string, i: 3 | 4) => {
      const slot = temp();
      emit(`${slot} = getelementptr ${entry}, ptr ${e}, i64 0, i32 ${i}`);
      return slot;
    };
    const load = (type: string, slot: string) => {
      const v = temp();
      emit(`${v} = load ${type}, ptr ${slot}`);
      return v;
    };
    const name = callee.name;
    if (name === "clear") {
      emit(`call void @fsh_rt_map_clear(ptr ${map})`);
      return undefined;
    }
    if (name === "keys" || name === "values" || name === "entries") return listed(e, name, t, map);
    if (name === "forEach") return eachEntry(e, t, map);
    // The key is owned for the call: kept when it goes in, dropped once it has been looked up.
    // A panic in the value's argument drops the key made before it.
    const [key, given] = delivered((hand) => [hand(owned(e.args[0]!), t.key), name === "set" ? hand(owned(e.args[1]!), t.value) : undefined]);
    if (name === "set" || name === "add") {
      inserted(t, map, key, given);
      return at;
    }
    const bits = keyBits(key, t.key);
    if (name === "delete") {
      const [gone, removed, drop, done] = [temp(), temp(), label(), label()];
      emit(`${gone} = call ptr @fsh_rt_map_remove(ptr ${map}, i64 ${bits})`);
      dispose(key, t.key);
      emit(`${removed} = icmp ne ptr ${gone}, null`);
      emit(`br i1 ${removed}, label %${drop}, label %${done}`);
      startBlock(drop);
      dispose(load(kt, part(gone, 3)), t.key);
      if (!t.set) dispose(load(vt, part(gone, 4)), t.value);
      emit(`br label %${done}`);
      startBlock(done);
      return removed;
    }
    const [i, there] = [temp(), temp()];
    emit(`${i} = call i64 @fsh_rt_map_find(ptr ${map}, i64 ${bits})`);
    dispose(key, t.key);
    emit(`${there} = icmp sge i64 ${i}, 0`);
    if (name === "has") return there;
    const [hit, miss, done] = [label(), label(), label()];
    // `update(k, f)`: the arrow called once with the value to change, when the key is there.
    if (name === "update") {
      const callback = e.args[1]!;
      const closure = types.get(callback) as ClosureType;
      const env = alloca(llvm(closure));
      emit(`store ${llvm(closure)} ${owned(callback)}, ptr ${env}`);
      const drop = () => needsDrop(closure) && dispose(unstash(env, closure), closure);
      emit(`br i1 ${there}, label %${hit}, label %${done}`);
      startBlock(hit);
      const found = temp();
      emit(`${found} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
      const target = calls.get(callback)!;
      const gives = invoke(target, env, [`ptr ${part(found, 4)}`].slice(0, target.body.params.length), e, undefined, drop);
      if (gives !== undefined && needsDrop(closure.returns)) dispose(gives, closure.returns);
      emit(`br label %${done}`);
      startBlock(done);
      drop();
      return there;
    }
    // `get`: a clone of the value, or nothing.
    const option = unionType([t.value, "null"]);
    const out = alloca(llvm(option));
    emit(`br i1 ${there}, label %${hit}, label %${miss}`);
    startBlock(hit);
    const found = temp();
    emit(`${found} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
    emit(`store ${llvm(option)} ${convert(copied(load(vt, part(found, 4)), t.value), t.value, option)}, ptr ${out}`);
    emit(`br label %${done}`);
    startBlock(miss);
    emit(`store ${llvm(option)} ${convert("zeroinitializer", "null", option)}, ptr ${out}`);
    emit(`br label %${done}`);
    startBlock(done);
    const v = load(llvm(option), out);
    if (!types.has(e) && needsDrop(option)) pending.push({ v, type: option });
    return v;
  }

  // `for...of` over a Map's entries or a Set's members, in insertion order. The table's pointer
  // and the entry reached live in slots, so a generator's loop may stop at a `yield`; the loop
  // owns the table only when it was made for it.
  function mapLoop(s: Extract<Stmt, { kind: "forIn" | "forOf" }>, t: MapType) {
    const local = resolved(s.left as Stmt);
    const entry = entryType(t);
    scopes.push([]);
    const [held, counter] = [loopSlot(s, 0, "ptr"), loopSlot(s, 1, "i64")];
    const kept = resuming && resuming.type.frame[current.frame!.loops.get(s)!]!.type;
    if (kept ? typeof kept !== "string" && kept.kind === "map" : fresh(s.right)) {
      own(held, t);
      emit(`store ptr ${owned(s.right)}, ptr ${held}`);
    } else emit(`store ptr ${value(s.right)}, ptr ${held}`);
    settle();
    emit(`store i64 0, ptr ${counter}`);
    const [test, live, loop, next, end] = [label(), label(), label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    const [i, map, used, more] = [temp(), temp(), temp(), temp()];
    emit(`${i} = load i64, ptr ${counter}`);
    emit(`${map} = load ptr, ptr ${held}`);
    emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    emit(`${more} = icmp slt i64 ${i}, ${used}`);
    emit(`br i1 ${more}, label %${live}, label %${end}`);
    startBlock(live);
    const [at, state, alive] = [temp(), temp(), temp()];
    emit(`${at} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
    emit(`${state} = load i64, ptr ${at}`);
    emit(`${alive} = icmp eq i64 ${state}, 1`);
    emit(`br i1 ${alive}, label %${loop}, label %${next}`);
    startBlock(loop);
    exits.set(s, { exit: end, next, depth: scopes.length });
    scopes.push([]);
    reserve(local);
    own(slot(local), local.type);
    // Each part is a pointer into the entry, or a copy when it copies.
    const piece = (i: 3 | 4, type: Type, given: Type) => {
      const part = temp();
      emit(`${part} = getelementptr ${entry}, ptr ${at}, i64 0, i32 ${i}`);
      if (isRef(given)) return part;
      const v = temp();
      emit(`${v} = load ${llvm(type)}, ptr ${part}`);
      return copied(v, type);
    };
    if (t.set) emit(`store ${llvm(local.type)} ${piece(3, t.key, local.type)}, ptr ${slot(local)}`);
    else {
      const [k, v] = elementsOf(local.type as ObjectType);
      const [first, pair] = [temp(), temp()];
      emit(`${first} = insertvalue ${llvm(local.type)} undef, ${llvm(k!)} ${piece(3, t.key, k!)}, 0`);
      emit(`${pair} = insertvalue ${llvm(local.type)} ${first}, ${llvm(v!)} ${piece(4, t.value, v!)}, 1`);
      emit(`store ${llvm(local.type)} ${pair}, ptr ${slot(local)}`);
    }
    s.body.forEach(statement);
    drop(scopes.length - 1);
    scopes.pop();
    emit(`br label %${next}`);
    startBlock(next);
    const [now, after] = [temp(), temp()];
    emit(`${now} = load i64, ptr ${counter}`);
    emit(`${after} = add i64 ${now}, 1`);
    emit(`store i64 ${after}, ptr ${counter}`);
    emit(`br label %${test}`);
    startBlock(end);
    drop(scopes.length - 1);
    scopes.pop();
  }

  // Runs the body for each live entry of a map, in insertion order, with a pointer to it.
  function entriesLoop(t: MapType, map: string, each: (entry: string) => void) {
    const [used, index] = [temp(), alloca("i64")];
    emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    emit(`store i64 0, ptr ${index}`);
    const [head, body, live, next, done] = [label(), label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${used}`);
    emit(`br i1 ${more}, label %${body}, label %${done}`);
    startBlock(body);
    const [at, state, alive] = [temp(), temp(), temp()];
    emit(`${at} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
    emit(`${state} = load i64, ptr ${at}`);
    emit(`${alive} = icmp eq i64 ${state}, 1`);
    emit(`br i1 ${alive}, label %${live}, label %${next}`);
    startBlock(live);
    each(at);
    emit(`br label %${next}`);
    startBlock(next);
    const after = temp();
    emit(`${after} = add i64 ${i}, 1`);
    emit(`store i64 ${after}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
  }

  // `keys()`, `values()` and `entries()`: arrays of clones, in insertion order. A Set's values
  // are its members, and its entries pair each member with itself, as JavaScript's do.
  function listed(e: Extract<Expr, { kind: "call" }>, name: string, t: MapType, map: string): string {
    const result = types.get(e) as ArrayType;
    const out = alloca(ARRAY);
    emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    const entry = entryType(t);
    const read = (at: string, i: 3 | 4, type: Type) => {
      const [slot, v] = [temp(), temp()];
      emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 ${i}`);
      emit(`${v} = load ${llvm(type)}, ptr ${slot}`);
      return copied(v, type);
    };
    entriesLoop(t, map, (at) => {
      if (name === "keys" || (name === "values" && t.set)) return appended(out, t.key, read(at, 3, t.key));
      if (name === "values") return appended(out, t.value, read(at, 4, t.value));
      const pair = result.element;
      const [k, v] = [read(at, 3, t.key), t.set ? read(at, 3, t.key) : read(at, 4, t.value)];
      const [first, both] = [temp(), temp()];
      emit(`${first} = insertvalue ${llvm(pair)} undef, ${llvm(t.key)} ${k}, 0`);
      emit(`${both} = insertvalue ${llvm(pair)} ${first}, ${t.set ? llvm(t.key) : llvm(t.value)} ${v}, 1`);
      appended(out, pair, both);
    });
    const v = temp();
    emit(`${v} = load ${ARRAY}, ptr ${out}`);
    if (!types.has(e)) pending.push({ v, type: result });
    return v;
  }

  // `forEach(f)`: the arrow called with each value and its key, or each member, borrowed or copied.
  function eachEntry(e: Extract<Expr, { kind: "call" }>, t: MapType, map: string): undefined {
    const entry = entryType(t);
    const callback = e.args[0]!;
    const closure = types.get(callback) as ClosureType;
    const target = calls.get(callback)!;
    const env = alloca(llvm(closure));
    emit(`store ${llvm(closure)} ${owned(callback)}, ptr ${env}`);
    const parts: [3 | 4, Type][] = t.set ? [[3, t.key], [3, t.key]] : [[4, t.value], [3, t.key]];
    entriesLoop(t, map, (at) => {
      const passed = parts.slice(0, closure.params.length).map(([i, type], n) => {
        const slot = temp();
        emit(`${slot} = getelementptr ${entry}, ptr ${at}, i64 0, i32 ${i}`);
        const given = closure.params[n]!;
        if (isRef(given)) return `ptr ${slot}`;
        const v = temp();
        emit(`${v} = load ${llvm(type)}, ptr ${slot}`);
        return `${llvm(given)} ${convert(copied(v, type), type, given)}`;
      });
      const unwound = () => {
        if (needsDrop(closure)) dispose(unstash(env, closure), closure);
      };
      const gives = invoke(target, env, passed.slice(0, target.body.params.length), e, undefined, unwound);
      if (gives !== undefined && needsDrop(closure.returns)) dispose(gives, closure.returns);
    });
    if (needsDrop(closure)) dispose(unstash(env, closure), closure);
    return undefined;
  }

  // A Semaphore's or Channel's method. Those that wait give a future holding a count on the
  // block, and for `send` the value going in.
  function blockCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string | undefined {
    const t = referent(valueType(callee.object)) as BlockType;
    const handle = temp();
    emit(`${handle} = load ptr, ptr ${receiver(callee.object)}`);
    if (callee.name === "abort") return void emit(`call void @fsh_rt_signal_abort(ptr ${handle})`);
    if (callee.name === "throwIfAborted") {
      const [aborted, yes, stop, fine] = [temp(), temp(), label(), label()];
      emit(`${aborted} = call i32 @fsh_rt_signal_aborted(ptr ${handle})`);
      emit(`${yes} = icmp ne i32 ${aborted}, 0`);
      emit(`br i1 ${yes}, label %${stop}, label %${fine}`);
      startBlock(stop);
      raised(e, abortError(current.raises.get(e)!.from));
      startBlock(fine);
      return undefined;
    }
    if (callee.name === "available" || callee.name === "close") {
      const result = temp();
      if (callee.name === "close") return void emit(`call void @fsh_rt_channel_close(ptr ${handle})`);
      emit(`${result} = call i64 @fsh_rt_semaphore_available(ptr ${handle})`);
      return result;
    }
    const future = types.get(e) as FutureType;
    // What a send, read or write carries: the value going in, the most bytes, or the bytes.
    const carried = ["send", "read", "write"].includes(callee.name) ? future.frame[2]!.type : undefined;
    const given = carried === undefined ? undefined : carried === "i64" ? value(e.args[0]!) : owned(e.args[0]!);
    let frame = temp();
    emit(`${frame} = insertvalue ${llvm(future)} zeroinitializer, ptr ${copied(handle, t)}, 1`);
    if (given !== undefined) {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(future)} ${frame}, ${llvm(carried!)} ${given}, 2`);
      frame = next;
    }
    return signalled(e, future, frame);
  }

  // A new block for a Dyn's value. At least a byte, so an empty class has an address of its own.
  // A shared Dyn's block is counted: the runtime keeps its count in 16 bytes before the value.
  function dynBlock(type: Type, counted = false): string {
    const [end, size, empty, some, block] = [temp(), temp(), temp(), temp(), temp()];
    emit(`${end} = getelementptr ${llvm(type)}, ptr null, i64 1`);
    emit(`${size} = ptrtoint ptr ${end} to i64`);
    emit(`${empty} = icmp eq i64 ${size}, 0`);
    emit(`${some} = select i1 ${empty}, i64 1, i64 ${size}`);
    emit(`${block} = call ptr @${counted ? "fsh_rt_dyn_alloc" : "fsh_rt_alloc"}(i64 ${some})`);
    return block;
  }

  // A value moved into a new Dyn's block, with the vtable of its type for the Dyn's interface.
  function box(v: string, type: Type, to: DynType): string {
    const [made, dyn] = [temp(), temp()];
    const block = dynBlock(type, sharesDyn(to));
    emit(`store ${llvm(type)} ${v}, ptr ${block}`);
    emit(`${made} = insertvalue ${DYN} undef, ptr ${block}, 0`);
    emit(`${dyn} = insertvalue ${DYN} ${made}, ptr ${vtable(type, to)}, 1`);
    return dyn;
  }

  // The vtable of a type for an interface: drop the block, copy it (the compiler's copies),
  // clone it as '.clone()' would (null when the type can't be), then a slot per member. A
  // shared Dyn's copy and clone count the block again and its drop gives a count up. Any other
  // Dyn's copy is its clone, so state it holds in an Atomic or a Lock is never split in two.
  function vtable(type: Type, to: DynType): string {
    const key = `${keyOf(type)} ${keyOf(to)}`;
    const made = vtables.get(key);
    if (made) return made;
    const name = `@"fsh.vtable.${vtables.size}"`;
    vtables.set(key, name);
    const table = dynMembers.get(key)!;
    let slots: string[];
    if (sharesDyn(to)) {
      // A shared Dyn's '.clone()' runs its class's own clone when it has one, and otherwise shares.
      const own = table.clone && table.clone !== "copy";
      slots = [dynRelease(type), "@fsh_rt_dyn_retain", own ? dynClone(type, table, true) : "@fsh_rt_dyn_retain"];
    } else {
      const copied = dynCopy(type);
      const cloned = table.clone === "copy" ? copied : dynClone(type, table);
      // A value holding nothing pinned copies as the compiler copies, its own Dyns through their
      // own vtables; one that does would split that state, so its copy panics.
      const pinned = holdsPart(type, (u) => typeof u !== "string" && ((u.kind === "interior" && u.which !== "Cell") || (u.kind === "block" && (u.which === "Semaphore" || u.which === "Permit")) || u.kind === "handle"));
      const copy = !pinned || promiseElement(to.of) !== undefined ? copied : table.clone ? cloned : dynUncopyable();
      slots = [dynDrop(type), copy, cloned];
    }
    slots.push(...dynSlots(type, to, table));
    globals.push(`${name} = internal constant [${slots.length} x ptr] [${slots.map((s) => `ptr ${s}`).join(", ")}]`);
    return name;
  }

  // Emits a thunk taking the pointer to a Dyn's block, then `params`, its body from `fill`. It
  // is a function of its own, so nothing the function being emitted holds drops in it.
  function thunk(name: string, returns: string, fill: () => void, params: string[] = []) {
    const saved = { allocas, body, temps, labels, block, pending, scopes };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    fill();
    out.push(`define internal ${returns} ${name}(${["ptr %p", ...params].join(", ")}) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block, pending, scopes } = saved);
  }

  // A shared Dyn's drop: the last count drops the value and frees its block.
  function dynRelease(type: Type): string {
    const name = `@"fsh.dyn.release.${vtables.size}"`;
    thunk(name, "void", () => {
      const [last, gone, kept, v] = [temp(), label(), label(), temp()];
      emit(`${last} = call i1 @fsh_rt_dyn_release(ptr %p)`);
      emit(`br i1 ${last}, label %${gone}, label %${kept}`);
      startBlock(gone);
      emit(`${v} = load ${llvm(type)}, ptr %p`);
      dispose(v, type);
      emit("call void @fsh_rt_dyn_free(ptr %p)");
      emit(`br label %${kept}`);
      startBlock(kept);
      emit("ret void");
    });
    return name;
  }

  // The copy of a Dyn whose value can't be cloned: it panics rather than split state in two.
  function dynUncopyable(): string {
    const name = `@"fsh.dyn.uncopyable"`;
    if (!uncopyable) {
      uncopyable = true;
      thunk(name, "ptr", () => {
        unwinding(`call void @fsh_rt_panic(ptr ${cString("panicked while copying a Dyn:\nits value holds an Atomic, a Lock, a JoinHandle or something else changed or awaited in one place, so it can't be copied; keep it in a shared value, or give its interface no methods that change it\n")})`);
        emit("unreachable");
      });
    }
    return name;
  }

  function dynDrop(type: Type): string {
    const name = `@"fsh.dyn.drop.${vtables.size}"`;
    thunk(name, "void", () => {
      const v = temp();
      emit(`${v} = load ${llvm(type)}, ptr %p`);
      dispose(v, type);
      emit("call void @fsh_rt_free(ptr %p)");
      emit("ret void");
    });
    return name;
  }

  // A new block holding the compiler's copy of the value: what its copies and drops balance on.
  function dynCopy(type: Type): string {
    const name = `@"fsh.dyn.copy.${vtables.size}"`;
    thunk(name, "ptr", () => {
      const v = temp();
      emit(`${v} = load ${llvm(type)}, ptr %p`);
      // Copied before its block is made, since a copy may panic part way.
      const made = copied(v, type);
      const block = dynBlock(type);
      emit(`store ${llvm(type)} ${made}, ptr ${block}`);
      emit(`ret ptr ${block}`);
    });
    return name;
  }

  // What a Dyn's '.clone()' runs when the class has its own `clone`: a new block holding what
  // it gives. Null when the type can't be cloned, which the call panics on.
  function dynClone(type: Type, table: DynTable, counted = false): string {
    if (!table.clone || table.clone === "copy") return "null";
    const own = table.clone;
    const name = `@"fsh.dyn.clone.${vtables.size}"`;
    thunk(name, "ptr", () => {
      const made = invoke(own, "%p", [])!;
      const block = dynBlock(type, counted);
      emit(`store ${llvm(type)} ${made}, ptr ${block}`);
      emit(`ret ptr ${block}`);
    });
    return name;
  }

  // A slot per interface member: each method, then each field. A method giving an interface
  // type can't be called through a Dyn, so its slot is null.
  function dynSlots(type: Type, to: DynType, { methods, fields }: DynTable): string[] {
    // A boxed future's one slot is its poll, which takes its frame as the block.
    if (promiseElement(to.of) !== undefined) return [symbol(futureOf.get(type as FutureType)!)];
    const n = vtables.size;
    const abstract = (t: Type) => typeof t !== "string" && t.kind === "interface" && promiseElement(t) === undefined;
    const made = to.of.methods.map((m, i) => (abstract(m.returns) ? "null" : methodThunk(`@"fsh.dyn.${n}.${m.name}"`, type, m, methods[i]!)));
    return [...made, ...to.of.fields.map((f, i) => fieldThunk(`@"fsh.dyn.${n}.get ${f.name}"`, type, f, fields[i]))];
  }

  // A method's slot: the type's method run on the block, its result as the interface gives it.
  // Through a method declaring `this: Own<this>` the Dyn is given up: its block is freed after,
  // and its value dropped first unless the type's method took it over.
  function methodThunk(name: string, type: Type, m: Method, target: Instance): string {
    if (promiseElement(m.returns) !== undefined) return futureThunk(name, type, m, target);
    const returns = m.returns === "void" ? "void" : llvm(m.returns);
    thunk(name, returns, () => {
      const owner = target.body.owner;
      const upcasts = typeof type !== "string" && type.kind === "class" && owner !== undefined && owner !== type;
      const self = upcasts ? upcast("%p", type, owner) : "%p";
      // Given up, the block is freed once the method returns or unwinds: its value dropped first,
      // or for a base's owning method, the derived fields it doesn't know of.
      const giveUp = !m.owned ? undefined : () => {
        if (!target.body.self?.owned) {
          const v = temp();
          emit(`${v} = load ${llvm(type)}, ptr %p`);
          dispose(v, type);
        } else if (upcasts) {
          for (let t = type as ClassType; t !== owner; t = t.base!) {
            const at = upcast("%p", type as ClassType, t);
            for (const [part, i] of parts(t)) {
              if (i === 0 || !needsDrop(part)) continue;
              const [slot, v] = [temp(), temp()];
              emit(`${slot} = getelementptr ${llvm(t)}, ptr ${at}, i32 0, i32 ${i}`);
              emit(`${v} = load ${llvm(part)}, ptr ${slot}`);
              dispose(v, part);
            }
          }
        }
        emit("call void @fsh_rt_free(ptr %p)");
      };
      // A closure may take fewer parameters than its callable passes: the rest are dropped here.
      const taken = target.body.closure ? target.body.params.length : m.params.length;
      m.params.slice(taken).forEach((p, i) => dispose(`%a${taken + i}`, p));
      const result = invoke(target, self, m.params.slice(0, taken).map((p, i) => `${llvm(p)} %a${i}`), undefined, giveUp);
      if (result === undefined || m.returns === "void") {
        if (result !== undefined) dispose(result, target.returns);
        return emit("ret void");
      }
      // A result narrowed to what the interface gives drops the parts it leaves out.
      if (needsDrop(target.returns) && !keepsAll(target.returns, m.returns)) {
        const kept = copied(convert(result, target.returns, m.returns), m.returns);
        dispose(result, target.returns);
        return emit(`ret ${returns} ${kept}`);
      }
      emit(`ret ${returns} ${convert(result, target.returns, m.returns)}`);
    }, m.params.map((p, i) => `${llvm(p)} %a${i}`));
    return name;
  }

  // A slot giving a `Promise<T>`: the future the method or async arrow makes, its frame holding
  // the block (a method's object, borrowed) or a copy of the closure, then the arguments, boxed.
  function futureThunk(name: string, type: Type, m: Method, target: Instance): string {
    const closure = target.body.closure !== undefined;
    const to = closure ? storedType(m.returns) as DynType : lentPromise(promiseElement(m.returns)!);
    const params = m.params.map((p, i) => `${llvm(p)} %a${i}`);
    thunk(name, DYN, () => {
      const taken = closure ? target.body.params.length : m.params.length;
      m.params.slice(taken).forEach((p, i) => dispose(`%a${taken + i}`, p));
      let made: string;
      let future: FutureType;
      if (target.future) {
        future = target.future;
        let frame = temp();
        if (closure) {
          const env = temp();
          emit(`${env} = load ${llvm(target.closure!)}, ptr %p`);
          emit(`${frame} = insertvalue ${llvm(future)} zeroinitializer, ${llvm(target.closure!)} ${copied(env, target.closure!)}, 1`);
        } else {
          const owner = target.body.owner;
          const self = typeof type !== "string" && type.kind === "class" && owner && owner !== type ? upcast("%p", type, owner) : "%p";
          emit(`${frame} = insertvalue ${llvm(future)} zeroinitializer, ptr ${self}, 1`);
        }
        params.slice(0, taken).forEach((p, i) => {
          const next = temp();
          emit(`${next} = insertvalue ${llvm(future)} ${frame}, ${p}, ${i + 2}`);
          frame = next;
        });
        made = frame;
      } else {
        future = target.returns as FutureType;
        made = invoke(target, "%p", params.slice(0, taken))!;
      }
      emit(`ret ${DYN} ${box(made, future, to)}`);
    }, params);
    return name;
  }

  // A field's slot: a copy of the field, or what the getter supplying it gives.
  function fieldThunk(name: string, type: Type, f: Field, getter: Instance | undefined): string {
    thunk(name, llvm(f.type), () => {
      if (getter) {
        const owner = getter.body.owner;
        const self = typeof type !== "string" && type.kind === "class" && owner && owner !== type ? upcast("%p", type, owner) : "%p";
        emit(`ret ${llvm(f.type)} ${convert(invoke(getter, self, [])!, getter.returns, f.type)}`);
        return;
      }
      const holder = type as ObjectType | ClassType;
      const own = field(holder, f.name)!.type;
      const [at, v] = [temp(), temp()];
      emit(`${at} = getelementptr ${llvm(holder)}, ptr %p, i32 0, ${fieldPath(holder, f.name).map((i) => `i32 ${i}`).join(", ")}`);
      emit(`${v} = load ${llvm(own)}, ptr ${at}`);
      emit(`ret ${llvm(f.type)} ${convert(copied(v, own), own, f.type)}`);
    });
    return name;
  }

  // `d.clone()`: a new Dyn with the clone its vtable gives, or a panic when its value can't be.
  function dynCloned(e: Expr, object: Expr): string {
    const dyn = temp();
    emit(`${dyn} = load ${DYN}, ptr ${receiver(object)}`);
    const [data, table, at, fn, none, made, copy, result] = [temp(), temp(), temp(), temp(), temp(), temp(), temp(), temp()];
    emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
    emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
    emit(`${at} = getelementptr ptr, ptr ${table}, i64 2`);
    emit(`${fn} = load ptr, ptr ${at}`);
    emit(`${none} = icmp eq ptr ${fn}, null`);
    panicIf(none, "this Dyn's value can't be cloned: its type holds an Atomic, a Lock, a JoinHandle or something else changed or awaited in one place", e);
    // A class's own clone may panic.
    unwinding(`call ptr ${fn}(ptr ${data})`, made);
    emit(`${copy} = insertvalue ${DYN} ${dyn}, ptr ${made}, 0`);
    emit(`${result} = insertvalue ${DYN} ${copy}, ptr ${table}, 1`);
    return result;
  }

  // A Dyn's block and vtable, for a call or a field read through it.
  function opened(object: Expr, take: boolean): [string, string] {
    const dyn = take ? owned(object) : temp();
    if (!take) emit(`${dyn} = load ${DYN}, ptr ${receiver(object)}`);
    const [data, table] = [temp(), temp()];
    emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
    emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
    return [data, table];
  }

  // The function in a vtable's slot after its drop, copy and clone.
  function vslot(table: string, i: number): string {
    const [at, fn] = [temp(), temp()];
    emit(`${at} = getelementptr ptr, ptr ${table}, i64 ${3 + i}`);
    emit(`${fn} = load ptr, ptr ${at}`);
    return fn;
  }

  // A method call through a Dyn: one taking its object over takes the Dyn.
  // A stored callable's call is its one method's, on the callee itself.
  function dynCall(e: Extract<Expr, { kind: "call" }>, callee: Expr): string | undefined {
    const info = dynCalls.get(e)!;
    const object = info.callable ?? (callee as Extract<Expr, { kind: "member" }>).object;
    const t = referent(valueType(object)) as DynType;
    const m = t.of.methods[info.index]!;
    const [data, table] = opened(object, info.owned);
    const fn = vslot(table, info.index);
    const args = e.args.map((a, i) => `, ${llvm(m.params[i]!)} ${owned(a)}`).join("");
    // A `Promise<T>` comes back as its boxed future.
    const gives = promiseElement(m.returns) !== undefined ? types.get(e)! : m.returns;
    const returns = gives === "void" ? "void" : llvm(gives);
    const result = gives === "void" ? undefined : temp();
    unwinding(`call ${returns} ${fn}(ptr ${data}${args})`, result);
    if (result && !types.has(e) && needsDrop(gives)) pending.push({ v: result, type: gives });
    return result;
  }

  // A field read through a Dyn: a copy, through its slot after the methods'.
  function dynField(e: Extract<Expr, { kind: "member" }>): string {
    const t = referent(types.get(e.object)!) as DynType;
    const [data, table] = opened(e.object, false);
    const fn = vslot(table, t.of.methods.length + t.of.fields.findIndex((f) => f.name === e.name));
    const result = temp();
    emit(`${result} = call ${llvm(types.get(e)!)} ${fn}(ptr ${data})`);
    return result;
  }

  // A function dropping one value where it lives, for a channel to drop what it still holds.
  function elementDrop(type: Type): string {
    const made = elementDrops.get(type);
    if (made) return made;
    const name = `@"fsh.element.drop.${elementDrops.size}"`;
    elementDrops.set(type, name);
    const saved = { allocas, body, temps, labels, block };
    [allocas, body, temps, labels, block] = [[], [], 0, 0, "entry"];
    const v = temp();
    emit(`${v} = load ${llvm(type)}, ptr %p`);
    dispose(v, type);
    emit("ret void");
    out.push(`define internal void ${name}(ptr %p) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block } = saved);
    return name;
  }

  // A shared value's block: its count, then what a Lock of its value would be.
  function sharedBlock(t: SharedType): string {
    return `{ i64, ${llvm(interiorType("Lock", t.of))} }`;
  }

  // `shared(v)`: a new block with one count, holding v.
  function sharedNew(e: Extract<Expr, { kind: "call" }>): string {
    const t = valueType(e) as SharedType;
    const v = owned(e.args[0]!);
    const [end, size, block, at] = [temp(), temp(), temp(), temp()];
    emit(`${end} = getelementptr ${sharedBlock(t)}, ptr null, i64 1`);
    emit(`${size} = ptrtoint ptr ${end} to i64`);
    emit(`${block} = call ptr @fsh_rt_shared_new(i64 ${size})`);
    emit(`${at} = getelementptr ${sharedBlock(t)}, ptr ${block}, i32 0, i32 1, i32 1`);
    emit(`store ${llvm(t.of)} ${v}, ptr ${at}`);
    return block;
  }

  // `update`: the callback runs with a pointer to what the Lock holds, between taking and
  // releasing its word. The callback's captures are made before the lock is taken.
  function lockUpdate(e: Extract<Expr, { kind: "call" }>, t: InteriorType, at: string): string | undefined {
    const callback = e.args[0]!;
    // The callback's value lives in a slot it is called through; what it leaves of its captures
    // is dropped after it, as at any closure's call.
    const made = types.get(callback)!;
    const env = alloca(llvm(made));
    emit(`store ${llvm(made)} ${owned(callback)}, ptr ${env}`);
    const leftovers = needsDrop(made) ? () => dispose(unstash(env, made), made) : undefined;
    takeLock(at, e);
    const inside = temp();
    emit(`${inside} = getelementptr ${llvm(t)}, ptr ${at}, i32 0, i32 1`);
    const target = calls.get(callback)!;
    const result = invoke(target, env, target.body.params.length > 0 ? [`ptr ${inside}`] : [], e, leftovers);
    emit(`call void @fsh_rt_unlock(ptr ${at})`);
    if (result && !types.has(e) && needsDrop(target.returns)) pending.push({ v: result, type: target.returns });
    return result;
  }

  // A Cell's method: a plain load or store where it lives, which only one thread can reach.
  function cellCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>, t: InteriorType, at: string): string | undefined {
    const ty = llvm(t.of);
    // The argument runs first: it may use the same Cell.
    const given = callee.name === "get" ? undefined : owned(e.args[0]!);
    const old = temp();
    emit(`${old} = load ${ty}, ptr ${at}`);
    if (given === undefined) return copied(old, t.of);
    emit(`store ${ty} ${given}, ptr ${at}`);
    if (callee.name === "replace") return old;
    dispose(old, t.of);
    return undefined;
  }

  // Part `i` of a loop's state: an alloca, or in a generator, the frame's field for it.
  function loopSlot(s: Stmt, i: number, type: string): string {
    return resuming ? `%loop.${current.frame!.loops.get(s)! + i}` : alloca(type);
  }

  // `for...of` over a fixed array: each element where it lives, as an array's loop gives them;
  // a temporary is held in a slot of the loop's own.
  function fixedLoop(s: Extract<Stmt, { kind: "forIn" | "forOf" }>, type: FixedType) {
    const local = resolved(s.left as Stmt);
    scopes.push([]);
    // Where the array lives is kept in the loop's slot, and read again each pass, as a
    // generator's or an async function's loop may be resumed in a later call.
    // In a resumable body the frame decides: its slot is a pointer exactly when the source is a
    // place to point at.
    const kept = resuming && resuming.type.frame[current.frame!.loops.get(s)!]!.type;
    const lent = kept ? isRef(kept) : isRef(types.get(s.right)!) || lendable(s.right);
    const held = loopSlot(s, 0, lent ? "ptr" : llvm(type));
    if (lent) emit(`store ptr ${isRef(types.get(s.right)!) ? evaluate(s.right) : address(s.right)}, ptr ${held}`);
    else {
      own(held, type);
      emit(`store ${llvm(type)} ${owned(s.right)}, ptr ${held}`);
    }
    settle();
    const counter = loopSlot(s, 1, "i64");
    emit(`store i64 0, ptr ${counter}`);
    const [test, loop, next, end] = [label(), label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${counter}`);
    emit(`${more} = icmp ult i64 ${i}, ${type.size}`);
    emit(`br i1 ${more}, label %${loop}, label %${end}`);
    startBlock(loop);
    exits.set(s, { exit: end, next, depth: scopes.length });
    scopes.push([]);
    reserve(local);
    own(slot(local), local.type);
    let base = held;
    if (lent) {
      base = temp();
      emit(`${base} = load ptr, ptr ${held}`);
    }
    const at = temp();
    emit(`${at} = getelementptr ${llvm(type)}, ptr ${base}, i64 0, i64 ${i}`);
    if (isRef(local.type)) emit(`store ptr ${at}, ptr ${slot(local)}`);
    else {
      const v = temp();
      emit(`${v} = load ${llvm(type.element)}, ptr ${at}`);
      emit(`store ${llvm(local.type)} ${copied(v, type.element)}, ptr ${slot(local)}`);
    }
    s.body.forEach(statement);
    drop(scopes.length - 1);
    scopes.pop();
    emit(`br label %${next}`);
    startBlock(next);
    const [now, after] = [temp(), temp()];
    emit(`${now} = load i64, ptr ${counter}`);
    emit(`${after} = add i64 ${now}, 1`);
    emit(`store i64 ${after}, ptr ${counter}`);
    emit(`br label %${test}`);
    startBlock(end);
    drop(scopes.length - 1);
    scopes.pop();
  }

  // `for...of` over a string: each code point as a new string, until the runtime gives none. The
  // loop holds a reference to the string, so changing the variable it came from changes nothing.
  function stringLoop(s: Extract<Stmt, { kind: "forIn" | "forOf" }>) {
    const local = resolved(s.left as Stmt);
    scopes.push([]);
    const [held, offset] = [loopSlot(s, 0, "ptr"), loopSlot(s, 1, "i64")];
    const text = fresh(s.right) ? owned(s.right) : copied(value(s.right), "string");
    own(held, "string");
    emit(`store ptr ${text}, ptr ${held}`);
    settle();
    emit(`store i64 0, ptr ${offset}`);
    const [test, loop, next, end] = [label(), label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    const [string, point, done] = [temp(), temp(), temp()];
    emit(`${string} = load ptr, ptr ${held}`);
    emit(`${point} = call ptr @fsh_rt_str_next(ptr ${string}, ptr ${offset})`);
    emit(`${done} = icmp eq ptr ${point}, null`);
    emit(`br i1 ${done}, label %${end}, label %${loop}`);
    startBlock(loop);
    exits.set(s, { exit: end, next, depth: scopes.length });
    scopes.push([]);
    reserve(local);
    own(slot(local), "string");
    emit(`store ptr ${point}, ptr ${slot(local)}`);
    s.body.forEach(statement);
    drop(scopes.length - 1);
    scopes.pop();
    emit(`br label %${next}`);
    startBlock(next);
    emit(`br label %${test}`);
    startBlock(end);
    drop(scopes.length - 1);
    scopes.pop();
  }

  // `for...of` over a generator: each `next()` gives the variable its value, until it finishes.
  // The loop owns a generator it was given, and drops it once the loop ends however it ends; one
  // it borrows through a `Mut` stays with its owner.
  function generatorLoop(s: Extract<Stmt, { kind: "forIn" | "forOf" }>, iterated: Type) {
    const local = resolved(s.left as Stmt);
    const generator = (isRef(iterated) ? iterated.to : iterated) as GeneratorType;
    scopes.push([]);
    const held = loopSlot(s, 0, llvm(iterated));
    if (isRef(iterated)) emit(`store ptr ${value(s.right)}, ptr ${held}`);
    else {
      own(held, generator);
      emit(`store ${llvm(generator)} ${owned(s.right)}, ptr ${held}`);
    }
    settle();
    const [test, loop, end] = [label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    let at = held;
    if (isRef(iterated)) {
      at = temp();
      emit(`${at} = load ptr, ptr ${held}`);
    }
    const result = resume(generator, at);
    const [finished, more] = nextShapes(generator.yields);
    emit(`br i1 ${holds(result, nextResult(generator.yields) as UnionType, [finished])}, label %${end}, label %${loop}`);
    startBlock(loop);
    exits.set(s, { exit: end, next: test, depth: scopes.length });
    scopes.push([]);
    reserve(local);
    own(slot(local), local.type);
    const [shaped, v] = [convert(result, nextResult(generator.yields), more), temp()];
    emit(`${v} = extractvalue ${llvm(more)} ${shaped}, 1`);
    emit(`store ${llvm(local.type)} ${v}, ptr ${slot(local)}`);
    s.body.forEach(statement);
    drop(scopes.length - 1);
    scopes.pop();
    emit(`br label %${test}`);
    startBlock(end);
    drop(scopes.length - 1);
    scopes.pop();
  }

  // The two shapes `next()` gives: finished, and holding a value.
  function nextShapes(yields: Type): [ObjectType, ObjectType] {
    const members = (nextResult(yields) as UnionType).members as ObjectType[];
    const finished = members.find((m) => m.fields.length === 1)!;
    return [finished, members.find((m) => m !== finished)!];
  }

  // What `next()` gives: `v`, or that the generator has finished. `done` is a literal, which
  // takes no room: the union's tag tells the two apart.
  function answer(v: string | undefined, yields: Type): string {
    const [finished, more] = nextShapes(yields);
    if (v === undefined) return convert("zeroinitializer", finished, nextResult(yields));
    const made = temp();
    emit(`${made} = insertvalue ${llvm(more)} zeroinitializer, ${llvm(yields)} ${v}, 1`);
    return convert(made, more, nextResult(yields));
  }

  // Runs a generator to its next `yield`, through a pointer to it.
  function resume(generator: GeneratorType, at: string): string {
    const target = generatorOf.get(generator)!;
    const result = temp();
    unwinding(`call ${resultType(target)} ${symbol(target)}(ptr ${at})`, result);
    return result;
  }

  // `yield v`: the value goes back to `next()`'s caller, and the next call goes on from here.
  function yielded(e: Extract<Expr, { kind: "yield" }>) {
    const g = resuming!;
    const v = owned(e.value!);
    settle();
    const result = answer(v, (g.type as GeneratorType).yields);
    const at = label();
    g.resumes.push(at);
    emit(`store i32 ${g.resumes.length}, ptr %state`);
    emit(`ret ${resultType(current)} ${result}`);
    startBlock(at);
  }

  // A variable's slot: an alloca, or in a generator, the frame's field, reached on entry.
  function reserve(local: Local) {
    if (!framed.has(slot(local))) allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
  }

  function slot(local: Local): string {
    // Quoted, so any name a variable may have, `café` or a pattern's `[a, b]`, is a valid one.
    return captured.get(local) ?? `%"${local.name === "%" ? "topic" : local.name}.${local.id}"`;
  }

  function resolved(node: Expr | Stmt | Param | ObjectProp): Local {
    const local = locals.get(node);
    if (!local) throw new Error("internal error: unresolved name");
    return local;
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        if (s.expr.kind === "yield") return yielded(s.expr);
        effect(s.expr);
        settle();
        return;
      case "block":
      case "unsafe":
        scoped(s.body);
        return;
      // A comptime block runs while compiling and leaves nothing to run.
      case "comptime":
        comptimeBlock(current, s);
        return;
      case "if": {
        const cond = value(s.cond);
        settle();
        const then = label();
        const otherwise = s.else ? label() : undefined;
        const end = label();
        emit(`br i1 ${cond}, label %${then}, label %${otherwise ?? end}`);
        startBlock(then);
        scoped(s.then);
        emit(`br label %${end}`);
        if (s.else && otherwise) {
          startBlock(otherwise);
          scoped(s.else);
          emit(`br label %${end}`);
        }
        startBlock(end);
        return;
      }
      case "while": {
        reserveC(s.cond);
        const test = label();
        const loop = label();
        const end = label();
        emit(`br label %${test}`);
        startBlock(test);
        const cond = value(s.cond);
        settle();
        emit(`br i1 ${cond}, label %${loop}, label %${end}`);
        startBlock(loop);
        exits.set(s, { exit: end, next: test, depth: scopes.length });
        scoped(s.body);
        emit(`br label %${test}`);
        startBlock(end);
        return;
      }
      case "for": {
        // The initializer's variables last for the whole loop.
        scopes.push([]);
        if (s.init) statement(s.init);
        reserveC(s.test);
        reserveC(s.update);
        const [test, loop, next, end] = [label(), label(), label(), label()];
        emit(`br label %${test}`);
        startBlock(test);
        const cond = s.test ? value(s.test) : undefined;
        settle();
        emit(cond ? `br i1 ${cond}, label %${loop}, label %${end}` : `br label %${loop}`);
        startBlock(loop);
        exits.set(s, { exit: end, next, depth: scopes.length });
        scoped(s.body);
        emit(`br label %${next}`);
        startBlock(next);
        if (s.update) effect(s.update);
        settle();
        emit(`br label %${test}`);
        startBlock(end);
        drop(scopes.length - 1);
        scopes.pop();
        return;
      }
      // The array is read once; one the loop made itself is owned by the loop until it ends.
      // Each pass gives the variable a pointer to its element, or a copy of a Copy one.
      case "forOf": {
        const iterated = types.get(s.right)!;
        if (typeof iterated !== "string" && (iterated.kind === "generator" || (iterated.kind === "ref" && typeof iterated.to !== "string" && iterated.to.kind === "generator"))) {
          return generatorLoop(s, iterated);
        }
        if (lower(valueType(s.right)) === "string") return stringLoop(s);
        const inline = isRef(types.get(s.right)!) ? (types.get(s.right) as RefType).to : types.get(s.right)!;
        if (typeof inline !== "string" && inline.kind === "fixed") return fixedLoop(s, inline);
        if (typeof inline !== "string" && inline.kind === "map") return mapLoop(s, inline);
        const type = valueType(s.right) as ArrayType;
        const local = resolved(s.left as Stmt);
        scopes.push([]);
        // The array, and the position reached, live in slots: a generator's loop may stop at a
        // `yield` and go on in a later call.
        const [held, counter] = [loopSlot(s, 0, ARRAY), loopSlot(s, 1, "i64")];
        // In a generator, the frame says whether the loop owns its array.
        const kept = resuming && resuming.type.frame[current.frame!.loops.get(s)!]!.type;
        if (kept ? typeof kept !== "string" && kept.kind === "array" : fresh(s.right)) {
          own(held, type);
          emit(`store ${ARRAY} ${owned(s.right)}, ptr ${held}`);
        } else emit(`store ${ARRAY} ${value(s.right)}, ptr ${held}`);
        settle();
        emit(`store i64 0, ptr ${counter}`);
        const [test, loop, next, end] = [label(), label(), label(), label()];
        emit(`br label %${test}`);
        startBlock(test);
        const [i, more, array, length, data] = [temp(), temp(), temp(), temp(), temp()];
        emit(`${i} = load i64, ptr ${counter}`);
        emit(`${array} = load ${ARRAY}, ptr ${held}`);
        emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
        emit(`${more} = icmp ult i64 ${i}, ${length}`);
        emit(`br i1 ${more}, label %${loop}, label %${end}`);
        startBlock(loop);
        exits.set(s, { exit: end, next, depth: scopes.length });
        scopes.push([]);
        reserve(local);
        own(slot(local), local.type);
        const at = temp();
        emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
        emit(`${at} = getelementptr ${llvm(type.element)}, ptr ${data}, i64 ${i}`);
        if (isRef(local.type)) emit(`store ptr ${at}, ptr ${slot(local)}`);
        else {
          const v = temp();
          emit(`${v} = load ${llvm(type.element)}, ptr ${at}`);
          emit(`store ${llvm(local.type)} ${copied(v, type.element)}, ptr ${slot(local)}`);
        }
        s.body.forEach(statement);
        drop(scopes.length - 1);
        scopes.pop();
        emit(`br label %${next}`);
        startBlock(next);
        const [now, after] = [temp(), temp()];
        emit(`${now} = load i64, ptr ${counter}`);
        emit(`${after} = add i64 ${now}, 1`);
        emit(`store i64 ${after}, ptr ${counter}`);
        emit(`br label %${test}`);
        startBlock(end);
        drop(scopes.length - 1);
        scopes.pop();
        return;
      }
      case "doWhile": {
        reserveC(s.cond);
        const [loop, test, end] = [label(), label(), label()];
        emit(`br label %${loop}`);
        startBlock(loop);
        exits.set(s, { exit: end, next: test, depth: scopes.length });
        scoped(s.body);
        emit(`br label %${test}`);
        startBlock(test);
        const cond = value(s.cond);
        settle();
        emit(`br i1 ${cond}, label %${loop}, label %${end}`);
        startBlock(end);
        return;
      }
      case "switch": {
        const subject = operand(s.discriminant, s.cases.flatMap((c) => (c.test ? [c.test] : [])));
        // A subject the switch made is released on the way into the body that runs, and stays
        // pending through the tests, so an error raised in one drops it too.
        const held = pending.slice(floor);
        const enter = (body: string) => {
          if (held.length === 0) return body;
          const via = label();
          entries.push([via, body]);
          return via;
        };
        const entries: [string, string][] = [];
        const subjectType = valueType(s.discriminant);
        const type = llvm(subjectType);
        const bodies = s.cases.map(() => label());
        const end = label();
        exits.set(s, { exit: end, depth: scopes.length });
        // The cases share one scope.
        scopes.push([]);
        // The tests run in order; when none matches, control goes to `default`, wherever it sits.
        s.cases.forEach((c, i) => {
          if (!c.test) return;
          const test = value(c.test);
          // Anything but two values of one primitive type, such as a union or an enum member,
          // compares by value.
          const testType = valueType(c.test);
          const primitive = typeof subjectType === "string" && testType === subjectType && subjectType !== "string";
          const equal = primitive ? compare(type, subject, test) : equals(subject, subjectType, test, testType);
          settle(floor + held.length);
          const next = label();
          emit(`br i1 ${equal}, label %${enter(bodies[i]!)}, label %${next}`);
          startBlock(next);
        });
        const fallback = s.cases.findIndex((c) => !c.test);
        emit(`br label %${enter(fallback < 0 ? end : bodies[fallback]!)}`);
        pending.length = floor;
        for (const [via, body] of entries) {
          startBlock(via);
          for (const { v, type } of held) dispose(v, type);
          emit(`br label %${body}`);
        }
        s.cases.forEach((c, i) => {
          startBlock(bodies[i]!);
          c.body.forEach(statement);
          emit(`br label %${bodies[i + 1] ?? end}`);
        });
        startBlock(end);
        drop(scopes.length - 1);
        scopes.pop();
        return;
      }
      case "labeled": {
        const end = label();
        exits.set(s, { exit: end, depth: scopes.length });
        statement(s.body);
        emit(`br label %${end}`);
        startBlock(end);
        return;
      }
      case "break":
      case "continue": {
        const target = exits.get(jumps.get(s)!)!;
        jump(s.kind === "break" ? target.exit : target.next!, target.depth);
        startBlock(label());
        return;
      }
      case "return":
        if (jumps.has(s)) {
          given(s, jumps.get(s)!);
        } else if (s.value && current.returns === "void") {
          // An arrow's expression body may be a call returning nothing.
          effect(s.value);
          settle();
          leave(undefined);
        } else {
          // A future's inferred result is widened from what its returns give, as a `let` is.
          const v = s.value ? (current.future ? convert(owned(s.value), valueType(s.value), current.future.gives) : owned(s.value)) : undefined;
          settle();
          leave(v);
        }
        // Anything after a return goes in a fresh block that nothing branches to.
        startBlock(label());
        return;
      case "throw":
        raised(s, owned(s.value));
        pending.length = floor;
        startBlock(label());
        return;
      // An error raised in the block is stored where the catch reads it, and the catch runs.
      // A `finally` runs however the two are left, then carries on the way they were left.
      case "try": {
        const region = s.finalizer ? enter() : undefined;
        const after = label();
        const done = () => (region ? exit(region, "normal", () => emit(`br label %${after}`)) : emit(`br label %${after}`));
        if (!s.handler) {
          scoped(s.block);
          done();
        } else {
          const local = s.param ? resolved(s) : undefined;
          const type = current.caught.get(s)!;
          const handler = { label: label(), slot: alloca(llvm(type)), depth: scopes.length, floor };
          handlers.push(handler);
          scoped(s.block);
          handlers.pop();
          done();
          startBlock(handler.label);
          scopes.push([]);
          const caught = temp();
          emit(`${caught} = load ${llvm(type)}, ptr ${handler.slot}`);
          // The catch's variable owns the error; with none, the error is dropped here.
          if (local) {
            reserve(local);
            own(slot(local), local.type);
            emit(`store ${llvm(type)} ${caught}, ptr ${slot(local)}`);
          } else dispose(caught, type);
          s.handler.forEach(statement);
          drop(scopes.length - 1);
          scopes.pop();
          done();
        }
        if (region) {
          finallies.pop();
          startBlock(region.label);
          // What a way out keeps while the finally runs is dropped if the finally leaves its own way.
          scopes.push([]);
          for (const { slot, type } of region.slots.values()) own(slot, type);
          scoped(s.finalizer!);
          const chosen = temp();
          emit(`${chosen} = load i32, ptr ${region.chosen}`);
          const targets = region.exits.map(() => label());
          emit(`switch i32 ${chosen}, label %${targets[0]} [ ${targets.map((t, i) => `i32 ${i}, label %${t}`).join(" ")} ]`);
          region.exits.forEach((e, i) => {
            startBlock(targets[i]!);
            e.resume();
          });
          scopes.pop();
        }
        startBlock(after);
        return;
      }
      case "let": {
        const local = resolved(s);
        reserve(local);
        own(slot(local), local.type);
        // A variable declared without a value starts empty, as a moved-out one is.
        const init = s.declarations[0]!.init;
        emit(`store ${llvm(local.type)} ${init ? owned(init) : "zeroinitializer"}, ptr ${slot(local)}`);
        settle();
        return;
      }
    }
  }

  // Emits a call that may panic, assigning its result to `result` when given. Unwinding, with
  // anything live here, it is an invoke whose landing pad drops the statement's values and every
  // scope's variables, runs `cleanup` for what the call itself held, and lets the unwind go on.
  // Variables not yet set, or already dropped, are empty, so dropping every scope is safe.
  function unwinding(call: string, result?: string, cleanup?: () => void) {
    const assign = result ? `${result} = ` : "";
    const live = pending.some((p) => needsDrop(p.type)) || scopes.some((s) => s.length > 0);
    if (panic === "abort" || (!live && !cleanup)) return emit(assign + call);
    // A landing pad reads the statement's values back from slots: at -O0 on AArch64, LLVM loses
    // the second register of a two-register value carried into one. Each call stores them
    // again, since a value may reach it along a path no earlier store was on.
    const held = pending.filter((p) => needsDrop(p.type));
    for (const p of held) {
      p.slot ??= alloca(llvm(p.type));
      emit(`store ${llvm(p.type)} ${p.v}, ptr ${p.slot}`);
    }
    const [ok, pad, caught] = [label(), label(), temp()];
    emit(`${assign}invoke ${call.slice("call ".length)} to label %${ok} unwind label %${pad}`);
    startBlock(pad);
    emit(`${caught} = landingpad { ptr, i32 } cleanup`);
    cleanup?.();
    for (const p of held.reverse()) {
      const v = temp();
      emit(`${v} = load ${llvm(p.type)}, ptr ${p.slot}`);
      dispose(v, p.type);
    }
    drop(0);
    emit(`resume { ptr, i32 } ${caught}`);
    startBlock(ok);
  }

  // A match: the subject is read once, then each arm's pattern is tested in order; a match binds
  // its names and runs its guard, and a failing guard drops what it bound and tries the next arm.
  // The checker made sure some arm matches. As a value, each arm gives one of its own. A value
  // the match made is its own, in a slot its bindings move parts out of, dropped with what is
  // left once the match ends; a place is read where it lives, and bindings point into it.
  function lowerMatch(e: Extract<Expr, { kind: "match" }>, wanted: boolean): string | undefined {
    const type = valueType(e.subject);
    scopes.push(passing([]));
    let subject: string;
    let at: string | undefined;
    const owning = made(e.subject) && fresh(e.subject);
    if (owning) {
      subject = value(e.subject, true);
      at = alloca(llvm(type));
      own(at, type);
      emit(`store ${llvm(type)} ${subject}, ptr ${at}`);
    } else {
      subject = value(e.subject);
      at = lendable(e.subject) && !coercions.has(e.subject) && stored(e.subject) === type ? address(e.subject) : undefined;
    }
    const result = wanted ? types.get(e) : undefined;
    const slot = result && alloca(llvm(result));
    const end = label();
    for (const arm of e.arms) {
      const next = label();
      tested(arm.pattern, subject, next);
      scopes.push(passing([]));
      // A guarded arm copies what it binds, since a failing guard moves on to arms that may bind
      // the same parts.
      bindAll(arm.pattern, subject, at, owning && !arm.guard);
      if (arm.guard) {
        const mark = pending.length;
        const ok = value(arm.guard);
        settle(mark);
        const [body, failed] = [label(), label()];
        emit(`br i1 ${ok}, label %${body}, label %${failed}`);
        startBlock(failed);
        drop(scopes.length - 1);
        emit(`br label %${next}`);
        startBlock(body);
      }
      const mark = pending.length;
      if (arm.body.kind === "block") {
        const given = label();
        exits.set(arm.body, { exit: given, depth: scopes.length });
        arms.set(arm.body, result && slot ? { slot, type: result } : undefined);
        const outer = floor;
        floor = mark;
        statement(arm.body);
        floor = outer;
        emit(`br label %${given}`);
        startBlock(given);
      } else {
        if (result && slot) emit(`store ${llvm(result)} ${needsDrop(result) ? owned(arm.body) : value(arm.body)}, ptr ${slot}`);
        else effect(arm.body);
        settle(mark);
      }
      drop(scopes.length - 1);
      scopes.pop();
      emit(`br label %${end}`);
      startBlock(next);
    }
    emit("unreachable");
    startBlock(end);
    drop(scopes.length - 1);
    scopes.pop();
    if (!result || !slot) return undefined;
    const v = temp();
    emit(`${v} = load ${llvm(result)}, ptr ${slot}`);
    return v;
  }

  // A pipe over a value: the value lives in the topic's slot while the right side runs, and is
  // dropped after it unless the right side moved it out.
  function lowerPipe(e: Extract<Expr, { kind: "pipe" }>, wanted: boolean): string | undefined {
    const local = locals.get(e)!;
    scopes.push(passing([]));
    reserve(local);
    own(slot(local), local.type);
    emit(`store ${llvm(local.type)} ${owned(e.value)}, ptr ${slot(local)}`);
    const mark = pending.length;
    const type = types.get(e);
    let v: string | undefined;
    if (wanted && type) v = needsDrop(type) ? owned(e.body) : value(e.body);
    else effect(e.body);
    settle(mark);
    drop(scopes.length - 1);
    scopes.pop();
    return v;
  }

  // A `return` in a match arm's block: its value goes where the match keeps what it gives, and
  // control leaves the arm, dropping what the scopes inside it own.
  function given(s: Extract<Stmt, { kind: "return" }>, arm: Stmt) {
    const into = arms.get(arm);
    if (s.value && into) emit(`store ${llvm(into.type)} ${needsDrop(into.type) ? owned(s.value) : value(s.value)}, ptr ${into.slot}`);
    else if (s.value) effect(s.value);
    settle();
    const target = exits.get(arm)!;
    jump(target.exit, target.depth);
  }

  // Tests a value against a pattern, going on when it matches and to `no` when it doesn't. A
  // payload is only read once its member's tag is known.
  function tested(p: Pattern, v: string, no: string) {
    const info = current.patterns.get(p)!;
    const pass = (condition: string) => {
      const ok = label();
      emit(`br i1 ${condition}, label %${ok}, label %${no}`);
      startBlock(ok);
    };
    const union = typeof info.type !== "string" && info.type.kind === "union" ? info.type : undefined;
    switch (info.kind) {
      case "any":
        return;
      case "literal":
        return pass(info.member ? equals(v, info.type, "zeroinitializer", info.member) : equals(v, info.type, value((p as Extract<Pattern, { kind: "literal" }>).value), valueType((p as Extract<Pattern, { kind: "literal" }>).value)));
      case "none":
        return pass(union ? holds(v, union, ["null"]) : "true");
      case "some": {
        const empty = temp();
        emit(`${empty} = xor i1 ${holds(v, union!, ["null"])}, true`);
        pass(empty);
        return tested(info.arg, convert(v, info.type, info.inner), no);
      }
      case "variant": {
        if (union) pass(holds(v, union, [info.variant]));
        const payload = union ? convert(v, info.type, info.variant) : v;
        info.args.forEach((arg, i) => {
          const field = temp();
          emit(`${field} = extractvalue ${llvm(info.variant)} ${payload}, ${i}`);
          tested(arg, field, no);
        });
        return;
      }
      case "object": {
        if (union) pass(holds(v, union, info.shapes));
        const holder = shapeOf(info);
        const held = union ? convert(v, info.type, holder) : v;
        for (const [key, sub, type] of info.fields) tested(sub, fieldOf(held, holder, key, type), no);
        return;
      }
      case "array": {
        const [length, data, same] = [temp(), temp(), temp()];
        emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
        emit(`${same} = icmp eq i64 ${length}, ${info.items.length}`);
        pass(same);
        emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
        info.items.forEach((item, i) => tested(item, loadElement(data, info.element, i).v, no));
        return;
      }
      case "or": {
        const yes = label();
        info.alternatives.forEach((alt, i) => {
          const next = i < info.alternatives.length - 1 ? label() : no;
          tested(alt, v, next);
          emit(`br label %${yes}`);
          if (next !== no) startBlock(next);
        });
        startBlock(yes);
        return;
      }
    }
  }

  // Binds the names a pattern gives, in the arm's scope: a pointer into where the value lives,
  // for a borrowing binding; otherwise the value, moved out of a temporary the match owns, or a
  // copy. A part with no place of its own to point at is pointed at in a copy of its bits.
  function bindAll(p: Pattern, v: string, at: string | undefined, move: boolean) {
    const info = current.patterns.get(p)!;
    if (info.kind === "any" && p.kind === "ident") {
      const local = resolved(p as Expr);
      reserve(local);
      // A binding borrowing the part points where it lives; one of a part that is itself a
      // reference, like a `Mut` field, holds that reference.
      if (isRef(local.type) && local.type !== info.type) {
        let pointer = at;
        if (!pointer) {
          pointer = alloca(llvm(info.type));
          emit(`store ${llvm(info.type)} ${v}, ptr ${pointer}`);
        }
        emit(`store ptr ${pointer}, ptr ${slot(local)}`);
        return;
      }
      own(slot(local), local.type);
      const taken = move && at && needsDrop(info.type);
      if (taken) emit(`store ${llvm(info.type)} zeroinitializer, ptr ${at}`);
      emit(`store ${llvm(local.type)} ${taken ? v : copied(v, info.type)}, ptr ${slot(local)}`);
      return;
    }
    if (info.kind === "variant") {
      const inUnion = info.type !== info.variant;
      const payload = inUnion ? convert(v, info.type, info.variant) : v;
      const payloadAt = at && inUnion ? partAt(llvm(info.type), at, 1) : at;
      info.args.forEach((arg, i) => {
        const field = temp();
        emit(`${field} = extractvalue ${llvm(info.variant)} ${payload}, ${i}`);
        bindAll(arg, field, payloadAt && partAt(llvm(info.variant), payloadAt, i), move);
      });
      return;
    }
    if (info.kind === "object") {
      // One shape has its fields in place; several have no one place to point into.
      const holder = shapeOf(info);
      const union = info.type !== holder;
      const held = union ? convert(v, info.type, holder) : v;
      const single = typeof holder !== "string" && (holder.kind === "object" || holder.kind === "class") ? holder : undefined;
      const holderAt = at && single ? (union ? partAt(llvm(info.type), at, 1) : at) : undefined;
      for (const [key, sub, type] of info.fields) {
        let fieldAt: string | undefined;
        if (holderAt && single) {
          fieldAt = temp();
          emit(`${fieldAt} = getelementptr ${llvm(single)}, ptr ${holderAt}, i32 0, ${fieldPath(single, key).map((i) => `i32 ${i}`).join(", ")}`);
        }
        bindAll(sub, fieldOf(held, holder, key, type), fieldAt, move && fieldAt !== undefined);
      }
      return;
    }
    if (info.kind === "array") {
      const data = temp();
      emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
      info.items.forEach((item, i) => {
        const { v: element, at: elementAt } = loadElement(data, info.element, i);
        bindAll(item, element, elementAt, move);
      });
      return;
    }
    if (info.kind === "some") {
      // Only an Option of one member keeps that member in place as its payload.
      const alone = (info.type as UnionType).members.length === 2;
      const innerAt = at && alone ? partAt(llvm(info.type), at, 1) : undefined;
      bindAll(info.arg, convert(v, info.type, info.inner), innerAt, move && innerAt !== undefined);
    }
  }

  // What an object pattern meets once its member is known: its one shape, or the union of them.
  function shapeOf(info: Extract<PatternInfo, { kind: "object" }>): Type {
    return info.shapes.length === 1 ? info.shapes[0]! : unionType(info.shapes);
  }

  // A field of a value, read as `type`: from an object or instance, or a union's members.
  function fieldOf(v: string, holder: Type, key: string, type: Type): string {
    if (typeof holder !== "string" && holder.kind === "union") return unionField(v, holder, key, type);
    const shape = holder as ObjectType | ClassType;
    const read = temp();
    emit(`${read} = extractvalue ${llvm(shape)} ${v}, ${fieldPath(shape, key).join(", ")}`);
    return convert(read, field(shape, key)!.type, type);
  }

  // An array's element `i`, and where it lives.
  function loadElement(data: string, element: Type, i: number): { v: string; at: string } {
    const [at, v] = [temp(), temp()];
    emit(`${at} = getelementptr ${llvm(element)}, ptr ${data}, i64 ${i}`);
    emit(`${v} = load ${llvm(element)}, ptr ${at}`);
    return { v, at };
  }

  // A pointer to part `i` of an aggregate in memory.
  function partAt(type: string, at: string, i: number): string {
    const part = temp();
    emit(`${part} = getelementptr ${type}, ptr ${at}, i32 0, i32 ${i}`);
    return part;
  }

  // An expression run for its effect, dropping any value it makes.
  function effect(e: Expr) {
    if (e.kind === "match") return void lowerMatch(e, false);
    if (e.kind === "pipe") return void lowerPipe(e, false);
    if (e.kind === "unary" && e.op === "await") {
      const v = awaitFuture(e);
      const gives = (valueType(e.operand) as FutureType).gives;
      if (v !== undefined && needsDrop(gives)) dispose(v, gives);
      return;
    }
    if (e.kind !== "call") return void value(e);
    const result = call(e);
    // A call whose value goes unused has no type of its own recorded.
    const type = types.get(e) ?? calls.get(e)?.returns;
    if (result !== undefined && type) dispose(result, type);
  }

  // Whether a value of the type owns memory it gives back when dropped: a string, or anything
  // holding one by value.
  function needsDrop(type: Type | undefined): boolean {
    if (type === "string") return true;
    if (typeof type !== "string" && type?.kind === "handle") return true;
    if (type === undefined || typeof type === "string") return false;
    if (type.kind === "union") return type.members.some(needsDrop);
    if (type.kind === "array" || type.kind === "map" || type.kind === "shared" || type.kind === "block" || type.kind === "dyn") return true;
    if (type.kind === "fixed") return type.size > 0 && needsDrop(type.element);
    if (type.kind === "interior" && type.which !== "Lock") return needsDrop(type.of);
    return parts(type).some(([t]) => needsDrop(t));
  }

  // The parts of an aggregate value, each with its index: an instance's embedded base, then its
  // fields; an object's or a closure's fields.
  function parts(type: Exclude<Type, string>): [Type, number][] {
    // A Lock is its word, then what it holds.
    if (type.kind === "interior") return type.which === "Lock" ? [[type.of, 1]] : [];
    if (type.kind !== "object" && type.kind !== "class" && type.kind !== "closure" && type.kind !== "variant" && type.kind !== "generator" && type.kind !== "future") return [];
    const base: [Type, number][] = type.kind === "class" && type.base ? [[type.base, 0]] : [];
    return [...base, ...(type.kind === "generator" || type.kind === "future" ? type.frame : type.fields).map((f, i): [Type, number] => [f.type, i + base.length])];
  }

  // A copy of a value, holding its own reference to each string in it.
  function copied(v: string, type: Type): string {
    if (typeof type !== "string" && type.kind === "interior" && type.which !== "Lock") return copied(v, type.of);
    if (!needsDrop(type)) return v;
    if (type === "string") {
      emit(`call void @fsh_rt_str_retain(ptr ${v})`);
      return v;
    }
    if (typeof type !== "string" && type.kind === "handle") {
      emit(`call void @fsh_rt_handle_retain(ptr ${v})`);
      return v;
    }
    // A copy may panic part way, on a Dyn whose value can't be copied.
    const result = temp();
    unwinding(`call ${llvm(type)} ${helper("copy", type as Exclude<Type, string>)}(${llvm(type)} ${v})`, result);
    return result;
  }

  // Gives up a value: releases a reference to everything it owns.
  function dispose(v: string, type: Type) {
    if (typeof type !== "string" && type.kind === "interior" && type.which !== "Lock") return dispose(v, type.of);
    if (!needsDrop(type)) return;
    if (type === "string") return emit(`call void @fsh_rt_str_release(ptr ${v})`);
    if (typeof type !== "string" && type.kind === "handle") return emit(`call void @fsh_rt_handle_drop(ptr ${v})`);
    emit(`call void ${helper("drop", type as Exclude<Type, string>)}(${llvm(type)} ${v})`);
  }

  // The function that drops what a value of an aggregate type owns, or returns a copy of it,
  // part by part, or for a union, in the member it holds. It is named before it is made, so a
  // type holding itself calls it.
  function helper(kind: "drop" | "copy", type: Exclude<Type, string>): string {
    const made = glue[kind].get(type);
    if (made) return made;
    const name = `@"fsh.${kind}.${glue[kind].size}"`;
    glue[kind].set(type, name);
    // A copy keeps the parts it has made pending, so a panic part way drops them.
    const saved = { allocas, body, temps, labels, block, pending, scopes };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const t = llvm(type);
    const each = (v: string, part: Type, track = true) => {
      if (kind === "drop") return (dispose(v, part), v);
      const made = copied(v, part);
      if (track) pending.push({ v: made, type: part });
      return made;
    };
    let result = "%v";
    if (type.kind === "array") {
      result = kind === "drop" ? dropArray(type) : copyArray(type);
    } else if (type.kind === "map") {
      // A map moved out of its place left it empty, which the runtime's free skips.
      if (kind === "drop") emit("call void @fsh_rt_map_free(ptr %v)");
      else result = copyMap(type);
    } else if (type.kind === "fixed") {
      // Element by element in a loop over the value held in a slot, each copy written back.
      const [slot, index] = [alloca(t), alloca("i64")];
      emit(`store ${t} %v, ptr ${slot}`);
      emit(`store i64 0, ptr ${index}`);
      const [head, body, done] = [label(), label(), label()];
      emit(`br label %${head}`);
      startBlock(head);
      const [i, more] = [temp(), temp()];
      emit(`${i} = load i64, ptr ${index}`);
      emit(`${more} = icmp ult i64 ${i}, ${type.size}`);
      emit(`br i1 ${more}, label %${body}, label %${done}`);
      startBlock(body);
      const [at, v, after] = [temp(), temp(), temp()];
      emit(`${at} = getelementptr ${t}, ptr ${slot}, i64 0, i64 ${i}`);
      emit(`${v} = load ${llvm(type.element)}, ptr ${at}`);
      const made = each(v, type.element, false);
      if (kind === "copy") emit(`store ${llvm(type.element)} ${made}, ptr ${at}`);
      emit(`${after} = add i64 ${i}, 1`);
      emit(`store i64 ${after}, ptr ${index}`);
      emit(`br label %${head}`);
      startBlock(done);
      if (kind === "copy") {
        result = temp();
        emit(`${result} = load ${t}, ptr ${slot}`);
      }
    } else if (type.kind === "shared") {
      if (kind === "copy") emit("call void @fsh_rt_shared_retain(ptr %v)");
      else dropShared(type);
    } else if (type.kind === "dyn") {
      // Through the vtable: its drop frees the block; its copy gives a new block. A Dyn moved
      // out of its place left it empty, with nothing to drop or copy.
      const [data, table, empty, at, fn, full, done] = [temp(), temp(), temp(), temp(), temp(), label(), label()];
      emit(`${data} = extractvalue ${DYN} %v, 0`);
      emit(`${table} = extractvalue ${DYN} %v, 1`);
      emit(`${empty} = icmp eq ptr ${data}, null`);
      emit(`br i1 ${empty}, label %${done}, label %${full}`);
      startBlock(full);
      emit(`${at} = getelementptr ptr, ptr ${table}, i64 ${kind === "drop" ? 0 : 1}`);
      emit(`${fn} = load ptr, ptr ${at}`);
      let copy: string | undefined;
      if (kind === "drop") emit(`call void ${fn}(ptr ${data})`);
      else {
        const made = temp();
        copy = temp();
        unwinding(`call ptr ${fn}(ptr ${data})`, made);
        emit(`${copy} = insertvalue ${DYN} %v, ptr ${made}, 0`);
      }
      const from = block;
      emit(`br label %${done}`);
      startBlock(done);
      if (copy) {
        result = temp();
        emit(`${result} = phi ${DYN} [ %v, %entry ], [ ${copy}, %${from} ]`);
      }
    } else if (type.kind === "block") {
      const release = { Semaphore: "fsh_rt_semaphore_release", Permit: "fsh_rt_permit_drop", Channel: "fsh_rt_channel_release", AbortController: "fsh_rt_signal_release", AbortSignal: "fsh_rt_signal_release", TcpListener: "fsh_rt_socket_release", TcpStream: "fsh_rt_socket_release" }[type.which];
      emit(kind === "copy" ? "call void @fsh_rt_block_retain(ptr %v)" : `call void @${release}(ptr %v)`);
    } else if (type.kind === "union") {
      // The copy starts as the value itself, which is right for members owning nothing.
      const copy = kind === "copy" ? alloca(t) : "";
      if (copy) emit(`store ${t} %v, ptr ${copy}`);
      const tag = temp();
      emit(`${tag} = extractvalue ${t} %v, 0`);
      const owners = type.members.filter(needsDrop);
      const cases = owners.map(() => label());
      const end = label();
      emit(`switch i32 ${tag}, label %${end} [ ${owners.map((m, i) => `i32 ${type.members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
      owners.forEach((m, i) => {
        startBlock(cases[i]!);
        // One member's copy, made on its own path, so nothing else is pending beside it.
        const part = each(convert("%v", type, m), m, false);
        if (copy) emit(`store ${t} ${convert(part, m, type)}, ptr ${copy}`);
        emit(`br label %${end}`);
      });
      startBlock(end);
      if (copy) {
        result = temp();
        emit(`${result} = load ${t}, ptr ${copy}`);
      }
    } else {
      for (const [part, i] of parts(type)) {
        if (!needsDrop(part)) continue;
        const v = temp();
        emit(`${v} = extractvalue ${t} %v, ${i}`);
        const made = each(v, part);
        if (kind === "drop") continue;
        const next = temp();
        emit(`${next} = insertvalue ${t} ${result}, ${llvm(part)} ${made}, ${i}`);
        result = next;
      }
    }
    emit(kind === "drop" ? "ret void" : `ret ${t} ${result}`);
    out.push(`define internal ${kind === "drop" ? "void" : t} ${name}(${t} %v) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    return name;
  }

  // In an array's drop function: drops each element, then frees the buffer.
  function dropArray(type: ArrayType): string {
    const [data, length] = [temp(), temp()];
    emit(`${data} = extractvalue ${ARRAY} %v, 0`);
    emit(`${length} = extractvalue ${ARRAY} %v, 1`);
    if (needsDrop(type.element)) {
      elements(type.element, data, length, (at) => {
        const v = temp();
        emit(`${v} = load ${llvm(type.element)}, ptr ${at}`);
        dispose(v, type.element);
      });
    }
    emit(`call void @fsh_rt_free(ptr ${data})`);
    return "%v";
  }

  // In an array's copy function: a new buffer just long enough, holding a copy of each element.
  function copyArray(type: ArrayType): string {
    const [data, length, copy] = [temp(), temp(), temp()];
    emit(`${data} = extractvalue ${ARRAY} %v, 0`);
    emit(`${length} = extractvalue ${ARRAY} %v, 1`);
    emit(`${copy} = call ptr @fsh_rt_array_alloc(i64 ${bytes(type.element, length)})`);
    const t = llvm(type.element);
    const element = type.element;
    const glued = typeof element !== "string" && element.kind !== "handle" && element.kind !== "interior" && needsDrop(element);
    elements(element, data, length, (at, i) => {
      const [v, to] = [temp(), temp()];
      emit(`${v} = load ${t}, ptr ${at}`);
      emit(`${to} = getelementptr ${t}, ptr ${copy}, i64 ${i}`);
      if (!glued) return emit(`store ${t} ${copied(v, element)}, ptr ${to}`);
      // An element's copy may panic: the elements copied so far, and the buffer, go with it.
      const made = temp();
      unwinding(`call ${t} ${helper("copy", element)}(${t} ${v})`, made, () => dispose(built(copy, i, i), type));
      emit(`store ${t} ${made}, ptr ${to}`);
    });
    return built(copy, length, length);
  }

  // An array literal with spreads, built in order: each part goes in as it runs, a spread array
  // made for it giving up its elements and others giving clones then and there, before a later
  // part could change or move it. The array being built is owned by a scope of its own, so a
  // panic part way drops it.
  function spreadArray(written: Expr[], type: ArrayType): string {
    const out = alloca(ARRAY);
    scopes.push([]);
    own(out, type);
    emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    for (const x of written) {
      if (x.kind !== "spread") {
        appended(out, type.element, owned(x));
        continue;
      }
      const taken = fresh(x.value);
      const from = types.get(x)!;
      const whole = taken ? owned(x.value) : value(x.value);
      const [data, length] = [temp(), temp()];
      emit(`${data} = extractvalue ${ARRAY} ${whole}, 0`);
      emit(`${length} = extractvalue ${ARRAY} ${whole}, 1`);
      elements(from, data, length, (at) => {
        const v = temp();
        emit(`${v} = load ${llvm(from)}, ptr ${at}`);
        appended(out, type.element, convert(taken ? v : copied(v, from), from, type.element));
      });
      if (taken) emit(`call void @fsh_rt_free(ptr ${data})`);
    }
    const v = temp();
    emit(`${v} = load ${ARRAY}, ptr ${out}`);
    emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    scopes.pop();
    return v;
  }

  // Puts `v` at the end of the array at `at`, growing it when it is full.
  function appended(at: string, element: Type, v: string) {
    const t = llvm(element);
    emit(`call void @fsh_rt_array_reserve(ptr ${at}, i64 ${bytes(element, "1")})`);
    const [lengthAt, dataAt, length, data, slot, more] = [temp(), temp(), temp(), temp(), temp(), temp()];
    emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    emit(`${length} = load i64, ptr ${lengthAt}`);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${length}`);
    emit(`store ${t} ${v}, ptr ${slot}`);
    emit(`${more} = add i64 ${length}, 1`);
    emit(`store i64 ${more}, ptr ${lengthAt}`);
  }

  // `map`, `filter`, `find`, `some`, `every` and `reduce`: a loop calling the callback with each
  // element, a copy when it copies and otherwise a pointer to it, and its index. The array is
  // only read, so its length and data are read once. `some`, `every` and `find` stop at the
  // first element that decides them.
  function callbackLoop(e: Extract<Expr, { kind: "call" }>, method: string, array: ArrayType, at: string): string | undefined {
    const [callback, init] = e.args as [Expr, Expr | undefined];
    const element = array.element;
    const t = llvm(element);
    const closure = types.get(callback) as ClosureType;
    const target = calls.get(callback)!;
    const env = alloca(llvm(closure));
    emit(`store ${llvm(closure)} ${owned(callback)}, ptr ${env}`);
    const result = method === "forEach" ? "void" : types.get(e) ?? (method === "map" ? arrayType(closure.returns) : method === "flatMap" ? lower(closure.returns)
      : method === "filter" ? array : method === "find" ? unionType([element, "null"]) : method === "findIndex" ? "i64" : method === "reduce" ? closure.params[0]! : "boolean");
    const building = method === "map" || method === "filter" || method === "flatMap";
    const out = result === "void" ? "" : alloca(llvm(result));
    const [lengthAt, dataAt, length, data, index] = [temp(), temp(), temp(), temp(), alloca("i64")];
    emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    emit(`${length} = load i64, ptr ${lengthAt}`);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    const elementAt = (i: string) => {
      const slot = temp();
      emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
      return slot;
    };
    const load = (slot: string) => {
      const v = temp();
      emit(`${v} = load ${t}, ptr ${slot}`);
      return v;
    };
    const reducing = method === "reduce";
    let first = "0";
    if (building) emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    if (method === "findIndex") emit(`store i64 -1, ptr ${out}`);
    if (method === "find") emit(`store ${llvm(result)} ${convert("zeroinitializer", "null", result)}, ptr ${out}`);
    if (method === "some" || method === "every") emit(`store i1 ${method === "every"}, ptr ${out}`);
    if (reducing && init) emit(`store ${llvm(result)} ${convert(owned(init), types.get(init)!, result)}, ptr ${out}`);
    if (reducing && !init) {
      // Without an initial value the first element starts, and an empty array has none.
      const [empty, fail, ok] = [temp(), label(), label()];
      emit(`${empty} = icmp eq i64 ${length}, 0`);
      emit(`br i1 ${empty}, label %${fail}, label %${ok}`);
      startBlock(fail);
      unwinding(`call void @fsh_rt_panic(ptr ${cString(`panicked at ${where(e)}:\nreduce of empty array with no initial value\n`)})`);
      emit("unreachable");
      startBlock(ok);
      emit(`store ${llvm(result)} ${convert(copied(load(elementAt("0")), element), element, result)}, ptr ${out}`);
      first = "1";
    }
    emit(`store i64 ${first}, ptr ${index}`);
    const [head, body, next, done] = [label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${length}`);
    emit(`br i1 ${more}, label %${body}, label %${done}`);
    startBlock(body);
    const slot = elementAt(i);
    const given = closure.params[reducing ? 1 : 0];
    const passed = given === undefined ? [] : [isRef(given) ? `ptr ${slot}` : `${llvm(given)} ${convert(copied(load(slot), element), element, given)}`];
    if (closure.params.length > (reducing ? 2 : 1)) passed.push(`i64 ${i}`);
    if (reducing) {
      const acc = temp();
      emit(`${acc} = load ${llvm(result)}, ptr ${out}`);
      passed.unshift(`${llvm(closure.params[0]!)} ${convert(acc, result, closure.params[0]!)}`);
    }
    // A panic in the callback drops what the loop has built and what the callback captured.
    const unwound = () => {
      if (building) {
        const built = temp();
        emit(`${built} = load ${llvm(result)}, ptr ${out}`);
        dispose(built, result);
      }
      if (needsDrop(closure)) dispose(unstash(env, closure), closure);
    };
    const gives = invoke(target, env, passed.slice(0, target.body.params.length), e, undefined, unwound)!;
    if (method === "map") appended(out, closure.returns, gives);
    else if (method === "forEach") {
      // What the callback gives is dropped; JavaScript's forEach ignores it.
      if (gives !== undefined && needsDrop(closure.returns)) dispose(gives, closure.returns);
    } else if (method === "flatMap") {
      const many = alloca(ARRAY);
      emit(`store ${ARRAY} ${convert(gives, closure.returns, result)}, ptr ${many}`);
      emit(`call void @fsh_rt_array_extend(ptr ${out}, ptr ${many}, i64 ${bytes((result as ArrayType).element, "1")})`);
    }
    else if (reducing) emit(`store ${llvm(result)} ${convert(gives, closure.returns, result)}, ptr ${out}`);
    else {
      const [hit, miss] = [label(), next];
      // `every` stops at the first element its callback rejects; the others at one it accepts.
      if (method === "every") emit(`br i1 ${gives}, label %${miss}, label %${hit}`);
      else emit(`br i1 ${gives}, label %${hit}, label %${miss}`);
      startBlock(hit);
      if (method === "filter") {
        appended(out, element, copied(load(slot), element));
        emit(`br label %${next}`);
      } else {
        if (method === "find") emit(`store ${llvm(result)} ${convert(copied(load(slot), element), element, result)}, ptr ${out}`);
        else if (method === "findIndex") emit(`store i64 ${i}, ptr ${out}`);
        else emit(`store i1 ${method === "some"}, ptr ${out}`);
        emit(`br label %${done}`);
      }
    }
    if (method === "map" || method === "flatMap" || method === "forEach" || reducing) emit(`br label %${next}`);
    startBlock(next);
    const after = temp();
    emit(`${after} = add i64 ${i}, 1`);
    emit(`store i64 ${after}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    // What the callback left of its captures drops once, after the last call.
    if (needsDrop(closure)) dispose(unstash(env, closure), closure);
    if (result === "void") return undefined;
    const v = temp();
    emit(`${v} = load ${llvm(result)}, ptr ${out}`);
    if (!types.has(e) && needsDrop(result)) pending.push({ v, type: result });
    return v;
  }

  // `at(i)`: a clone of the element `i` names, counting back from the end when it is negative,
  // or nothing outside the array.
  function elementAt(e: Extract<Expr, { kind: "call" }>, array: ArrayType, at: string): string {
    const element = array.element;
    const option = unionType([element, "null"]);
    const i = value(e.args[0]!);
    const [lengthAt, length, negative, fromEnd, k, low, high, outside] = [temp(), temp(), temp(), temp(), temp(), temp(), temp(), temp()];
    emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    emit(`${length} = load i64, ptr ${lengthAt}`);
    emit(`${negative} = icmp slt i64 ${i}, 0`);
    emit(`${fromEnd} = add i64 ${length}, ${i}`);
    emit(`${k} = select i1 ${negative}, i64 ${fromEnd}, i64 ${i}`);
    emit(`${low} = icmp slt i64 ${k}, 0`);
    emit(`${high} = icmp sge i64 ${k}, ${length}`);
    emit(`${outside} = or i1 ${low}, ${high}`);
    const [some, none, end] = [label(), label(), label()];
    emit(`br i1 ${outside}, label %${none}, label %${some}`);
    startBlock(some);
    const [dataAt, data, slot, v] = [temp(), temp(), temp(), temp()];
    emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    emit(`${slot} = getelementptr ${llvm(element)}, ptr ${data}, i64 ${k}`);
    emit(`${v} = load ${llvm(element)}, ptr ${slot}`);
    const held = convert(copied(v, element), element, option);
    const someEnd = block;
    emit(`br label %${end}`);
    startBlock(none);
    const nothing = convert("zeroinitializer", "null", option);
    const noneEnd = block;
    emit(`br label %${end}`);
    startBlock(end);
    const result = temp();
    emit(`${result} = phi ${llvm(option)} [ ${held}, %${someEnd} ], [ ${nothing}, %${noneEnd} ]`);
    if (types.has(e)) return convert(result, option, types.get(e)!);
    pending.push({ v: result, type: option });
    return result;
  }

  // `sort`: the runtime's merge sort, comparing through a function that calls the comparator
  // with the two elements, or orders numbers and strings when there is none.
  function sorted(e: Extract<Expr, { kind: "call" }>, array: ArrayType, at: string): undefined {
    const element = array.element;
    const compare = e.args[0];
    const closure = compare && (types.get(compare) as ClosureType);
    let env = "null";
    let through: string;
    if (compare && closure) {
      const target = calls.get(compare)!;
      env = alloca(llvm(closure));
      emit(`store ${llvm(closure)} ${owned(compare)}, ptr ${env}`);
      through = `@"fsh.sort.compare.${comparators++}"`;
      thunk(through, "i32", () => {
        const arg = (p: string, given: Type | undefined): string[] => {
          if (given === undefined) return [];
          if (isRef(given)) return [`ptr ${p}`];
          const v = temp();
          emit(`${v} = load ${llvm(element)}, ptr ${p}`);
          return [`${llvm(given)} ${convert(copied(v, element), element, given)}`];
        };
        const args = [...arg("%a", closure.params[0]), ...arg("%b", closure.params[1])];
        emit(`ret i32 ${sign(invoke(target, "%p", args.slice(0, target.body.params.length))!, closure.returns)}`);
      }, ["ptr %a", "ptr %b"]);
    } else through = order(element);
    const [lengthAt, dataAt, length, data] = [temp(), temp(), temp(), temp()];
    emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    emit(`${length} = load i64, ptr ${lengthAt}`);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    // The scratch buffer is codegen's, so a comparator's panic frees it too.
    const [size, room, buffer] = [bytes(element, "1"), temp(), temp()];
    emit(`${room} = mul i64 ${length}, ${size}`);
    emit(`${buffer} = call ptr @fsh_rt_array_alloc(i64 ${room})`);
    const leftovers = () => {
      if (closure && needsDrop(closure)) dispose(unstash(env, closure), closure);
    };
    unwinding(`call void @fsh_rt_sort(ptr ${data}, i64 ${length}, i64 ${size}, ptr ${through}, ptr ${env}, ptr ${buffer})`, undefined, () => {
      emit(`call void @fsh_rt_free(ptr ${buffer})`);
      leftovers();
    });
    emit(`call void @fsh_rt_free(ptr ${buffer})`);
    leftovers();
    return undefined;
  }

  // -1, 0 or 1 for a comparator's number, as its sign; NaN is 0, keeping the order.
  function sign(v: string, type: Type): string {
    const t = lower(type);
    const [less, more, some, result] = [temp(), temp(), temp(), temp()];
    const ty = llvm(t);
    if (isFloat(t)) {
      emit(`${less} = fcmp olt ${ty} ${v}, 0.0`);
      emit(`${more} = fcmp ogt ${ty} ${v}, 0.0`);
    } else {
      const signed = isInteger(t) && INTEGERS[t].signed;
      emit(`${less} = icmp ${signed ? "slt" : "ult"} ${ty} ${v}, 0`);
      emit(`${more} = icmp ${signed ? "sgt" : "ugt"} ${ty} ${v}, 0`);
    }
    emit(`${some} = select i1 ${more}, i32 1, i32 0`);
    emit(`${result} = select i1 ${less}, i32 -1, i32 ${some}`);
    return result;
  }

  // The default order for an element type: numbers by value, strings by UTF-16 code units.
  function order(element: Type): string {
    const t = lower(element);
    const known = orders.get(keyOf(t));
    if (known) return known;
    const name = `@"fsh.sort.order.${orders.size}"`;
    orders.set(keyOf(t), name);
    thunk(name, "i32", () => {
      const [a, b] = [temp(), temp()];
      emit(`${a} = load ${llvm(t)}, ptr %a`);
      emit(`${b} = load ${llvm(t)}, ptr %b`);
      if (t === "string") {
        const result = temp();
        emit(`${result} = call i32 @fsh_rt_str_compare(ptr ${a}, ptr ${b})`);
        emit(`ret i32 ${result}`);
        return;
      }
      // A subtraction could overflow, so the two are compared instead.
      const [less, more, some, result] = [temp(), temp(), temp(), temp()];
      if (isFloat(t)) {
        emit(`${less} = fcmp olt ${llvm(t)} ${a}, ${b}`);
        emit(`${more} = fcmp ogt ${llvm(t)} ${a}, ${b}`);
      } else {
        const signed = isInteger(t) && INTEGERS[t].signed;
        emit(`${less} = icmp ${signed ? "slt" : "ult"} ${llvm(t)} ${a}, ${b}`);
        emit(`${more} = icmp ${signed ? "sgt" : "ugt"} ${llvm(t)} ${a}, ${b}`);
      }
      emit(`${some} = select i1 ${more}, i32 1, i32 0`);
      emit(`${result} = select i1 ${less}, i32 -1, i32 ${some}`);
      emit(`ret i32 ${result}`);
    }, ["ptr %a", "ptr %b"]);
    return name;
  }

  // `shift`, `unshift`, `splice`, `reverse` and `fill`. Elements move in and out bitwise, through
  // the runtime's gap and take helpers; only `fill` makes copies, each stored before the element
  // it replaces is dropped.
  function changed(e: Extract<Expr, { kind: "call" }>, method: string, array: ArrayType, at: string): string | undefined {
    const element = array.element;
    const t = llvm(element);
    const size = bytes(element, "1");
    // What the call takes over is dropped if a later argument panics before the call.
    const args = delivered((hand) => e.args.map((a, i) => ((method === "splice" && i >= 2) || method === "unshift" || (method === "fill" && i === 0) ? hand(owned(a), element) : value(a))));
    const [lengthAt, length] = [temp(), temp()];
    emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    emit(`${length} = load i64, ptr ${lengthAt}`);
    // The values given, stored from index `from` on.
    const placed = (values: string[], from: string) => {
      const [dataAt, data] = [temp(), temp()];
      emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
      emit(`${data} = load ptr, ptr ${dataAt}`);
      values.forEach((v, i) => {
        const [index, slot] = [temp(), temp()];
        emit(`${index} = add i64 ${from}, ${i}`);
        emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${index}`);
        emit(`store ${t} ${v}, ptr ${slot}`);
      });
    };
    if (method === "reverse") {
      emit(`call void @fsh_rt_array_reverse(ptr ${at}, i64 ${size})`);
      return undefined;
    }
    if (method === "unshift") {
      if (args.length === 0) return undefined;
      emit(`call void @fsh_rt_array_open(ptr ${at}, i64 0, i64 ${args.length}, i64 ${size})`);
      placed(args, "0");
      return undefined;
    }
    if (method === "shift") {
      const option = unionType([element, "null"]);
      const [empty, some, none, end] = [temp(), label(), label(), label()];
      emit(`${empty} = icmp eq i64 ${length}, 0`);
      emit(`br i1 ${empty}, label %${none}, label %${some}`);
      startBlock(some);
      const taken = alloca(ARRAY);
      emit(`call void @fsh_rt_array_take(ptr ${at}, i64 0, i64 1, i64 ${size}, ptr ${taken})`);
      const [dataAt, data, v] = [temp(), temp(), temp()];
      emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${taken}, i32 0, i32 0`);
      emit(`${data} = load ptr, ptr ${dataAt}`);
      emit(`${v} = load ${t}, ptr ${data}`);
      emit(`call void @fsh_rt_free(ptr ${data})`);
      const held = convert(v, element, option);
      const someEnd = block;
      emit(`br label %${end}`);
      startBlock(none);
      const nothing = convert("zeroinitializer", "null", option);
      const noneEnd = block;
      emit(`br label %${end}`);
      startBlock(end);
      const result = temp();
      emit(`${result} = phi ${llvm(option)} [ ${held}, %${someEnd} ], [ ${nothing}, %${noneEnd} ]`);
      if (types.has(e)) return convert(result, option, types.get(e)!);
      pending.push({ v: result, type: option });
      return result;
    }
    if (method === "splice") {
      const start = position(args[0]!, length);
      const room = temp();
      emit(`${room} = sub i64 ${length}, ${start}`);
      let count = room;
      if (args[1] !== undefined) {
        // A count below zero removes nothing, and one past the end removes what is there.
        const [negative, atLeast, over, kept] = [temp(), temp(), temp(), temp()];
        emit(`${negative} = icmp slt i64 ${args[1]}, 0`);
        emit(`${atLeast} = select i1 ${negative}, i64 0, i64 ${args[1]}`);
        emit(`${over} = icmp sgt i64 ${atLeast}, ${room}`);
        emit(`${kept} = select i1 ${over}, i64 ${room}, i64 ${atLeast}`);
        count = kept;
      }
      const removed = alloca(ARRAY);
      emit(`call void @fsh_rt_array_take(ptr ${at}, i64 ${start}, i64 ${count}, i64 ${size}, ptr ${removed})`);
      const items = args.slice(2);
      if (items.length > 0) {
        emit(`call void @fsh_rt_array_open(ptr ${at}, i64 ${start}, i64 ${items.length}, i64 ${size})`);
        placed(items, start);
      }
      const v = temp();
      emit(`${v} = load ${ARRAY}, ptr ${removed}`);
      if (!types.has(e)) pending.push({ v, type: array });
      return v;
    }
    // `fill`: a copy of the value in each slot of the range, then the value itself dropped.
    const given = args[0]!;
    const from = args[1] !== undefined ? position(args[1], length) : "0";
    const to = args[2] !== undefined ? position(args[2], length) : length;
    const index = alloca("i64");
    emit(`store i64 ${from}, ptr ${index}`);
    const [head, body, done] = [label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more, dataAt, data, slot, old, after] = [temp(), temp(), temp(), temp(), temp(), temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${to}`);
    emit(`br i1 ${more}, label %${body}, label %${done}`);
    startBlock(body);
    const copy = copied(given, element);
    emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
    emit(`${old} = load ${t}, ptr ${slot}`);
    emit(`store ${t} ${copy}, ptr ${slot}`);
    dispose(old, element);
    emit(`${after} = add i64 ${i}, 1`);
    emit(`store i64 ${after}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    dispose(given, element);
    return undefined;
  }

  // Where `lastIndexOf` searches back from, as an end past it: a negative position counts from
  // the end, and one past the last element starts at the last.
  function lastFrom(v: string, length: string): string {
    const [negative, fromEnd, k, last, past, kept, end] = [temp(), temp(), temp(), temp(), temp(), temp(), temp()];
    emit(`${negative} = icmp slt i64 ${v}, 0`);
    emit(`${fromEnd} = add i64 ${length}, ${v}`);
    emit(`${k} = select i1 ${negative}, i64 ${fromEnd}, i64 ${v}`);
    emit(`${last} = sub i64 ${length}, 1`);
    emit(`${past} = icmp sgt i64 ${k}, ${last}`);
    emit(`${kept} = select i1 ${past}, i64 ${last}, i64 ${k}`);
    emit(`${end} = add i64 ${kept}, 1`);
    return end;
  }

  // `concat` and `flat`: a new array of clones, of this array's elements then each argument's,
  // or of the elements of each array this one holds.
  function gathered(e: Extract<Expr, { kind: "call" }>, method: string, array: ArrayType, at: string): string {
    const result = types.get(e) ?? (method === "concat" ? array : lower(array.element));
    const out = alloca(ARRAY);
    emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    // Each element of the array at `from`, cloned onto the end of the result.
    const cloneAll = (from: string, element: Type, each?: (slot: string) => void) => {
      const [lengthAt, dataAt, length, data, index] = [temp(), temp(), temp(), temp(), alloca("i64")];
      emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${from}, i32 0, i32 1`);
      emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${from}, i32 0, i32 0`);
      emit(`${length} = load i64, ptr ${lengthAt}`);
      emit(`${data} = load ptr, ptr ${dataAt}`);
      emit(`store i64 0, ptr ${index}`);
      const [head, body, done] = [label(), label(), label()];
      emit(`br label %${head}`);
      startBlock(head);
      const [i, more, slot, after] = [temp(), temp(), temp(), temp()];
      emit(`${i} = load i64, ptr ${index}`);
      emit(`${more} = icmp slt i64 ${i}, ${length}`);
      emit(`br i1 ${more}, label %${body}, label %${done}`);
      startBlock(body);
      emit(`${slot} = getelementptr ${llvm(element)}, ptr ${data}, i64 ${i}`);
      if (each) each(slot);
      else {
        const v = temp();
        emit(`${v} = load ${llvm(element)}, ptr ${slot}`);
        appended(out, element, copied(v, element));
      }
      emit(`${after} = add i64 ${i}, 1`);
      emit(`store i64 ${after}, ptr ${index}`);
      emit(`br label %${head}`);
      startBlock(done);
    };
    if (method === "flat") {
      const inner = array.element as ArrayType;
      cloneAll(at, array.element, (slot) => cloneAll(slot, inner.element));
    } else {
      // The arguments run first, as in JavaScript, before anything is cloned.
      const sources = e.args.map((a) => value(a));
      cloneAll(at, array.element);
      for (const from of sources) cloneAll(from, array.element);
    }
    const v = temp();
    emit(`${v} = load ${ARRAY}, ptr ${out}`);
    if (!types.has(e)) pending.push({ v, type: result });
    return v;
  }

  // A position as JavaScript reads one against a length: a negative one counts from the end,
  // and either is kept between 0 and the length.
  function position(v: string, length: string): string {
    const [negative, fromEnd, low, high, past, kept, result] = [temp(), temp(), temp(), temp(), temp(), temp(), temp()];
    emit(`${negative} = icmp slt i64 ${v}, 0`);
    emit(`${fromEnd} = add i64 ${length}, ${v}`);
    emit(`${low} = icmp slt i64 ${fromEnd}, 0`);
    emit(`${high} = select i1 ${low}, i64 0, i64 ${fromEnd}`);
    emit(`${past} = icmp sgt i64 ${v}, ${length}`);
    emit(`${kept} = select i1 ${past}, i64 ${length}, i64 ${v}`);
    emit(`${result} = select i1 ${negative}, i64 ${high}, i64 ${kept}`);
    return result;
  }

  // `includes`, `indexOf`, `join` and `slice`: one loop over the elements from a start
  // position, reading each where it lives.
  function readingLoop(e: Extract<Expr, { kind: "call" }>, method: string, array: ArrayType, at: string): string | undefined {
    const element = array.element;
    const t = llvm(element);
    const [lengthAt, dataAt, length, data] = [temp(), temp(), temp(), temp()];
    emit(`${lengthAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 1`);
    emit(`${dataAt} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 0`);
    emit(`${length} = load i64, ptr ${lengthAt}`);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    const args = e.args.map((a) => value(a));
    const searching = method === "includes" || method === "indexOf" || method === "lastIndexOf";
    const from = method === "slice" ? args[0] : args[1];
    const start = method !== "join" && method !== "lastIndexOf" && from ? position(from, length) : "0";
    // `lastIndexOf` looks at every element up to where it starts searching back from, and keeps
    // the last it finds.
    const end = method === "slice" && args[1] ? position(args[1], length) : method === "lastIndexOf" && from ? lastFrom(from, length) : length;
    const result: Type = searching ? (method === "includes" ? "boolean" : "i64") : method === "join" ? "string" : array;
    const out = alloca(llvm(result));
    if (searching) emit(`store ${llvm(result)} ${method === "includes" ? "false" : "-1"}, ptr ${out}`);
    else if (method === "join") emit(`store ptr ${text("")}, ptr ${out}`);
    else emit(`store ${ARRAY} zeroinitializer, ptr ${out}`);
    const index = alloca("i64");
    emit(`store i64 ${start}, ptr ${index}`);
    const [head, body, next, done] = [label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${end}`);
    emit(`br i1 ${more}, label %${body}, label %${done}`);
    startBlock(body);
    const [slot, v] = [temp(), temp()];
    emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
    emit(`${v} = load ${t}, ptr ${slot}`);
    if (searching) {
      const hit = label();
      let same = equals(v, element, args[0]!, valueType(e.args[0]!));
      // `includes` finds NaN, as JavaScript's SameValueZero does; `indexOf` never does.
      if (method === "includes" && isFloat(lower(element)) && isFloat(lower(valueType(e.args[0]!)))) {
        const [here, there, both, either] = [temp(), temp(), temp(), temp()];
        emit(`${here} = fcmp uno ${t} ${v}, ${v}`);
        emit(`${there} = fcmp uno ${llvm(lower(valueType(e.args[0]!)))} ${args[0]}, ${args[0]}`);
        emit(`${both} = and i1 ${here}, ${there}`);
        emit(`${either} = or i1 ${same}, ${both}`);
        same = either;
      }
      emit(`br i1 ${same}, label %${hit}, label %${next}`);
      startBlock(hit);
      emit(`store ${llvm(result)} ${method === "includes" ? "true" : i}, ptr ${out}`);
      emit(`br label %${method === "lastIndexOf" ? next : done}`);
    } else if (method === "join") {
      // ponytail: each element copies the text so far, quadratic in the result's length; an
      // in-place append of a uniquely owned string makes it linear.
      const so = temp();
      emit(`${so} = load ptr, ptr ${out}`);
      const [first, separated, joined] = [temp(), label(), label()];
      emit(`${first} = icmp eq i64 ${i}, 0`);
      const from = block;
      emit(`br i1 ${first}, label %${joined}, label %${separated}`);
      startBlock(separated);
      const withSep = concat(so, args[0] ?? text(","));
      emit(`call void @fsh_rt_str_release(ptr ${so})`);
      const sepEnd = block;
      emit(`br label %${joined}`);
      startBlock(joined);
      const before = temp();
      emit(`${before} = phi ptr [ ${so}, %${from} ], [ ${withSep}, %${sepEnd} ]`);
      const mark = pending.length;
      const base = lower(element);
      const plain = isInteger(base) || isFloat(base) || base === "boolean";
      const piece = plain ? written(v, base) : written(convert(v, element, "string"), "string");
      const made = pending.splice(mark);
      const after = concat(before, piece);
      emit(`call void @fsh_rt_str_release(ptr ${before})`);
      for (const p of made) dispose(p.v, p.type);
      emit(`store ptr ${after}, ptr ${out}`);
      emit(`br label %${next}`);
    } else {
      appended(out, element, copied(v, element));
      emit(`br label %${next}`);
    }
    startBlock(next);
    const after = temp();
    emit(`${after} = add i64 ${i}, 1`);
    emit(`store i64 ${after}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    const r = temp();
    emit(`${r} = load ${llvm(result)}, ptr ${out}`);
    if (!types.has(e) && needsDrop(result)) pending.push({ v: r, type: result });
    return r;
  }

  // The size in bytes of `count` elements, as LLVM lays them out.
  function bytes(element: Type, count: string): string {
    const [end, size] = [temp(), temp()];
    emit(`${end} = getelementptr ${llvm(element)}, ptr null, i64 ${count}`);
    emit(`${size} = ptrtoint ptr ${end} to i64`);
    return size;
  }

  // An array value from its buffer, length and capacity.
  function built(data: string, length: string, capacity: string): string {
    const [a, b, c] = [temp(), temp(), temp()];
    emit(`${a} = insertvalue ${ARRAY} undef, ptr ${data}, 0`);
    emit(`${b} = insertvalue ${ARRAY} ${a}, i64 ${length}, 1`);
    emit(`${c} = insertvalue ${ARRAY} ${b}, i64 ${capacity}, 2`);
    return c;
  }

  // Runs `each` with a pointer to each of the first `length` elements of a buffer, and its index.
  function elements(element: Type, data: string, length: string, each: (at: string, i: string) => void) {
    const counter = alloca("i64");
    emit(`store i64 0, ptr ${counter}`);
    const [test, loop, end] = [label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${counter}`);
    emit(`${more} = icmp ult i64 ${i}, ${length}`);
    emit(`br i1 ${more}, label %${loop}, label %${end}`);
    startBlock(loop);
    const at = temp();
    emit(`${at} = getelementptr ${llvm(element)}, ptr ${data}, i64 ${i}`);
    each(at, i);
    const next = temp();
    emit(`${next} = add i64 ${i}, 1`);
    emit(`store i64 ${next}, ptr ${counter}`);
    emit(`br label %${test}`);
    startBlock(end);
  }

  // `push` moves its argument in at the end, growing the buffer when full; `pop` takes the last
  // element out as an Option, empty when there is none. Both work on the array where it lives.
  function arrayCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string | undefined {
    const type = valueType(callee.object) as ArrayType;
    const t = llvm(type.element);
    const at = receiver(callee.object);
    const [lengthAt, dataAt] = [temp(), temp()];
    const field = (to: string, i: number) => emit(`${to} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 ${i}`);
    if (callee.name === "push") {
      appended(at, type.element, owned(e.args[0]!));
      return undefined;
    }
    if (callee.name === "sort") return sorted(e, type, at);
    if (callee.name === "at") return elementAt(e, type, at);
    if (callee.name === "reserve") {
      // A count below zero panics, which drops what is live here.
      unwinding(`call void @fsh_rt_array_grow(ptr ${at}, i64 ${value(e.args[0]!)}, i64 ${bytes(type.element, "1")}, ptr ${panicAt(e)})`);
      return undefined;
    }
    if (callee.name === "shrinkToFit") {
      emit(`call void @fsh_rt_array_shrink(ptr ${at}, i64 ${bytes(type.element, "1")})`);
      return undefined;
    }
    if (callee.name === "concat" || callee.name === "flat") return gathered(e, callee.name, type, at);
    if (["shift", "unshift", "splice", "reverse", "fill"].includes(callee.name)) return changed(e, callee.name, type, at);
    if (["includes", "indexOf", "lastIndexOf", "join", "slice"].includes(callee.name)) return readingLoop(e, callee.name, type, at);
    if (callee.name !== "pop") return callbackLoop(e, callee.name, type, at);
    const option = unionType([type.element, "null"]);
    field(lengthAt, 1);
    const [length, empty, some, none, end] = [temp(), temp(), label(), label(), label()];
    emit(`${length} = load i64, ptr ${lengthAt}`);
    emit(`${empty} = icmp eq i64 ${length}, 0`);
    emit(`br i1 ${empty}, label %${none}, label %${some}`);
    startBlock(some);
    const [last, data, slot, v] = [temp(), temp(), temp(), temp()];
    emit(`${last} = sub i64 ${length}, 1`);
    emit(`store i64 ${last}, ptr ${lengthAt}`);
    field(dataAt, 0);
    emit(`${data} = load ptr, ptr ${dataAt}`);
    emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${last}`);
    emit(`${v} = load ${t}, ptr ${slot}`);
    const held = convert(v, type.element, option);
    const someEnd = block;
    emit(`br label %${end}`);
    startBlock(none);
    const nothing = convert("zeroinitializer", "null", option);
    const noneEnd = block;
    emit(`br label %${end}`);
    startBlock(end);
    const result = temp();
    emit(`${result} = phi ${llvm(option)} [ ${held}, %${someEnd} ], [ ${nothing}, %${noneEnd} ]`);
    // Used as a statement, the call has no type of its own; what it took out drops after it.
    if (types.has(e)) return convert(result, option, types.get(e)!);
    pending.push({ v: result, type: option });
    return result;
  }

  // A pointer to an array's element, after the bounds check.
  // An array that is a place is read after the index runs, which may change it; a temporary
  // one runs first, as JavaScript runs an index's object. An index an assignment already ran is
  // reused, with the bounds checked again.
  function element(e: Extract<Expr, { kind: "index" }>): string {
    const held = types.get(e.object)!;
    const inline = isRef(held) ? held.to : held;
    if (typeof inline !== "string" && inline.kind === "fixed") return fixedElement(e, inline);
    const type = valueType(e.object) as ArrayType;
    let index = fixed.get(e.index);
    let array: string;
    if (index === undefined && !lendable(e.object)) {
      array = value(e.object);
      index = value(e.index);
    } else {
      index ??= value(e.index);
      array = value(e.object);
    }
    const [data, length, at] = [temp(), temp(), temp()];
    emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
    bounds(length, index, e);
    emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
    emit(`${at} = getelementptr ${llvm(type.element)}, ptr ${data}, i64 ${index}`);
    return at;
  }

  // `FixedArray.filled<T, N>(v)`: a copy of `v` in each slot but the last, which takes `v`
  // itself, filled in a loop so a large one stays small.
  function fixedFilled(e: Extract<Expr, { kind: "call" }>, type: FixedType): string {
    const element = type.element;
    const v = owned(e.args[0]!);
    if (type.size === 0) {
      dispose(v, element);
      return "undef";
    }
    const at = alloca(llvm(type));
    const index = alloca("i64");
    emit(`store i64 0, ptr ${index}`);
    const [head, body, done] = [label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp ult i64 ${i}, ${type.size - 1}`);
    emit(`br i1 ${more}, label %${body}, label %${done}`);
    startBlock(body);
    const [slot, after] = [temp(), temp()];
    emit(`${slot} = getelementptr ${llvm(type)}, ptr ${at}, i64 0, i64 ${i}`);
    emit(`store ${llvm(element)} ${copied(v, element)}, ptr ${slot}`);
    emit(`${after} = add i64 ${i}, 1`);
    emit(`store i64 ${after}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    const last = temp();
    emit(`${last} = getelementptr ${llvm(type)}, ptr ${at}, i64 0, i64 ${type.size - 1}`);
    emit(`store ${llvm(element)} ${v}, ptr ${last}`);
    const result = temp();
    emit(`${result} = load ${llvm(type)}, ptr ${at}`);
    if (!types.has(e) && needsDrop(type)) pending.push({ v: result, type });
    return result;
  }

  // A pointer to a fixed array's element, after the bounds check against its known length: the
  // array is where it lives, through a reference, or a temporary spilled to a slot.
  function fixedElement(e: Extract<Expr, { kind: "index" }>, type: FixedType): string {
    const held = types.get(e.object)!;
    let index = fixed.get(e.index);
    let base: string;
    if (isRef(held)) {
      base = evaluate(e.object);
      index ??= value(e.index);
    } else if (lendable(e.object)) {
      index ??= value(e.index);
      base = address(e.object);
    } else {
      const v = value(e.object);
      index ??= value(e.index);
      base = alloca(llvm(type));
      emit(`store ${llvm(type)} ${v}, ptr ${base}`);
    }
    bounds(String(type.size), index, e);
    const at = temp();
    emit(`${at} = getelementptr ${llvm(type)}, ptr ${base}, i64 0, i64 ${index}`);
    return at;
  }

  // Whether an expression makes a value of its own, rather than reading one that lives somewhere.
  // A conditional or `??` makes one from whichever side it gives.
  function fresh(e: Expr): boolean {
    if (!needsDrop(types.get(e))) return false;
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
        return true;
      // An awaited future gives its value over.
      case "unary":
        return e.op === "await";
      case "binary":
        return e.op === "+" || e.op === "??";
      case "member":
        return calls.has(e) || current.copiesOut.has(e) || computed.has(e);
      // A string's index makes a string; an array's reads an element.
      case "index":
        return !indexes(valueType(e.object));
      default:
        return false;
    }
  }

  // An expression's value for a place to own: one it made, the value of a place it moves out
  // of, which is left empty, or else a copy holding another reference to what it owns. A
  // conversion that leaves part of a value behind copies the part it keeps.
  function owned(e: Expr): string {
    const to = coercions.get(e);
    // A value boxed into a Dyn: the block takes it, moved out of its place or made for it, or
    // else a copy of it.
    if (to && isDyn(to) && !isDyn(types.get(e)!)) {
      const type = types.get(e)!;
      let v = known.get(e) ?? evaluate(e);
      if (current.consumes.has(e) && lendable(e)) emit(`store ${llvm(e.kind === "member" ? stored(e) : type)} zeroinitializer, ptr ${address(e)}`);
      else if (!fresh(e)) v = copied(v, type);
      return box(v, type, to);
    }
    const whole = !to || keepsAll(types.get(e)!, to);
    if (whole && fresh(e)) return value(e, true);
    const v = value(e);
    if (whole && current.consumes.has(e) && lendable(e)) {
      emit(`store ${llvm(e.kind === "member" ? stored(e) : types.get(e)!)} zeroinitializer, ptr ${address(e)}`);
      return v;
    }
    return e.kind === "string" ? v : copied(v, valueType(e));
  }

  // Whether converting a value from one type to another keeps all it owns: putting it in a
  // union, taking a union's member out, or moving it to a union holding all its members.
  function keepsAll(from: Type, to: Type): boolean {
    const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
    return !needsDrop(from) || isDyn(to) || members(from).every((m) => members(to).includes(m)) || members(from).includes(to);
  }

  // A receiver copied into a slot for an owning method: the copy is its own, pending until the
  // call takes it.
  function spill(slot: string, type: Type, v: string): string {
    const copy = { v: copied(v, type), type };
    pending.push(copy);
    spills.push({ slot, type, copy });
    return copy.v;
  }

  // A value read for an operand. One read from a place takes a reference of its own while a
  // later operand that might change the place runs, released when the statement ends.
  function operand(e: Expr, later: Expr[]): string {
    const v = value(e);
    const type = valueType(e);
    if (!needsDrop(type) || fresh(e) || e.kind === "string" || !later.some(writes)) return v;
    const copy = copied(v, type);
    pending.push({ v: copy, type });
    return copy;
  }

  // Whether running an expression might change a place: it assigns, updates or calls.
  function writes(node: unknown): boolean {
    if (typeof node !== "object" || node === null) return false;
    if (Array.isArray(node)) return node.some(writes);
    const kind = (node as { kind?: string }).kind;
    if (kind === "arrow") return false;
    if (kind === "assign" || kind === "update" || kind === "call" || kind === "new") return true;
    if (kind === "member" && calls.has(node as Expr)) return true;
    return Object.values(node).some(writes);
  }

  // Owned values handed to something not yet called or built: dropped if an error leaves before
  // it takes them.
  function delivered<T>(make: (hand: (v: string, type: Type) => string) => T): T {
    const handed: { v: string; type: Type }[] = [];
    const result = make((v, type) => {
      const entry = { v, type };
      pending.push(entry);
      handed.push(entry);
      return v;
    });
    pending = pending.filter((entry) => !handed.includes(entry));
    return result;
  }

  // Releases the values made since `mark` that nothing took over, newest first.
  function settle(mark = floor) {
    for (const { v, type } of pending.splice(mark).reverse()) dispose(v, type);
  }

  // A variable the innermost scope owns. Its slot starts empty, so dropping it before it is set,
  // or again after, does nothing.
  function own(at: string, type: Type, empty = true) {
    if (!needsDrop(type)) return;
    if (empty && !framed.has(at)) allocas.push(`  store ${llvm(type)} zeroinitializer, ptr ${at}`);
    scopes.at(-1)!.push({ slot: at, type });
  }

  // Drops what the scopes from `depth` inward own, innermost and newest first, emptying each.
  function drop(depth: number) {
    for (const scope of scopes.slice(depth).reverse()) {
      for (const { slot, type } of [...scope].reverse()) {
        const v = temp();
        emit(`${v} = load ${llvm(type)}, ptr ${slot}`);
        emit(`store ${llvm(type)} zeroinitializer, ptr ${slot}`);
        dispose(v, type);
      }
    }
  }

  function scoped(body: Stmt[]) {
    scopes.push([]);
    body.forEach(statement);
    drop(scopes.length - 1);
    scopes.pop();
  }

  // Returns the call's result, or undefined for a call that returns nothing.
  function compare(type: string, a: string, b: string): string {
    const result = temp();
    emit(`${result} = ${type === "float" || type === "double" ? "fcmp oeq" : "icmp eq"} ${type} ${a}, ${b}`);
    return result;
  }

  // A method's receiver runs before its arguments, as in JavaScript. A method called in an
  // optional chain runs only when the chain isn't empty.
  function call(e: Extract<Expr, { kind: "call" }>): string | undefined {
    if (fixedFills.has(e)) return fixedFilled(e, types.get(e) as FixedType);
    if (e.callee.kind === "member" && unwraps(e.callee.object)) return link(e, e.callee.object, () => run(e));
    return run(e);
  }

  function run(e: Extract<Expr, { kind: "call" }>): string | undefined {
    const target = calls.get(e);
    if (!target) {
      if (isPrint(e.callee)) {
        print(e.args, builder, (a) => operand(a, e.args.slice(e.args.indexOf(a) + 1)), valueType, convert);
        return undefined;
      }
      // `Shape.Circle(1.5)`: a variant built from its payload, each value handed to it. Used as a
      // statement, it is dropped after it.
      const built = types.get(e.callee);
      if (built && typeof built !== "string" && built.kind === "variant") {
        const values = delivered((hand) => e.args.map((a, i) => hand(owned(a), built.fields[i]!.type)));
        let result = "zeroinitializer";
        values.forEach((v, i) => {
          const next = temp();
          emit(`${next} = insertvalue ${llvm(built)} ${result === "zeroinitializer" ? "undef" : result}, ${llvm(built.fields[i]!.type)} ${v}, ${i}`);
          result = next;
        });
        if (!types.has(e)) pending.push({ v: result, type: built });
        return result;
      }
      // `ptrOf(r)` and `mutPtrOf(m)`: the address its argument is lent at.
      if (e.callee.kind === "ident" && (e.callee.name === "ptrOf" || e.callee.name === "mutPtrOf")) return value(e.args[0]!);
      if (e.callee.kind === "ident" && e.callee.name === "nullPtr") return "null";
      if (maths.has(e)) return mathCall(e);
      if (parses.has(e)) return parseCall(e, parses.get(e)!);
      if (fixedPrints.has(e)) return toFixed(e);
      if (e.callee.kind === "ident" && e.callee.name === "fill length") {
        const n = value(e.args[0]!);
        if (!lengthChecks.has(e)) return n;
        const [negative, fail, ok] = [temp(), label(), label()];
        emit(`${negative} = icmp slt i64 ${n}, 0`);
        emit(`br i1 ${negative}, label %${fail}, label %${ok}`);
        startBlock(fail);
        unwinding(`call void @fsh_rt_panic(ptr ${cString(`panicked at ${where(e)}:\ninvalid array length\n`)})`);
        emit("unreachable");
        startBlock(ok);
        return n;
      }
      // `spawn(p)`: the future's frame moves into a new task, whose handle this gives.
      if (e.callee.kind === "ident" && e.callee.name === "spawn") {
        const future = valueType(e.args[0]!) as FutureType;
        const [poll, drop, dropOutput] = taskGlue(future);
        const [frame, task] = [alloca(llvm(future)), temp()];
        emit(`store ${llvm(future)} ${owned(e.args[0]!)}, ptr ${frame}`);
        unwinding(`call ptr @fsh_rt_spawn(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${sizeOf(llvm(future))}, i64 ${sizeOf(pollType(future))})`, task);
        if (!types.has(e)) pending.push({ v: task, type: handleType(future.gives, future.throws) });
        return task;
      }
      // `sleep(ms)`'s future holds the delay until its first poll makes it a deadline.
      if (e.callee.kind === "ident" && e.callee.name === "sleep") {
        const future = (types.get(e) ?? SLEEP) as FutureType;
        const made = temp();
        emit(`${made} = insertvalue ${llvm(future)} zeroinitializer, i64 ${value(e.args[0]!)}, 1`);
        return signalled(e, future, made);
      }
      // `yieldNow()`'s future is its one state, not yet polled.
      if (e.callee.kind === "ident" && e.callee.name === "yieldNow") return "zeroinitializer";
      if (e.callee.kind === "ident" && e.callee.name === "cString") return forC(value(e.args[0]!), e);
      if (e.callee.kind === "ident" && e.callee.name === "shared" && !locals.has(e.callee)) {
        const made = sharedNew(e);
        if (!types.has(e)) pending.push({ v: made, type: valueType(e) });
        return made;
      }
      // `TcpListener.bind` and `TcpStream.connect` make a future holding the address; connect's
      // frame also keeps the socket while it connects.
      if (e.callee.kind === "member" && e.callee.object.kind === "ident" && (e.callee.object.name === "TcpListener" || e.callee.object.name === "TcpStream") && !types.has(e.callee.object)) {
        const future = types.get(e) as FutureType;
        const first = e.callee.object.name === "TcpStream" ? 2 : 1;
        const [host, port, made, frame] = [owned(e.args[0]!), value(e.args[1]!), temp(), temp()];
        emit(`${made} = insertvalue ${llvm(future)} zeroinitializer, ptr ${host}, ${first}`);
        emit(`${frame} = insertvalue ${llvm(future)} ${made}, i64 ${port}, ${first + 1}`);
        return signalled(e, future, frame);
      }
      if (e.callee.kind === "member" && e.callee.object.kind === "ident" && e.callee.object.name === "AbortSignal" && !types.has(e.callee.object)) {
        const made = temp();
        emit(`${made} = call ptr @fsh_rt_signal_timeout(i64 ${value(e.args[0]!)})`);
        if (!types.has(e)) pending.push({ v: made, type: blockType("AbortSignal") });
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "nowMs" && !calls.has(e)) {
        const made = temp();
        emit(`${made} = call i64 @fsh_rt_now_ms()`);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "httpDate" && !calls.has(e)) {
        const made = temp();
        emit(`${made} = call ptr @fsh_rt_http_date()`);
        if (!types.has(e)) pending.push({ v: made, type: "string" });
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "utf8Encode" && !calls.has(e)) {
        const [bytes, made] = [alloca(ARRAY), temp()];
        emit(`call void @fsh_rt_utf8_encode(ptr ${bytes}, ptr ${value(e.args[0]!)})`);
        emit(`${made} = load ${ARRAY}, ptr ${bytes}`);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "utf8Decode" && !calls.has(e)) {
        const made = temp();
        emit(`${made} = call ptr @fsh_rt_utf8_decode(ptr ${value(e.args[0]!)})`);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "fromCString") {
        const made = temp();
        unwinding(`call ptr @fsh_rt_str_from_cstring(ptr ${value(e.args[0]!)})`, made);
        if (!types.has(e)) pending.push({ v: made, type: "string" });
        return made;
      }
      if (e.callee.kind === "member" && typeof valueType(e.callee.object) !== "string" && (valueType(e.callee.object) as Exclude<Type, string>).kind === "pointer") return pointerCall(e, e.callee);
      if (e.callee.kind === "member" && typeof referent(valueType(e.callee.object)) !== "string" && (referent(valueType(e.callee.object)) as Exclude<Type, string>).kind === "interior") return atomicCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name !== "clone" && typeof referent(valueType(e.callee.object)) !== "string" && (referent(valueType(e.callee.object)) as Exclude<Type, string>).kind === "block") return blockCall(e, e.callee);
      if (dynCalls.has(e)) return dynCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name === "update" && typeof referent(valueType(e.callee.object)) !== "string" && (referent(valueType(e.callee.object)) as Exclude<Type, string>).kind === "shared") {
        const t = referent(valueType(e.callee.object)) as SharedType;
        const block = temp();
        emit(`${block} = load ptr, ptr ${receiver(e.callee.object)}`);
        const lock = temp();
        emit(`${lock} = getelementptr ${sharedBlock(t)}, ptr ${block}, i32 0, i32 1`);
        return lockUpdate(e, interiorType("Lock", t.of), lock);
      }
      // `String(x)`: a number's new string, or another reference to a string. Used as a
      // statement, the call has no type of its own, and the string drops after it.
      if (e.callee.kind === "ident" && e.callee.name === "String") {
        const v = written(value(e.args[0]!), valueType(e.args[0]!));
        const made = pending.at(-1)?.v === v ? pending.pop() : undefined;
        const result = made ? v : copied(v, "string");
        if (!types.has(e)) pending.push({ v: result, type: "string" });
        return result;
      }
      if (e.callee.kind === "member" && e.callee.name !== "clone" && valueType(e.callee.object) === "string") return stringCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name !== "clone" && isArray(valueType(e.callee.object))) return arrayCall(e, e.callee);
      if (e.callee.kind === "member" && e.callee.name !== "clone" && (valueType(e.callee.object) as { kind?: string }).kind === "map") return mapCall(e, e.callee);
      if (e.callee.kind === "member" && typeof valueType(e.callee.object) !== "string" && (valueType(e.callee.object) as Exclude<Type, string>).kind === "generator") {
        const result = resume(valueType(e.callee.object) as GeneratorType, receiver(e.callee.object));
        const type = nextResult((valueType(e.callee.object) as GeneratorType).yields);
        if (!types.has(e) && needsDrop(type)) pending.push({ v: result, type });
        return result;
      }
      // The compiler's `clone()`: a copy holding another reference to what the value owns.
      const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
      if (isDyn(types.get(e)!)) return dynCloned(e, object);
      return copied(convert(value(object), types.get(object)!, types.get(e)!), types.get(e)!);
    }
    const object = e.callee.kind === "member" ? e.callee.object : e.callee.kind === "super" ? e.callee : undefined;
    const before = spills.length;
    // A nested function calling itself runs with the captures it was called with.
    const pointer = target.body.closure ? (selfCalls.has(e) ? "%env" : receiver(e.callee)) : target.body.self && object ? thisPointer(target, object) : undefined;
    const mine = spills.splice(before);
    // A closure may take fewer parameters than the function type it was given as.
    const values = argValues(e.args, target, target.body.closure ? target.body.params.length : e.args.length);
    // Calling a generator or async function makes its frame, holding the arguments, ready to start.
    const machine = target.generator ?? target.future;
    if (machine) {
      let frame = "zeroinitializer";
      // An async arrow's frame starts with its own copy of the closure, and an async method's
      // with its object, then the arguments.
      const method = target.body.self && !target.body.self.constructor;
      const first = target.body.closure || method ? 2 : 1;
      // The frame takes the call's spilled receiver, which then drops nothing of its own.
      pending = pending.filter((entry) => !mine.some((m) => m.copy === entry));
      if (method) {
        const owns = target.body.self!.owned;
        const self = owns ? unstash(pointer!, target.body.self!.type) : pointer!;
        const next = temp();
        emit(`${next} = insertvalue ${llvm(machine)} ${frame}, ${owns ? llvm(target.body.self!.type) : "ptr"} ${self}, 1`);
        frame = next;
      }
      if (target.body.closure) {
        const [env, next] = [temp(), temp()];
        emit(`${env} = load ${llvm(target.closure!)}, ptr ${pointer}`);
        emit(`${next} = insertvalue ${llvm(machine)} ${frame}, ${llvm(target.closure!)} ${copied(env, target.closure!)}, 1`);
        frame = next;
      }
      values.forEach((v, i) => {
        const next = temp();
        emit(`${next} = insertvalue ${llvm(machine)} ${frame}, ${v}, ${i + first}`);
        frame = next;
      });
      if (!types.has(e)) pending.push({ v: frame, type: machine });
      return frame;
    }
    // The call takes the copy; what it leaves, the parts of a derived instance its base's
    // method doesn't drop, is dropped once it returns or raises.
    pending = pending.filter((entry) => !mine.some((m) => m.copy === entry));
    const leftovers = mine.length === 0 ? undefined : () => {
      for (const { slot, type } of mine) dispose(unstash(slot, type), type);
    };
    const result = invoke(target, pointer, values, e, leftovers);
    // A call through a type parameter returns what its bound's method declares.
    return result && types.has(e) ? convert(result, target.returns, types.get(e)!) : result;
  }

  // A call's arguments, typed, then an empty value for each optional parameter it leaves out.
  // Arguments past `taken` run for their effects only.
  function argValues(args: Expr[], target: Instance, taken = args.length): string[] {
    // A comptime parameter's argument was computed while compiling, and isn't passed.
    const passed = (i: number) => !target.body.params[i]?.comptime;
    const values = delivered((hand) => args.flatMap((a, i) => (!passed(i) ? [] : i < taken ? [`${llvm(valueType(a))} ${hand(owned(a), valueType(a))}`] : (value(a), []))));
    // A left-out optional parameter is empty, and a left-out rest parameter an empty array.
    for (const p of target.body.params.slice(args.length)) {
      const type = target.locals.get(p)!.type;
      values.push(`${llvm(type)} ${p.rest ? "zeroinitializer" : convert("zeroinitializer", "null", type)}`);
    }
    return values;
  }

  // A string method's call. The string is read before its arguments run, as in JavaScript. In
  // an optional chain, the result is the chain's Option.
  function stringCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string {
    const s = operand(callee.object, e.args);
    const args = e.args.map((a) => value(a));
    const result = temp();
    // A call used as a statement has no type of its own; a string it makes is released when the
    // statement ends.
    const given = (v: string, type: Type) => {
      if (types.has(e)) return convert(v, type, types.get(e)!);
      if (needsDrop(type)) pending.push({ v, type });
      return v;
    };
    switch (callee.name) {
      case "charCodeAt":
        inBounds(s, args[0]!, e);
        emit(`${result} = call i16 @fsh_rt_str_unit(ptr ${s}, i64 ${args[0]})`);
        return given(result, "u16");
      case "slice":
      case "substring":
        emit(`${result} = call ptr @fsh_rt_str_${callee.name}(ptr ${s}, i64 ${args[0]}, i64 ${args[1] ?? 0}, i32 ${args.length - 1})`);
        return given(result, "string");
      // A missing position is the start, or for endsWith, the end, which the runtime clamps to.
      case "indexOf":
        emit(`${result} = call i64 @fsh_rt_str_index_of(ptr ${s}, ptr ${args[0]}, i64 ${args[1] ?? 0})`);
        return given(result, "i64");
      case "includes": {
        const found = temp();
        emit(`${found} = call i64 @fsh_rt_str_index_of(ptr ${s}, ptr ${args[0]}, i64 ${args[1] ?? 0})`);
        emit(`${result} = icmp sge i64 ${found}, 0`);
        return given(result, "boolean");
      }
      // An array comes back through memory, as C and LLVM return aggregates differently.
      case "split": {
        const out = alloca(ARRAY);
        emit(`call void @fsh_rt_str_split(ptr ${out}, ptr ${s}, ptr ${args[0] ?? "null"}, i64 ${args[1] ?? "4294967295"})`);
        emit(`${result} = load ${ARRAY}, ptr ${out}`);
        return given(result, arrayType("string"));
      }
      case "replace":
        emit(`${result} = call ptr @fsh_rt_str_replace(ptr ${s}, ptr ${args[0]}, ptr ${args[1]})`);
        return given(result, "string");
      case "padStart":
      case "padEnd":
        // These two may panic, so a panic in them drops what is live here.
        unwinding(`call ptr @fsh_rt_str_pad(ptr ${s}, i64 ${args[0]}, ptr ${args[1] ?? "null"}, i32 ${callee.name === "padStart" ? 1 : 0}, ptr ${panicAt(e)})`, result);
        return given(result, "string");
      case "repeat":
        unwinding(`call ptr @fsh_rt_str_repeat(ptr ${s}, i64 ${args[0]}, ptr ${panicAt(e)})`, result);
        return given(result, "string");
      case "toUpperCase":
      case "toLowerCase":
        emit(`${result} = call ptr @fsh_rt_str_case(ptr ${s}, i32 ${callee.name === "toUpperCase" ? 1 : 0})`);
        return given(result, "string");
      case "trim":
      case "trimStart":
      case "trimEnd":
        emit(`${result} = call ptr @fsh_rt_str_trim(ptr ${s}, i32 ${callee.name === "trimStart" ? 1 : callee.name === "trimEnd" ? 2 : 3})`);
        return given(result, "string");
      case "startsWith":
      case "endsWith": {
        const yes = temp();
        const name = callee.name === "startsWith" ? "starts_with" : "ends_with";
        emit(`${yes} = call i32 @fsh_rt_str_${name}(ptr ${s}, ptr ${args[0]}, i64 ${args[1] ?? (callee.name === "startsWith" ? 0 : "9223372036854775807")})`);
        emit(`${result} = icmp ne i32 ${yes}, 0`);
        return given(result, "boolean");
      }
    }
    throw new Error(`internal error: no lowering for the string method ${callee.name}`);
  }

  // The "panicked at" line for a panic the runtime raises at an expression.
  function panicAt(at: Expr): string {
    return cString(`panicked at ${where(at)}:\n`);
  }

  // `file:line:col` of an expression, in the program or the std library.
  function where(at: Span): string {
    const place = sourceOf(src, file, at.start, sources);
    const { line, col } = locate(place.src, place.offset);
    return `${place.file}:${line}:${col}`;
  }

  function units(s: string): string {
    const result = temp();
    emit(`${result} = call i64 @fsh_rt_str_units(ptr ${s})`);
    return result;
  }

  // Panics, as Rust's indexing does, unless a `usize` index is below the string's UTF-16 length.
  function inBounds(s: string, index: string, at: Expr) {
    bounds(units(s), index, at);
  }

  // Panics, as Rust's indexing does, unless a `usize` index is below a length.
  function bounds(length: string, index: string, at: Expr) {
    const [outside, fail, ok] = [temp(), label(), label()];
    emit(`${outside} = icmp uge i64 ${index}, ${length}`);
    emit(`br i1 ${outside}, label %${fail}, label %${ok}`);
    startBlock(fail);
    unwinding(`call void @fsh_rt_panic_bounds(ptr ${cString(`panicked at ${where(at)}:\n`)}, i64 ${length}, i64 ${index})`);
    emit("unreachable");
    startBlock(ok);
  }

  function assign(e: Extract<Expr, { kind: "assign" }>): string {
    const op = ASSIGNMENTS[e.op]!;
    // `&&=` and `||=` skip the right side as `&&` and `||` do, and assign only when they
    // run it, which matters when the target is a setter.
    if (op === "&&" || op === "||") return logical(op, value(e.target), () => store(e.target, value(e.value)));
    // The target is read before the right-hand side runs, as in JavaScript.
    const type = types.get(e)!;
    if (op === "+" && type === "string") {
      return store(e.target, concat(operand(e.target, [e.value]), written(value(e.value), valueType(e.value))));
    }
    return store(e.target, op === "=" ? owned(e.value) : numeric(op, value(e.target), value(e.value), e, type));
  }

  // Runs an assignment to a target, having first run the indexes into arrays along its path,
  // outermost first, so each runs once and before the value, as in JavaScript.
  function fixing(target: Expr, run: () => string): string {
    const nodes: Expr[] = [];
    for (let e = target; e.kind === "member" || e.kind === "index"; e = e.object) if (e.kind === "index" && indexes(valueType(e.object))) nodes.unshift(e.index);
    for (const index of nodes) fixed.set(index, value(index));
    const result = run();
    for (const index of nodes) fixed.delete(index);
    return result;
  }

  // A field read, or a getter's result.
  function member(e: Extract<Expr, { kind: "member" }>): string {
    if (current.copiesOut.has(e)) return copyOut(e);
    if (computed.has(e)) return isDyn(referent(types.get(e.object)!)) ? dynField(e) : blockProperty(e);
    const getter = calls.get(e);
    if (getter) return convert(invoke(getter, thisPointer(getter, e.object), [])!, getter.returns, types.get(e)!);
    // An enum member's value is known, and the enum's name is no value to evaluate.
    if (!types.has(e.object)) return "zeroinitializer";
    // Inside a shared value's block only this field is read: its neighbours change unlocked.
    if (inBlock(e)) {
      const read = temp();
      emit(`${read} = load ${llvm(stored(e))}, ptr ${address(e)}`);
      return convert(read, stored(e), types.get(e)!);
    }
    // Through a reference, the value it points to.
    const shared = coercions.get(e.object) ?? types.get(e.object)!;
    const whole = () => {
      if (!inBlock(e.object)) return value(e.object);
      const read = temp();
      emit(`${read} = load ${llvm(stored(e.object))}, ptr ${address(e.object)}`);
      return read;
    };
    if (shared === "string") return convert(units(whole()), "usize", types.get(e)!);
    // A fixed array's length is known while compiling; what it is read from still runs, and an
    // index into it is still checked.
    if (typeof shared !== "string" && shared.kind === "fixed") {
      if (e.object.kind !== "ident" && e.object.kind !== "this") whole();
      return convert(String(shared.size), "usize", types.get(e)!);
    }
    if (typeof shared !== "string" && shared.kind === "map") {
      const size = temp();
      emit(`${size} = call i64 @fsh_rt_map_size(ptr ${whole()})`);
      return convert(size, "usize", types.get(e)!);
    }
    if (typeof shared !== "string" && shared.kind === "array") {
      const length = temp();
      emit(`${length} = extractvalue ${ARRAY} ${whole()}, ${e.name === "capacity" ? 2 : 1}`);
      return convert(length, "usize", types.get(e)!);
    }
    if (typeof shared !== "string" && shared.kind === "union") return unionField(whole(), shared, e.name, types.get(e)!);
    const object = shared as ObjectType | ClassType;
    const result = temp();
    emit(`${result} = extractvalue ${llvm(object)} ${value(e.object)}, ${fieldPath(object, e.name).join(", ")}`);
    // A field read through an interface or object parameter takes the type its bound declares.
    return convert(result, field(object, e.name)!.type, types.get(e)!);
  }

  // Whether a field read reaches into a shared value's block through its interior-mutable
  // fields, where it is read in place.
  function inBlock(e: Expr): boolean {
    for (; e.kind === "member" && !calls.has(e); e = e.object) {
      const holder = referent(types.get(e.object)!);
      if (typeof holder !== "string" && holder.kind === "shared") return !current.copiesOut.has(e);
      if (typeof holder === "string" || (holder.kind !== "object" && holder.kind !== "class")) return false;
    }
    return false;
  }

  // A shared value's block, and a pointer to one of its value's fields.
  function sharedField(e: Extract<Expr, { kind: "member" }>): [string, SharedType, string] {
    const holder = types.get(e.object)!;
    const t = referent(holder) as SharedType;
    const block = isRef(holder) ? temp() : value(e.object);
    if (isRef(holder)) emit(`${block} = load ptr, ptr ${value(e.object)}`);
    const at = temp();
    const path = fieldPath(t.of as ObjectType | ClassType, e.name).map((i) => `i32 ${i}`).join(", ");
    emit(`${at} = getelementptr ${sharedBlock(t)}, ptr ${block}, i32 0, i32 1, i32 1, ${path}`);
    return [block, t, at];
  }

  // A shared value's plain field, copied out while its lock is held.
  function copyOut(e: Extract<Expr, { kind: "member" }>): string {
    const [block, t, at] = sharedField(e);
    const lock = temp();
    emit(`${lock} = getelementptr ${sharedBlock(t)}, ptr ${block}, i32 0, i32 1`);
    takeLock(lock, e);
    const read = temp();
    const type = types.get(e)!;
    emit(`${read} = load ${llvm(type)}, ptr ${at}`);
    const copy = copied(read, type);
    emit(`call void @fsh_rt_unlock(ptr ${lock})`);
    return copy;
  }

  // Whether an expression is an Option a link of an optional chain reads through.
  function unwraps(object: Expr): boolean {
    const option = types.get(object);
    return option !== undefined && isOption(option) && coercions.has(object);
  }

  // A link of an optional chain: empty when the Option it reads through is, and otherwise
  // `compute`, which reads what the Option holds. Its result is already the link's Option.
  function link(e: Expr, object: Expr, compute: () => string | undefined): string | undefined {
    const option = types.get(object) as UnionType;
    const raw = evaluate(object);
    if (fresh(object)) pending.push({ v: raw, type: option });
    known.set(object, raw);
    const [some, none, end] = [label(), label(), label()];
    emit(`br i1 ${holds(raw, option, ["null"])}, label %${none}, label %${some}`);
    startBlock(some);
    const mark = pending.length;
    const got = compute();
    settle(mark);
    const someEnd = block;
    emit(`br label %${end}`);
    startBlock(none);
    const type = types.get(e);
    const empty = got !== undefined && type ? convert("zeroinitializer", "null", type) : undefined;
    const noneEnd = block;
    emit(`br label %${end}`);
    startBlock(end);
    known.delete(object);
    if (got === undefined || !type || empty === undefined) return undefined;
    const result = temp();
    emit(`${result} = phi ${llvm(type)} [ ${got}, %${someEnd} ], [ ${empty}, %${noneEnd} ]`);
    return result;
  }

  // A pointer to the instance a method works on: its receiver, or the base embedded in it
  // that declares the method.
  function thisPointer(target: Instance, object: Expr): string {
    const held = unwraps(object) ? coercions.get(object)! : referent(types.get(object)!);
    return upcast(receiver(object, target.body.self?.owned), held as ClassType, target.body.owner!);
  }

  // Calls a function with its arguments' values, after the instance when it is a method.
  // `after` runs once the call returns, and before an error it raises goes on.
  // `after` runs once the call is over, however it ended; `unwound` only when it panicked.
  function invoke(target: Instance, pointer: string | undefined, args: string[], at?: Expr, after?: () => void, unwound?: () => void): string | undefined {
    const cleanup = after || unwound ? () => (after?.(), unwound?.()) : undefined;
    const type = target.returns;
    const values = pointer ? [`ptr ${pointer}`, ...args] : args;
    // A narrow value crosses to C widened, both ways.
    const passed = target.body.foreign ? values.map((v, i) => v.replace(/^\S+ /, `${crossing(target.signature![i]!)} `)) : values;
    const call = `call ${target.body.foreign ? crossed(type) : resultType(target)} ${symbol(target)}(${passed.join(", ")})`;
    if (type === "void" && !target.throws) {
      unwinding(call, undefined, cleanup);
      after?.();
      return undefined;
    }
    const result = temp();
    unwinding(call, result, cleanup);
    if (!target.throws) {
      after?.();
      return result;
    }
    // A call that failed raises its error where this function sends it.
    const [failed, bad, ok] = [temp(), label(), label()];
    emit(`${failed} = extractvalue ${resultType(target)} ${result}, 0`);
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(bad);
    const error = temp();
    emit(`${error} = extractvalue ${resultType(target)} ${result}, 2`);
    after?.();
    raised(at!, error);
    startBlock(ok);
    after?.();
    if (type === "void") return undefined;
    const got = temp();
    emit(`${got} = extractvalue ${resultType(target)} ${result}, 1`);
    return got;
  }

  // The IR type a function returns: its value, or for a throwing one, whether it failed, then
  // its value (`{}` for none) and its error.
  function resultType(i: Instance): string {
    if (i.generator) return llvm(nextResult(i.generator.yields));
    if (i.future) return pollType(i.future);
    if (!i.throws) return llvm(i.returns);
    return `{ i1, ${i.returns === "void" ? "{}" : llvm(i.returns)}, ${llvm(i.throws)} }`;
  }

  // A `finally` region being emitted: the block its `finally` starts, the slot naming the way
  // control left, each way out with how to resume it, the labels made before the region, and
  // how many catches and scopes enclosed it.
  type Region = { label: string; chosen: string; exits: { key: string; resume: () => void }[]; start: number; handlers: number; depth: number; floor: number; slots: Map<string, { slot: string; type: Type }> };

  function enter(): Region {
    const region = { label: label(), chosen: alloca("i32"), exits: [], start: labels, handlers: handlers.length, depth: scopes.length, floor, slots: new Map() };
    finallies.push(region);
    return region;
  }

  // Leaves a region the way `key` names, through its `finally`, which then resumes it.
  function exit(region: Region, key: string, resume: () => void) {
    let i = region.exits.findIndex((e) => e.key === key);
    if (i < 0) i = region.exits.push({ key, resume }) - 1;
    emit(`store i32 ${i}, ptr ${region.chosen}`);
    emit(`br label %${region.label}`);
  }

  // A slot a region keeps a value in while its `finally` runs.
  function stash(region: Region, key: string, type: Type, v: string): string {
    let slot = region.slots.get(key)?.slot;
    if (!slot) region.slots.set(key, { slot: (slot = alloca(llvm(type))), type });
    emit(`store ${llvm(type)} ${v}, ptr ${slot}`);
    return slot;
  }

  // Takes a value back out of a region's slot, leaving it empty.
  function unstash(slot: string, type: Type): string {
    const v = temp();
    emit(`${v} = load ${llvm(type)}, ptr ${slot}`);
    emit(`store ${llvm(type)} zeroinitializer, ptr ${slot}`);
    return v;
  }

  // Jumps to a label outside the scopes from `depth` inward, dropping what they own, through
  // each `finally` whose region it leaves.
  function jump(to: string, depth: number) {
    const region = finallies.at(-1);
    if (region && Number(to.slice(1)) < region.start) {
      drop(region.depth);
      return exit(region, `jump ${to}`, () => jump(to, depth));
    }
    drop(depth);
    emit(`br label %${to}`);
  }

  // Leaves the function being emitted with a value, or with none, through any `finally`.
  function leave(v: string | undefined) {
    const region = finallies.at(-1);
    drop(region?.depth ?? 0);
    const gives = current.future ? current.future.gives : current.returns;
    if (region) {
      const kept = v === undefined ? undefined : stash(region, "return", gives, v);
      return exit(region, "return", () => leave(kept && unstash(kept, gives)));
    }
    // A generator or a future that finishes stays finished; a future gives its value as it does.
    if (resuming) {
      emit("store i32 -1, ptr %state");
      if (current.future) return emit(`ret ${resultType(current)} ${polled(current.future, 1, v)}`);
      return emit(`br label %${resuming.done}`);
    }
    if (!current.throws) return emit(v === undefined ? "ret void" : `ret ${llvm(current.returns)} ${v}`);
    const type = resultType(current);
    let result = temp();
    emit(`${result} = insertvalue ${type} undef, i1 false, 0`);
    if (v !== undefined) {
      const next = temp();
      emit(`${next} = insertvalue ${type} ${result}, ${llvm(current.returns)} ${v}, 1`);
      result = next;
    }
    emit(`ret ${type} ${result}`);
  }

  // An error raised by a `throw` or a failed call, which goes to the innermost catch, or else
  // leaves the function with it.
  function raised(at: Expr | Stmt, error: string) {
    const { from, to, wrapper, param, via } = current.raises.get(at)!;
    if (!via) return route(convert(error, from, to), to);
    // Wrapped by the error class's static `from` first.
    const wrapped = invoke(via, undefined, [`${llvm(param!)} ${convert(error, from, param!)}`])!;
    route(convert(wrapped, wrapper!, to), to);
  }

  // Sends an error of type `to` to the innermost catch, through any `finally` in between, or
  // else leaves the function with it.
  // What the statement made so far, and what the scopes left own, are dropped on the way; in a
  // match arm's block, so are the values pending in the expressions it leaves.
  function route(error: string, to: Type) {
    const region = finallies.at(-1);
    const toRegion = region !== undefined && handlers.length <= region.handlers;
    const kept = toRegion ? region.floor : handlers.at(-1)?.floor ?? 0;
    for (const { v, type } of pending.slice(kept).reverse()) dispose(v, type);
    if (region && toRegion) {
      drop(region.depth);
      const kept = stash(region, "error", to, error);
      return exit(region, "error", () => route(unstash(kept, to), to));
    }
    const handler = handlers.at(-1);
    drop(handler?.depth ?? 0);
    if (handler) {
      emit(`store ${llvm(to)} ${error}, ptr ${handler.slot}`);
      emit(`br label %${handler.label}`);
      return;
    }
    if (current.future) {
      emit("store i32 -1, ptr %state");
      emit(`ret ${resultType(current)} ${polled(current.future, 2, undefined, error)}`);
      return;
    }
    const type = resultType(current);
    const [a, b] = [temp(), temp()];
    emit(`${a} = insertvalue ${type} undef, i1 true, 0`);
    emit(`${b} = insertvalue ${type} ${a}, ${llvm(to)} ${error}, 2`);
    emit(`ret ${type} ${b}`);
  }

  // What polling a future gives: a tag, pending (0), ready (1) or failed (2), then the value it
  // gives and the error it throws, each `{}` when there is none.
  function pollType(f: FutureType | HandleType): string {
    return `{ i8, ${f.gives === "void" ? "{}" : llvm(f.gives)}, ${f.throws ? llvm(f.throws) : "{}"} }`;
  }

  // A poll result with `tag`, and the value or the error it carries.
  function polled(f: FutureType, tag: number, v?: string, error?: string): string {
    let made = temp();
    emit(`${made} = insertvalue ${pollType(f)} zeroinitializer, i8 ${tag}, 0`);
    for (const [part, at, type] of [[v, 1, f.gives], [error, 2, f.throws]] as const) {
      if (part === undefined || type === undefined || type === "void") continue;
      const next = temp();
      emit(`${next} = insertvalue ${pollType(f)} ${made}, ${llvm(type)} ${part}, ${at}`);
      made = next;
    }
    return made;
  }

  // `await p`: the future moves into its slot in the frame, and is polled there, here and at
  // each later poll of this one until it is done. While it is pending, so is this future. Its
  // value comes out, or its error is raised; either way it is finished, and dropped.
  function awaitFuture(e: Extract<Expr, { kind: "unary" }>): string | undefined {
    const inner = valueType(e.operand) as FutureType | HandleType | DynType;
    // A boxed future polls as a future giving what its Promise does, and throws nothing.
    const shape = inner.kind === "dyn" ? handleType(promiseElement(inner.of)!, undefined) : inner;
    const g = resuming!;
    const at = `%await.${current.frame!.awaits.get(e)!}`;
    emit(`store ${llvm(inner)} ${owned(e.operand)}, ptr ${at}`);
    settle();
    scopes.at(-1)!.push({ slot: at, type: inner });
    const poll = label();
    g.resumes.push(poll);
    const resumed = g.resumes.length;
    emit(`br label %${poll}`);
    startBlock(poll);
    const [result, tag, waiting, ready, failed] = [temp(), temp(), label(), label(), label()];
    const leaf = inner.kind === "future" ? leafOf.get(inner) : undefined;
    let given: string | undefined;
    let reason: string | undefined;
    if (leaf) {
      // A semaphore's, channel's or socket's wait, or a sleep given a signal, polled by the
      // runtime, which wakes the task when it may go on. A send moves its value in, leaving its
      // slot empty.
      const [slot, handle, outcome] = [temp(), temp(), temp()];
      emit(`${slot} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 1`);
      if (leaf.method !== "sleep") emit(`${handle} = load ptr, ptr ${slot}`);
      // A socket's poll gives its result through `made`, and on failure the system's reason
      // through `reason`, for the IoError its awaiter is thrown; an abort leaves it null.
      const socket = ["bind", "connect", "accept", "read", "write"].includes(leaf.method);
      if (socket) {
        reason = alloca("ptr");
        emit(`store ptr null, ptr ${reason}`);
      }
      // One given a signal joins its waiters first, and stops if it has aborted, leaving the
      // waiters it joined; once done any other way, it leaves the signal's.
      let signal: [string, string] | undefined;
      if (leaf.signal) {
        const n = (inner as FutureType).frame.length;
        const [at1, sig, flag, aborted, yes, cancel, go] = [temp(), temp(), temp(), temp(), temp(), label(), label()];
        emit(`${at1} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 ${n - 2}`);
        emit(`${sig} = load ptr, ptr ${at1}`);
        emit(`${flag} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 ${n - 1}`);
        emit(`${aborted} = call i32 @fsh_rt_signal_enter(ptr ${sig}, ptr ${flag}, ptr %cx)`);
        emit(`${yes} = icmp ne i32 ${aborted}, 0`);
        emit(`br i1 ${yes}, label %${cancel}, label %${go}`);
        startBlock(cancel);
        if (leaf.method === "acquire") emit(`call void @fsh_rt_semaphore_leave(ptr ${handle}, ptr %cx)`);
        if (leaf.method === "send" || leaf.method === "receive") emit(`call void @fsh_rt_channel_leave(ptr ${handle}, ptr %cx)`);
        if (leaf.method === "sleep") emit("call void @fsh_rt_sleep_leave(ptr %cx)");
        if (socket) emit(`call void @fsh_rt_socket_leave(ptr ${handle}, ptr %cx)`);
        emit(`call void @fsh_rt_signal_leave(ptr ${sig}, ptr ${flag}, ptr %cx)`);
        emit(`br label %${failed}`);
        startBlock(go);
        signal = [sig, flag];
      }
      if (socket) {
        const [made, field] = [alloca(leaf.method === "read" ? ARRAY : "ptr"), (i: number) => {
          const [ptr, v] = [temp(), temp()];
          emit(`${ptr} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 ${i}`);
          return [ptr, v] as const;
        }];
        if (leaf.method === "accept") emit(`${outcome} = call i32 @fsh_rt_tcp_accept(ptr ${handle}, ptr %cx, ptr ${made}, ptr ${reason})`);
        else if (leaf.method === "read") {
          const [maxAt, max] = field(2);
          emit(`${max} = load i64, ptr ${maxAt}`);
          emit(`${outcome} = call i32 @fsh_rt_tcp_read(ptr ${handle}, i64 ${max}, ptr %cx, ptr ${made}, ptr ${reason})`);
        } else if (leaf.method === "write") {
          const [bytesAt] = field(2);
          const [writtenAt] = field(3);
          emit(`${outcome} = call i32 @fsh_rt_tcp_write(ptr ${handle}, ptr ${bytesAt}, ptr ${writtenAt}, ptr %cx, ptr ${reason})`);
        } else {
          const first = leaf.method === "bind" ? 1 : 2;
          const [hostAt, host] = field(first);
          const [portAt, port] = field(first + 1);
          emit(`${host} = load ptr, ptr ${hostAt}`);
          emit(`${port} = load i64, ptr ${portAt}`);
          if (leaf.method === "bind") emit(`${outcome} = call i32 @fsh_rt_tcp_bind(ptr ${host}, i64 ${port}, ptr ${made}, ptr ${reason})`);
          else emit(`${outcome} = call i32 @fsh_rt_tcp_connect(ptr ${slot}, ptr ${host}, i64 ${port}, ptr %cx, ptr ${made}, ptr ${reason})`);
        }
        if (leaf.method !== "write") {
          given = temp();
          emit(`${given} = load ${leaf.method === "read" ? ARRAY : "ptr"}, ptr ${made}`);
        }
      } else if (leaf.method === "sleep") {
        emit(`${outcome} = call i32 @fsh_rt_sleep(ptr ${at}, ptr %cx)`);
      } else if (leaf.method === "acquire") {
        const [permit, made] = [alloca("ptr"), temp()];
        emit(`${outcome} = call i32 @fsh_rt_semaphore_acquire(ptr ${handle}, ptr %cx, ptr ${permit})`);
        emit(`${made} = load ptr, ptr ${permit}`);
        given = made;
      } else if (leaf.method === "send") {
        const [moving, closed] = [temp(), temp()];
        emit(`${moving} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        emit(`${outcome} = call i32 @fsh_rt_channel_send(ptr ${handle}, ptr ${moving}, ptr %cx)`);
        emit(`${closed} = icmp eq i32 ${outcome}, 3`);
        panicIf(closed, "send on a closed channel", e);
      } else {
        const buffer = alloca(llvm(leaf.of));
        emit(`${outcome} = call i32 @fsh_rt_channel_receive(ptr ${handle}, ptr ${buffer}, ptr %cx)`);
        // What it gives is an Option: the value, or empty once the channel is closed and drained.
        const [got, read, option] = [temp(), temp(), temp()];
        emit(`${got} = icmp eq i32 ${outcome}, 1`);
        emit(`${read} = load ${llvm(leaf.of)}, ptr ${buffer}`);
        emit(`${option} = select i1 ${got}, ${llvm(shape.gives)} ${convert(read, leaf.of, shape.gives)}, ${llvm(shape.gives)} ${convert("zeroinitializer", "null", shape.gives)}`);
        given = option;
      }
      emit(`${tag} = trunc i32 ${outcome} to i8`);
      if (!signal) emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${ready} i8 5, label %${failed} ]`);
      else {
        const [over, broke] = [label(), label()];
        emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${over} i8 2, label %${over} i8 5, label %${broke} ]`);
        startBlock(over);
        emit(`call void @fsh_rt_signal_leave(ptr ${signal[0]}, ptr ${signal[1]}, ptr %cx)`);
        emit(`br label %${ready}`);
        startBlock(broke);
        emit(`call void @fsh_rt_signal_leave(ptr ${signal[0]}, ptr ${signal[1]}, ptr %cx)`);
        emit(`br label %${failed}`);
      }
    } else if (inner === YIELD_NOW) {
      // Pending the first time it is polled, done the next.
      const [state, fresh] = [temp(), temp()];
      emit(`${state} = load i32, ptr ${at}`);
      emit(`store i32 1, ptr ${at}`);
      emit(`${fresh} = icmp eq i32 ${state}, 0`);
      emit(`br i1 ${fresh}, label %${waiting}, label %${ready}`);
    } else if (inner === SLEEP) {
      const done = temp();
      emit(`${done} = call i32 @fsh_rt_sleep(ptr ${at}, ptr %cx)`);
      emit(`${tag} = trunc i32 ${done} to i8`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} ]`);
    } else if (inner.kind === "handle") {
      // A spawned task: the runtime copies its result out once it is done.
      const [buffer, task, outcome] = [alloca(pollType(shape)), temp(), temp()];
      emit(`${task} = load ptr, ptr ${at}`);
      emit(`${outcome} = call i32 @fsh_rt_join(ptr ${task}, ptr %cx, ptr ${buffer})`);
      emit(`${result} = load ${pollType(shape)}, ptr ${buffer}`);
      emit(`${tag} = trunc i32 ${outcome} to i8`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
    } else if (inner.kind === "dyn") {
      // Through its vtable: the slot after drop, copy and clone is the future's own poll.
      const [dyn, data, table, slot, fn] = [temp(), temp(), temp(), temp(), temp()];
      emit(`${dyn} = load ${DYN}, ptr ${at}`);
      emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      emit(`${slot} = getelementptr ptr, ptr ${table}, i64 3`);
      emit(`${fn} = load ptr, ptr ${slot}`);
      unwinding(`call ${pollType(shape)} ${fn}(ptr ${data}, ptr %cx)`, result);
      emit(`${tag} = extractvalue ${pollType(shape)} ${result}, 0`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} ]`);
    } else {
      unwinding(`call ${pollType(shape)} ${symbol(futureOf.get(inner)!)}(ptr ${at}, ptr %cx)`, result);
      emit(`${tag} = extractvalue ${pollType(shape)} ${result}, 0`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
    }
    startBlock(waiting);
    // `yieldNow` asks to be polled again at once, behind whatever else is waiting.
    if (inner === YIELD_NOW) emit("call void @fsh_rt_wake(ptr %cx)");
    emit(`store i32 ${resumed}, ptr %state`);
    emit(`ret ${resultType(current)} ${polled(current.future!, 0)}`);
    const finish = () => {
      const old = temp();
      emit(`${old} = load ${llvm(inner)}, ptr ${at}`);
      emit(`store ${llvm(inner)} zeroinitializer, ptr ${at}`);
      dispose(old, inner);
    };
    if (shape.throws) {
      startBlock(failed);
      // An aborted wait throws a new AbortError; any other future gives its own error.
      // A socket's failure is an IoError with the system's reason; any other leaf's, an abort.
      let error = "";
      if (leaf && reason && !leaf.signal) {
        const [text, made] = [temp(), temp()];
        emit(`${text} = load ptr, ptr ${reason}`);
        emit(`${made} = insertvalue ${llvm(shape.throws)} zeroinitializer, ptr ${text}, 0`);
        error = made;
      } else if (leaf && reason) {
        // Given a signal, it throws either: an AbortError when it was aborted, leaving no reason.
        const members = (shape.throws as UnionType).members as ClassType[];
        const [io, aborted] = [members.find((m) => m.name === "IoError")!, members.find((m) => m.name === "AbortError")!];
        const [text, none, ioAt, abortAt, join, made] = [temp(), temp(), label(), label(), label(), temp()];
        emit(`${text} = load ptr, ptr ${reason}`);
        emit(`${none} = icmp eq ptr ${text}, null`);
        emit(`br i1 ${none}, label %${abortAt}, label %${ioAt}`);
        startBlock(ioAt);
        const failure = temp();
        emit(`${failure} = insertvalue ${llvm(io)} zeroinitializer, ptr ${text}, 0`);
        const asIo = convert(failure, io, shape.throws);
        const fromIo = block;
        emit(`br label %${join}`);
        startBlock(abortAt);
        const asAbort = convert(abortError(aborted), aborted, shape.throws);
        const fromAbort = block;
        emit(`br label %${join}`);
        startBlock(join);
        emit(`${made} = phi ${llvm(shape.throws)} [ ${asIo}, %${fromIo} ], [ ${asAbort}, %${fromAbort} ]`);
        error = made;
      } else if (leaf) error = abortError(shape.throws);
      else {
        error = temp();
        emit(`${error} = extractvalue ${pollType(shape)} ${result}, 2`);
      }
      finish();
      raised(e, error);
    } else if (inner !== YIELD_NOW && inner !== SLEEP) {
      startBlock(failed);
      emit("unreachable");
    }
    startBlock(ready);
    let v: string | undefined = given;
    if (shape.gives !== "void" && !leaf) {
      v = temp();
      emit(`${v} = extractvalue ${pollType(shape)} ${result}, 1`);
    }
    finish();
    return v;
  }

  // The C entry point. An error escaping Fish's `main` is printed to stderr, exiting with 1.
  // A C function under an export's name, calling it. A panic can't unwind into C, so one that
  // reaches here aborts, its message already printed.
  function exported(i: Instance): string[] {
    const params = i.body.params.map((p, n) => [i.locals.get(p)!.type, `%a${n}`] as const);
    // A library's panics all unwind, the runtime's default, whichever way the build chose: the
    // abort happens here, before C sees the unwind.
    const call = `${i.returns === "void" ? "" : "%r = "}invoke ${llvm(i.returns)} ${symbol(i)}(${params.map(([t, a]) => `${llvm(t)} ${a}`).join(", ")})`;
    const head = `define ${crossed(i.returns)} @"${i.body.name}"(${params.map(([t, a]) => `${crossing(t)} ${a}`).join(", ")}) ${UNWINDS} {`;
    const done = i.returns === "void" ? "  ret void" : `  ret ${llvm(i.returns)} %r`;
    return [head, "entry:", `  ${call} to label %ok unwind label %pad`, "ok:", done, "pad:", "  %caught = landingpad { ptr, i32 } cleanup", "  call void @abort()", "  unreachable", "}", ""];
  }

  function entry(): string[] {
    if (main.future) return driver(main.future);
    if (!main.throws) return [`define i32 @main() ${unwinds} {`, '  call void @"fsh.main"()', "  ret i32 0", "}"];
    current = main;
    ({ types, locals, calls, setters, coercions, jumps } = main);
    [allocas, body, temps, labels, block] = [[], [], 0, 0, "entry"];
    const type = resultType(main);
    const [result, failed, bad, ok, error] = [temp(), temp(), label(), label(), temp()];
    emit(`${result} = call ${type} @"fsh.main"()`);
    emit(`${failed} = extractvalue ${type} ${result}, 0`);
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(ok);
    emit("ret i32 0");
    startBlock(bad);
    emit(`${error} = extractvalue ${type} ${result}, 2`);
    // Output printed before the error stays ahead of it, as a panic's does.
    emit("call i32 @fflush(ptr null)");
    write(2, ["Error:", [error, main.throws]], builder, convert);
    dispose(error, main.throws);
    emit("ret i32 1");
    return [`define i32 @main() ${unwinds} {`, "entry:", ...allocas, ...body, "}"];
  }

  // An async `main`, run by the runtime as its first task; an error it gives is reported as a
  // throwing `main`'s is.
  function driver(future: FutureType): string[] {
    const [poll, drop, dropOutput] = taskGlue(future);
    current = main;
    ({ types, locals, calls, setters, coercions, jumps } = main);
    [allocas, body, temps, labels, block] = [[], [], 0, 0, "entry"];
    const type = pollType(future);
    const [frame, out, outcome, result, failed, ok, bad] = [temp(), temp(), temp(), temp(), temp(), label(), label()];
    allocas.push(`  ${frame} = alloca ${llvm(future)}`, `  store ${llvm(future)} zeroinitializer, ptr ${frame}`, `  ${out} = alloca ${type}`);
    emit(`${outcome} = call i32 @fsh_rt_run(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${sizeOf(llvm(future))}, i64 ${sizeOf(type)}, ptr ${out})`);
    emit(`${failed} = icmp eq i32 ${outcome}, 2`);
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(ok);
    emit("ret i32 0");
    startBlock(bad);
    emit(`${result} = load ${type}, ptr ${out}`);
    if (future.throws) {
      const error = temp();
      emit(`${error} = extractvalue ${type} ${result}, 2`);
      emit("call i32 @fflush(ptr null)");
      write(2, ["Error:", [error, future.throws]], builder, convert);
      dispose(error, future.throws);
      emit("ret i32 1");
    } else emit("unreachable");
    return [`define i32 @main() ${unwinds} {`, "entry:", ...allocas, ...body, "}"];
  }

  // The size of an LLVM type in bytes, as a constant.
  function sizeOf(type: string): string {
    return `ptrtoint (ptr getelementptr (${type}, ptr null, i32 1) to i64)`;
  }

  // What the runtime needs to run a future as a task, made once per future type: a poll that
  // writes the result into the task's output and says pending (0), ready (1), failed (2) or
  // panicked (3); a drop of the frame where it stopped; and a drop of the output it gave.
  function taskGlue(future: FutureType): [string, string, string] {
    const name = (kind: string) => `@"task.${kind}.${futureOf.get(future)!.symbol}"`;
    if (!glued.has(future)) {
      glued.add(future);
      const [frame, type] = [llvm(future), pollType(future)];
      const output = `getelementptr i8, ptr %frame, i64 ${sizeOf(frame)}`;
      const caught = panic === "abort" ? [] : ["pad:", "  %caught = landingpad { ptr, i32 } cleanup", "  ret i32 3"];
      const call = panic === "abort" ? `  %r = call ${type} ${symbol(futureOf.get(future)!)}(ptr %frame, ptr %task)` : `  %r = invoke ${type} ${symbol(futureOf.get(future)!)}(ptr %frame, ptr %task) to label %polled unwind label %pad`;
      const [dropFrame, dropOutput] = [helperBody((v) => dispose(v, future)), outputDrop(future)];
      out.push(
        `define internal i32 ${name("poll")}(ptr %task, ptr %frame) ${UNWINDS} {`, "entry:", call, ...(panic === "abort" ? [] : ["polled:"]),
        "  %tag = extractvalue " + type + " %r, 0", "  %done = icmp ne i8 %tag, 0", "  br i1 %done, label %finished, label %waiting",
        "waiting:", "  ret i32 0",
        "finished:", `  %out = ${output}`, `  store ${type} %r, ptr %out`, "  %outcome = zext i8 %tag to i32", "  ret i32 %outcome", ...caught, "}", "",
        `define internal void ${name("drop")}(ptr %frame) ${unwinds} {`, "entry:", `  %v = load ${frame}, ptr %frame`, ...dropFrame, "  ret void", "}", "",
        `define internal void ${name("output")}(ptr %out) ${unwinds} {`, "entry:", `  %v = load ${type}, ptr %out`, ...dropOutput, "  ret void", "}", "",
      );
    }
    return [name("poll"), name("drop"), name("output")];
  }

  // The instructions dropping `%v` of `type`, as a helper's body.
  function helperBody(drop: (v: string) => void): string[] {
    const saved = [allocas, body, temps, labels, block] as const;
    [allocas, body, temps, labels, block] = [[], [], 0, 0, "entry"];
    drop("%v");
    const lines = [...allocas, ...body];
    [allocas, body, temps, labels, block] = saved as unknown as [string[], string[], number, number, string];
    return lines;
  }

  // Drops the value or the error in a finished future's poll result.
  function outputDrop(future: FutureType): string[] {
    return helperBody((v) => {
      const type = pollType(future);
      const [tag, ready, failed, end] = [temp(), label(), label(), label()];
      emit(`${tag} = extractvalue ${type} ${v}, 0`);
      emit(`switch i8 ${tag}, label %${end} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
      startBlock(ready);
      if (needsDrop(future.gives)) {
        const value = temp();
        emit(`${value} = extractvalue ${type} ${v}, 1`);
        dispose(value, future.gives);
      }
      emit(`br label %${end}`);
      startBlock(failed);
      if (future.throws && needsDrop(future.throws)) {
        const error = temp();
        emit(`${error} = extractvalue ${type} ${v}, 2`);
        dispose(error, future.throws);
      }
      emit(`br label %${end}`);
      startBlock(end);
    });
  }

  // A pointer to the base embedded in an instance of `from`, through as many bases as it
  // takes to reach `to`.
  function upcast(ptr: string, from: ClassType, to: ClassType): string {
    for (let t = from; t !== to; t = t.base!) {
      const next = temp();
      emit(`${next} = getelementptr ${llvm(t)}, ptr ${ptr}, i32 0, i32 0`);
      ptr = next;
    }
    return ptr;
  }

  // Where a method's receiver lives. A temporary, such as a call's or a getter's result,
  // gets a slot. A method that `owns` its object drops it: one in place is left empty, and one
  // in a slot is a copy of its own.
  function receiver(object: Expr, owns = false): string {
    if (object.kind === "super") return upcast("%this", self!, types.get(object) as ClassType);
    // A reference already points where the receiver lives.
    if (isRef(types.get(object)!)) return evaluate(object);
    // In an optional chain, what the Option holds: in place when it is one member of it.
    if (unwraps(object)) {
      const option = types.get(object) as UnionType;
      const held = coercions.get(object)!;
      if (lendable(object) && option.members.includes(held)) {
        const at = temp();
        emit(`${at} = getelementptr ${llvm(option)}, ptr ${address(object)}, i32 0, i32 1`);
        return at;
      }
      // A variable narrowed to fewer members still holds its value in its own union's payload.
      const local = object.kind === "ident" ? locals.get(object) : undefined;
      const whole = local?.type;
      if (local && typeof whole !== "string" && whole?.kind === "union" && whole.members.includes(held)) {
        const at = temp();
        emit(`${at} = getelementptr ${llvm(whole)}, ptr ${slot(local)}, i32 0, i32 1`);
        return at;
      }
      const copy = alloca(llvm(held));
      const read = value(object);
      const v = owns ? spill(copy, held, read) : read;
      emit(`store ${llvm(held)} ${v}, ptr ${copy}`);
      return copy;
    }
    if (lendable(object)) return address(object);
    const type = llvm(types.get(object)!);
    const spilled = alloca(type);
    const read = value(object);
    const v = owns ? spill(spilled, types.get(object)!, read) : read;
    emit(`store ${type} ${v}, ptr ${spilled}`);
    return spilled;
  }

  // An expression's value, copied down to the declared type it meets when that is narrower.
  // A value the expression made is released when the statement ends, unless `consume` takes it.
  function value(e: Expr, consume = false): string {
    const to = coercions.get(e);
    const type = types.get(e)!;
    if (to && typeof to !== "string" && to.kind === "ref" && (typeof type === "string" || type.kind !== "ref")) return borrowed(e, to.to);
    const result = known.get(e) ?? evaluate(e);
    // Nothing runs after a value of `never`, so it stands for any value at all.
    if (type === "never") return "undef";
    // A value meeting a Dyn moves into its block; a temporary then drops as the Dyn.
    if (to && isDyn(to) && !isDyn(type)) {
      const boxed = box(result, type, to);
      if (!consume && fresh(e) && !known.has(e)) pending.push({ v: boxed, type: to });
      return boxed;
    }
    if (!consume && fresh(e) && !known.has(e)) pending.push({ v: result, type });
    return to ? convert(result, type, to) : result;
  }

  // The type of what `value` gives for an expression: its own, or what it is converted to.
  function valueType(e: Expr): Type {
    return coercions.get(e) ?? types.get(e)!;
  }

  // A pointer to a value lent to a reference: where a place holding exactly that type lives,
  // or else a slot holding a copy converted to it.
  function borrowed(e: Expr, to: Type): string {
    if (lendable(e) && stored(e) === to) return address(e);
    const slot = alloca(llvm(to));
    const made = evaluate(e);
    if (fresh(e)) pending.push({ v: made, type: types.get(e)! });
    emit(`store ${llvm(to)} ${convert(made, types.get(e)!, to)}, ptr ${slot}`);
    return slot;
  }

  function evaluate(e: Expr): string {
    switch (e.kind) {
      case "int": {
        const type = types.get(e)!;
        return isFloat(type) ? floatConstant(Number(e.value), type) : String(e.value);
      }
      case "float":
        return floatConstant(e.value, types.get(e) as "f32" | "f64");
      case "as": {
        const [from, to] = [coercions.get(e.expr) ?? types.get(e.expr)!, types.get(e)!];
        const pointer = (t: Type) => typeof t !== "string" && t.kind === "pointer";
        if (!pointer(from) && !pointer(to)) return cast(value(e.expr), from, to as Numeric);
        // A raw pointer is an address: another pointer is the same one, and an integer is its
        // number.
        if (pointer(from) && pointer(to)) return value(e.expr);
        // An integer becomes an address as a `usize` would, sign-extending a narrower signed one.
        const converted = temp();
        if (pointer(to)) emit(`${converted} = inttoptr i64 ${cast(value(e.expr), from, "usize")} to ptr`);
        else emit(`${converted} = ptrtoint ptr ${value(e.expr)} to ${llvm(to)}`);
        return converted;
      }
      case "bool":
        return String(e.value);
      case "comptime":
        bakeable(types.get(e)!, e);
        return bake(comptimeValue(current, e), types.get(e)!);
      // A string literal on its own has only its literal type, which takes no space.
      case "string":
        return "zeroinitializer";
      case "null":
        return "zeroinitializer";
      // Nothing after a throw expression runs, so the value it stands for is never read.
      case "throw":
        raised(e, owned(e.value));
        startBlock(label());
        return "undef";
      case "index": {
        const object = valueType(e.object);
        if (indexes(object)) {
          const held = isRef(object) ? object.to : object;
          const v = temp();
          emit(`${v} = load ${llvm((held as ArrayType | FixedType).element)}, ptr ${element(e)}`);
          return v;
        }
        const s = operand(e.object, [e.index]);
        const index = value(e.index);
        inBounds(s, index, e);
        const result = temp();
        emit(`${result} = call ptr @fsh_rt_str_at(ptr ${s}, i64 ${index})`);
        return result;
      }
      // The elements run first, then fill a buffer just long enough.
      case "array": {
        const made = types.get(e)!;
        // A fixed array's literal is its elements in place.
        if (typeof made !== "string" && made.kind === "fixed") {
          const values = delivered((hand) => (e.elements as Expr[]).map((x) => hand(owned(x), made.element)));
          return values.reduce((whole, v, i) => {
            const next = temp();
            emit(`${next} = insertvalue ${llvm(made)} ${whole}, ${llvm(made.element)} ${v}, ${i}`);
            return next;
          }, "undef");
        }
        const type = made as ArrayType;
        const t = llvm(type.element);
        if (e.elements.some((x) => x?.kind === "spread")) return spreadArray(e.elements as Expr[], type);
        const values = delivered((hand) => (e.elements as Expr[]).map((x) => hand(owned(x), type.element)));
        const n = String(values.length);
        const data = temp();
        emit(`${data} = call ptr @fsh_rt_array_alloc(i64 ${bytes(type.element, n)})`);
        values.forEach((v, i) => {
          const at = temp();
          emit(`${at} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
          emit(`store ${t} ${v}, ptr ${at}`);
        });
        return built(data, n, n);
      }
      case "template": {
        // Text alone is a literal, which takes no space.
        if (e.exprs.length === 0) return "zeroinitializer";
        const parts: string[] = [];
        e.quasis.forEach((q, i) => {
          if (q !== "") parts.push(text(q));
          const x = e.exprs[i];
          if (x) parts.push(written(operand(x, e.exprs.slice(i + 1)), valueType(x)));
        });
        const array = alloca(`[${parts.length} x ptr]`);
        parts.forEach((part, i) => {
          const at = temp();
          emit(`${at} = getelementptr [${parts.length} x ptr], ptr ${array}, i32 0, i32 ${i}`);
          emit(`store ptr ${part}, ptr ${at}`);
        });
        const result = temp();
        emit(`${result} = call ptr @fsh_rt_str_join(ptr ${array}, i64 ${parts.length})`);
        return result;
      }
      case "nonNull": {
        // Through a reference, the Option it points to.
        const option = valueType(e.expr) as UnionType;
        const v = value(e.expr);
        panicIf(holds(v, option, ["null"]), "called `Option::unwrap()` on a `None` value", e);
        return convert(v, option, types.get(e)!);
      }
      case "ident": {
        // A top-level const: a scalar or string baked where it is read, an aggregate read through
        // a pointer to its global.
        const read = calls.get(e);
        if (read?.body.comptime === "const") return isRef(types.get(e)!) ? constantGlobal(read) : bake(comptimeBody(read), types.get(e)!);
        // `undefined` is the empty value, unless a variable takes the name.
        if (!locals.has(e)) return "zeroinitializer";
        const local = resolved(e);
        const t = temp();
        emit(`${t} = load ${llvm(local.type)}, ptr ${slot(local)}`);
        // Where a check narrowed the variable, its value comes out of the union.
        return convert(t, local.type, types.get(e)!);
      }
      case "member":
        if (maths.has(e)) return floatConstant(MATH_CONSTANTS[e.name]!, "f64");
        return unwraps(e.object) ? link(e, e.object, () => member(e))! : member(e);
      // A closure's value is each variable it holds, and a pointer to each it borrows, or to `this`.
      case "arrow": {
        const inner = calls.get(e)!;
        let result = "undef";
        [...inner.captures!.values()].forEach((from, i) => {
          const type = inner.closure!.fields[i]!.type;
          let part = from === "this" ? "%this" : slot(from);
          // A closure holding a variable's value holds a copy, or moves it in, emptying it.
          if (!isRef(type)) {
            part = temp();
            emit(`${part} = load ${llvm(type)}, ptr ${slot(from as Local)}`);
            if (isCopy(type)) part = copied(part, type);
            else emit(`store ${llvm(type)} zeroinitializer, ptr ${slot(from as Local)}`);
          }
          const next = temp();
          emit(`${next} = insertvalue ${llvm(inner.closure!)} ${result}, ${llvm(type)} ${part}, ${i}`);
          result = next;
        });
        return inner.captures!.size === 0 ? "zeroinitializer" : result;
      }
      case "object": {
        const type = types.get(e) as ObjectType;
        if (e.props.some((p) => p.kind === "spread")) return spreadObject(e, type);
        // Properties run in source order, then fill the fields in their sorted order.
        const values = delivered((hand) => new Map(e.props.map((p) => {
          const [name, v] = property(p, type);
          return [name, hand(v, field(type, name)!.type)];
        })));
        let result = "undef";
        type.fields.forEach((f, i) => {
          const next = temp();
          emit(`${next} = insertvalue ${llvm(type)} ${result}, ${llvm(f.type)} ${values.get(f.name)}, ${i}`);
          result = next;
        });
        return result;
      }
      case "this": {
        const result = temp();
        emit(`${result} = load ${llvm(types.get(e)!)}, ptr %this`);
        return result;
      }
      case "new": {
        if ((types.get(e) as Exclude<Type, string>).kind === "interior") return interiorNew(e, types.get(e) as InteriorType);
        if ((types.get(e) as Exclude<Type, string>).kind === "block") return blockNew(e, types.get(e) as BlockType);
        if ((types.get(e) as Exclude<Type, string>).kind === "map") return mapNew(types.get(e) as MapType, e.args?.[0]);
        // The constructor fills in a slot, which then holds the new instance. The slot starts
        // empty, so a field's first assignment has nothing to drop.
        const type = types.get(e) as ClassType;
        const instance = alloca(llvm(type));
        emit(`store ${llvm(type)} zeroinitializer, ptr ${instance}`);
        const values = argValues(e.args ?? [], calls.get(e)!).map((v) => `, ${v}`);
        // A panic in the constructor drops the fields it has set.
        unwinding(`call void ${symbol(calls.get(e)!)}(ptr ${instance}${values.join("")})`, undefined, () => dispose(unstash(instance, type), type));
        const result = temp();
        emit(`${result} = load ${llvm(type)}, ptr ${instance}`);
        return result;
      }
      case "call": {
        const result = call(e);
        if (!result) throw new Error("internal error: void call used as a value");
        return result;
      }
      case "unary": {
        if (e.op === "await") return awaitFuture(e)!;
        const type = types.get(e)!;
        // A negative literal is a constant, which may be the type's minimum.
        if (e.op === "-" && (e.operand.kind === "int" || e.operand.kind === "float")) {
          return isFloat(type) ? floatConstant(-Number(e.operand.value), type) : String(-e.operand.value);
        }
        const operand = value(e.operand);
        if (e.op === "-" && isFloat(type)) {
          const result = temp();
          emit(`${result} = fneg ${llvm(type)} ${operand}`);
          return result;
        }
        if (e.op === "-") return arithmetic("-", "0", operand, e, type as Integer, "negate");
        const result = temp();
        emit(`${result} = xor ${llvm(type)} ${operand}, ${e.op === "~" ? -1 : "true"}`);
        return result;
      }
      case "assign":
        return fixing(e.target, () => assign(e));
      case "match":
        return lowerMatch(e, true)!;
      case "unsafe":
        return value(e.expr);
      case "pipe":
        return lowerPipe(e, true)!;
      case "update":
        return fixing(e.operand, () => {
          const old = value(e.operand);
          const type = types.get(e)!;
          const result = numeric(e.op === "++" ? "+" : "-", old, isFloat(type) ? floatConstant(1, type) : "1", e, type);
          store(e.operand, result);
          return e.prefix ? result : old;
        });
      case "conditional": {
        const cond = value(e.cond);
        const [then, otherwise, end] = [label(), label(), label()];
        emit(`br i1 ${cond}, label %${then}, label %${otherwise}`);
        // Each side gives a value of its own when the result owns memory.
        const side = (x: Expr) => {
          const mark = pending.length;
          const v = needsDrop(types.get(e)) ? owned(x) : value(x);
          settle(mark);
          return v;
        };
        startBlock(then);
        const a = side(e.then);
        const thenEnd = block;
        emit(`br label %${end}`);
        startBlock(otherwise);
        const b = side(e.else);
        const otherwiseEnd = block;
        emit(`br label %${end}`);
        startBlock(end);
        const result = temp();
        emit(`${result} = phi ${llvm(types.get(e)!)} [ ${a}, %${thenEnd} ], [ ${b}, %${otherwiseEnd} ]`);
        return result;
      }
      case "binary": {
        if (e.op === "&&" || e.op === "||") return logical(e.op, value(e.left), () => value(e.right));
        if (e.op === "??") return orElse(e);
        if (e.op === "+" && types.get(e) === "string") return concat(written(operand(e.left, [e.right]), valueType(e.left)), written(value(e.right), valueType(e.right)));
        const first = (x: Expr) => (x === e.left ? operand(x, [e.right]) : value(x));
        const tested = test(e, first, valueType);
        if (tested) return tested;
        const condition = COMPARISON[e.op];
        const [a, b] = [first(e.left), value(e.right)];
        // An operand keeps a literal type only when both are the same string literal.
        const type = coercions.get(e.left) ?? types.get(e.left)!;
        if (!condition) return numeric(e.op, a, b, e, type);
        // Empty values are always equal.
        if (type === "null") return String(e.op === "===");
        // Raw pointers compare by address.
        if (typeof type !== "string" && type.kind === "pointer") {
          const same = temp();
          emit(`${same} = icmp ${condition} ptr ${a}, ${b}`);
          return same;
        }
        if (typeof type !== "string") return String(e.op === "===");
        const result = temp();
        if (isFloat(type)) {
          emit(`${result} = fcmp ${FLOAT_COMPARISON[e.op]} ${llvm(type)} ${a}, ${b}`);
          return result;
        }
        // Strings compare by the runtime's order: below, equal or above zero.
        if (type === "string") {
          const order = temp();
          emit(`${order} = call i32 @fsh_rt_str_compare(ptr ${a}, ptr ${b})`);
          emit(`${result} = icmp ${condition} i32 ${order}, 0`);
          return result;
        }
        // An ordering of unsigned numbers compares them as unsigned.
        const unsigned = isInteger(type) && !INTEGERS[type].signed && condition.startsWith("s");
        emit(`${result} = icmp ${unsigned ? `u${condition.slice(1)}` : condition} ${llvm(type)} ${a}, ${b}`);
        return result;
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
  function spreadObject(e: Extract<Expr, { kind: "object" }>, type: ObjectType): string {
    const got = new Map<string, { v: string; type: Type }>();
    const put = (name: string, v: string, t: Type) => {
      const old = got.get(name);
      if (old) {
        pending = pending.filter((entry) => entry !== old);
        dispose(old.v, old.type);
      }
      const entry = { v, type: t };
      pending.push(entry);
      got.set(name, entry);
    };
    for (const p of e.props) {
      if (p.kind === "property") {
        put(p.key as string, owned(p.value), valueType(p.value));
        continue;
      }
      if (p.kind === "shorthand") {
        const local = resolved(p);
        const to = field(type, p.name)!.type;
        // A shorthand lent to a reference field points at its variable.
        if (isRef(to) && !isRef(local.type)) {
          put(p.name, slot(local), to);
          continue;
        }
        const read = temp();
        emit(`${read} = load ${llvm(local.type)}, ptr ${slot(local)}`);
        put(p.name, copied(read, local.type), local.type);
        continue;
      }
      if (p.kind !== "spread") throw new Error("internal error: unchecked property");
      const held = types.get(p.value)!;
      // The source's own type in this instance, its fields laid out as this instance has them.
      const source = lower(isRef(held) ? held.to : held) as ObjectType | ClassType;
      const taken = fresh(p.value);
      let whole = taken ? owned(p.value) : value(p.value);
      if (isRef(held)) {
        const read = temp();
        emit(`${read} = load ${llvm(source)}, ptr ${whole}`);
        whole = read;
      }
      const fields = source.kind === "class" ? allFields(source) : source.fields;
      for (const f of fields) {
        const v = temp();
        emit(`${v} = extractvalue ${llvm(source)} ${whole}, ${fieldPath(source, f.name).join(", ")}`);
        const shown = source.kind !== "class" || (f.access ?? "public") === "public";
        if (shown) put(f.name, taken ? v : copied(v, f.type), f.type);
        else if (taken) dispose(v, f.type);
      }
    }
    let result = "undef";
    type.fields.forEach((f, i) => {
      const part = got.get(f.name)!;
      const next = temp();
      emit(`${next} = insertvalue ${llvm(type)} ${result}, ${llvm(f.type)} ${convert(part.v, part.type, f.type)}, ${i}`);
      result = next;
    });
    const made = new Set(got.values());
    pending = pending.filter((entry) => !made.has(entry as { v: string; type: Type }));
    return result;
  }

  function property(p: ObjectProp, object: ObjectType): [string, string] {
    if (p.kind === "property") return [p.key as string, owned(p.value)];
    if (p.kind !== "shorthand") throw new Error("internal error: unchecked property");
    const local = resolved(p);
    const to = field(object, p.name)!.type;
    // A shorthand lent to a reference field points at its variable.
    if (isRef(to) && !isRef(local.type)) return [p.name, slot(local)];
    const result = temp();
    emit(`${result} = load ${llvm(local.type)}, ptr ${slot(local)}`);
    return [p.name, copied(convert(result, local.type, to), to)];
  }

  // Writes a value to a place, giving the assignment's value: what was written, or, for a setter,
  // which keeps what it is given, a copy of its own released when the statement ends.
  function store(target: Expr, result: string): string {
    const setter = setters.get(target);
    if (setter && target.kind === "member") {
      const type = types.get(target)!;
      const kept = copied(result, type);
      if (needsDrop(type)) pending.push({ v: kept, type });
      invoke(setter, thisPointer(setter, target.object), [`${llvm(type)} ${result}`]);
      return kept;
    }
    // A whole value written through a mutable reference goes where it points.
    const type = types.get(target)!;
    if (isRef(type) && coercions.has(target)) {
      // Through the reference as stored, unless an update keeps the member it was narrowed to.
      const whole = target.kind === "ident" && type === resolved(target).type;
      const pointer = whole ? temp() : evaluate(target);
      if (whole) emit(`${pointer} = load ptr, ptr ${slot(resolved(target))}`);
      replace(pointer, type.to, result);
      return result;
    }
    replace(address(target), type, result);
    return result;
  }

  // Writes a value into a place, dropping the one it held.
  function replace(at: string, type: Type, v: string) {
    const old = temp();
    if (needsDrop(type)) emit(`${old} = load ${llvm(type)}, ptr ${at}`);
    emit(`store ${llvm(type)} ${v}, ptr ${at}`);
    if (needsDrop(type)) dispose(old, type);
  }

  // Where an assignment target lives: a variable's slot, or a field inside one.
  function address(target: Expr): string {
    if (target.kind === "this") return "%this";
    if (target.kind === "index") return element(target);
    if (target.kind !== "member") {
      // A union narrowed to one member keeps it in place as its payload.
      const local = resolved(target);
      if (types.get(target) === local.type) return slot(local);
      const payload = temp();
      emit(`${payload} = getelementptr ${llvm(local.type)}, ptr ${slot(local)}, i32 0, i32 1`);
      return payload;
    }
    if (typeof referent(types.get(target.object)!) !== "string" && (referent(types.get(target.object)!) as Exclude<Type, string>).kind === "shared") return sharedField(target)[2];
    const holder = stored(target.object);
    const object = referent(holder) as ObjectType | ClassType;
    // Through a reference, the field is inside what it points to.
    const base = isRef(holder) ? evaluate(target.object) : address(target.object);
    const result = temp();
    const path = fieldPath(object, target.name).map((i) => `i32 ${i}`).join(", ");
    emit(`${result} = getelementptr ${llvm(object)}, ptr ${base}, i32 0, ${path}`);
    return result;
  }

  // Whether an expression names somewhere a value lives: a variable, `this`, or a field of one,
  // but not a variable narrowed to part of a union, an enum's member or a union's shared field.
  function lendable(e: Expr): boolean {
    for (; e.kind === "member" && !calls.has(e); e = e.object) {
      // A string's or an array's `length` is computed, not a field.
      const object = types.has(e.object) ? referent(types.get(e.object)!) : undefined;
      // A shared value's interior-mutable field lives in its block, wherever the handle is.
      if (typeof object !== "string" && object?.kind === "shared") return !current.copiesOut.has(e);
      if (!object || typeof object === "string" || (object.kind !== "object" && object.kind !== "class")) return false;
    }
    if (e.kind === "this") return true;
    // An array's element lives in its buffer, wherever the array itself is.
    if (e.kind === "index") return indexes(valueType(e.object));
    const local = e.kind === "ident" ? locals.get(e) : undefined;
    const type = types.get(e);
    return local !== undefined && (type === local.type || typeof type === "string" || type?.kind !== "union");
  }

  // The type a place is stored as. Read through a type parameter's bound, a field may have a
  // wider type than the one it is stored with.
  function stored(e: Expr): Type {
    if (e.kind !== "member" || calls.has(e)) return types.get(e)!;
    const holder = referent(stored(e.object));
    // A shared value's field is stored in its block's value.
    const object = typeof holder !== "string" && holder.kind === "shared" ? holder.of : holder;
    return field(object as ObjectType | ClassType, e.name)!.type;
  }

  // The right side runs only when the left side does not already decide the result.
  // What the left Option holds, or the right side, run only when the left is empty.
  function orElse(e: Extract<Expr, { kind: "binary" }>): string {
    const option = valueType(e.left) as UnionType;
    const type = types.get(e)!;
    const v = value(e.left);
    const [some, none, end] = [label(), label(), label()];
    emit(`br i1 ${holds(v, option, ["null"])}, label %${none}, label %${some}`);
    startBlock(some);
    // The result is a value of its own, like a conditional's.
    const kept = copied(convert(v, option, type), type);
    const someEnd = block;
    emit(`br label %${end}`);
    startBlock(none);
    const mark = pending.length;
    const fallback = needsDrop(type) ? owned(e.right) : value(e.right);
    settle(mark);
    const noneEnd = block;
    emit(`br label %${end}`);
    startBlock(end);
    const result = temp();
    emit(`${result} = phi ${llvm(type)} [ ${kept}, %${someEnd} ], [ ${fallback}, %${noneEnd} ]`);
    return result;
  }

  function logical(op: "&&" | "||", a: string, right: () => string): string {
    const from = block;
    const rhs = label();
    const end = label();
    emit(op === "&&" ? `br i1 ${a}, label %${rhs}, label %${end}` : `br i1 ${a}, label %${end}, label %${rhs}`);
    startBlock(rhs);
    const mark = pending.length;
    const b = right();
    settle(mark);
    const rhsEnd = block;
    emit(`br label %${end}`);
    startBlock(end);
    const result = temp();
    emit(`${result} = phi i1 [ ${op === "||"}, %${from} ], [ ${b}, %${rhsEnd} ]`);
    return result;
  }

  function concat(a: string, b: string): string {
    const result = temp();
    emit(`${result} = call ptr @fsh_rt_str_concat(ptr ${a}, ptr ${b})`);
    return result;
  }

  // A value as a string, written as JavaScript's `String(x)` would; a number's is a new string,
  // released when the statement ends.
  function written(v: string, type: Type): string {
    if (type === "string") return v;
    if (type === "boolean") {
      const result = temp();
      emit(`${result} = select i1 ${v}, ptr ${text("true")}, ptr ${text("false")}`);
      return result;
    }
    let from = isFloat(type) ? type : "i64";
    let wide = v;
    if (isInteger(type)) {
      const { bits, signed } = INTEGERS[type];
      if (!signed) from = "u64";
      if (bits < 64) {
        wide = temp();
        emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
    }
    const result = temp();
    emit(`${result} = call ptr @fsh_rt_str_from_${from}(${from === "f32" ? "float" : from === "f64" ? "double" : "i64"} ${wide})`);
    pending.push({ v: result, type: "string" });
    return result;
  }

  // A value computed while compiling, built as a value of its type: scalars and strings as
  // constants, aggregates assembled from their baked parts.
  function bake(tagged: Value, type: Type): string {
    if (typeof type !== "string" && type.kind === "union") {
      const member = memberOf(tagged, type);
      return convert(bake(untagged(tagged), member), member, type);
    }
    const v = untagged(tagged);
    // A literal type, or the empty value, takes no space.
    if ((typeof type !== "string" && type.kind === "literal") || v === null) return "zeroinitializer";
    if (typeof v === "string") return text(v);
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") return floatConstant(v, type as "f32" | "f64");
    if (typeof v === "bigint") return String(v);
    // An Atomic is its value; an atomic boolean a byte. A Lock is its word, free, then its value.
    if (v && typeof type !== "string" && v.kind === "interior" && type.kind === "interior") {
      if (type.which === "Lock") {
        const made = temp();
        emit(`${made} = insertvalue ${llvm(type)} zeroinitializer, ${llvm(type.of)} ${bake(v.value, type.of)}, 1`);
        return made;
      }
      return llvm(type) === "i8" ? (v.value ? "1" : "0") : bake(v.value, type.of);
    }
    if (v && typeof type !== "string" && v.kind === "array" && type.kind === "array") {
      const n = String(v.items.length);
      const [data, t] = [temp(), llvm(type.element)];
      emit(`${data} = call ptr @fsh_rt_array_alloc(i64 ${bytes(type.element, n)})`);
      // Numbers are copied from constant data, so a large table is one copy, not a store each.
      if (v.items.length > 0 && (isInteger(type.element) || isFloat(type.element))) {
        const table = `@.table.${globals.length}`;
        const element = type.element;
        const items = v.items.map((x) => `${t} ${typeof untagged(x) === "number" ? floatConstant(untagged(x) as number, element as "f32" | "f64") : String(untagged(x))}`);
        globals.push(`${table} = private unnamed_addr constant [${n} x ${t}] [${items.join(", ")}]`);
        intrinsics.add("declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)");
        emit(`call void @llvm.memcpy.p0.p0.i64(ptr ${data}, ptr ${table}, i64 ${bytes(element, n)}, i1 false)`);
        return built(data, n, n);
      }
      v.items.forEach((item, i) => {
        const at = temp();
        emit(`${at} = getelementptr ${t}, ptr ${data}, i64 ${i}`);
        emit(`store ${t} ${bake(item, type.element)}, ptr ${at}`);
      });
      return built(data, n, n);
    }
    if (v && typeof type !== "string" && (type.kind === "object" || type.kind === "class" || type.kind === "variant")) {
      const parts: [Type, Value][] = [];
      if (type.kind === "class" && type.base) parts.push([type.base, v]);
      type.fields.forEach((f, i) => parts.push([f.type, v.kind === "variant" ? v.args[i] : v.kind === "record" ? v.fields.get(f.name) : undefined]));
      let made = "zeroinitializer";
      parts.forEach(([part, x], i) => {
        const next = temp();
        emit(`${next} = insertvalue ${llvm(type)} ${made}, ${llvm(part)} ${bake(x, part)}, ${i}`);
        made = next;
      });
      return made;
    }
    throw new Error(`internal error: no baked form for a comptime value of type ${keyOf(type)}`);
  }

  // A literal's string block: a count below zero, so it is never freed, its length, a pointer
  // to its bytes, no base, its UTF-16 length, and no breadcrumbs.
  function text(value: string): string {
    const made = texts.get(value);
    if (made) return made;
    const bytes = wtf8(value);
    let lit = "";
    for (const b of bytes) {
      const plain = b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
      lit += plain ? String.fromCharCode(b) : "\\" + b.toString(16).padStart(2, "0").toUpperCase();
    }
    const name = `@.text.${globals.length}`;
    texts.set(value, name);
    globals.push(`${name}.bytes = private unnamed_addr constant [${bytes.length} x i8] c"${lit}"`);
    // Non-ASCII text longer than one breadcrumb's stride gets its breadcrumbs, as the runtime
    // would make them.
    const crumbs = bytes.length !== value.length && value.length > STRIDE ? breadcrumbs(value) : undefined;
    if (crumbs) globals.push(`${name}.crumbs = private unnamed_addr constant [${crumbs.length} x i64] [${crumbs.map((c) => `i64 ${c}`).join(", ")}]`);
    globals.push(`${name} = private unnamed_addr constant { i64, i64, ptr, ptr, i64, ptr } { i64 -1, i64 ${bytes.length}, ptr ${name}.bytes, ptr null, i64 ${value.length}, ptr ${crumbs ? `${name}.crumbs` : "null"} }`);
    return name;
  }

  function cString(s: string): string {
    const bytes = new TextEncoder().encode(s + "\0");
    let lit = "";
    for (const b of bytes) {
      const plain = b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
      lit += plain ? String.fromCharCode(b) : "\\" + b.toString(16).padStart(2, "0").toUpperCase();
    }
    const name = `@.str.${globals.length}`;
    globals.push(`${name} = private unnamed_addr constant [${bytes.length} x i8] c"${lit}"`);
    return name;
  }
}

// The runtime's breadcrumb stride, in UTF-16 units.
const STRIDE = 64;

// Where every STRIDE-th UTF-16 unit of a string is: its character's byte offset times two,
// plus one when the unit is a pair's second half.
function breadcrumbs(text: string): number[] {
  const crumbs: number[] = [];
  let at = 0;
  for (let unit = 0; unit < text.length; unit++) {
    const c = text.charCodeAt(unit);
    const second = c >= 0xdc00 && c < 0xe000 && unit > 0 && text.charCodeAt(unit - 1) >= 0xd800 && text.charCodeAt(unit - 1) < 0xdc00;
    if (unit % STRIDE === 0) crumbs.push(at * 2 + (second ? 1 : 0));
    const paired = c >= 0xd800 && c < 0xdc00 && text.charCodeAt(unit + 1) >= 0xdc00 && text.charCodeAt(unit + 1) < 0xe000;
    if (!paired) at += second ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return crumbs;
}

// A string's WTF-8 bytes: UTF-8, with a lone surrogate in its 3-byte form.
function wtf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (c >= 0xd800 && c < 0xdc00 && next >= 0xdc00 && next < 0xe000) {
      c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
      i++;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
