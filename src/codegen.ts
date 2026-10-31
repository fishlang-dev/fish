import { selfCalls, selfOf, type Checked, type Instance, type Local, type Type } from "./check.ts";
import type { Narrowing } from "./overloads.ts";
import { crossed as rustCrossing, dropSymbol, rustClassOf, trusted, type Crossing } from "./rust.ts";
import { asserts, computed, jsAccessors, jsCalls, jsEmptyTests, jsEvaluations, jsExports, jsMembers, jsMethods, jsNews, jsOptionalOf, jsStatics, timerCalls, restStarts, stringBuilds, syncFileCalls, combinedCalls, formatCalls, formatPlan, inspectCalls, equalities, jsonCalls, dynCalls, dynMembers, boxedMembers, fixedFills, joinCalls, printCalls, printStream, clocks, fileCalls, lengthChecks, MATH_CONSTANTS, MATH_FLOAT, maths, parses, fixedPrints, integerCalls, integerMethod, REGEX_FLAGS, regexCalls, regexNews, regexStringCalls, regexStringType, type DynTable } from "./values.ts";
import { compile as compileRegex, parsePattern } from "./regex.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { lowering } from "./arithmetic.ts";
import { CompileError, locate, sourceOf, type Source } from "./diag.ts";
import { comptimeBlock, comptimeBody, comptimeParameter, comptimeValue, memberOf, untagged, type Value } from "./comptime.ts";
import { print, RUNTIME, write } from "./runtime.ts";
import type { BinaryOp, Expr, JsName, ObjectProp, Param, Pattern, Span, Stmt } from "./parser.ts";
import { ARRAY, DYN, compound, conversions, llvm } from "./layout.ts";
import { made, type PatternInfo } from "./match.ts";
import { STD_BASE } from "./std.ts";
import { kindTests } from "./narrow.ts";
import { allFields, arrayType, callableOf, elementsOf, isPlainJs, jsShape, type InterfaceType, type ClosureType, type FixedType, type RefType, lower, show, field, fieldPath, handleType, holdsPart, sharesDyn, INTEGERS, isCopy, nextResult, leafFuture, SLEEP, unionType, YIELD_NOW, type ArrayType, type MapType, type FutureType, type HandleType, type GeneratorType, type InteriorType, type PointerType, type SharedType, type BlockType, type DynType, type Method, type Field, keyOf, described, digest, promiseElement, lentPromise, stored as storedType, blockType, interiorType, leafOf, isFloat, isInteger, isOption, type ClassType, type Integer, type Numeric, type ObjectType, type RegexType, type UnionType, type RecursiveType, matchType, regexType, unfold, tiedBy, isTuple, tupleType, combinedOf, settledParts, type LiteralType, type VariantType } from "./typing.ts";

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

// An argument described for the runtime's util.format routine: its kind, an integer's or a
// boolean's value, a float's, a string or String(x), and an inspect tree.
const FARG = "{ i32, i64, double, ptr, ptr }";
const FARG_KINDS = { string: 0, int: 1, uint: 2, float: 3, boolean: 4, null: 5, parts: 6 };

// A float constant as LLVM writes one exactly: the bits of the double holding it, which for
// an f32 must be a float's value.
function floatConstant(value: number, type: "f32" | "f64"): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, type === "f32" ? Math.fround(value) : value);
  return `0x${view.getBigUint64(0).toString(16).toUpperCase().padStart(16, "0")}`;
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
const quoted = (name: string) => name.replace(/["\\]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()}`);
// An instance's name in the IR.
export const symbol = (i: Instance) => (i.body.rust ? `@"${trusted(i.body.rust).symbol}"` : i.body.foreign ? `@"${i.body.name}"` : `@"fsh.${quoted(i.symbol)}"`);

// Function definitions and declarations, each with the lines after it, in order of the symbols
// they name.
function byName(lines: string[]): string[] {
  const chunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("define ") || line.startsWith("declare ")) chunks.push([line]);
    else chunks.at(-1)!.push(line);
  }
  const named = chunks.map((c) => [/@("[^"]*"|[\w.$-]+)\(/.exec(c[0]!)![1]!, c] as const);
  return named.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flatMap(([, c]) => c);
}

// The `Math` functions LLVM's intrinsics compute exactly. The rest call the runtime's
// correctly rounded ones, since libm's differ by platform and LLVM folds constants with the
// libm of the machine compiling.
const MATH_INTRINSICS = new Set(["floor", "ceil", "trunc", "sqrt"]);

// The C functions the runtime prelude already declares, which a `declare function` reuses.
const DECLARED = new Set(RUNTIME.flatMap((line) => /^declare [^@]*@([\w.]+)\(/.exec(line)?.[1] ?? []));

// Whether a value of the type holds a Rust handle, which only moves.
const holdsRust = (t: Type) => holdsPart(t, (u) => rustClassOf(u) !== undefined);

// How a narrow value crosses to C, which expects it widened by its caller: a boolean, a byte
// holding 0 or 1, and unsigned integers zero-extended, signed ones sign-extended.
const extension = (type: Type) => (type === "boolean" || type === "u8" || type === "u16" ? "zeroext" : type === "i8" || type === "i16" ? "signext" : "");
const crossing = (type: Type) => [llvm(type), extension(type)].filter(Boolean).join(" ");
const crossed = (type: Type) => [extension(type), llvm(type)].filter(Boolean).join(" ");

// The C parameters a value crossing to a Rust shim is passed as: a pointer for a Rust type, a
// string or an Option of either, which is null when empty; an array's buffer and length; and a
// flag first for an Option of a number, a boolean or an array.
function shimParams(c: Crossing): string[] {
  if (c.kind === "plain") return [crossing(c.type)];
  if (c.kind === "array") return ["ptr", "i64"];
  if (c.kind === "option" && (c.of.kind === "plain" || c.of.kind === "array")) return ["i1 zeroext", ...shimParams(c.of)];
  return ["ptr"];
}

// What a Rust shim returns for what its function gives, and the type of the slot it writes the
// rest of it into: an array, or what an Option of a number, a boolean or an array holds.
function shimGives(c: Crossing | undefined): { returns: string; out?: string } {
  if (!c) return { returns: "void" };
  if (c.kind === "plain") return { returns: crossed(c.type) };
  if (c.kind === "array") return { returns: "void", out: ARRAY };
  if (c.kind === "option" && c.of.kind === "plain") return { returns: "zeroext i1", out: llvm(c.inner) };
  if (c.kind === "option" && c.of.kind === "array") return { returns: "zeroext i1", out: ARRAY };
  return { returns: "ptr" };
}

// What a Rust function gives, as it crosses: a constructor gives its handle.
const rustGiven = (i: Instance): Crossing | undefined => (i.body.self?.constructor ? rustCrossing(i.body.owner!, true) : i.returns === "void" ? undefined : rustCrossing(i.returns, true));

// A library has no C `main`; each export gets a C function under its own name instead.
// `sources` holds the program's files other than the entry, for panic locations.
// `harness`: the entry file is `fishc test`'s generated harness, whose functions keep no frame.
// `leaks`: a `--leaks` build, whose frames name each allocation's site, so it keeps them in release.
export type Options = { src: string; file: string; release: boolean; panic: "unwind" | "abort"; library?: boolean; sources?: Source[]; harness?: boolean; leaks?: boolean };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
export function codegen({ instances }: Checked, { src, file, release, panic, library = false, sources = [], harness = false, leaks = false }: Options): string {
  const unwinds = panic === "abort" ? "uwtable" : UNWINDS;
  // In a debug or `--leaks` build each of the program's own functions keeps a frame on the
  // runtime's shadow stack, `{ site, name, prev }`, for a panic's backtrace and a leak's site:
  // `framing` is the body of the one being emitted, and `site` the expression or statement whose
  // calls it is making.
  let framing: string[] | undefined;
  let site: Span | undefined;
  let frames = false;
  const globals: string[] = [];
  const regexes = new Map<string, string>();
  const out: string[] = [];
  // Allocas go in the entry block, where mem2reg promotes them and loops don't grow the stack.
  let allocas: string[] = [];
  let body: string[] = [];
  let temps = 0;
  let labels = 0;
  // Each variable's number in the function being emitted, which tells apart two of one name.
  // Counted per function, so a function's IR doesn't change with the program around it.
  let numbered = new Map<Local, number>();
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
  const cStrings = new Map<string, string>();
  const tables = new Set<string>();
  // The function dropping, or copying, what a value of each type owns, made once.
  const glue = { drop: new Map<Type, string>(), copy: new Map<Type, string>() };
  // The function comparing two values of each compound type, made once.
  const comparers = new Map<Type, string>();
  const jsonWriters = new Map<Type, string>();
  const jsonReaders = new Map<Type, string>();
  const inspectors = new Map<Type, string>();
  // Each async instance's awaits, by the state it is paused in at each: the frame field the
  // awaited future is in, and its type, for cancelling it there.
  const awaitsOf = new Map<Instance, { state: number; field: number; type: Type }[]>();
  // The poll functions of `Promise.all` and `Promise.race` futures, and the async instances a
  // cancel function is wanted for.
  const combinePolls = new Map<FutureType, string>();
  const cancelled = new Set<Instance>();
  // The functions writing String(x) of a value with parts, by its type.
  const stringers = new Map<Type, string>();
  // The global each top-level const holding an aggregate lives in.
  const constantGlobals = new Map<Instance, string>();
  // The thunks copying a Dyn that can't be copied that are made, by the Rust type they name or
  // "" for the general one, and whether the one dropping a settled JS promise's output is.
  const uncopyable = new Set<string>();
  let settledOutput = false;
  const elementDrops = new Map<Type, string>();
  // The functions JS calls a Fish callback through, by its type and where it was given, and the
  // tasks settling the JS promises Fish futures are given to JS as.
  const callbacks = new Map<string, string>();
  const settlers = new Map<string, [string, string]>();
  // Where a value going to JS is given, for a callback's panics to name.
  let jsSite: Expr | undefined;
  const vtables = new Map<string, string>();
  // The functions `sort` compares through: one per comparator, and one per element type for the
  // default order.
  const orders = new Map<string, string>();
  const builder = { emit, temp, label, startBlock, cString, alloca, text, mayPanic: (call: string) => unwinding(call), deep: (a: string, b: string, type: Type) => deepEquals(a, b, type), inspect: (v: string, type: Type) => inspected(v, type) };
  const intrinsics = new Set<string>();
  // The C functions the program declares itself, which the libm functions Math uses may be.
  const foreign = new Set<string>();
  // The shim functions declared, each once however many declarations name its Rust function,
  // and the drop functions of the Rust types the program drops.
  const declaredRust = new Set<string>();
  const rustDrops = new Set<string>();
  const { operate, arithmetic, panicIf, method: integerLowering } = lowering(builder, where, release, intrinsics);
  const { convert, test, equals, unionField, holds, eachMember } = conversions(builder);

  // The instance each generator type resumes, and each future type polls.
  const generatorOf = new Map(instances.flatMap((i) => (i.generator ? [[i.generator, i] as const] : [])));
  const futureOf = new Map(instances.flatMap((i) => (i.future ? [[i.future, i] as const] : [])));
  // Each generated name in each family and what it stands for, so two things described alike
  // are never given one name.
  const taken = new Map<string, unknown>();
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
      foreign.add(instance.body.name);
      if (instance.body.rust) {
        // A Rust function's shim takes its handle first when it is a method, then its parameters
        // as they cross, the slot for the rest of what it gives, and where it puts a panic's message.
        const rust = symbol(instance);
        if (declaredRust.has(rust)) continue;
        declaredRust.add(rust);
        const self = instance.body.self && !instance.body.self.constructor ? ["ptr"] : [];
        const gives = shimGives(rustGiven(instance));
        const params = [...self, ...instance.signature!.flatMap((t) => shimParams(rustCrossing(t))), ...(gives.out ? ["ptr"] : []), ...(instance.throws ? ["ptr"] : []), "ptr"];
        out.push(`declare ${gives.returns} ${rust}(${params.join(", ")})`, "");
        continue;
      }
      if (!DECLARED.has(instance.body.name)) out.push(`declare ${crossed(instance.returns)} ${symbol(instance)}(${instance.signature!.map(crossing).join(", ")})`, "");
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
    numbered = new Map();
    block = "entry";
    pending = [];
    floor = 0;
    reserved.clear();
    scopes = [[]];
    const type = instance.returns;
    framed = new Set();
    // std's functions, its built-in modules' included, keep no frame, as Rust's short backtrace
    // hides std's internals; nor do the arrows the checker wraps around a callback.
    const from = sourceOf(src, file, f.start, sources).file;
    const ours = f.start < STD_BASE && !BUILT_IN.test(from) && !(harness && from === file) && !f.closure?.made;
    framing = (!release || leaks) && !library && ours ? body : undefined;
    site = undefined;
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
      // A `for await` loop's third field is the future it awaits.
      for (const [s, i] of instance.frame!.loops) [i, i + 1, ...((s as { await?: boolean }).await ? [i + 2] : [])].forEach((j) => field(`%loop${j}`, j));
      for (const i of instance.frame!.awaits.values()) field(`%await${i}`, i);
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
    // Falling off the end drops what the body holds there, at its closing brace.
    site = { start: f.end - 1, end: f.end };
    // The last block is unreachable when every path returned; the checker guarantees it for values.
    if (type === "void" || resuming) leave(undefined);
    else emit("unreachable");
    if (resuming) {
      // Each `next()` or poll goes on from where the last stopped: the start, a `yield` or an
      // `await`, or the end. A finished future is never polled again.
      startBlock(resuming.done);
      if (resuming.type.kind === "generator") emit(`ret ${resultType(instance)} ${yieldedAs(answer(undefined, resuming.type.yields))}`);
      else emit("unreachable");
      const resumes = [resuming.start, ...resuming.resumes].map((at, i) => `i32 ${i}, label %${at}`).join(" ");
      allocas.push(...pushFrame(instance), "  %resumed = load i32, ptr %state", `  switch i32 %resumed, label %${resuming.done} [ ${resumes} ]`);
      const takes = resuming.type.kind === "future" || resuming.type.async ? "ptr %frame, ptr %cx" : "ptr %frame";
      out.push(`define internal ${resultType(instance)} ${symbol(instance)}(${takes}) ${unwinds} {`, "entry:", ...allocas, ...popFrame(body), "}", "");
      continue;
    }
    // Fish's own functions stay inside this module, so two libraries never clash over them.
    out.push(`define internal ${resultType(instance)} ${symbol(instance)}(${params.join(", ")}) ${unwinds} {`, "entry:", ...allocas, ...pushFrame(instance), ...popFrame(body), "}", "");
  }
  framing = undefined;
  if (frames) globals.push("@fsh_rt_frames = external thread_local global ptr");
  // A cancel function wanted while making one may want another.
  for (const done = new Set<Instance>(); done.size < cancelled.size;) {
    for (const i of [...cancelled]) {
      if (done.has(i)) continue;
      done.add(i);
      cancelFunction(i);
    }
  }
  const main = instances.find((i) => i.symbol === "main")!;
  // Built before the module is put together, since its message adds a global.
  const start = library ? instances.filter((i) => i.body.exported).flatMap(exported) : entry();
  const filled = fillConstants();

  // Definitions in order of their names, rather than of when they were made, so a function
  // has the same place among them whatever the program around it.
  return [
    ...globals.toSorted(),
    // The runtime reads which way a panic goes. A library leaves it to the runtime's default, so
    // two libraries in one program don't both define it; its exports abort on a panic anyway.
    ...(library ? [] : [`@fsh_panic_abort = constant i32 ${panic === "abort" ? 1 : 0}`]),
    "",
    ...RUNTIME,
    ...[...intrinsics].filter((line) => !foreign.has(/@([\w.]+)\(/.exec(line)![1]!)),
    ...[...rustDrops].map((name) => `declare void ${name}(ptr, ptr)`),
    "",
    ...byName(out),
    ...start,
    ...filled,
    "",
  ].join("\n");

  // A framed function's entry pushes its frame: a generator or future's on each resume, since it
  // pops at every suspend, so an `await` chain or a generator's resumer is the stack below it.
  // The record is `{ site, name, prev }`, the site first so each call's store is to the slot
  // itself; nothing else outlives the entry block, so unoptimized code spills nothing more.
  function pushFrame(i: Instance): string[] {
    if (body !== framing) return [];
    frames = true;
    return [
      `  %fsh.site = alloca ${FRAME}`,
      `  %fsh.name = getelementptr ${FRAME}, ptr %fsh.site, i32 0, i32 1`,
      `  %fsh.link = getelementptr ${FRAME}, ptr %fsh.site, i32 0, i32 2`,
      "  %fsh.prev = load ptr, ptr @fsh_rt_frames",
      "  store ptr null, ptr %fsh.site",
      `  store ptr ${cString(frameName(i))}, ptr %fsh.name`,
      "  store ptr %fsh.prev, ptr %fsh.link",
      "  store ptr %fsh.site, ptr @fsh_rt_frames",
    ];
  }

  // Every return pops it; an unwinding panic leaves it, for the runtime to reset.
  function popFrame(lines: string[]): string[] {
    if (lines !== framing) return lines;
    let n = 0;
    return lines.flatMap((line) => {
      if (!line.startsWith("  ret ")) return [line];
      const [link, prev] = [`%fsh.link${n}`, `%fsh.prev${n++}`];
      return [`  ${link} = getelementptr ${FRAME}, ptr %fsh.site, i32 0, i32 2`, `  ${prev} = load ptr, ptr ${link}`, `  store ptr ${prev}, ptr @fsh_rt_frames`, line];
    });
  }

  // A frame's name: the function as written, a generic one's instance without its number, a
  // nested function by its name and an arrow by where it starts.
  function frameName(i: Instance): string {
    const closure = i.body.closure;
    if (closure) return closure.self ?? `<arrow ${where(i.body).split(":").slice(-2).join(":")}>`;
    return i.symbol.replace(/#\w+/g, "");
  }

  // The part of a generated symbol telling `owner` apart in its family: a hash of its description
  // rather than a count, so it is the same in every program making it. Owners described alike
  // get numbered suffixes.
  function stableId(family: string, description: string, owner: unknown = description): string {
    const stem = digest(description);
    let id = stem;
    for (let n = 1; taken.has(`${family} ${id}`) && taken.get(`${family} ${id}`) !== owner; n++) id = `${stem}.${n}`;
    taken.set(`${family} ${id}`, owner);
    return id;
  }

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
      if (t.kind === "literal" || t.kind === "regex") return undefined;
      // A type holding itself isn't built into the program.
      if (tiedBy(t)) return t;
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
    // `**` is `Math.pow`; an f32 one is worked in f64 and rounded back.
    if (op === "**") {
      intrinsics.add("declare double @fsh_math_pow(double, double)");
      if (type === "f64") {
        emit(`${result} = call double @fsh_math_pow(double ${a}, double ${b})`);
        return result;
      }
      const [x, y, wide] = [temp(), temp(), temp()];
      emit(`${x} = fpext float ${a} to double`);
      emit(`${y} = fpext float ${b} to double`);
      emit(`${wide} = call double @fsh_math_pow(double ${x}, double ${y})`);
      emit(`${result} = fptrunc double ${wide} to float`);
      return result;
    }
    emit(`${result} = ${FLOAT_ARITHMETIC[op]} ${llvm(type)} ${a}, ${b}`);
    return result;
  }

  // `Math` on f64 lowers to LLVM's intrinsics or to the runtime's functions; `abs`, `sign`, `min`
  // and `max` keep their numeric type, a float `min` or `max` giving NaN for any NaN and telling
  // -0 from 0, as JavaScript does.
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
    if (name in MATH_FLOAT && name !== "round") return call(`@fsh_math_${name}`, args);
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

  // `x.checkedAdd(y)` and its kin: checked gives null when the operation overflowed, and
  // overflowing pairs the wrapped value with whether it did, the intrinsic's own `{ iN, i1 }`.
  function integerMethodCall(e: Extract<Expr, { kind: "call" }>): string {
    const callee = e.callee as Extract<Expr, { kind: "member" }>;
    const type = lower(valueType(callee.object)) as Integer;
    const [family, operation] = integerMethod(callee.name)!;
    const a = value(callee.object);
    const [v, over] = integerLowering(family, operation, a, e.args[0] ? value(e.args[0]) : "", e, type);
    const t = llvm(type);
    const result = temp();
    if (family === "checked") {
      const option = unionType([type, "null"]);
      emit(`${result} = select i1 ${over}, ${llvm(option)} ${convert("zeroinitializer", "null", option)}, ${llvm(option)} ${convert(v, type, option)}`);
      return result;
    }
    if (family !== "overflowing") return v;
    const pair = temp();
    emit(`${pair} = insertvalue { ${t}, i1 } undef, ${t} ${v}, 0`);
    emit(`${result} = insertvalue { ${t}, i1 } ${pair}, i1 ${over}, 1`);
    return result;
  }

  // An assertion: a panic at the call when it is false, giving its message, or else
  // `assertion failed: ` and its condition as written. The message is made only then, as Rust's is.
  function assertCall(e: Extract<Expr, { kind: "call" }>): undefined {
    const holds = value(e.args[0]!);
    const [fail, ok] = [label(), label()];
    emit(`br i1 ${holds}, label %${ok}, label %${fail}`);
    startBlock(fail);
    if (e.args[1]) {
      // The message is handed over owned, and what making it left pending released first.
      const mark = pending.length;
      const message = owned(e.args[1]);
      settle(mark);
      unwinding(`call void @fsh_rt_panic_assert(ptr ${panicAt(e)}, ptr ${message})`);
    } else unwinding(`call void @fsh_rt_panic(ptr ${cString(`panicked at ${where(e)}:\nassertion failed: ${asserts.get(e)}\n`)})`);
    emit("unreachable");
    startBlock(ok);
    return undefined;
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
    const callee = body === framing && site ? CALLEE.exec(line)?.[1] : undefined;
    if (callee && !QUIET.test(callee)) body.push(`  store ptr ${cString(where(site!))}, ptr %fsh.site`);
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

  // Takes a lock word, panicking if this thread already holds it, which would wait forever, or
  // if a task panicked holding it, which leaves it held over a value it may have half changed.
  function takeLock(word: string, at: Span) {
    const [taken, held, poisoned] = [temp(), temp(), temp()];
    emit(`${taken} = call i32 @fsh_rt_lock(ptr ${word})`);
    emit(`${held} = icmp eq i32 ${taken}, 1`);
    panicIf(held, "this lock is already held by an `update` running here; use the value its callback is given", at);
    emit(`${poisoned} = icmp eq i32 ${taken}, 2`);
    panicIf(poisoned, "a task panicked while holding this lock, so the value it guards may be half changed", at);
  }

  // 'AbortSignal.any's handles and their count: a literal's, lent one by one, in a stack array,
  // and otherwise the borrowed array's own buffer.
  function signalList(list: Expr): string {
    if (list.kind !== "array") {
      const [array, whole, buffer, length] = [value(list), temp(), temp(), temp()];
      emit(`${whole} = load ${ARRAY}, ptr ${array}`);
      emit(`${buffer} = extractvalue ${ARRAY} ${whole}, 0`);
      emit(`${length} = extractvalue ${ARRAY} ${whole}, 1`);
      return `ptr ${buffer}, i64 ${length}`;
    }
    const n = list.elements.length;
    const handles = alloca(`[${Math.max(n, 1)} x ptr]`);
    list.elements.forEach((x, i) => {
      const [handle, at] = [temp(), temp()];
      emit(`${handle} = load ptr, ptr ${value(x!)}`);
      emit(`${at} = getelementptr [${Math.max(n, 1)} x ptr], ptr ${handles}, i32 0, i32 ${i}`);
      emit(`store ptr ${handle}, ptr ${at}`);
    });
    return `ptr ${handles}, i64 ${n}`;
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

  // An export of one of the program's packages, as a JsValue. The bundle is defined once the
  // packages the program reaches are bundled.
  function jsExport(name: JsName, at: Expr): string {
    const box = temp();
    unwinding(`call ptr @fsh_rt_js_export(ptr @fsh.js.bundle, i64 ${name.package}, ptr ${cString(name.name)}, ptr ${panicAt(at)})`, box);
    return box;
  }

  // A call of a package's function: each argument converted into a new JS value, and the result
  // read back as its declaration says.
  function jsCall(e: Extract<Expr, { kind: "call" }>, name: JsName, target: Instance): string | undefined {
    const fn = jsExport(name, e);
    const argv = jsArgv(e.args, (i) => target.body.params[i]?.optional === true);
    const result = temp();
    unwinding(`call ptr @fsh_rt_js_call(ptr ${fn}, ptr null, i64 ${e.args.length}, ptr ${argv}, ptr ${panicAt(e)})`, result);
    const gives = types.get(e) ?? (target.returns === "void" ? undefined : target.returns);
    if (gives === undefined) return void emit(`call void @fsh_rt_js_release(ptr ${result})`);
    return fromJs(result, gives, `'${name.name}' from '${name.module}' gave`, e);
  }

  // Arguments going to JS, each a new JS value in a buffer of boxes the call gives up; `optional`
  // says which parameters JS may leave out, so an empty value is undefined there.
  function jsArgv(args: Expr[], optional: (i: number) => boolean): string {
    const boxes = args.map((a, i) => {
      jsSite = a;
      const to = coercions.get(a);
      // A callback is handed over to JS, which keeps it, as the stored callable it meets, and a
      // future as the stored Promise, which a task awaits; one read from a place moves out of it.
      const held = to ?? types.get(a)!;
      if (isCallback(held) || isPromised(held)) return toJs(owned(a), held, optional(i) ? "undefined" : "null");
      return toJs(jsOperand(a), types.get(a)!, optional(i) ? "undefined" : "null", coercions.get(a));
    });
    const argv = alloca(`[${Math.max(boxes.length, 1)} x ptr]`);
    boxes.forEach((box, i) => {
      const at = temp();
      emit(`${at} = getelementptr [${boxes.length} x ptr], ptr ${argv}, i32 0, i32 ${i}`);
      emit(`store ptr ${box}, ptr ${at}`);
    });
    return argv;
  }

  // A value going to JS, as its own type rather than one it meets, as JS takes any; one made
  // for the statement is dropped once it ends.
  function jsOperand(a: Expr): string {
    const v = known.get(a) ?? evaluate(a);
    if (fresh(a) && !known.has(a)) pending.push({ v, type: types.get(a)! });
    return v;
  }

  // A handle's box, read through a reference to it.
  function jsHandle(object: Expr): string {
    const v = value(object);
    if (!isRef(valueType(object))) return v;
    const box = temp();
    emit(`${box} = load ptr, ptr ${v}`);
    return box;
  }

  // Which parameters of the method, constructor or static a call takes are written with `?`.
  function optionalAt(call: Expr): (i: number) => boolean {
    const optional = jsOptionalOf.get(call) ?? [];
    return (i) => optional[i] === true;
  }

  // A property of a JS object read as its declaration says: a handle's, or a class's static.
  function jsGet(object: string, name: string, type: Type, what: string, at: Expr): string {
    const box = temp();
    unwinding(`call ptr @fsh_rt_js_get(ptr ${object}, ptr ${text(name)}, ptr ${panicAt(at)})`, box);
    return fromJs(box, type, what, at);
  }

  // A method of a JS object called with it as `this`, its result read as `gives` says, or
  // dropped when the call's value goes unused.
  function jsMethod(object: string, name: string, args: Expr[], gives: Type | undefined, what: string, at: Expr): string | undefined {
    const fn = temp();
    unwinding(`call ptr @fsh_rt_js_get(ptr ${object}, ptr ${text(name)}, ptr ${panicAt(at)})`, fn);
    emit(`call void @fsh_rt_block_retain(ptr ${object})`);
    const argv = jsArgv(args, optionalAt(at));
    const result = temp();
    unwinding(`call ptr @fsh_rt_js_call(ptr ${fn}, ptr ${object}, i64 ${args.length}, ptr ${argv}, ptr ${panicAt(at)})`, result);
    if (gives === undefined || gives === "void") return void emit(`call void @fsh_rt_js_release(ptr ${result})`);
    return fromJs(result, gives, what, at);
  }

  // A package's class's static member, read or called on the class itself.
  function jsStatic(e: Expr, name: JsName): string | undefined {
    const c = jsExport(name, e);
    let result: string | undefined;
    if (e.kind === "member") result = jsGet(c, e.name, types.get(e)!, `'${name.name}.${e.name}' is`, e);
    else {
      const call = e as Extract<Expr, { kind: "call" }>;
      const method = (call.callee as Extract<Expr, { kind: "member" }>).name;
      result = jsMethod(c, method, call.args, types.get(call), `'${name.name}.${method}' gave`, call);
    }
    emit(`call void @fsh_rt_js_release(ptr ${c})`);
    return result;
  }

  // A stored callable, which crosses into JS as a function.
  function isCallback(t: Type): boolean {
    return typeof t !== "string" && t.kind === "dyn" && callableOf.has(t.of);
  }

  // A stored Promise, which crosses into JS as a promise.
  function isPromised(t: Type): boolean {
    return typeof t !== "string" && t.kind === "dyn" && promiseElement(t.of) !== undefined;
  }

  // The task settling a JS promise with what a stored Promise gives, given at `at`: its poll,
  // awaiting the Promise and resolving the JS promise with its value made a JS value, and the
  // drop of a frame never finished. The frame holds the Promise and the settling functions.
  function jsSettler(type: DynType, at: Expr): [string, string] {
    const key = `${keyOf(type)} ${at.start}`;
    const made = settlers.get(key);
    if (made) return made;
    const n = stableId("js.settle", `${described(type)} ${at.start}`, key);
    const names: [string, string] = [`@fsh.js.settle.${n}`, `@fsh.js.settle.drop.${n}`];
    settlers.set(key, names);
    const frame = `{ ${DYN}, ptr }`;
    const saved = { allocas, body, temps, labels, block, pending, scopes, jsSite };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const [innerAt, settleAt, settle] = [temp(), temp(), temp()];
    emit(`${innerAt} = getelementptr ${frame}, ptr %frame, i32 0, i32 0`);
    emit(`${settleAt} = getelementptr ${frame}, ptr %frame, i32 0, i32 1`);
    emit(`${settle} = load ptr, ptr ${settleAt}`);
    const step = pollStep(type, innerAt, at);
    startBlock(step.waiting);
    emit("ret i32 0");
    startBlock(step.failed);
    emit("unreachable");
    startBlock(step.ready);
    const gives = promiseElement(type.of)!;
    const v = step.value();
    jsSite = at;
    const box = gives === "void" || v === undefined ? temp() : toJs(v, gives, "null");
    if (gives === "void" || v === undefined) emit(`${box} = call ptr @fsh_rt_js_of_empty(i32 1)`);
    emit(`call void @fsh_rt_js_settle(ptr ${settle}, ptr ${box})`);
    if (v !== undefined && gives !== "void") dispose(v, gives);
    const old = temp();
    emit(`${old} = load ${DYN}, ptr ${innerAt}`);
    dispose(old, type);
    emit("ret i32 1");
    out.push(`define internal i32 ${names[0]}(ptr %cx, ptr %frame) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const [promise, held] = [temp(), temp()];
    emit(`${promise} = load ${DYN}, ptr %frame`);
    dispose(promise, type);
    const at1 = temp();
    emit(`${at1} = getelementptr ${frame}, ptr %frame, i32 0, i32 1`);
    emit(`${held} = load ptr, ptr ${at1}`);
    emit(`call void @fsh_rt_js_release(ptr ${held})`);
    emit("ret void");
    out.push(`define internal void ${names[1]}(ptr %frame) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    if (!settledOutput) {
      settledOutput = true;
      out.push(`define internal void @"fsh.js.settled.output"(ptr %out) {`, "entry:", "  ret void", "}", "");
    }
    ({ allocas, body, temps, labels, block, pending, scopes, jsSite } = saved);
    return names;
  }

  // The function JS calls a callback of this type through, given at `at`: what JS gives it read
  // as its parameters say, the callable called, and what it gives made a JS value. Called with a
  // count below zero, as JS's garbage collector drops the function, it drops the callable.
  function jsCallback(type: DynType, at: Expr): string {
    const key = `${keyOf(type)} ${at.start}`;
    const made = callbacks.get(key);
    if (made) return made;
    const name = `@fsh.js.callback.${stableId("js.callback", `${described(type)} ${at.start}`, key)}`;
    callbacks.set(key, name);
    const saved = { allocas, body, temps, labels, block, pending, scopes, jsSite };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const fn = callableOf.get(type.of)!;
    const [dropping, drop, call] = [temp(), label(), label()];
    emit(`${dropping} = icmp slt i64 %argc, 0`);
    emit(`br i1 ${dropping}, label %${drop}, label %${call}`);
    startBlock(drop);
    const [half, whole] = [temp(), temp()];
    emit(`${half} = insertvalue ${DYN} undef, ptr %data, 0`);
    emit(`${whole} = insertvalue ${DYN} ${half}, ptr %table, 1`);
    dispose(whole, type);
    emit("ret ptr null");
    startBlock(call);
    const args = fn.params.map((p, i) => {
      const [slot, box] = [temp(), temp()];
      emit(`${slot} = getelementptr ptr, ptr %argv, i64 ${i}`);
      emit(`${box} = load ptr, ptr ${slot}`);
      return `, ${llvm(p)} ${fromJs(box, p, `a callback was given`, at)}`;
    });
    const callee = vslot("%table", 0);
    const result = fn.returns === "void" ? undefined : temp();
    unwinding(`call ${fn.returns === "void" ? "void" : llvm(fn.returns)} ${callee}(ptr %data${args.join("")})`, result);
    if (result === undefined) emit("ret ptr null");
    else {
      jsSite = at;
      const box = toJs(result, fn.returns, "null");
      dispose(result, fn.returns);
      emit(`ret ptr ${box}`);
    }
    out.push(`define internal ptr ${name}(ptr %data, ptr %table, i64 %argc, ptr %argv) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block, pending, scopes, jsSite } = saved);
    return name;
  }

  // The shape an object is given as: a package's, or an object type, through an Option.
  function jsShapeOf(t: Type): ObjectType | InterfaceType | undefined {
    if (typeof t === "string") return undefined;
    if (t.kind === "union") return t.members.map(jsShapeOf).find((s) => s !== undefined);
    return jsShape(t) ?? (t.kind === "object" ? t : undefined);
  }

  // A Fish value as a new JS value, in a box of its own; empty is `undefined` for a parameter
  // written with `?`, which JS may leave out, and `null` otherwise. A field an object leaves out
  // isn't there in JS either.
  function toJs(v: string, type: Type, empty: "undefined" | "null", declared?: Type): string {
    if (typeof type !== "string" && type.kind === "param") return toJs(v, type.concrete!, empty, declared);
    const box = temp();
    if (isRef(type)) {
      const loaded = temp();
      emit(`${loaded} = load ${llvm(type.to)}, ptr ${v}`);
      return toJs(loaded, type.to, empty);
    }
    if (typeof type !== "string" && type.kind === "block") {
      emit(`call void @fsh_rt_block_retain(ptr ${v})`);
      return v;
    }
    if (typeof type !== "string" && type.kind === "union") return eachMember(v, type, blockType("JsValue"), (part, m) => toJs(part, m, empty, declared));
    // A Fish future as a JS promise, settled by a task that awaits it, spawned now.
    if (isPromised(type)) {
      const [settleAt, frame] = [alloca("ptr"), alloca(`{ ${DYN}, ptr }`)];
      emit(`${box} = call ptr @fsh_rt_js_promise(ptr ${settleAt})`);
      const [settle, innerAt, heldAt, task] = [temp(), temp(), temp(), temp()];
      emit(`${settle} = load ptr, ptr ${settleAt}`);
      emit(`${innerAt} = getelementptr { ${DYN}, ptr }, ptr ${frame}, i32 0, i32 0`);
      emit(`store ${DYN} ${v}, ptr ${innerAt}`);
      emit(`${heldAt} = getelementptr { ${DYN}, ptr }, ptr ${frame}, i32 0, i32 1`);
      emit(`store ptr ${settle}, ptr ${heldAt}`);
      const [poll, drop] = jsSettler(type as DynType, jsSite!);
      unwinding(`call ptr @fsh_rt_spawn(ptr ${poll}, ptr ${drop}, ptr @"fsh.js.settled.output", ptr ${frame}, i64 ${sizeOf(`{ ${DYN}, ptr }`)}, i64 8)`, task);
      emit(`call void @fsh_rt_handle_drop(ptr ${task})`);
      return box;
    }
    // A callback as a JS function that owns it.
    if (isCallback(type)) {
      const [data, table] = [temp(), temp()];
      emit(`${data} = extractvalue ${DYN} ${v}, 0`);
      emit(`${table} = extractvalue ${DYN} ${v}, 1`);
      emit(`${box} = call ptr @fsh_rt_js_function(ptr ${data}, ptr ${table}, ptr ${jsCallback(type as DynType, jsSite!)}, i32 ${callableOf.get((type as DynType).of)!.params.length})`);
      return box;
    }
    // An array or a tuple as a new JS array, and an object as a new JS object, each part
    // converted in turn.
    if (typeof type !== "string" && (type.kind === "array" || type.kind === "fixed" || (type.kind === "object" && type.tuple))) {
      emit(`${box} = call ptr @fsh_rt_js_array()`);
      const push = (part: string, t: Type) => emit(`call void @fsh_rt_js_push(ptr ${box}, ptr ${toJs(part, t, "null")})`);
      if (type.kind === "array" && type.element === "never") return box;
      if (type.kind === "array") {
        const [data, length] = [temp(), temp()];
        emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
        emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
        elements(type.element, data, length, (at) => {
          const part = temp();
          emit(`${part} = load ${llvm(type.element)}, ptr ${at}`);
          push(part, type.element);
        });
      } else {
        const parts = type.kind === "fixed" ? Array.from({ length: type.size }, () => type.element) : elementsOf(type);
        parts.forEach((t, i) => {
          const part = temp();
          emit(`${part} = extractvalue ${llvm(type)} ${v}, ${type.kind === "fixed" ? i : fieldPath(type, String(i)).join(", ")}`);
          push(part, t);
        });
      }
      return box;
    }
    if (typeof type !== "string" && type.kind === "object") {
      emit(`${box} = call ptr @fsh_rt_js_object()`);
      // The shape the object is given as says which properties are written with `?`.
      const shape = declared === undefined ? undefined : jsShapeOf(referent(declared));
      for (const f of type.fields) {
        const [part, into] = [temp(), shape?.fields.find((g) => g.name === f.name)];
        emit(`${part} = extractvalue ${llvm(type)} ${v}, ${fieldPath(type, f.name).join(", ")}`);
        emit(`call void @fsh_rt_js_put(ptr ${box}, ptr ${cString(f.name)}, ptr ${toJs(part, f.type, into?.optional ? "undefined" : "null", into?.type)})`);
      }
      return box;
    }
    if (typeof type !== "string" && type.kind === "literal") {
      const value = type.value;
      if (typeof value === "string") emit(`${box} = call ptr @fsh_rt_js_of_string(ptr ${text(value)})`);
      else if (typeof value === "boolean") emit(`${box} = call ptr @fsh_rt_js_of_boolean(i32 ${value ? 1 : 0})`);
      else emit(`${box} = call ptr @fsh_rt_js_of_number(double ${floatConstant(Number(value), "f64")})`);
      return box;
    }
    if (type === "string") emit(`${box} = call ptr @fsh_rt_js_of_string(ptr ${v})`);
    else if (type === "boolean") {
      const word = temp();
      emit(`${word} = zext i1 ${v} to i32`);
      emit(`${box} = call ptr @fsh_rt_js_of_boolean(i32 ${word})`);
    } else if (type === "null") emit(`${box} = call ptr @fsh_rt_js_of_empty(i32 ${empty === "undefined" ? 1 : 0})`);
    else emit(`${box} = call ptr @fsh_rt_js_of_number(double ${type === "f64" ? v : cast(v, type, "f64")})`);
    return box;
  }

  // A JsValue read as the type its declaration gives it, checked, giving up its box: `what` says
  // what gave it, as "'f' from 'pkg' gave". A union takes the first member the JS value is.
  function fromJs(box: string, type: Type, what: string, at: Expr): string {
    if (typeof type !== "string" && type.kind === "param") return fromJs(box, type.concrete!, what, at);
    if (isPlainJs(type)) return box;
    const checked = (call: string) => `${call}(ptr ${box}, ptr ${cString(what)}, ptr ${cString(show(type))}, ptr ${panicAt(at)})`;
    // Panics unless the JS value is what the declaration says, by the test `jsMatches` makes.
    const expect = (test: string) => {
      const [yes, no] = [label(), label()];
      emit(`br i1 ${test}, label %${yes}, label %${no}`);
      startBlock(no);
      unwinding(`call void ${checked("@fsh_rt_js_mismatch")}`);
      emit("unreachable");
      startBlock(yes);
    };
    if (typeof type !== "string" && type.kind === "union") return jsUnion(box, type, what, at);
    // A promise is awaited as a future holding it, which reads what it settles with then.
    if (typeof type !== "string" && type.kind === "future") {
      const frame = temp();
      emit(`${frame} = insertvalue ${llvm(type)} zeroinitializer, ptr ${box}, 1`);
      return frame;
    }
    // A handle of a declared shape holds an object.
    if (typeof type !== "string" && type.kind === "block") {
      unwinding(`call void ${checked("@fsh_rt_js_object_is")}`);
      return box;
    }
    if (type === "string" || type === "f64" || type === "boolean") {
      const [result, read] = type === "string" ? ["ptr", "string"] : type === "f64" ? ["double", "number"] : ["i32", "boolean"];
      const v = temp();
      unwinding(`call ${result} ${checked(`@fsh_rt_js_as_${read}`)}`, v);
      if (type !== "boolean") return v;
      const yes = temp();
      emit(`${yes} = icmp ne i32 ${v}, 0`);
      return yes;
    }
    // Another number type takes a JS number it holds exactly.
    if (isFloat(type) || isInteger(type)) {
      const [d, v] = [temp(), temp()];
      if (isFloat(type)) {
        unwinding(`call double ${checked("@fsh_rt_js_as_number")}`, d);
        emit(`${v} = fptrunc double ${d} to float`);
        return v;
      }
      const { bits, signed } = INTEGERS[type as Integer];
      // The bound past the largest value, which a double holds exactly where the largest isn't.
      const [min, past] = signed ? [-(2 ** (bits - 1)), 2 ** (bits - 1)] : [0, 2 ** bits];
      unwinding(`call double @fsh_rt_js_as_integer(ptr ${box}, double ${floatConstant(min, "f64")}, double ${floatConstant(past, "f64")}, ptr ${cString(what)}, ptr ${cString(show(type))}, ptr ${panicAt(at)})`, d);
      emit(`${v} = ${signed ? "fptosi" : "fptoui"} double ${d} to ${llvm(type)}`);
      return v;
    }
    // Empty, and a literal, hold nothing once they are known to be what the declaration says.
    if (type === "null" || (typeof type !== "string" && type.kind === "literal")) {
      expect(jsMatches(box, type));
      emit(`call void @fsh_rt_js_release(ptr ${box})`);
      return "zeroinitializer";
    }
    if (typeof type === "string") throw new Error(`internal error: no reading of a '${type}' out of JS`);
    // A JS array as a new Fish array, each element read as the declaration says; a fixed array
    // takes exactly its length, and a tuple its elements by their places.
    if (type.kind === "array" || type.kind === "fixed" || (type.kind === "object" && type.tuple)) {
      const length = temp();
      unwinding(`call i64 ${checked("@fsh_rt_js_length")}`, length);
      // ponytail: an element that isn't what its declaration says panics leaving the elements read
      // so far, and the array's box, unfreed; free them on the way out if a panic stops being final
      const read = (i: string, element: Type) => {
        const part = temp();
        unwinding(`call ptr @fsh_rt_js_at(ptr ${box}, i64 ${i}, ptr ${panicAt(at)})`, part);
        return fromJs(part, element, `${what} an array holding`, at);
      };
      if (type.kind === "array") {
        const data = temp();
        emit(`${data} = call ptr @fsh_rt_array_alloc(i64 ${bytes(type.element, length)})`);
        elements(type.element, data, length, (slot, i) => emit(`store ${llvm(type.element)} ${read(i, type.element)}, ptr ${slot}`));
        emit(`call void @fsh_rt_js_release(ptr ${box})`);
        return built(data, length, length);
      }
      const parts = type.kind === "fixed" ? Array.from({ length: type.size }, () => type.element) : elementsOf(type);
      const enough = temp();
      emit(`${enough} = icmp ${type.kind === "fixed" ? "eq" : "sge"} i64 ${length}, ${parts.filter((p) => type.kind === "fixed" || !isOption(p)).length}`);
      expect(enough);
      let made = "zeroinitializer";
      parts.forEach((element, i) => {
        const next = temp();
        emit(`${next} = insertvalue ${llvm(type)} ${made}, ${llvm(element)} ${read(String(i), element)}, ${type.kind === "fixed" ? i : fieldPath(type, String(i)).join(", ")}`);
        made = next;
      });
      emit(`call void @fsh_rt_js_release(ptr ${box})`);
      return made;
    }
    // A JS object as a new Fish object of its declared shape, each property read in turn.
    if (type.kind === "object") {
      expect(jsMatches(box, type));
      let made = "zeroinitializer";
      for (const f of type.fields) {
        const next = temp();
        const v = jsGet(box, f.name, f.type, `${what} an object whose '${f.name}' is`, at);
        emit(`${next} = insertvalue ${llvm(type)} ${made}, ${llvm(f.type)} ${v}, ${fieldPath(type, f.name).join(", ")}`);
        made = next;
      }
      emit(`call void @fsh_rt_js_release(ptr ${box})`);
      return made;
    }
    throw new Error(`internal error: no reading of a '${show(type)}' out of JS`);
  }

  // A JS value read as the first member of a union it is: literals tried first, then the rest,
  // a plain JsValue last as it takes anything.
  function jsUnion(box: string, type: UnionType, what: string, at: Expr): string {
    const rank = (m: Type) => (typeof m !== "string" && m.kind === "literal" ? 0 : isPlainJs(m) ? 2 : 1);
    const order = [...type.members].sort((a, b) => rank(a) - rank(b));
    const [slot, done] = [alloca(llvm(type)), label()];
    for (const m of order) {
      const [yes, no] = [label(), label()];
      emit(`br i1 ${jsMatches(box, m)}, label %${yes}, label %${no}`);
      startBlock(yes);
      emit(`store ${llvm(type)} ${convert(fromJs(box, m, what, at), m, type)}, ptr ${slot}`);
      emit(`br label %${done}`);
      startBlock(no);
    }
    unwinding(`call void @fsh_rt_js_mismatch(ptr ${box}, ptr ${cString(what)}, ptr ${cString(show(type))}, ptr ${panicAt(at)})`);
    emit("unreachable");
    startBlock(done);
    const out = temp();
    emit(`${out} = load ${llvm(type)}, ptr ${slot}`);
    return out;
  }

  // Whether a JS value is of a declared type, as an `i1`: a literal by its value, an array or a
  // tuple by each element, an object by each property, and a handle's shape by having each
  // property it can't leave out, its literal properties matching. Nothing it reads throws.
  function jsMatches(box: string, m: Type): string {
    const is = (kind: number, s = "null", d = "0.0") => {
      const [r, b] = [temp(), temp()];
      emit(`${r} = call i32 @fsh_rt_js_is(ptr ${box}, i32 ${kind}, ptr ${s}, double ${d})`);
      emit(`${b} = icmp ne i32 ${r}, 0`);
      return b;
    };
    if (isPlainJs(m)) return "true";
    if (m === "null") return is(1);
    if (m === "string") return is(2);
    if (m === "boolean") return is(4);
    if (isFloat(m) || isInteger(m)) return is(3);
    if (typeof m === "string") return "false";
    if (m.kind === "literal") return is(...jsLiteral(m.value));
    if (m.kind === "param") return jsMatches(box, m.concrete!);
    if (m.kind === "union") {
      // Any member, the rest tried only while none has matched.
      const [first, ...rest] = m.members;
      return rest.reduce((any, member) => {
        const none = temp();
        emit(`${none} = xor i1 ${any}, true`);
        const later = both(none, () => jsMatches(box, member));
        const v = temp();
        emit(`${v} = or i1 ${any}, ${later}`);
        return v;
      }, jsMatches(box, first!));
    }
    if (m.kind === "array" || m.kind === "fixed" || (m.kind === "object" && m.tuple)) return jsArrayMatches(box, m, is(10));
    if (m.kind === "object") {
      let all = is(9);
      for (const f of m.fields) all = both(all, () => jsPart(box, cString(f.name), "-1", (part) => jsMatches(part, f.type)));
      return all;
    }
    const shape = m.kind === "block" ? jsShape(m) : undefined;
    let all = is(9);
    for (const f of shape?.fields ?? []) {
      if (isOption(f.type)) continue;
      const [kind, s, d] = typeof f.type !== "string" && f.type.kind === "literal" ? jsLiteral(f.type.value) : [11, "null", "0.0"] as const;
      const [r, b, both] = [temp(), temp(), temp()];
      emit(`${r} = call i32 @fsh_rt_js_field_is(ptr ${box}, ptr ${cString(f.name)}, i32 ${kind}, ptr ${s}, double ${d})`);
      emit(`${b} = icmp ne i32 ${r}, 0`);
      emit(`${both} = and i1 ${all}, ${b}`);
      all = both;
    }
    return all;
  }

  // `first`, and then, only where it holds, what `then` tests, as an `i1`.
  function both(first: string, then: () => string): string {
    const [more, done, from] = [label(), label(), block];
    emit(`br i1 ${first}, label %${more}, label %${done}`);
    startBlock(more);
    const second = then();
    const after = block;
    emit(`br label %${done}`);
    startBlock(done);
    const v = temp();
    emit(`${v} = phi i1 [ false, %${from} ], [ ${second}, %${after} ]`);
    return v;
  }

  // What `test` says of a property, by name, or an element, by index, of a JS value, read
  // without throwing: one that throws as it is read is undefined.
  function jsPart(box: string, name: string, index: string, test: (part: string) => string): string {
    const part = temp();
    emit(`${part} = call ptr @fsh_rt_js_peek(ptr ${box}, ptr ${name === "null" ? "null" : name}, i64 ${index})`);
    const v = test(part);
    emit(`call void @fsh_rt_js_release(ptr ${part})`);
    return v;
  }

  // Whether a JS array holds what an array, fixed array or tuple type says, every element of it.
  function jsArrayMatches(box: string, m: Type, isArray: string): string {
    if (typeof m === "string") return "false";
    return both(isArray, () => {
      const length = temp();
      emit(`${length} = call i64 @fsh_rt_js_count(ptr ${box})`);
      if (m.kind === "object") {
        const parts = elementsOf(m);
        const enough = temp();
        emit(`${enough} = icmp sge i64 ${length}, ${parts.filter((p) => !isOption(p)).length}`);
        return parts.reduce((all, element, i) => both(all, () => jsPart(box, "null", String(i), (part) => jsMatches(part, element))), enough);
      }
      const element = (m as ArrayType | FixedType).element;
      const fits = m.kind === "fixed" ? temp() : "true";
      if (m.kind === "fixed") emit(`${fits} = icmp eq i64 ${length}, ${(m as FixedType).size}`);
      return both(fits, () => {
        // Each element in turn, until one doesn't match.
        const [i, ok] = [alloca("i64"), alloca("i1")];
        emit(`store i64 0, ptr ${i}`);
        emit(`store i1 true, ptr ${ok}`);
        const [test, body, next, end] = [label(), label(), label(), label()];
        emit(`br label %${test}`);
        startBlock(test);
        const [at, more] = [temp(), temp()];
        emit(`${at} = load i64, ptr ${i}`);
        emit(`${more} = icmp slt i64 ${at}, ${length}`);
        emit(`br i1 ${more}, label %${body}, label %${end}`);
        startBlock(body);
        const matched = jsPart(box, "null", at, (part) => jsMatches(part, element));
        emit(`br i1 ${matched}, label %${next}, label %${end}`);
        startBlock(next);
        const step = temp();
        emit(`${step} = add i64 ${at}, 1`);
        emit(`store i64 ${step}, ptr ${i}`);
        emit(`br label %${test}`);
        startBlock(end);
        const [reached, all] = [temp(), temp()];
        emit(`${reached} = load i64, ptr ${i}`);
        emit(`${all} = icmp eq i64 ${reached}, ${length}`);
        return all;
      });
    });
  }

  // What `fsh_rt_js_is` takes to test for a literal: its kind, and its text or number.
  function jsLiteral(value: string | bigint | boolean): [number, string, string] {
    if (typeof value === "string") return [5, text(value), "0.0"];
    if (typeof value === "boolean") return [value ? 7 : 6, "null", "0.0"];
    return [8, "null", floatConstant(Number(value), "f64")];
  }

  // A JsValue narrowed to a string, number or boolean, read out of JS.
  function jsRead(box: string, as: Type): string {
    const [read, v] = [temp(), temp()];
    if (as === "string") return emit(`${read} = call ptr @fsh_rt_js_string(ptr ${box})`), read;
    if (as === "f64") return emit(`${read} = call double @fsh_rt_js_number(ptr ${box})`), read;
    emit(`${read} = call i32 @fsh_rt_js_boolean(ptr ${box})`);
    emit(`${v} = icmp ne i32 ${read}, 0`);
    return v;
  }

  // A Semaphore's or Channel's method, or a JsValue's. Those that wait give a future holding a
  // count on the block, and for `send` the value going in.
  function blockCall(e: Extract<Expr, { kind: "call" }>, callee: Extract<Expr, { kind: "member" }>): string | undefined {
    const t = referent(valueType(callee.object)) as BlockType;
    const handle = temp();
    emit(`${handle} = load ptr, ptr ${receiver(callee.object)}`);
    if (jsMethods.has(e)) return jsMethod(handle, callee.name, e.args, types.get(e), `'${callee.name}' of '${show(t)}' gave`, e);
    if (jsAccessors.has(e)) {
      const [made, has] = [temp(), temp()];
      const at = callee.name === "at" ? `i64 ${value(e.args[0]!)}` : `ptr ${value(e.args[0]!)}`;
      unwinding(`call ${callee.name === "has" ? "i32" : "ptr"} @fsh_rt_js_${callee.name}(ptr ${handle}, ${at}, ptr ${panicAt(e)})`, made);
      if (callee.name !== "has") return made;
      emit(`${has} = icmp ne i32 ${made}, 0`);
      return has;
    }
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
    // A settle the cell no longer takes leaves its value here to drop.
    if (callee.name === "settle") {
      const of = lower(t.of);
      const [slot, taken, kept, drop, done] = [alloca(llvm(of)), temp(), temp(), label(), label()];
      emit(`store ${llvm(of)} ${owned(e.args[0]!)}, ptr ${slot}`);
      emit(`${taken} = call i32 @fsh_rt_channel_settle(ptr ${handle}, ptr ${slot})`);
      const no = temp();
      emit(`${no} = icmp eq i32 ${taken}, 0`);
      emit(`br i1 ${no}, label %${drop}, label %${done}`);
      startBlock(drop);
      emit(`${kept} = load ${llvm(of)}, ptr ${slot}`);
      dispose(kept, of);
      emit(`br label %${done}`);
      startBlock(done);
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
    const n = stableId("vtable", `${described(type)} as ${described(to)}`, key);
    const name = `@fsh.vtable.${n}`;
    vtables.set(key, name);
    const table = dynMembers.get(key)!;
    let slots: string[];
    if (sharesDyn(to)) {
      // A shared Dyn's '.clone()' runs its class's own clone when it has one, and otherwise shares.
      const own = table.clone && table.clone !== "copy";
      slots = [dynRelease(type, n), "@fsh_rt_dyn_retain", own ? dynClone(type, n, table, true) : "@fsh_rt_dyn_retain"];
    } else {
      // A Rust value is never copied, so a Dyn holding one panics if it ever is.
      let rust: string | undefined;
      holdsPart(type, (u) => (rust ??= rustClassOf(u)?.name) !== undefined);
      const copied = rust !== undefined ? dynUncopyable(rust) : dynCopy(type, n);
      const cloned = table.clone === "copy" ? copied : dynClone(type, n, table);
      // A value holding nothing pinned copies as the compiler copies, its own Dyns through their
      // own vtables; one that does would split that state, so its copy panics.
      const pinned = holdsPart(type, (u) => typeof u !== "string" && ((u.kind === "interior" && u.which !== "Cell") || (u.kind === "block" && (u.which === "Semaphore" || u.which === "Permit")) || u.kind === "handle" || u.kind === "generator"));
      const copy = !pinned || promiseElement(to.of) !== undefined ? copied : table.clone ? cloned : dynUncopyable();
      slots = [dynDrop(type, n), copy, cloned];
    }
    slots.push(...dynSlots(type, n, to, table));
    // An error-like value boxed as a cause keeps how it prints, so an Error prints its cause
    // chain as Node does.
    if (to.of.name === "ErrorLike") slots.push(inspectThunk(type, n));
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

  // A boxed value's inspect tree at a depth, as console.log would make it for its own type.
  function inspectThunk(type: Type, n: string): string {
    const name = `@fsh.dyn.inspect.${n}`;
    thunk(name, "ptr", () => {
      const v = temp();
      emit(`${v} = load ${llvm(type)}, ptr %p`);
      emit(`ret ptr ${inspectTree(v, type, "%d")}`);
    }, ["i64 %d"]);
    return name;
  }

  // A shared Dyn's drop: the last count drops the value and frees its block.
  function dynRelease(type: Type, n: string): string {
    const name = `@fsh.dyn.release.${n}`;
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

  // The copy of a Dyn whose value can't be cloned: it panics rather than split state in two,
  // naming the Rust type when a Rust value is what can't be copied.
  function dynUncopyable(rust = ""): string {
    const name = rust ? `@"fsh.dyn.uncopyable.${rust}"` : `@"fsh.dyn.uncopyable"`;
    if (!uncopyable.has(rust)) {
      uncopyable.add(rust);
      const why = rust
        ? `its value holds a Rust '${rust}', which is moved, never copied; await the futures holding one, or move them rather than copy them`
        : "its value holds an Atomic, a Lock, a JoinHandle, a Rust value or something else changed or awaited in one place, so it can't be copied; keep it in a shared value, or give its interface no methods that change it";
      thunk(name, "ptr", () => {
        unwinding(`call void @fsh_rt_panic(ptr ${cString(`panicked while copying a Dyn:\n${why}\n`)})`);
        emit("unreachable");
      });
    }
    return name;
  }

  function dynDrop(type: Type, n: string): string {
    const name = `@fsh.dyn.drop.${n}`;
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
  function dynCopy(type: Type, n: string): string {
    const name = `@fsh.dyn.copy.${n}`;
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
  function dynClone(type: Type, n: string, table: DynTable, counted = false): string {
    if (!table.clone || table.clone === "copy") return "null";
    const own = table.clone;
    const name = `@fsh.dyn.clone.${n}`;
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
  function dynSlots(type: Type, n: string, to: DynType, { methods, fields }: DynTable): string[] {
    // A boxed future's slots are its poll, which takes its frame as the block, and its cancel.
    if (promiseElement(to.of) !== undefined) {
      if (leafOf.get(type as FutureType)?.method === "next") return nextSlots(type as FutureType, n);
      const instance = futureOf.get(type as FutureType)!;
      cancelled.add(instance);
      return [symbol(instance), cancelSymbol(instance)];
    }
    if (typeof type !== "string" && type.kind === "generator") return [generatorNext(type, n)];
    const abstract = (t: Type) => typeof t !== "string" && t.kind === "interface" && promiseElement(t) === undefined;
    const made = to.of.methods.map((m, i) => (abstract(m.returns) || !methods[i] ? "null" : methodThunk(`@"fsh.dyn.${n}.${m.name}"`, type, m, methods[i]!)));
    return [...made, ...to.of.fields.map((f, i) => fieldThunk(`@"fsh.dyn.${n}.get ${f.name}"`, type, f, fields[i]))];
  }

  // A boxed async generator's `next()`: its future, borrowing the generator in the block, boxed.
  function generatorNext(type: GeneratorType, n: string): string {
    const name = `@"fsh.dyn.${n}.next"`;
    thunk(name, DYN, () => {
      const future = leafFuture("next", type);
      const made = temp();
      emit(`${made} = insertvalue ${llvm(future)} zeroinitializer, ptr %p, 1`);
      emit(`ret ${DYN} ${box(made, future, lentPromise(nextResult(type.yields)))}`);
    });
    return name;
  }

  // A boxed `next()` future's poll and cancel: the generator's own, through the pointer to it.
  function nextSlots(future: FutureType, n: string): string[] {
    const target = generatorOf.get(leafOf.get(future)!.of as GeneratorType)!;
    cancelled.add(target);
    const generator = () => {
      const [slot, p] = [temp(), temp()];
      emit(`${slot} = getelementptr ${llvm(future)}, ptr %p, i32 0, i32 1`);
      emit(`${p} = load ptr, ptr ${slot}`);
      return p;
    };
    const poll = `@"fsh.dyn.${n}.poll"`;
    thunk(poll, pollType(future), () => {
      const result = temp();
      emit(`${result} = call ${pollType(future)} ${symbol(target)}(ptr ${generator()}, ptr %cx)`);
      emit(`ret ${pollType(future)} ${result}`);
    }, ["ptr %cx"]);
    const cancel = `@"fsh.dyn.${n}.cancel"`;
    thunk(cancel, "void", () => {
      emit(`call void ${cancelSymbol(target)}(ptr ${generator()}, ptr %cx)`);
      emit("ret void");
    }, ["ptr %cx"]);
    return [poll, cancel];
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
    const name = `@fsh.element.drop.${stableId("element.drop", described(type), type)}`;
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
    return resuming ? `%loop${current.frame!.loops.get(s)! + i}` : alloca(type);
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

  // `for await`: each pass awaits the next value in the loop's await slot, an async generator's
  // `next()` or a Channel's `receive()`, until the generator finishes or the channel is closed
  // and drained. The loop owns a generator it was given, as a generator's loop does, and a count
  // on its channel.
  function awaitLoop(s: Extract<Stmt, { kind: "forIn" | "forOf" }>, iterated: Type) {
    const local = resolved(s.left as Stmt);
    const base = current.frame!.loops.get(s)!;
    const [held, at] = [`%loop${base}`, `%loop${base + 2}`];
    const kept = resuming!.type.frame[base]!.type;
    const awaited = resuming!.type.frame[base + 2]!.type as FutureType | DynType;
    const boxed = awaited.kind === "dyn" ? awaited : undefined;
    const future = awaited as FutureType;
    const channel = typeof kept !== "string" && kept.kind === "block" ? kept : undefined;
    scopes.push([]);
    if (channel) {
      let handle = value(s.right);
      if (isRef(iterated)) {
        handle = temp();
        emit(`${handle} = load ptr, ptr ${value(s.right)}`);
      }
      own(held, channel);
      emit(`store ptr ${copied(handle, channel)}, ptr ${held}`);
    } else if (isRef(kept)) emit(`store ptr ${value(s.right)}, ptr ${held}`);
    else {
      own(held, kept);
      emit(`store ${llvm(kept)} ${owned(s.right)}, ptr ${held}`);
    }
    settle();
    scopes.at(-1)!.push({ slot: at, type: awaited });
    const [test, loop, end] = [label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    let source = held;
    if (channel || isRef(kept)) {
      source = temp();
      emit(`${source} = load ptr, ptr ${held}`);
    }
    if (boxed) {
      // A boxed generator's `next()` is its vtable's first slot after drop, copy and clone.
      const [dyn, data, table] = [temp(), temp(), temp()];
      emit(`${dyn} = load ${DYN}, ptr ${source}`);
      emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      const made = temp();
      unwinding(`call ${DYN} ${vslot(table, 0)}(ptr ${data})`, made);
      emit(`store ${DYN} ${made}, ptr ${at}`);
    } else {
      const frame = temp();
      emit(`${frame} = insertvalue ${llvm(future)} zeroinitializer, ptr ${channel ? copied(source, channel) : source}, 1`);
      emit(`store ${llvm(future)} ${frame}, ptr ${at}`);
    }
    const result = suspend(awaited, at, base + 2, s.right)!;
    const gives = (boxed ? promiseElement(boxed.of)! : future.gives) as UnionType;
    let v: string;
    if (channel) {
      emit(`br i1 ${holds(result, gives, ["null"])}, label %${end}, label %${loop}`);
      startBlock(loop);
      v = convert(result, gives, local.type);
    } else {
      const [finished, more] = nextShapes(local.type);
      emit(`br i1 ${holds(result, gives, [finished])}, label %${end}, label %${loop}`);
      startBlock(loop);
      v = temp();
      emit(`${v} = extractvalue ${llvm(more)} ${convert(result, gives, more)}, 1`);
    }
    exits.set(s, { exit: end, next: test, depth: scopes.length });
    scopes.push([]);
    reserve(local);
    own(slot(local), local.type);
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
    emit(`ret ${resultType(current)} ${yieldedAs(result)}`);
    startBlock(at);
  }

  // A variable's slot: an alloca, or in a generator, the frame's field, reached on entry.
  function reserve(local: Local) {
    if (!framed.has(slot(local))) allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
  }

  function slot(local: Local): string {
    const at = captured.get(local);
    if (at) return at;
    let n = numbered.get(local);
    if (n === undefined) numbered.set(local, (n = numbered.size));
    // Its number follows a dot, as no other name in a function's IR puts one. Quoted unless
    // plain, so any name a variable may have, `café` or a pattern's `[a, b]`, is a valid one.
    const name = `${local.name === "%" ? "topic" : local.name}.${n}`;
    return /^[-\w$.]+$/.test(name) ? `%${name}` : `%"${name}"`;
  }

  function resolved(node: Expr | Stmt | Param | ObjectProp): Local {
    const local = locals.get(node);
    if (!local) throw new Error("internal error: unresolved name");
    return local;
  }

  function statement(s: Stmt) {
    const outer = site;
    site = s;
    lowerStatement(s);
    site = outer;
  }

  function lowerStatement(s: Stmt) {
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
        if (s.await) return awaitLoop(s, iterated);
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
    if (type === "string" || (type !== undefined && rustClassOf(type))) return true;
    if (typeof type !== "string" && type?.kind === "handle") return true;
    if (type === undefined || typeof type === "string") return false;
    if (type.kind === "union") return type.members.some(needsDrop);
    if (type.kind === "array" || type.kind === "map" || type.kind === "shared" || type.kind === "block" || type.kind === "dyn" || type.kind === "recursive") return true;
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
    if (holdsRust(type)) throw new Error(`internal error: a '${show(type)}' holds a Rust handle, which is moved, never copied`);
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
    const rust = rustClassOf(type);
    if (rust) {
      // Rust's drop runs in the shim, which hands back a panic in it for the runtime to raise.
      const [name, caught] = [`@"${dropSymbol(rust)}"`, alloca("ptr")];
      rustDrops.add(name);
      emit(`store ptr null, ptr ${caught}`);
      emit(`call void ${name}(ptr ${v}, ptr ${caught})`);
      return emit(`call void @fsh_rt_rust_dropped(ptr ${caught}, ptr ${cString(`panicked while dropping a Rust '${rust.name}':\n`)})`);
    }
    emit(`call void ${helper("drop", type as Exclude<Type, string>)}(${llvm(type)} ${v})`);
  }

  // The function that drops what a value of an aggregate type owns, or returns a copy of it,
  // part by part, or for a union, in the member it holds. It is named before it is made, so a
  // type holding itself calls it.
  function helper(kind: "drop" | "copy", type: Exclude<Type, string>): string {
    if (kind === "copy" && holdsRust(type)) throw new Error(`internal error: a '${show(type)}' holds a Rust handle, which is moved, never copied`);
    const made = glue[kind].get(type);
    if (made) return made;
    const name = `@fsh.${kind}.${stableId(kind, described(type), type)}`;
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
    } else if (type.kind === "recursive") {
      result = kind === "drop" ? dropBlock(type) : copyBlock(type);
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
      const release = { Semaphore: "fsh_rt_semaphore_release", Permit: "fsh_rt_permit_drop", Channel: "fsh_rt_channel_release", AbortController: "fsh_rt_signal_release", AbortSignal: "fsh_rt_signal_release", TcpListener: "fsh_rt_socket_release", TcpStream: "fsh_rt_socket_release", FileJob: "fsh_rt_file_job_release", JsValue: "fsh_rt_js_release" }[type.which];
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

  // Whether two values of one compound type are equal, part by part, through the function made
  // for the type, which a type holding itself calls again.
  function deepEquals(a: string, b: string, type: Type): string {
    let name = comparers.get(type);
    if (!name) {
      name = `@fsh.eq.${stableId("eq", described(type), type)}`;
      comparers.set(type, name);
      const saved = { allocas, body, temps, labels, block, pending, scopes };
      [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
      const t = llvm(type);
      emit(`ret i1 ${compareParts("%a", "%b", type as Exclude<Type, string>)}`);
      out.push(`define internal i1 ${name}(${t} %a, ${t} %b) {`, "entry:", ...allocas, ...body, "}", "");
      ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    }
    const result = temp();
    emit(`${result} = call i1 ${name}(${llvm(type)} ${a}, ${llvm(type)} ${b})`);
    return result;
  }

  // Whether every part of two values of a compound type is equal.
  function compareParts(a: string, b: string, type: Exclude<Type, string>): string {
    const both = (x: string, y: string, t: Type) => equals(x, t, y, t);
    const all = (results: string[]) => results.reduce((acc, r) => {
      if (acc === "true") return r;
      const next = temp();
      emit(`${next} = and i1 ${acc}, ${r}`);
      return next;
    }, "true");
    if (type.kind === "recursive") {
      const [x, y] = [temp(), temp()];
      emit(`${x} = load ${llvm(type.of)}, ptr ${a}`);
      emit(`${y} = load ${llvm(type.of)}, ptr ${b}`);
      return both(x, y, type.of);
    }
    if (type.kind === "array" || type.kind === "fixed") {
      // Element by element in a loop, once the lengths agree.
      const element = llvm(type.element);
      const result = alloca("i1");
      emit(`store i1 true, ptr ${result}`);
      const [length, other, data, otherData] = [temp(), temp(), temp(), temp()];
      if (type.kind === "array") {
        emit(`${length} = extractvalue ${ARRAY} ${a}, 1`);
        emit(`${other} = extractvalue ${ARRAY} ${b}, 1`);
        emit(`${data} = extractvalue ${ARRAY} ${a}, 0`);
        emit(`${otherData} = extractvalue ${ARRAY} ${b}, 0`);
      } else {
        const [sa, sb] = [alloca(llvm(type)), alloca(llvm(type))];
        emit(`store ${llvm(type)} ${a}, ptr ${sa}`);
        emit(`store ${llvm(type)} ${b}, ptr ${sb}`);
        emit(`${length} = add i64 0, ${type.size}`);
        emit(`${other} = add i64 0, ${type.size}`);
        emit(`${data} = getelementptr ${llvm(type)}, ptr ${sa}, i32 0, i32 0`);
        emit(`${otherData} = getelementptr ${llvm(type)}, ptr ${sb}, i32 0, i32 0`);
      }
      const same = temp();
      emit(`${same} = icmp eq i64 ${length}, ${other}`);
      const index = alloca("i64");
      emit(`store i64 0, ptr ${index}`);
      const [head, loop, differ, done] = [label(), label(), label(), label()];
      emit(`br i1 ${same}, label %${head}, label %${differ}`);
      startBlock(head);
      const [i, more] = [temp(), temp()];
      emit(`${i} = load i64, ptr ${index}`);
      emit(`${more} = icmp ult i64 ${i}, ${length}`);
      emit(`br i1 ${more}, label %${loop}, label %${done}`);
      startBlock(loop);
      const [at, bt, x, y, next] = [temp(), temp(), temp(), temp(), temp()];
      emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
      emit(`${bt} = getelementptr ${element}, ptr ${otherData}, i64 ${i}`);
      emit(`${x} = load ${element}, ptr ${at}`);
      emit(`${y} = load ${element}, ptr ${bt}`);
      const equal = both(x, y, type.element);
      emit(`${next} = add i64 ${i}, 1`);
      emit(`store i64 ${next}, ptr ${index}`);
      emit(`br i1 ${equal}, label %${head}, label %${differ}`);
      startBlock(differ);
      emit(`store i1 false, ptr ${result}`);
      emit(`br label %${done}`);
      startBlock(done);
      const out = temp();
      emit(`${out} = load i1, ptr ${result}`);
      return out;
    }
    // An instance compares through its class's `equals`, which takes the other by reference.
    const own = type.kind === "class" ? equalities.get(type) : undefined;
    if (own) {
      const [x, y] = [alloca(llvm(type)), alloca(llvm(type))];
      emit(`store ${llvm(type)} ${a}, ptr ${x}`);
      emit(`store ${llvm(type)} ${b}, ptr ${y}`);
      return invoke(own, upcast(x, type as ClassType, own.body.owner!), [`ptr ${upcast(y, type as ClassType, own.body.owner!)}`])!;
    }
    // An object, an instance or an enum's member: its fields, a base first.
    const parts = type.kind === "class" && type.base ? [[type.base, 0] as const, ...type.fields.map((f, i) => [f.type, i + 1] as const)] : (type as ObjectType).fields.map((f, i) => [f.type, i] as const);
    return all(parts.map(([t, i]) => {
      const [x, y] = [temp(), temp()];
      emit(`${x} = extractvalue ${llvm(type)} ${a}, ${i}`);
      emit(`${y} = extractvalue ${llvm(type)} ${b}, ${i}`);
      return both(x, y, t);
    }));
  }

  // `JSON.stringify(x)`: x written into a new writer, whose text becomes the string.
  function stringifyCall(e: Extract<Expr, { kind: "call" }>): string {
    const x = e.args[0]!;
    const v = operand(x, []);
    const w = temp();
    emit(`${w} = call ptr @fsh_rt_json_new()`);
    jsonWrite(w, v, current.spelled?.get(x) ?? coercions.get(x) ?? types.get(x)!);
    const result = temp();
    emit(`${result} = call ptr @fsh_rt_json_done(ptr ${w})`);
    if (!types.has(e)) pending.push({ v: result, type: "string" });
    return result;
  }

  // Writes a value as JSON, through the function made for its type when it has parts.
  // The type as written is kept beside the lowered one, which forgets how a field was
  // spelled: an empty `x?: T` is left out, as JavaScript leaves out an undefined field.
  function jsonWrite(w: string, v: string, type: Type) {
    const t = lower(type);
    if (typeof t === "string" || t.kind === "literal") return jsonScalar(w, v, t);
    const written = asWritten(type);
    let name = jsonWriters.get(written);
    if (!name) {
      name = `@fsh.json.${stableId("json", described(written), written)}`;
      jsonWriters.set(written, name);
      const saved = { allocas, body, temps, labels, block, pending, scopes };
      [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
      jsonParts("%w", "%v", t, written);
      emit("ret void");
      out.push(`define internal void ${name}(ptr %w, ${llvm(t)} %v) {`, "entry:", ...allocas, ...body, "}", "");
      ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    }
    emit(`call void ${name}(ptr ${w}, ${llvm(t)} ${v})`);
  }

  function jsonRaw(w: string, s: string) {
    emit(`call void @fsh_rt_json_raw(ptr ${w}, ptr ${cString(s)}, i64 ${new TextEncoder().encode(s).length})`);
  }

  function jsonScalar(w: string, v: string, t: Type) {
    if (typeof t !== "string" && t.kind === "literal") return jsonRaw(w, typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value));
    if (t === "null") return jsonRaw(w, "null");
    if (t === "string") return void emit(`call void @fsh_rt_json_string(ptr ${w}, ptr ${v})`);
    if (t === "boolean") {
      const [yes, no, done] = [label(), label(), label()];
      emit(`br i1 ${v}, label %${yes}, label %${no}`);
      startBlock(yes);
      jsonRaw(w, "true");
      emit(`br label %${done}`);
      startBlock(no);
      jsonRaw(w, "false");
      emit(`br label %${done}`);
      startBlock(done);
      return;
    }
    if (isFloat(t)) {
      let wide = v;
      if (t === "f32") {
        wide = temp();
        emit(`${wide} = fpext float ${v} to double`);
      }
      return void emit(`call void @fsh_rt_json_f64(ptr ${w}, double ${wide}, i32 ${t === "f32" ? 1 : 0})`);
    }
    const { bits, signed } = INTEGERS[t as Integer];
    let wide = v;
    if (bits < 64) {
      wide = temp();
      emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
    }
    emit(`call void @fsh_rt_json_${signed ? "i64" : "u64"}(ptr ${w}, i64 ${wide})`);
  }

  // The parts of a value with them: an array's elements, an object's fields by name, an
  // instance's fields as declared, a base's first, a union's member, an enum's member tagged by
  // its name as serde writes it.
  // A type parameter's type as written, or the type itself.
  function asWritten(t: Type): Type {
    return typeof t !== "string" && t.kind === "param" && t.concrete ? asWritten(t.concrete) : t;
  }

  // A part of `written` where `lowered` has the same shape, so its spelling can be read.
  function writtenPart(written: Type, lowered: Exclude<Type, string>, part: (t: Exclude<Type, string>) => Type | undefined): Type | undefined {
    return typeof written !== "string" && written.kind === lowered.kind ? part(written) : undefined;
  }

  // A union's members as written, each beside the lowered member it lowers to: members sort by
  // their keys, which spelling changes, so a written member may sit at another index.
  function writtenMembers(written: Type, t: UnionType): Type[] {
    const spelled = writtenPart(written, t, (x) => x) as UnionType | undefined;
    return t.members.map((m) => spelled?.members.find((s) => lower(s) === m) ?? m);
  }

  function jsonParts(w: string, v: string, t: Exclude<Type, string>, written: Type = t) {
    if (t.kind === "ref" || t.kind === "recursive") {
      const to = t.kind === "ref" ? t.to : t.of;
      const held = temp();
      emit(`${held} = load ${llvm(lower(to))}, ptr ${v}`);
      return jsonWrite(w, held, writtenPart(written, t, (x) => (x.kind === "ref" ? x.to : undefined)) ?? to);
    }
    if (t.kind === "array" || t.kind === "fixed") return jsonElements(w, v, t, writtenPart(written, t, (x) => (x as ArrayType).element) ?? t.element);
    if (t.kind === "map") return jsonEntries(w, v, t, writtenPart(written, t, (x) => (x as MapType).value) ?? t.value);
    if (t.kind === "union") return jsonMember(w, v, t, writtenMembers(written, t));
    if (t.kind === "variant") {
      if (t.fields.length === 0) return jsonRaw(w, JSON.stringify(t.member));
      jsonRaw(w, `{${JSON.stringify(t.member)}:`);
      if (t.fields.length > 1) jsonRaw(w, "[");
      t.fields.forEach((f, i) => {
        if (i > 0) jsonRaw(w, ",");
        const x = temp();
        emit(`${x} = extractvalue ${llvm(t)} ${v}, ${i}`);
        jsonWrite(w, x, f.type);
      });
      jsonRaw(w, t.fields.length > 1 ? "]}" : "}");
      return;
    }
    if (t.kind === "class") return jsonObject(w, v, t, jsonFields((writtenPart(written, t, (x) => x) as ClassType | undefined) ?? t));
    const object = t as ObjectType;
    const spelled = writtenPart(written, t, (x) => x) as ObjectType | undefined;
    const as = spelled?.fields.length === object.fields.length ? spelled.fields : object.fields;
    if (isTuple(object)) {
      const [order, rest] = tupleOrder(object);
      const length = object.required === undefined ? undefined : tupleLength(v, object);
      const many = () => {
        const x = temp();
        emit(`${x} = extractvalue ${llvm(t)} ${v}, ${rest!.i}`);
        return x;
      };
      if (rest && order.length === 0) return jsonElements(w, many(), rest.f.type as ArrayType, (as[rest.i]!.type as ArrayType).element);
      jsonRaw(w, "[");
      order.forEach(({ i }, n) => {
        present(length, n, () => {
          if (n > 0) jsonRaw(w, ",");
          const x = temp();
          emit(`${x} = extractvalue ${llvm(t)} ${v}, ${i}`);
          jsonWrite(w, x, as[i]!.type);
        });
      });
      if (rest) jsonElements(w, many(), rest.f.type as ArrayType, (as[rest.i]!.type as ArrayType).element, true);
      jsonRaw(w, "]");
      return;
    }
    jsonObject(w, v, t, object.fields.map((f, i) => ({ name: f.name, type: as[i]!.type, path: [i], omit: as[i]!.optional !== undefined })));
  }

  // A class's fields JSON writes, a base's first, each with where it sits in the instance.
  function jsonFields(c: ClassType): { name: string; type: Type; path: number[]; omit?: boolean }[] {
    return c.base ? [...jsonFields(c.base).map((f) => ({ ...f, path: [0, ...f.path] })), ...ownJsonFields(c, 1)] : ownJsonFields(c, 0);
  }

  function ownJsonFields(c: ClassType, offset: number) {
    return c.fields.flatMap((f, i) => (f.name.startsWith("#") ? [] : [{ name: f.name, type: f.type, path: [offset + i], omit: f.optional !== undefined }]));
  }

  // An object's fields; one spelled `x?: T` is left out while empty, so whether a comma is
  // needed is known only as the fields are written.
  function jsonObject(w: string, v: string, t: Type, fields: { name: string; type: Type; path: number[]; omit?: boolean }[]) {
    jsonRaw(w, "{");
    const dynamic = fields.some((f) => f.omit);
    const wrote = dynamic ? alloca("i1") : "";
    if (dynamic) emit(`store i1 false, ptr ${wrote}`);
    fields.forEach((f, n) => {
      const x = temp();
      emit(`${x} = extractvalue ${llvm(t)} ${v}, ${f.path.join(", ")}`);
      const after = label();
      if (f.omit) {
        const [present, write] = [holds(x, lower(f.type) as UnionType, (lower(f.type) as UnionType).members.filter((m) => m !== "null")), label()];
        emit(`br i1 ${present}, label %${write}, label %${after}`);
        startBlock(write);
      }
      const key = `${JSON.stringify(f.name)}:`;
      if (!dynamic) jsonRaw(w, `${n > 0 ? "," : ""}${key}`);
      else {
        const [was, comma, bare] = [temp(), label(), label()];
        emit(`${was} = load i1, ptr ${wrote}`);
        emit(`br i1 ${was}, label %${comma}, label %${bare}`);
        startBlock(comma);
        jsonRaw(w, ",");
        emit(`br label %${bare}`);
        startBlock(bare);
        jsonRaw(w, key);
        emit(`store i1 true, ptr ${wrote}`);
      }
      jsonWrite(w, x, f.type);
      emit(`br label %${after}`);
      startBlock(after);
    });
    jsonRaw(w, "}");
  }

  // `bare` writes the elements alone, each after a comma, as a rest tuple's follow its fixed ones.
  function jsonElements(w: string, v: string, t: ArrayType | FixedType, written: Type, bare = false) {
    const element = llvm(lower(t.element));
    const [length, data] = [temp(), temp()];
    if (t.kind === "array") {
      emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
    } else {
      const slot = alloca(llvm(t));
      emit(`store ${llvm(t)} ${v}, ptr ${slot}`);
      emit(`${length} = add i64 0, ${t.size}`);
      emit(`${data} = getelementptr ${llvm(t)}, ptr ${slot}, i32 0, i32 0`);
    }
    if (!bare) jsonRaw(w, "[");
    const index = alloca("i64");
    emit(`store i64 0, ptr ${index}`);
    const [head, loop, comma, item, done] = [label(), label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${length}`);
    emit(`br i1 ${more}, label %${loop}, label %${done}`);
    startBlock(loop);
    const first = bare ? "false" : temp();
    if (!bare) emit(`${first} = icmp eq i64 ${i}, 0`);
    emit(`br i1 ${first}, label %${item}, label %${comma}`);
    startBlock(comma);
    jsonRaw(w, ",");
    emit(`br label %${item}`);
    startBlock(item);
    const [at, x, next] = [temp(), temp(), temp()];
    emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
    emit(`${x} = load ${element}, ptr ${at}`);
    jsonWrite(w, x, written);
    emit(`${next} = add i64 ${i}, 1`);
    emit(`store i64 ${next}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    if (!bare) jsonRaw(w, "]");
  }

  // The string `console.log` prints for a value: its tree, laid out by the runtime.
  function inspected(v: string, type: Type): string {
    const tree = inspectTree(v, type);
    const text = temp();
    emit(`${text} = call ptr @fsh_rt_insp_done(ptr ${tree})`);
    return text;
  }

  // util.format's call: each argument described for the runtime's routine, which formats them.
  function formatted(e: Extract<Expr, { kind: "call" }>): string {
    const n = e.args.length;
    const slots = alloca(`[${n} x ${FARG}]`);
    const needs = formatNeeds(e.args);
    e.args.forEach((a, i) => {
      const v = a.kind === "string" ? text(a.value) : operand(a, e.args.slice(i + 1));
      const at = temp();
      emit(`${at} = getelementptr [${n} x ${FARG}], ptr ${slots}, i32 0, i32 ${i}`);
      describe(at, v, printedType(a), needs[i]!);
    });
    const result = temp();
    unwinding(`call ptr @fsh_rt_format(ptr ${slots}, i64 ${n}, ptr ${panicAt(e)})`, result);
    if (!types.has(e)) pending.push({ v: result, type: "string" });
    return result;
  }

  function printedType(a: Expr): Type {
    return a.kind === "string" ? "string" : (current.spelled?.get(a) ?? valueType(a));
  }

  // Whether a first argument may be a format, a string with more arguments after it, as Node
  // formats one: a literal holding a percent sign, or a string known only at run time.
  function formats(args: Expr[]): boolean {
    const [first] = args;
    if (!first || args.length < 2) return false;
    if (first.kind === "string") return first.value.includes("%");
    const t = lower(printedType(first));
    const text = (m: Type) => m === "string" || (typeof m !== "string" && m.kind === "literal" && typeof m.value === "string");
    return text(t) || (typeof t !== "string" && t.kind === "union" && t.members.some(text));
  }

  // What each argument's description needs: a literal format says which specifier takes each,
  // so only that is built; one read at run time may ask anything of any.
  function formatNeeds(args: Expr[]): { text: boolean; depth: number }[] {
    const [first] = args;
    if (first?.kind !== "string" || args.length < 2) {
      const inspected = !formats(args);
      return args.map(() => (inspected ? { text: false, depth: 2 } : { text: true, depth: 4 }));
    }
    const { specs, rest } = formatPlan(first.value, args.length);
    const DEPTHS: Record<string, number> = { s: 0, O: 2, o: 4 };
    return args.map((_, i) => {
      if (i === 0 || i >= rest) return { text: false, depth: 2 };
      const spec = specs[i - 1]!;
      return { text: "dif".includes(spec), depth: DEPTHS[spec] ?? -1 };
    });
  }

  // An argument's description: its kind and value, and for a value with parts its String(x) when
  // `need.text` and its inspect tree, cut at `need.depth`, when that isn't -1. A union is
  // described by its member.
  function describe(at: string, v: string, type: Type, need: { text: boolean; depth: number }) {
    const t = lower(type);
    const put = (index: number, of: string, x: string) => {
      const p = temp();
      emit(`${p} = getelementptr ${FARG}, ptr ${at}, i32 0, i32 ${index}`);
      emit(`store ${of} ${x}, ptr ${p}`);
    };
    const whole = (kind: number, x: string) => {
      put(0, "i32", String(kind));
      put(1, "i64", x);
    };
    if (typeof t !== "string" && t.kind === "union") {
      const members = writtenMembers(type, t);
      const tag = temp();
      emit(`${tag} = extractvalue ${llvm(t)} ${v}, 0`);
      const cases = t.members.map(() => label());
      const end = label();
      emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      t.members.forEach((m, i) => {
        startBlock(cases[i]!);
        describe(at, convert(v, t, m), members[i]!, need);
        emit(`br label %${end}`);
      });
      startBlock(end);
      return;
    }
    if (typeof t !== "string" && t.kind === "literal") {
      const x = t.value;
      if (typeof x === "string") {
        put(0, "i32", String(FARG_KINDS.string));
        put(3, "ptr", text(x));
      } else if (typeof x === "boolean") whole(FARG_KINDS.boolean, x ? "1" : "0");
      else whole(FARG_KINDS.int, String(x));
      return;
    }
    if (t === "string") {
      put(0, "i32", String(FARG_KINDS.string));
      put(3, "ptr", v);
    } else if (t === "boolean") {
      const x = temp();
      emit(`${x} = zext i1 ${v} to i64`);
      whole(FARG_KINDS.boolean, x);
    } else if (t === "null" || t === "void" || t === "never") put(0, "i32", String(FARG_KINDS.null));
    else if (isFloat(t)) {
      let x = v;
      if (t === "f32") {
        x = temp();
        emit(`${x} = fpext float ${v} to double`);
      }
      whole(FARG_KINDS.float, t === "f32" ? "1" : "0");
      put(2, "double", x);
    } else if (isInteger(t)) {
      const { bits, signed } = INTEGERS[t];
      let x = v;
      if (bits < 64) {
        x = temp();
        emit(`${x} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      whole(signed ? FARG_KINDS.int : FARG_KINDS.uint, x);
    } else {
      put(0, "i32", String(FARG_KINDS.parts));
      put(3, "ptr", need.text ? jsText(v, type) : "null");
      put(4, "ptr", need.depth >= 0 ? inspectTree(v, type, String(2 - need.depth)) : "null");
    }
  }

  // JavaScript's String(x) of a value with parts, a new string: an array's elements joined by
  // commas, an empty one's as nothing; an object or instance is `[object Object]`.
  function jsText(v: string, type: Type): string {
    const [b, s] = [temp(), temp()];
    emit(`${b} = call ptr @fsh_rt_text_new()`);
    jsTextInto(b, v, type);
    emit(`${s} = call ptr @fsh_rt_text_done(ptr ${b})`);
    return s;
  }

  function jsTextInto(b: string, v: string, type: Type) {
    const t = lower(type);
    const raw = (s: string) => emit(`call void @fsh_rt_text_raw(ptr ${b}, ptr ${cString(s)})`);
    if (typeof t !== "string" && t.kind === "literal") return raw(String(t.value));
    if (t === "string") return emit(`call void @fsh_rt_text_add(ptr ${b}, ptr ${v})`);
    if (t === "null" || t === "void" || t === "never") return;
    if (t === "boolean") {
      const word = temp();
      emit(`${word} = select i1 ${v}, ptr ${cString("true")}, ptr ${cString("false")}`);
      return emit(`call void @fsh_rt_text_raw(ptr ${b}, ptr ${word})`);
    }
    if (isFloat(t)) return emit(`call void @fsh_rt_text_${t}(ptr ${b}, ${llvm(t)} ${v})`);
    if (isInteger(t)) {
      const { bits, signed } = INTEGERS[t];
      let x = v;
      if (bits < 64) {
        x = temp();
        emit(`${x} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      return emit(`call void @fsh_rt_text_${signed ? "i64" : "u64"}(ptr ${b}, i64 ${x})`);
    }
    if (typeof t === "string") return;
    if (t.kind === "union") {
      const tag = temp();
      emit(`${tag} = extractvalue ${llvm(t)} ${v}, 0`);
      const cases = t.members.map(() => label());
      const end = label();
      emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      t.members.forEach((m, i) => {
        startBlock(cases[i]!);
        jsTextInto(b, convert(v, t, m), m);
        emit(`br label %${end}`);
      });
      startBlock(end);
      return;
    }
    if (t.kind === "map") return raw(t.set ? "[object Set]" : "[object Map]");
    if (t.kind === "regex") return raw(`/${t.source}/${t.flags}`);
    if (t.kind !== "array" && t.kind !== "fixed" && t.kind !== "ref" && t.kind !== "recursive" && !(t.kind === "object" && isTuple(t))) return raw("[object Object]");
    let name = stringers.get(t);
    if (!name) {
      name = `@fsh.text.${stableId("text", described(t), t)}`;
      stringers.set(t, name);
      const saved = { allocas, body, temps, labels, block, pending, scopes };
      [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
      jsTextParts("%b", "%v", t);
      emit("ret void");
      out.push(`define internal void ${name}(${llvm(t)} %v, ptr %b) {`, "entry:", ...allocas, ...body, "}", "");
      ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    }
    emit(`call void ${name}(${llvm(t)} ${v}, ptr ${b})`);
  }

  // What an array, a tuple or a reference writes for String(x).
  function jsTextParts(b: string, v: string, t: Exclude<Type, string>) {
    if (t.kind === "ref" || t.kind === "recursive") {
      const to = t.kind === "ref" ? t.to : t.of;
      const held = temp();
      emit(`${held} = load ${llvm(lower(to))}, ptr ${v}`);
      return jsTextInto(b, held, to);
    }
    const comma = () => emit(`call void @fsh_rt_text_raw(ptr ${b}, ptr ${cString(",")})`);
    if (t.kind === "object") {
      const [order, rest] = tupleOrder(t);
      const length = t.required === undefined ? undefined : tupleLength(v, t);
      order.forEach(({ f, i }, n) => present(length, n, () => {
        if (n > 0) comma();
        const x = temp();
        emit(`${x} = extractvalue ${llvm(t)} ${v}, ${i}`);
        jsTextInto(b, x, f.type);
      }));
      if (!rest) return;
      const many = temp();
      emit(`${many} = extractvalue ${llvm(t)} ${v}, ${rest.i}`);
      return jsElements(b, many, rest.f.type as ArrayType, order.length > 0);
    }
    if (t.kind === "array" || t.kind === "fixed") return jsElements(b, v, t, false);
  }

  // An array's elements, each after a comma but the first unless `after` says one came before.
  function jsElements(b: string, v: string, t: ArrayType | FixedType, after: boolean) {
    const element = llvm(lower(t.element));
    const [length, data] = [temp(), temp()];
    if (t.kind === "array") {
      emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
    } else {
      const slot = alloca(llvm(t));
      emit(`store ${llvm(t)} ${v}, ptr ${slot}`);
      emit(`${length} = add i64 0, ${t.size}`);
      emit(`${data} = getelementptr ${llvm(t)}, ptr ${slot}, i32 0, i32 0`);
    }
    const index = alloca("i64");
    emit(`store i64 0, ptr ${index}`);
    const [head, loop, separate, write, done] = [label(), label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${length}`);
    emit(`br i1 ${more}, label %${loop}, label %${done}`);
    startBlock(loop);
    const first = temp();
    emit(`${first} = icmp eq i64 ${i}, 0`);
    emit(`br i1 ${after ? "false" : first}, label %${write}, label %${separate}`);
    startBlock(separate);
    emit(`call void @fsh_rt_text_raw(ptr ${b}, ptr ${cString(",")})`);
    emit(`br label %${write}`);
    startBlock(write);
    const [at, x, next] = [temp(), temp(), temp()];
    emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
    emit(`${x} = load ${element}, ptr ${at}`);
    jsTextInto(b, x, t.element);
    emit(`${next} = add i64 ${i}, 1`);
    emit(`store i64 ${next}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
  }

  // A value's tree for the runtime's layout, through the function made for its type when it
  // has parts. The type as written is kept beside the lowered one, for how fields were spelled.
  // `depth` is how deep in the printed value this one sits, as Node counts it.
  function inspectTree(v: string, type: Type, depth = "0"): string {
    const t = lower(type);
    if (typeof t === "string" || t.kind === "literal") return inspectScalar(v, t);
    const written = asWritten(type);
    let name = inspectors.get(written);
    if (!name) {
      name = `@fsh.insp.${stableId("insp", described(written), written)}`;
      inspectors.set(written, name);
      const saved = { allocas, body, temps, labels, block, pending, scopes };
      [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
      emit(`ret ptr ${inspectParts("%v", t, written)}`);
      out.push(`define internal ptr ${name}(${llvm(t)} %v, i64 %d) {`, "entry:", ...allocas, ...body, "}", "");
      ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    }
    const node = temp();
    emit(`${node} = call ptr ${name}(${llvm(t)} ${v}, i64 ${depth})`);
    return node;
  }

  function inspectScalar(v: string, t: Type): string {
    const node = temp();
    if (typeof t !== "string" && t.kind === "literal") {
      if (typeof t.value === "string") {
        emit(`${node} = call ptr @fsh_rt_insp_string(ptr ${text(t.value)})`);
      } else if (typeof t.value === "bigint") emit(`${node} = call ptr @fsh_rt_insp_i64(i64 ${t.value})`);
      else emit(`${node} = call ptr @fsh_rt_insp_text(ptr ${cString(String(t.value))})`);
      return node;
    }
    if (t === "null" || t === "never" || t === "void") emit(`${node} = call ptr @fsh_rt_insp_text(ptr ${cString("null")})`);
    else if (t === "string") emit(`${node} = call ptr @fsh_rt_insp_string(ptr ${v})`);
    else if (t === "boolean") {
      const word = temp();
      emit(`${word} = select i1 ${v}, ptr ${cString("true")}, ptr ${cString("false")}`);
      emit(`${node} = call ptr @fsh_rt_insp_text(ptr ${word})`);
    } else if (isFloat(t)) {
      let wide = v;
      if (t === "f32") {
        wide = temp();
        emit(`${wide} = fpext float ${v} to double`);
      }
      emit(`${node} = call ptr @fsh_rt_insp_f64(double ${wide}, i32 ${t === "f32" ? 1 : 0})`);
    } else {
      const { bits, signed } = INTEGERS[t as Integer];
      let wide = v;
      if (bits < 64) {
        wide = temp();
        emit(`${wide} = ${signed ? "sext" : "zext"} i${bits} ${v} to i64`);
      }
      emit(`${node} = call ptr @fsh_rt_insp_${signed ? "i64" : "u64"}(i64 ${wide})`);
    }
    return node;
  }

  // The tree of a value with parts: elements, members, entries, a member's values, an object's
  // fields by name or an instance's as declared, a base's first. An empty field spelled `x?: T`
  // is left out, as Node leaves out a field that isn't there.
  function inspectParts(v: string, t: Exclude<Type, string>, written: Type): string {
    if (t.kind === "ref" || t.kind === "recursive") {
      const to = t.kind === "ref" ? t.to : t.of;
      const held = temp();
      emit(`${held} = load ${llvm(lower(to))}, ptr ${v}`);
      return inspectTree(held, writtenPart(written, t, (x) => (x.kind === "ref" ? x.to : undefined)) ?? to, "%d");
    }
    // Past depth 2 Node prints a value with parts as `[Object]`, or `{}` when it has none, so
    // only its size and keys are kept, which also bounds how deep this goes.
    if (t.kind !== "union" && t.kind !== "variant") {
      const [deep, shell, full] = [temp(), label(), label()];
      emit(`${deep} = icmp sgt i64 %d, 2`);
      emit(`br i1 ${deep}, label %${shell}, label %${full}`);
      startBlock(shell);
      emit(`ret ptr ${inspectShell(v, t, written)}`);
      startBlock(full);
    }
    const next = temp();
    emit(`${next} = add i64 %d, 1`);
    if (t.kind === "array" || t.kind === "fixed") return inspectElements(v, t, writtenPart(written, t, (x) => (x as ArrayType).element) ?? t.element, next);
    if (t.kind === "map") return inspectEntries(v, t, writtenPart(written, t, (x) => (x as MapType).value) ?? t.value, next);
    if (t.kind === "union") {
      const members = writtenMembers(written, t);
      const result = alloca("ptr");
      const tag = temp();
      emit(`${tag} = extractvalue ${llvm(t)} ${v}, 0`);
      const done = label();
      const cases = t.members.map(() => label());
      emit(`switch i32 ${tag}, label %${done} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
      t.members.forEach((m, i) => {
        startBlock(cases[i]!);
        const member = lower(m);
        let x = "zeroinitializer";
        if (!(typeof member !== "string" && member.kind === "literal") && member !== "null") {
          const slot = alloca(llvm(t));
          emit(`store ${llvm(t)} ${v}, ptr ${slot}`);
          const at = temp();
          x = temp();
          emit(`${at} = getelementptr ${llvm(t)}, ptr ${slot}, i32 0, i32 1`);
          emit(`${x} = load ${llvm(member)}, ptr ${at}`);
        }
        emit(`store ptr ${inspectTree(x, members[i]!, "%d")}, ptr ${result}`);
        emit(`br label %${done}`);
      });
      startBlock(done);
      const node = temp();
      emit(`${node} = load ptr, ptr ${result}`);
      return node;
    }
    if (t.kind === "variant") {
      const node = temp();
      emit(`${node} = call ptr @fsh_rt_insp_variant(ptr ${cString(t.member)})`);
      t.fields.forEach((f, i) => {
        const x = temp();
        emit(`${x} = extractvalue ${llvm(t)} ${v}, ${i}`);
        emit(`call void @fsh_rt_insp_push(ptr ${node}, ptr ${inspectTree(x, f.type, "%d")})`);
      });
      return node;
    }
    const object = t as ObjectType;
    const spelled = writtenPart(written, t, (x) => x) as ObjectType | undefined;
    const as = spelled?.fields.length === object.fields.length ? spelled.fields : object.fields;
    if (t.kind === "object" && isTuple(object)) {
      const [order, rest] = tupleOrder(object);
      const length = object.required === undefined ? undefined : tupleLength(v, object);
      const node = temp();
      emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${length ?? order.length})`);
      order.forEach(({ i }, n) => {
        present(length, n, () => {
          const x = temp();
          emit(`${x} = extractvalue ${llvm(t)} ${v}, ${i}`);
          emit(`call void @fsh_rt_insp_push(ptr ${node}, ptr ${inspectTree(x, as[i]!.type, next)})`);
        });
      });
      // A rest tuple's further elements join its own, as one array.
      if (rest) {
        const x = temp();
        emit(`${x} = extractvalue ${llvm(t)} ${v}, ${rest.i}`);
        emit(`call void @fsh_rt_insp_append(ptr ${node}, ptr ${inspectElements(x, rest.f.type as ArrayType, (as[rest.i]!.type as ArrayType).element, next)})`);
      }
      return node;
    }
    const fields = t.kind === "class" ? jsonFields((writtenPart(written, t, (x) => x) as ClassType | undefined) ?? t) : object.fields.map((f, i) => ({ name: f.name, type: as[i]!.type, path: [i], omit: as[i]!.optional !== undefined }));
    if (t.kind === "class" && errorClass(t)) return errorTree(v, t, fields, next);
    const name = t.kind === "class" ? t.name.replace(/[@<].*$/, "") : "";
    const node = temp();
    emit(`${node} = call ptr @fsh_rt_insp_object(ptr ${cString(name)})`);
    for (const f of fields) {
      const x = temp();
      emit(`${x} = extractvalue ${llvm(t)} ${v}, ${f.path.join(", ")}`);
      const after = label();
      if (f.omit) {
        const present = holds(x, lower(f.type) as UnionType, (lower(f.type) as UnionType).members.filter((m) => m !== "null"));
        const write = label();
        emit(`br i1 ${present}, label %${write}, label %${after}`);
        startBlock(write);
      }
      emit(`call void @fsh_rt_insp_field(ptr ${node}, ptr ${cString(f.name)}, ptr ${inspectTree(x, f.type, next)})`);
      emit(`br label %${after}`);
      startBlock(after);
    }
    return node;
  }

  // Whether a class is the prelude's Error, or extends it.
  function errorClass(t: ClassType): boolean {
    if (t.generic?.name === "AggregateError") return true;
    for (let c: ClassType | undefined = t; c; c = c.base) if (c.name === "Error" && !c.generic) return true;
    return false;
  }

  // An Error as Node prints one with its stack left out: its header, then the fields beyond
  // Error's own and its cause, read through what ErrorLike gives.
  // `shell`, past the depth, it keeps only whether it has more than its header to show.
  function errorTree(v: string, t: ClassType, fields: { name: string; type: Type; path: number[]; omit?: boolean }[], depth: string, shell = false): string {
    const blank = () => {
      const b = temp();
      emit(`${b} = call ptr @fsh_rt_insp_text(ptr ${cString("")})`);
      return b;
    };
    const all = jsonFields(t);
    const read = (name: string) => {
      const f = all.find((x) => x.name === name)!;
      const x = temp();
      emit(`${x} = extractvalue ${llvm(t)} ${v}, ${f.path.join(", ")}`);
      return [x, f.type] as const;
    };
    const node = temp();
    emit(`${node} = call ptr @fsh_rt_insp_error(ptr ${cString(t.name.replace(/[@<].*$/, ""))}, ptr ${read("name")[0]}, ptr ${read("message")[0]})`);
    // A JsError's JS value is left out, as printing one isn't supported yet.
    const shown = fields.filter((f) => f.name !== "name" && f.name !== "message" && f.name !== "cause" && !(t.name === "JsError" && f.name === "value"));
    for (const f of shown) {
      const x = temp();
      emit(`${x} = extractvalue ${llvm(t)} ${v}, ${f.path.join(", ")}`);
      const after = label();
      if (f.omit) {
        const present = holds(x, lower(f.type) as UnionType, (lower(f.type) as UnionType).members.filter((m) => m !== "null"));
        const write = label();
        emit(`br i1 ${present}, label %${write}, label %${after}`);
        startBlock(write);
      }
      // An AggregateError's errors are shown as Node shows them, apart from its own fields.
      const key = f.name === "errors" && t.generic?.name === "AggregateError" ? "[errors]" : f.name;
      emit(`call void @fsh_rt_insp_field(ptr ${node}, ptr ${cString(key)}, ptr ${shell ? blank() : inspectTree(x, f.type, depth)})`);
      emit(`br label %${after}`);
      startBlock(after);
    }
    if (fields.length === 0) return node;
    const [cause, held] = read("cause");
    const option = lower(held) as UnionType;
    const dyn = option.members.find((m) => m !== "null") as DynType;
    const [yes, after] = [label(), label()];
    emit(`br i1 ${holds(cause, option, [dyn])}, label %${yes}, label %${after}`);
    startBlock(yes);
    let inner: string;
    if (shell) inner = blank();
    else {
      const d = convert(cause, option, dyn);
      const [data, table] = [temp(), temp()];
      inner = temp();
      emit(`${data} = extractvalue ${DYN} ${d}, 0`);
      emit(`${table} = extractvalue ${DYN} ${d}, 1`);
      // The slot after its fields prints the boxed value as its own type does.
      emit(`${inner} = call ptr ${vslot(table, dyn.of.methods.length + dyn.of.fields.length)}(ptr ${data}, i64 ${depth})`);
    }
    emit(`call void @fsh_rt_insp_field(ptr ${node}, ptr ${cString("[cause]")}, ptr ${inner})`);
    emit(`br label %${after}`);
    startBlock(after);
    return node;
  }

  // A value past depth 2, as Node prints it there: its size, or its keys, with no parts inside.
  function inspectShell(v: string, t: Exclude<Type, string>, written: Type): string {
    const node = temp();
    if (t.kind === "array" || t.kind === "fixed") {
      let length = String((t as FixedType).size);
      if (t.kind === "array") {
        length = temp();
        emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      }
      emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${length})`);
      return node;
    }
    if (t.kind === "map") {
      const size = temp();
      emit(`${size} = call i64 @fsh_rt_map_size(ptr ${v})`);
      emit(`${node} = call ptr @fsh_rt_insp_list(i32 ${t.set ? 5 : 4}, i64 ${size})`);
      return node;
    }
    const object = t as ObjectType;
    if (t.kind === "object" && isTuple(object)) {
      emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${object.required === undefined && object.rest === undefined ? object.fields.length : tupleLength(v, object)})`);
      return node;
    }
    const spelled = writtenPart(written, t, (x) => x) as ObjectType | undefined;
    const as = spelled?.fields.length === object.fields.length ? spelled.fields : object.fields;
    const fields = t.kind === "class" ? jsonFields((spelled as unknown as ClassType | undefined) ?? t) : object.fields.map((f, i) => ({ name: f.name, type: as[i]!.type, path: [i], omit: as[i]!.optional !== undefined }));
    // Past the depth, an Error is its header alone, or its class's name when it has more to show.
    if (t.kind === "class" && errorClass(t)) return errorTree(v, t, fields, "0", true);
    emit(`${node} = call ptr @fsh_rt_insp_object(ptr ${cString(t.kind === "class" ? t.name.replace(/[@<].*$/, "") : "")})`);
    for (const f of fields) {
      const after = label();
      if (f.omit) {
        const x = temp();
        emit(`${x} = extractvalue ${llvm(t)} ${v}, ${f.path.join(", ")}`);
        const present = holds(x, lower(f.type) as UnionType, (lower(f.type) as UnionType).members.filter((m) => m !== "null"));
        const write = label();
        emit(`br i1 ${present}, label %${write}, label %${after}`);
        startBlock(write);
      }
      const blank = temp();
      emit(`${blank} = call ptr @fsh_rt_insp_text(ptr ${cString("")})`);
      emit(`call void @fsh_rt_insp_field(ptr ${node}, ptr ${cString(f.name)}, ptr ${blank})`);
      emit(`br label %${after}`);
      startBlock(after);
    }
    return node;
  }

  // An array's first 100 elements, and how many it has.
  function inspectElements(v: string, t: ArrayType | FixedType, written: Type, depth: string): string {
    const element = llvm(lower(t.element));
    const [length, data] = [temp(), temp()];
    if (t.kind === "array") {
      emit(`${length} = extractvalue ${ARRAY} ${v}, 1`);
      emit(`${data} = extractvalue ${ARRAY} ${v}, 0`);
    } else {
      const slot = alloca(llvm(t));
      emit(`store ${llvm(t)} ${v}, ptr ${slot}`);
      emit(`${length} = add i64 0, ${t.size}`);
      emit(`${data} = getelementptr ${llvm(t)}, ptr ${slot}, i32 0, i32 0`);
    }
    const node = temp();
    emit(`${node} = call ptr @fsh_rt_insp_list(i32 3, i64 ${length})`);
    const [cap, kept] = [temp(), temp()];
    emit(`${cap} = icmp slt i64 ${length}, 100`);
    emit(`${kept} = select i1 ${cap}, i64 ${length}, i64 100`);
    const index = alloca("i64");
    emit(`store i64 0, ptr ${index}`);
    const [head, loop, done] = [label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${kept}`);
    emit(`br i1 ${more}, label %${loop}, label %${done}`);
    startBlock(loop);
    const [at, x, next] = [temp(), temp(), temp()];
    emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
    emit(`${x} = load ${element}, ptr ${at}`);
    emit(`call void @fsh_rt_insp_push(ptr ${node}, ptr ${inspectTree(x, written, depth)})`);
    emit(`${next} = add i64 ${i}, 1`);
    emit(`store i64 ${next}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    return node;
  }

  // A Map's or Set's live entries in order, its first 100, and how many it has.
  function inspectEntries(map: string, t: MapType, written: Type, depth: string): string {
    const entry = entryType(t);
    const [size, node] = [temp(), temp()];
    emit(`${size} = call i64 @fsh_rt_map_size(ptr ${map})`);
    emit(`${node} = call ptr @fsh_rt_insp_list(i32 ${t.set ? 5 : 4}, i64 ${size})`);
    const [counter, taken] = [alloca("i64"), alloca("i64")];
    emit(`store i64 0, ptr ${counter}`);
    emit(`store i64 0, ptr ${taken}`);
    const [test, live, loop, next, end] = [label(), label(), label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    const [i, used, more] = [temp(), temp(), temp()];
    emit(`${i} = load i64, ptr ${counter}`);
    emit(`${used} = call i64 @fsh_rt_map_used(ptr ${map})`);
    // Node prints the first 100 entries, so the rest aren't built.
    const [shown, room, going] = [temp(), temp(), temp()];
    emit(`${shown} = load i64, ptr ${taken}`);
    emit(`${room} = icmp slt i64 ${shown}, 100`);
    emit(`${more} = icmp slt i64 ${i}, ${used}`);
    emit(`${going} = and i1 ${more}, ${room}`);
    emit(`br i1 ${going}, label %${live}, label %${end}`);
    startBlock(live);
    const [at, state, alive] = [temp(), temp(), temp()];
    emit(`${at} = call ptr @fsh_rt_map_at(ptr ${map}, i64 ${i})`);
    emit(`${state} = load i64, ptr ${at}`);
    emit(`${alive} = icmp eq i64 ${state}, 1`);
    emit(`br i1 ${alive}, label %${loop}, label %${next}`);
    startBlock(loop);
    const counted = temp();
    emit(`${counted} = add i64 ${shown}, 1`);
    emit(`store i64 ${counted}, ptr ${taken}`);
    const [keyAt, key] = [temp(), temp()];
    emit(`${keyAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    emit(`${key} = load ${llvm(lower(t.key))}, ptr ${keyAt}`);
    emit(`call void @fsh_rt_insp_push(ptr ${node}, ptr ${inspectTree(key, t.key, depth)})`);
    if (!t.set) {
      const [valueAt, x] = [temp(), temp()];
      emit(`${valueAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
      emit(`${x} = load ${llvm(lower(t.value))}, ptr ${valueAt}`);
      emit(`call void @fsh_rt_insp_push(ptr ${node}, ptr ${inspectTree(x, written, depth)})`);
    }
    emit(`br label %${next}`);
    startBlock(next);
    const step = temp();
    emit(`${step} = add i64 ${i}, 1`);
    emit(`store i64 ${step}, ptr ${counter}`);
    emit(`br label %${test}`);
    startBlock(end);
    return node;
  }

  // `JSON.parse<T>(s)`: s read as a T. A failure, or text left after the value, throws a
  // JsonError holding the reader's message.
  function parseJsonCall(e: Extract<Expr, { kind: "call" }>): string {
    const type = types.get(e)!;
    const s = operand(e.args[0]!, []);
    const r = temp();
    emit(`${r} = call ptr @fsh_rt_json_in(ptr ${s})`);
    const [ok, v] = jsonRead(r, type);
    const [check, extra, bad, good] = [label(), label(), label(), label()];
    emit(`br i1 ${ok}, label %${check}, label %${bad}`);
    startBlock(check);
    const [ended, whole] = [temp(), temp()];
    emit(`${ended} = call i32 @fsh_rt_json_end(ptr ${r})`);
    emit(`${whole} = icmp ne i32 ${ended}, 0`);
    emit(`br i1 ${whole}, label %${good}, label %${extra}`);
    startBlock(extra);
    dispose(v, type);
    emit(`br label %${bad}`);
    startBlock(bad);
    const [message, error] = [temp(), temp()];
    emit(`${message} = call ptr @fsh_rt_json_close(ptr ${r})`);
    const failure = current.raises.get(e)!.from;
    emit(`${error} = insertvalue ${llvm(failure)} zeroinitializer, ptr ${message}, 0`);
    raised(e, error);
    startBlock(good);
    const none = temp();
    emit(`${none} = call ptr @fsh_rt_json_close(ptr ${r})`);
    emit(`call void @fsh_rt_str_release(ptr ${none})`);
    return v;
  }

  // Reads a value of a type through the function made for it, which reports whether it could.
  function jsonRead(r: string, type: Type): [ok: string, v: string] {
    const t = lower(type);
    let name = jsonReaders.get(t);
    if (!name) {
      name = `@fsh.json.read.${stableId("json.read", described(t), t)}`;
      jsonReaders.set(t, name);
      const saved = { allocas, body, temps, labels, block, pending, scopes };
      [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
      emit(`store ${llvm(t)} ${readParts("%r", t)}, ptr %out`);
      emit("ret i1 true");
      out.push(`define internal i1 ${name}(ptr %r, ptr %out) {`, "entry:", ...allocas, ...body, "}", "");
      ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    }
    const [slot, ok, v] = [alloca(llvm(t)), temp(), temp()];
    emit(`${ok} = call i1 ${name}(ptr ${r}, ptr ${slot})`);
    emit(`${v} = load ${llvm(t)}, ptr ${slot}`);
    return [ok, v];
  }

  // Goes on when a reading step succeeded, an i32 or i1 that isn't zero; otherwise the reading
  // function fails, after `undo` drops what it had made.
  function jsonGuard(ok: string, width: "i32" | "i1", undo?: () => void) {
    const [bad, good] = [label(), label()];
    let test = ok;
    if (width === "i32") {
      test = temp();
      emit(`${test} = icmp ne i32 ${ok}, 0`);
    }
    emit(`br i1 ${test}, label %${good}, label %${bad}`);
    startBlock(bad);
    undo?.();
    emit("ret i1 false");
    startBlock(good);
  }

  // Fails the reading function with "expected <what>" at the reader's place.
  function jsonExpected(r: string, what: string, undo?: () => void) {
    const ignored = temp();
    emit(`${ignored} = call i32 @fsh_rt_json_expected(ptr ${r}, ptr ${cString(what)})`);
    undo?.();
    emit("ret i1 false");
    startBlock(label());
  }

  // A value of the type, read inside a reading function, which fails and returns where it can't.
  function readParts(r: string, t: Type): string {
    if (typeof t !== "string" && t.kind === "literal") return readLiteral(r, t);
    if (t === "null") {
      const ok = temp();
      emit(`${ok} = call i32 @fsh_rt_json_null(ptr ${r})`);
      jsonGuard(ok, "i32");
      return "zeroinitializer";
    }
    if (t === "boolean") {
      const [slot, ok, v, b] = [alloca("i32"), temp(), temp(), temp()];
      emit(`${ok} = call i32 @fsh_rt_json_bool(ptr ${r}, ptr ${slot})`);
      jsonGuard(ok, "i32");
      emit(`${v} = load i32, ptr ${slot}`);
      emit(`${b} = trunc i32 ${v} to i1`);
      return b;
    }
    if (t === "string") {
      const [slot, ok, v] = [alloca("ptr"), temp(), temp()];
      emit(`${ok} = call i32 @fsh_rt_json_text(ptr ${r}, ptr ${slot}, ptr ${cString("string")})`);
      jsonGuard(ok, "i32");
      emit(`${v} = load ptr, ptr ${slot}`);
      return v;
    }
    if (isFloat(t)) {
      const [slot, ok, v] = [alloca("double"), temp(), temp()];
      emit(`${ok} = call i32 @fsh_rt_json_float(ptr ${r}, ptr ${slot}, ptr ${cString(t)})`);
      jsonGuard(ok, "i32");
      emit(`${v} = load double, ptr ${slot}`);
      if (t === "f64") return v;
      const narrow = temp();
      emit(`${narrow} = fptrunc double ${v} to float`);
      return narrow;
    }
    if (typeof t === "string" && Object.hasOwn(INTEGERS, t)) {
      const { bits, signed } = INTEGERS[t as Integer];
      const [slot, ok, v] = [alloca("i64"), temp(), temp()];
      emit(`${ok} = call i32 @fsh_rt_json_int(ptr ${r}, ptr ${slot}, i32 ${bits}, i32 ${signed ? 1 : 0}, ptr ${cString(t)})`);
      jsonGuard(ok, "i32");
      emit(`${v} = load i64, ptr ${slot}`);
      if (bits === 64) return v;
      const narrow = temp();
      emit(`${narrow} = trunc i64 ${v} to i${bits}`);
      return narrow;
    }
    const c = t as Exclude<Type, string>;
    if (c.kind === "recursive") {
      const [ok, v] = jsonRead(r, c.of);
      jsonGuard(ok, "i1");
      return convert(v, c.of, c);
    }
    if (c.kind === "array") return readElements(r, c);
    if (c.kind === "map") return readEntries(r, c);
    if (c.kind === "union") return c.members.every((m) => typeof m !== "string" && m.kind === "variant") ? readVariant(r, c) : readMember(r, c);
    if (c.kind === "variant") return readVariant(r, c);
    if (c.kind === "object" && isTuple(c)) return readTuple(r, c);
    const fields = c.kind === "class" ? jsonFields(c) : (c as ObjectType).fields.map((f, i) => ({ name: f.name, type: f.type, path: [i] }));
    return readObject(r, c, fields);
  }

  // A literal type's value, read as its base and checked; the error points at where it starts.
  function readLiteral(r: string, t: LiteralType): string {
    const [mark, start] = [alloca("[3 x i64]"), temp()];
    emit(`${start} = call i32 @fsh_rt_json_peek(ptr ${r})`);
    emit(`call void @fsh_rt_json_save(ptr ${r}, ptr ${mark})`);
    const what = typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
    const base = typeof t.value === "string" ? "string" : typeof t.value === "boolean" ? "boolean" : "i64";
    const v = readParts(r, base);
    const same = temp();
    if (base === "string") {
      const found = temp();
      emit(`${found} = call i32 @fsh_rt_json_same(ptr ${v}, ptr ${cString(t.value as string)}, i64 ${new TextEncoder().encode(t.value as string).length})`);
      emit(`call void @fsh_rt_str_release(ptr ${v})`);
      emit(`${same} = icmp ne i32 ${found}, 0`);
    } else if (base === "boolean") emit(`${same} = icmp eq i1 ${v}, ${t.value}`);
    else emit(`${same} = icmp eq i64 ${v}, ${String(t.value)}`);
    jsonGuard(same, "i1", () => {
      emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
      const ignored = temp();
      emit(`${ignored} = call i32 @fsh_rt_json_unlike(ptr ${r}, ptr ${cString(what)})`);
    });
    return "zeroinitializer";
  }

  // An array's elements, each pushed as it is read; a failure drops what was read. `after` reads
  // on from a rest tuple's fixed elements, `from` of them, which `undo` drops on a failure.
  function readElements(r: string, t: ArrayType, after?: { from: number; undo: () => void }): string {
    const array = alloca(ARRAY);
    emit(`store ${ARRAY} zeroinitializer, ptr ${array}`);
    const undo = () => {
      after?.undo();
      const held = temp();
      emit(`${held} = load ${ARRAY}, ptr ${array}`);
      dispose(held, t);
    };
    if (!after) {
      const opened = temp();
      emit(`${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 91, ptr ${cString("array")})`);
      jsonGuard(opened, "i32");
    }
    const index = alloca("i64");
    emit(`store i64 ${after?.from ?? 0}, ptr ${index}`);
    const [head, item, done] = [label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, first, more] = [temp(), temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${first} = icmp eq i64 ${i}, 0`);
    const wide = temp();
    emit(`${wide} = zext i1 ${first} to i32`);
    emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 93, i32 ${wide})`);
    const [failed, ended] = [temp(), temp()];
    emit(`${failed} = icmp slt i32 ${more}, 0`);
    const [bad, ok] = [label(), label()];
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(bad);
    undo();
    emit("ret i1 false");
    startBlock(ok);
    emit(`${ended} = icmp eq i32 ${more}, 0`);
    emit(`br i1 ${ended}, label %${done}, label %${item}`);
    startBlock(item);
    const mark = temp();
    emit(`${mark} = call i64 @fsh_rt_json_index_path(ptr ${r}, i64 ${i})`);
    const [read, v] = jsonRead(r, t.element);
    jsonGuard(read, "i1", undo);
    emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
    appended(array, t.element, v);
    const next = temp();
    emit(`${next} = add i64 ${i}, 1`);
    emit(`store i64 ${next}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
    const result = temp();
    emit(`${result} = load ${ARRAY}, ptr ${array}`);
    return result;
  }

  // A tuple's elements, exactly as many as it has, in order.
  function readTuple(r: string, t: ObjectType): string {
    const [order, rest] = tupleOrder(t);
    const opened = temp();
    emit(`${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 91, ptr ${cString("array")})`);
    jsonGuard(opened, "i32");
    const read: { v: string; type: Type; i: number }[] = [];
    // Optional elements are read into slots, empty until read, since the array may end first.
    const required = t.required ?? order.length;
    const slots = order.slice(required).map(({ f, i }) => {
      const slot = alloca(llvm(lower(f.type)));
      emit(`store ${llvm(lower(f.type))} ${convert("zeroinitializer", "null", f.type)}, ptr ${slot}`);
      return { slot, type: f.type, i };
    });
    const loaded = (x: { slot: string; type: Type }) => {
      const v = temp();
      emit(`${v} = load ${llvm(lower(x.type))}, ptr ${x.slot}`);
      return v;
    };
    const undo = () => {
      read.forEach((x) => dispose(x.v, x.type));
      slots.forEach((x) => dispose(loaded(x), x.type));
    };
    const what = rest ? `an array of at least ${order.length}` : required === order.length ? `an array of ${order.length}` : `an array of ${required} to ${order.length}`;
    const finish = label();
    // Whether an element follows, or with `wanted` 0 the array ends, failing on bad text.
    const step = (n: number, wanted: 0 | 1) => {
      const [more, readable, right] = [temp(), temp(), temp()];
      emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 93, i32 ${n === 0 ? 1 : 0})`);
      emit(`${readable} = icmp sge i32 ${more}, 0`);
      jsonGuard(readable, "i1", undo);
      emit(`${right} = icmp eq i32 ${more}, ${wanted}`);
      return right;
    };
    order.forEach(({ f, i }, n) => {
      const right = step(n, 1);
      const [bad, good] = [label(), label()];
      // Where an optional element would be, the array may end instead.
      emit(`br i1 ${right}, label %${good}, label %${n < required ? bad : finish}`);
      if (n < required) {
        startBlock(bad);
        jsonExpected(r, what, undo);
        emit(`br label %${good}`);
      }
      startBlock(good);
      const mark = temp();
      emit(`${mark} = call i64 @fsh_rt_json_index_path(ptr ${r}, i64 ${n})`);
      const [ok, v] = jsonRead(r, f.type);
      jsonGuard(ok, "i1", undo);
      emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
      if (n < required) read.push({ v, type: f.type, i });
      else emit(`store ${llvm(lower(f.type))} ${v}, ptr ${slots[n - required]!.slot}`);
    });
    if (rest) {
      // The fixed elements dominate the rest's reads, so its failures can drop them.
      read.push({ v: readElements(r, rest.f.type as ArrayType, { from: order.length, undo }), type: rest.f.type, i: rest.i });
    } else {
      const right = step(order.length, 0);
      const [bad, good] = [label(), label()];
      emit(`br i1 ${right}, label %${good}, label %${bad}`);
      startBlock(bad);
      jsonExpected(r, what, undo);
      emit(`br label %${good}`);
      startBlock(good);
    }
    emit(`br label %${finish}`);
    startBlock(finish);
    return [...read, ...slots.map((x) => ({ v: loaded(x), type: x.type, i: x.i }))].reduce((agg, x) => {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(t)} ${agg}, ${llvm(lower(x.type))} ${x.v}, ${x.i}`);
      return next;
    }, "undef");
  }

  // An object's fields by key, in any order, unknown keys passed over and a repeated key's
  // last value kept, as JavaScript reads them; a missing field is an error unless it may be
  // empty. A failure drops the fields read so far.
  function readObject(r: string, t: Exclude<Type, string>, fields: { name: string; type: Type; path: number[] }[]) {
    const slots = fields.map((f) => ({ ...f, slot: alloca(llvm(lower(f.type))), seen: alloca("i1") }));
    for (const f of slots) emit(`store i1 false, ptr ${f.seen}`);
    const undo = () => {
      for (const f of slots.filter((f) => needsDrop(f.type))) {
        const [was, drop, after, v] = [temp(), label(), label(), temp()];
        emit(`${was} = load i1, ptr ${f.seen}`);
        emit(`br i1 ${was}, label %${drop}, label %${after}`);
        startBlock(drop);
        emit(`${v} = load ${llvm(lower(f.type))}, ptr ${f.slot}`);
        dispose(v, f.type);
        emit(`br label %${after}`);
        startBlock(after);
      }
    };
    const opened = temp();
    emit(`${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 123, ptr ${cString("object")})`);
    jsonGuard(opened, "i32");
    const first = alloca("i32");
    emit(`store i32 1, ptr ${first}`);
    const [head, entry, next, done] = [label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [isFirst, more, failed, ended] = [temp(), temp(), temp(), temp()];
    emit(`${isFirst} = load i32, ptr ${first}`);
    emit(`store i32 0, ptr ${first}`);
    emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 ${isFirst})`);
    emit(`${failed} = icmp sge i32 ${more}, 0`);
    jsonGuard(failed, "i1", undo);
    emit(`${ended} = icmp eq i32 ${more}, 0`);
    emit(`br i1 ${ended}, label %${done}, label %${entry}`);
    startBlock(entry);
    const [keySlot, gotKey, key] = [alloca("ptr"), temp(), temp()];
    emit(`${gotKey} = call i32 @fsh_rt_json_key(ptr ${r}, ptr ${keySlot})`);
    jsonGuard(gotKey, "i32", undo);
    emit(`${key} = load ptr, ptr ${keySlot}`);
    for (const f of slots) {
      const [found, match, skip] = [temp(), label(), label()];
      const same = temp();
      emit(`${found} = call i32 @fsh_rt_json_same(ptr ${key}, ptr ${cString(f.name)}, i64 ${new TextEncoder().encode(f.name).length})`);
      emit(`${same} = icmp ne i32 ${found}, 0`);
      emit(`br i1 ${same}, label %${match}, label %${skip}`);
      startBlock(match);
      const mark = temp();
      emit(`${mark} = call i64 @fsh_rt_json_field_path(ptr ${r}, ptr ${key})`);
      emit(`call void @fsh_rt_str_release(ptr ${key})`);
      // A repeated key replaces the value read before.
      if (needsDrop(f.type)) {
        const [was, drop, after, old] = [temp(), label(), label(), temp()];
        emit(`${was} = load i1, ptr ${f.seen}`);
        emit(`store i1 false, ptr ${f.seen}`);
        emit(`br i1 ${was}, label %${drop}, label %${after}`);
        startBlock(drop);
        emit(`${old} = load ${llvm(lower(f.type))}, ptr ${f.slot}`);
        dispose(old, f.type);
        emit(`br label %${after}`);
        startBlock(after);
      }
      const [ok, v] = jsonRead(r, f.type);
      jsonGuard(ok, "i1", undo);
      emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
      emit(`store ${llvm(lower(f.type))} ${v}, ptr ${f.slot}`);
      emit(`store i1 true, ptr ${f.seen}`);
      emit(`br label %${head}`);
      startBlock(skip);
    }
    emit(`call void @fsh_rt_str_release(ptr ${key})`);
    const skipped = temp();
    emit(`${skipped} = call i32 @fsh_rt_json_skip(ptr ${r})`);
    jsonGuard(skipped, "i32", undo);
    emit(`br label %${next}`);
    startBlock(next);
    emit(`br label %${head}`);
    startBlock(done);
    let agg = "undef";
    for (const f of slots) {
      const [was, have, absent, join, v] = [temp(), label(), label(), label(), temp()];
      emit(`${was} = load i1, ptr ${f.seen}`);
      emit(`br i1 ${was}, label %${join}, label %${absent}`);
      startBlock(absent);
      const empty = isOption(lower(f.type));
      if (empty) emit(`store ${llvm(lower(f.type))} ${convert("zeroinitializer", "null", lower(f.type))}, ptr ${f.slot}`);
      else {
        const ignored = temp();
        emit(`${ignored} = call i32 @fsh_rt_json_missing(ptr ${r}, ptr ${cString(f.name)})`);
        undo();
        emit("ret i1 false");
        startBlock(have);
      }
      emit(`br label %${join}`);
      startBlock(join);
      emit(`${v} = load ${llvm(lower(f.type))}, ptr ${f.slot}`);
      const made = temp();
      emit(`${made} = insertvalue ${llvm(t)} ${agg}, ${llvm(lower(f.type))} ${v}, ${f.path.join(", ")}`);
      agg = made;
    }
    return agg;
  }

  // A union's value: each member tried in turn from the same place, the first that reads
  // winning; when none does, the error kept is from the one that read furthest. An enum's
  // members are read together, tagged as the enum is.
  function readMember(r: string, t: UnionType): string {
    const mark = alloca("[3 x i64]");
    const result = alloca(llvm(t));
    const done = label();
    emit(`call void @fsh_rt_json_save(ptr ${r}, ptr ${mark})`);
    const groups = new Map<string, VariantType[]>();
    const parts: (Type | VariantType[])[] = [];
    for (const m of t.members) {
      if (typeof m === "string" || m.kind !== "variant") {
        parts.push(m);
        continue;
      }
      let group = groups.get(m.enum);
      if (!group) {
        group = [];
        groups.set(m.enum, group);
        parts.push(group);
      }
      group.push(m);
    }
    for (const part of parts) {
      const m = Array.isArray(part) ? unionType(part) : part;
      const [ok, v] = jsonRead(r, m);
      const [won, lost] = [label(), label()];
      emit(`br i1 ${ok}, label %${won}, label %${lost}`);
      startBlock(won);
      emit(`call void @fsh_rt_json_forget(ptr ${r})`);
      emit(`store ${llvm(t)} ${convert(v, m, t)}, ptr ${result}`);
      emit(`br label %${done}`);
      startBlock(lost);
      emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
    }
    emit(`call void @fsh_rt_json_settle(ptr ${r}, ptr ${mark}, ptr ${cString(show(t))})`);
    emit("ret i1 false");
    startBlock(done);
    const v = temp();
    emit(`${v} = load ${llvm(t)}, ptr ${result}`);
    return v;
  }

  // A data enum's member, tagged as serde writes it: a bare name, or an object of one key, the
  // name, holding its value or an array of its values.
  function readVariant(r: string, t: UnionType | VariantType): string {
    const variants = t.kind === "union" ? (t.members as VariantType[]) : [t];
    const result = alloca(llvm(t));
    const [named, keyed, done] = [label(), label(), label()];
    const names = variants.map((v) => v.member).join(", ");
    const mark = alloca("[3 x i64]");
    emit(`call void @fsh_rt_json_save(ptr ${r}, ptr ${mark})`);
    const [c, quoted] = [temp(), temp()];
    emit(`${c} = call i32 @fsh_rt_json_peek(ptr ${r})`);
    emit(`${quoted} = icmp eq i32 ${c}, 34`);
    emit(`br i1 ${quoted}, label %${named}, label %${keyed}`);
    // Pick the member a name says, or fail naming the ones there are.
    const pick = (name: string, units: boolean, then: (v: VariantType) => void) => {
      for (const v of variants.filter((v) => (v.fields.length === 0) === units)) {
        const [found, same, yes, no] = [temp(), temp(), label(), label()];
        emit(`${found} = call i32 @fsh_rt_json_same(ptr ${name}, ptr ${cString(v.member)}, i64 ${new TextEncoder().encode(v.member).length})`);
        emit(`${same} = icmp ne i32 ${found}, 0`);
        emit(`br i1 ${same}, label %${yes}, label %${no}`);
        startBlock(yes);
        emit(`call void @fsh_rt_str_release(ptr ${name})`);
        then(v);
        emit(`br label %${done}`);
        startBlock(no);
      }
      emit(`call void @fsh_rt_str_release(ptr ${name})`);
      emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
      jsonExpected(r, `one of ${names}`);
      emit(`br label %${done}`);
    };
    startBlock(named);
    const name = readParts(r, "string");
    pick(name, true, (v) => emit(`store ${llvm(t)} ${convert("zeroinitializer", v, t)}, ptr ${result}`));
    startBlock(keyed);
    const opened = temp();
    emit(`${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 123, ptr ${cString(`one of ${names}`)})`);
    jsonGuard(opened, "i32");
    const [more, one] = [temp(), temp()];
    emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 1)`);
    emit(`${one} = icmp sgt i32 ${more}, 0`);
    jsonGuard(one, "i1", () => {
      emit(`call void @fsh_rt_json_restore(ptr ${r}, ptr ${mark})`);
      const ignored = temp();
      emit(`${ignored} = call i32 @fsh_rt_json_expected(ptr ${r}, ptr ${cString(`one of ${names}`)})`);
    });
    const [keySlot, gotKey, key] = [alloca("ptr"), temp(), temp()];
    emit(`${gotKey} = call i32 @fsh_rt_json_key(ptr ${r}, ptr ${keySlot})`);
    jsonGuard(gotKey, "i32");
    emit(`${key} = load ptr, ptr ${keySlot}`);
    const path = temp();
    emit(`${path} = call i64 @fsh_rt_json_field_path(ptr ${r}, ptr ${key})`);
    pick(key, false, (v) => {
      const payload = v.fields.length === 1 ? readParts(r, lower(v.fields[0]!.type)) : readTuple(r, tupleType(v.fields.map((f) => f.type)));
      const made = v.fields.length === 1 ? (() => {
        const one = temp();
        emit(`${one} = insertvalue ${llvm(v)} undef, ${llvm(lower(v.fields[0]!.type))} ${payload}, 0`);
        return one;
      })() : v.fields.reduce((agg, f, i) => {
        const [part, next] = [temp(), temp()];
        const tuple = tupleType(v.fields.map((f) => f.type));
        emit(`${part} = extractvalue ${llvm(tuple)} ${payload}, ${tuple.fields.findIndex((g) => g.name === String(i))}`);
        emit(`${next} = insertvalue ${llvm(v)} ${agg}, ${llvm(lower(f.type))} ${part}, ${i}`);
        return next;
      }, "undef");
      const [closing, closed] = [temp(), temp()];
      emit(`${closing} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 0)`);
      emit(`${closed} = icmp eq i32 ${closing}, 0`);
      jsonGuard(closed, "i1", () => {
        dispose(made, v);
        const ignored = temp();
        emit(`${ignored} = call i32 @fsh_rt_json_expected(ptr ${r}, ptr ${cString("an object of one key")})`);
      });
      emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${path})`);
      emit(`store ${llvm(t)} ${convert(made, v, t)}, ptr ${result}`);
    });
    startBlock(done);
    const v = temp();
    emit(`${v} = load ${llvm(t)}, ptr ${result}`);
    return v;
  }

  // A string-keyed Map's entries, each key's last value kept.
  function readEntries(r: string, t: MapType): string {
    const map = mapNew(t, undefined);
    const undo = () => dispose(map, t);
    const opened = temp();
    emit(`${opened} = call i32 @fsh_rt_json_open(ptr ${r}, i32 123, ptr ${cString("object")})`);
    jsonGuard(opened, "i32", undo);
    const first = alloca("i32");
    emit(`store i32 1, ptr ${first}`);
    const [head, entry, done] = [label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [isFirst, more, failed, ended] = [temp(), temp(), temp(), temp()];
    emit(`${isFirst} = load i32, ptr ${first}`);
    emit(`store i32 0, ptr ${first}`);
    emit(`${more} = call i32 @fsh_rt_json_more(ptr ${r}, i32 125, i32 ${isFirst})`);
    emit(`${failed} = icmp sge i32 ${more}, 0`);
    jsonGuard(failed, "i1", undo);
    emit(`${ended} = icmp eq i32 ${more}, 0`);
    emit(`br i1 ${ended}, label %${done}, label %${entry}`);
    startBlock(entry);
    const [keySlot, gotKey, key, mark] = [alloca("ptr"), temp(), temp(), temp()];
    emit(`${gotKey} = call i32 @fsh_rt_json_key(ptr ${r}, ptr ${keySlot})`);
    jsonGuard(gotKey, "i32", undo);
    emit(`${key} = load ptr, ptr ${keySlot}`);
    emit(`${mark} = call i64 @fsh_rt_json_field_path(ptr ${r}, ptr ${key})`);
    const [ok, v] = jsonRead(r, t.value);
    jsonGuard(ok, "i1", () => {
      emit(`call void @fsh_rt_str_release(ptr ${key})`);
      undo();
    });
    emit(`call void @fsh_rt_json_back(ptr ${r}, i64 ${mark})`);
    inserted(t, map, key, v);
    emit(`br label %${head}`);
    startBlock(done);
    return map;
  }

  // A string-keyed Map's live entries, in the order they went in, as an object's fields.
  function jsonEntries(w: string, map: string, t: MapType, written: Type) {
    const entry = entryType(t);
    jsonRaw(w, "{");
    const [counter, wrote] = [alloca("i64"), alloca("i1")];
    emit(`store i64 0, ptr ${counter}`);
    emit(`store i1 false, ptr ${wrote}`);
    const [test, live, loop, comma, item, next, end] = [label(), label(), label(), label(), label(), label(), label()];
    emit(`br label %${test}`);
    startBlock(test);
    const [i, used, more] = [temp(), temp(), temp()];
    emit(`${i} = load i64, ptr ${counter}`);
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
    const after = temp();
    emit(`${after} = load i1, ptr ${wrote}`);
    emit(`br i1 ${after}, label %${comma}, label %${item}`);
    startBlock(comma);
    jsonRaw(w, ",");
    emit(`br label %${item}`);
    startBlock(item);
    emit(`store i1 true, ptr ${wrote}`);
    const [keyAt, key, valueAt, x] = [temp(), temp(), temp(), temp()];
    emit(`${keyAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 3`);
    emit(`${key} = load ptr, ptr ${keyAt}`);
    emit(`call void @fsh_rt_json_string(ptr ${w}, ptr ${key})`);
    jsonRaw(w, ":");
    emit(`${valueAt} = getelementptr ${entry}, ptr ${at}, i64 0, i32 4`);
    emit(`${x} = load ${llvm(lower(t.value))}, ptr ${valueAt}`);
    jsonWrite(w, x, written);
    emit(`br label %${next}`);
    startBlock(next);
    const step = temp();
    emit(`${step} = add i64 ${i}, 1`);
    emit(`store i64 ${step}, ptr ${counter}`);
    emit(`br label %${test}`);
    startBlock(end);
    jsonRaw(w, "}");
  }

  // A union's value, written as the member its tag says it holds.
  function jsonMember(w: string, v: string, t: UnionType, written: Type[]) {
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(t)} ${v}, 0`);
    const done = label();
    const cases = t.members.map(() => label());
    emit(`switch i32 ${tag}, label %${done} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    t.members.forEach((m, i) => {
      startBlock(cases[i]!);
      const member = lower(m);
      if (typeof member === "string" && (member === "null" || member === "never")) jsonRaw(w, "null");
      else if (typeof member !== "string" && member.kind === "literal") jsonScalar(w, "", member);
      else {
        const slot = alloca(llvm(t));
        emit(`store ${llvm(t)} ${v}, ptr ${slot}`);
        const [at, x] = [temp(), temp()];
        emit(`${at} = getelementptr ${llvm(t)}, ptr ${slot}, i32 0, i32 1`);
        emit(`${x} = load ${llvm(member)}, ptr ${at}`);
        jsonWrite(w, x, written[i]!);
      }
      emit(`br label %${done}`);
    });
    startBlock(done);
  }

  // In an array's drop function: drops each element, then frees the buffer.
  // A recursive type's block, or a copy of it holding copies of what it owns. A block moved out
  // of its place left it empty, with nothing to drop or copy.
  function dropBlock(type: RecursiveType): string {
    const [held, done] = [label(), label()];
    const empty = temp();
    emit(`${empty} = icmp eq ptr %v, null`);
    emit(`br i1 ${empty}, label %${done}, label %${held}`);
    startBlock(held);
    const v = temp();
    emit(`${v} = load ${llvm(type.of)}, ptr %v`);
    dispose(v, type.of);
    emit("call void @fsh_rt_free(ptr %v)");
    emit(`br label %${done}`);
    startBlock(done);
    return "%v";
  }

  function copyBlock(type: RecursiveType): string {
    const [held, done] = [label(), label()];
    const empty = temp();
    emit(`${empty} = icmp eq ptr %v, null`);
    emit(`br i1 ${empty}, label %${done}, label %${held}`);
    startBlock(held);
    const v = temp();
    emit(`${v} = load ${llvm(type.of)}, ptr %v`);
    const copy = convert(copied(v, type.of), type.of, type);
    const from = block;
    emit(`br label %${done}`);
    startBlock(done);
    const result = temp();
    emit(`${result} = phi ptr [ null, %entry ], [ ${copy}, %${from} ]`);
    return result;
  }

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
      // Its own owner, since code emitted twice, as a `finally` is, makes two.
      through = `@fsh.sort.compare.${stableId("sort.compare", `${current.symbol} ${compare.start}`, {})}`;
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
    const name = `@fsh.sort.order.${stableId("sort.order", described(t), keyOf(t))}`;
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
    bounds(length, index, e, restStarts.get(e.object));
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
        return calls.has(e) || current.copiesOut.has(e) || computed.has(e) || jsMembers.has(e) || jsStatics.has(e);
      // A JsValue read out of JS as a string, or a package's const.
      case "ident":
        return current.copiesOut.has(e) || jsExports.has(e);
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
    // else a copy of it. One boxed into a union's Dyn then goes into the union.
    const dyn = boxedMembers.get(e) ?? (to && isDyn(to) ? to : undefined);
    if (to && dyn && !isDyn(types.get(e)!)) {
      const type = types.get(e)!;
      let v = known.get(e) ?? evaluate(e);
      if (current.consumes.has(e) && lendable(e)) emit(`store ${llvm(e.kind === "member" ? stored(e) : type)} zeroinitializer, ptr ${address(e)}`);
      else if (!fresh(e)) v = copied(v, type);
      return to === dyn ? box(v, type, dyn) : convert(box(v, type, dyn), dyn, to);
    }
    // A value read out of a recursive type's block, when it is given up, leaves the block to be
    // freed.
    if (to && !isRef(to) && unboxes(types.get(e)!, to)) {
      const type = types.get(e)!;
      const v = known.get(e) ?? evaluate(e);
      const out = convert(v, type, to);
      if (fresh(e)) freeBlocks(v, type);
      else if (current.consumes.has(e) && lendable(e)) {
        freeBlocks(v, type);
        emit(`store ${llvm(placeType(e))} zeroinitializer, ptr ${address(e)}`);
      } else return copied(out, to);
      return out;
    }
    // A value moving into a recursive type's block is taken, or copied, first.
    if (to && boxes(types.get(e)!, to)) {
      const type = types.get(e)!;
      let v = known.get(e) ?? evaluate(e);
      if (current.consumes.has(e) && lendable(e)) take(e);
      else if (!fresh(e)) v = copied(v, type);
      return convert(v, type, to);
    }
    const whole = !to || keepsAll(types.get(e)!, to);
    // A Rust handle is never copied: one made here, or moved out of its place, is taken whole.
    const rust = holdsRust(types.get(e)!);
    if ((whole || rust) && fresh(e)) return value(e, true);
    if (!rust && !needsDrop(types.get(e)!) && holdsRust(valueType(e))) return value(e);
    // A value owning nothing meets a recursive type's blocks only as the blocks just made for it.
    if (to && !needsDrop(types.get(e)!) && holdsPart(to, (t) => typeof t !== "string" && t.kind === "recursive")) return value(e, true);
    const v = value(e);
    if ((whole || rust) && current.consumes.has(e) && lendable(e)) {
      take(e);
      return v;
    }
    return e.kind === "string" ? v : copied(v, valueType(e));
  }

  // Leaves a place empty once its value is moved out. A value read out of a recursive type's
  // block leaves the block behind, which is freed.
  function take(e: Expr) {
    const at = address(e);
    const place = placeType(e);
    if (place !== types.get(e)) {
      const held = temp();
      emit(`${held} = load ${llvm(place)}, ptr ${at}`);
      freeBlocks(held, place);
    }
    emit(`store ${llvm(place)} zeroinitializer, ptr ${at}`);
  }

  // Where a place's value lives: in the place, or in the block a recursive type's place holds.
  function blockOf(at: string, place: Type): string {
    if (typeof place === "string" || place.kind !== "recursive") return at;
    const block = temp();
    emit(`${block} = load ptr, ptr ${at}`);
    return block;
  }

  // The type a place holds its value as: a field's or an element's own, or the variable's.
  function placeType(e: Expr): Type {
    if (e.kind === "member") return stored(e);
    if (e.kind === "index" && indexes(valueType(e.object))) {
      const object = valueType(e.object);
      return ((isRef(object) ? object.to : object) as ArrayType | FixedType).element;
    }
    return types.get(e)!;
  }

  // Frees a value's own recursive block, or the one its union holds, without what is in it.
  function freeBlocks(v: string, type: Type) {
    if (typeof type !== "string" && type.kind === "recursive") return emit(`call void @fsh_rt_free(ptr ${v})`);
    if (typeof type === "string" || type.kind !== "union") return;
    const blocks = type.members.filter((m) => typeof m !== "string" && m.kind === "recursive");
    if (blocks.length === 0) return;
    const tag = temp();
    emit(`${tag} = extractvalue ${llvm(type)} ${v}, 0`);
    const [cases, end] = [blocks.map(() => label()), label()];
    emit(`switch i32 ${tag}, label %${end} [ ${blocks.map((m, i) => `i32 ${type.members.indexOf(m)}, label %${cases[i]}`).join(" ")} ]`);
    blocks.forEach((m, i) => {
      startBlock(cases[i]!);
      emit(`call void @fsh_rt_free(ptr ${convert(v, type, m)})`);
      emit(`br label %${end}`);
    });
    startBlock(end);
  }

  // Whether converting a value reads some of it out of a recursive type's block.
  function unboxes(from: Type, to: Type): boolean {
    const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
    return from !== to && members(from).some((m) => typeof m !== "string" && m.kind === "recursive" && !members(to).includes(m));
  }

  // Whether converting a value moves some of it into a recursive type's block.
  function boxes(from: Type, to: Type): boolean {
    const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
    return from !== to && members(to).some((m) => typeof m !== "string" && m.kind === "recursive") && members(from).some((m) => !members(to).includes(m));
  }

  // Whether converting a value from one type to another keeps all it owns: putting it in a
  // union, taking a union's member out, or moving it to a union holding all its members.
  function keepsAll(from: Type, to: Type): boolean {
    const members = (t: Type) => (typeof t !== "string" && t.kind === "union" ? t.members : [t]);
    if (!needsDrop(from) || isDyn(to) || members(from).every((m) => members(to).includes(m)) || members(from).includes(to)) return true;
    return members(from).every((m) => members(to).some((t) => keepsPart(m, t)));
  }

  // Whether a member converts to another keeping all it owns: moved into a recursive type's
  // block, or an object whose fields each do.
  function keepsPart(from: Type, to: Type): boolean {
    if (typeof to !== "string" && to.kind === "recursive") return keepsAll(from, to.of);
    if (typeof from === "string" || typeof to === "string" || from.kind !== "object" || to.kind !== "object") return false;
    return from.fields.every((f) => {
      const kept = field(to, f.name);
      return kept ? keepsAll(f.type, kept.type) : !needsDrop(f.type);
    });
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
    if (!needsDrop(type) || fresh(e) || e.kind === "string" || !later.some(writes) || holdsRust(type)) return v;
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
    if (stringBuilds.has(e)) return stringBuilt(e, stringBuilds.get(e)!);
    // A joined handle is the same task's pointer.
    if (joinCalls.has(e)) return owned((e.callee as Extract<Expr, { kind: "member" }>).object);
    if (e.callee.kind === "member" && unwraps(e.callee.object)) return link(e, e.callee.object, () => run(e));
    return run(e);
  }

  // node:fs's blocking calls: what each gives, or a failure raised as the IoError the runtime's
  // parts make.
  function syncFile(e: Extract<Expr, { kind: "call" }>, name: string): string | undefined {
    const path = operand(e.args[0]!, e.args.slice(1));
    if (name === "pathExists") {
      const [found, result] = [temp(), temp()];
      emit(`${found} = call i32 @fsh_rt_fs_exists(ptr ${path})`);
      emit(`${result} = icmp ne i32 ${found}, 0`);
      return result;
    }
    const parts = alloca("[4 x ptr]");
    const status = temp();
    // What a call fills in, read once it has succeeded.
    let read: (() => string) | undefined;
    const filled = (type: string, slot: string) => () => {
      const v = temp();
      emit(`${v} = load ${type}, ptr ${slot}`);
      return v;
    };
    switch (name) {
      case "fileReadSync":
      case "dirRead": {
        const out = alloca(ARRAY);
        emit(`${status} = call i32 @fsh_rt_fs_${name === "dirRead" ? "readdir" : "read_sync"}(ptr ${path}, ptr ${out}, ptr ${parts})`);
        read = filled(ARRAY, out);
        break;
      }
      case "fileWriteSync": {
        // The bytes are handed over, as to any call, and released once written.
        const [bytes, given] = [alloca(ARRAY), owned(e.args[1]!)];
        emit(`store ${ARRAY} ${given}, ptr ${bytes}`);
        emit(`${status} = call i32 @fsh_rt_fs_write_sync(ptr ${path}, ptr ${bytes}, ptr ${parts})`);
        dispose(given, arrayType("u8"));
        break;
      }
      case "pathReal":
      case "dirTemp": {
        const out = alloca("ptr");
        emit(`${status} = call i32 @fsh_rt_fs_${name === "pathReal" ? "realpath" : "mkdtemp"}(ptr ${path}, ptr ${out}, ptr ${parts})`);
        read = filled("ptr", out);
        break;
      }
      case "pathStat": {
        const [numbers, mtime, follow] = [alloca("[3 x i64]"), alloca("double"), temp()];
        emit(`${follow} = zext i1 ${value(e.args[1]!)} to i32`);
        emit(`${status} = call i32 @fsh_rt_fs_stat(ptr ${path}, i32 ${follow}, ptr ${numbers}, ptr ${mtime}, ptr ${parts})`);
        read = () => {
          const tuple = types.get(e) as ObjectType;
          const number = (i: number) => {
            const [at, v] = [temp(), temp()];
            emit(`${at} = getelementptr [3 x i64], ptr ${numbers}, i32 0, i32 ${i}`);
            emit(`${v} = load i64, ptr ${at}`);
            return v;
          };
          const time = temp();
          emit(`${time} = load double, ptr ${mtime}`);
          let made = "zeroinitializer";
          for (const [field, v] of [["0", number(0)], ["1", number(1)], ["2", time], ["3", number(2)]] as const) {
            const next = temp();
            emit(`${next} = insertvalue ${llvm(tuple)} ${made}, ${llvm(field === "2" ? "f64" : "i64")} ${v}, ${fieldPath(tuple, field).join(", ")}`);
            made = next;
          }
          return made;
        };
        break;
      }
      case "pathRemove": {
        const [recursive, force] = [temp(), temp()];
        emit(`${recursive} = zext i1 ${value(e.args[1]!)} to i32`);
        emit(`${force} = zext i1 ${value(e.args[2]!)} to i32`);
        emit(`${status} = call i32 @fsh_rt_fs_rm(ptr ${path}, i32 ${recursive}, i32 ${force}, ptr ${parts})`);
        break;
      }
    }
    const [failed, bad, good] = [temp(), label(), label()];
    emit(`${failed} = icmp ne i32 ${status}, 1`);
    emit(`br i1 ${failed}, label %${bad}, label %${good}`);
    startBlock(bad);
    raised(e, ioError(parts, current.raises.get(e)!.from as ClassType));
    startBlock(good);
    if (!read) return undefined;
    const result = read();
    // Unused, as a statement, what a call gives is released when the statement ends.
    const gives: Record<string, Type> = { fileReadSync: arrayType("u8"), dirRead: arrayType("string"), pathReal: "string", dirTemp: "string" };
    if (!types.has(e) && gives[name]) pending.push({ v: result, type: gives[name]! });
    return result;
  }

  // `String.fromCharCode` and `String.fromCodePoint` over their gathered array, a temporary the
  // statement releases.
  function stringBuilt(e: Extract<Expr, { kind: "call" }>, kind: "units" | "points"): string {
    const array = value(e.args[0]!);
    const [data, length, result] = [temp(), temp(), temp()];
    emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
    emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
    if (kind === "units") emit(`${result} = call ptr @fsh_rt_str_from_units(ptr ${data}, i64 ${length})`);
    else unwinding(`call ptr @fsh_rt_str_from_points(ptr ${data}, i64 ${length}, ptr ${panicAt(e)})`, result);
    if (!types.has(e)) pending.push({ v: result, type: "string" });
    return result;
  }

  function run(e: Extract<Expr, { kind: "call" }>): string | undefined {
    const target = calls.get(e);
    const js = jsCalls.get(e);
    if (js && target) return jsCall(e, js, target);
    const statics = jsStatics.get(e);
    if (statics) return jsStatic(e, statics);
    if (!target) {
      if (formatCalls.has(e)) return formatted(e);
      if (inspectCalls.has(e)) {
        const [a] = e.args as [Expr];
        const [slot, result] = [alloca(FARG), temp()];
        describe(slot, a.kind === "string" ? text(a.value) : operand(a, []), printedType(a), { text: false, depth: 2 });
        emit(`${result} = call ptr @fsh_rt_inspect(ptr ${slot})`);
        if (!types.has(e)) pending.push({ v: result, type: "string" });
        return result;
      }
      // A print whose first argument may be a format prints what format gives.
      if (printCalls.has(e) && formats(e.args)) {
        const line = formatted(e);
        // The statement releases the line, as it does a format call's value it drops.
        write(printStream(e.callee), [[line, "string"]], builder, convert);
        return undefined;
      }
      if (printCalls.has(e)) {
        print(e.args, builder, (a) => operand(a, e.args.slice(e.args.indexOf(a) + 1)), (a) => current.spelled?.get(a) ?? valueType(a), convert, printStream(e.callee));
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
      if (kindTests.has(e)) return test(e, value, valueType)!;
      if (syncFileCalls.has(e)) return syncFile(e, syncFileCalls.get(e)!);
      // `Promise.all` and `Promise.race`: their futures moved into the combined one's frame.
      if (combinedCalls.has(e)) {
        const t = types.get(e) as FutureType;
        if (e.args[0]!.kind !== "array") {
          const made = temp();
          emit(`${made} = insertvalue ${llvm(t)} zeroinitializer, ${ARRAY} ${owned(e.args[0]!)}, 1`);
          return made;
        }
        const list = (e.args[0] as Extract<Expr, { kind: "array" }>).elements as Expr[];
        const given = list.map((x) => owned(x));
        let frame = "zeroinitializer";
        given.forEach((v, i) => {
          const next = temp();
          emit(`${next} = insertvalue ${llvm(t)} ${frame}, ${llvm(valueType(list[i]!))} ${v}, ${1 + 3 * i}`);
          frame = next;
        });
        return frame;
      }
      if (jsEvaluations.has(e)) {
        const made = temp();
        unwinding(`call ptr @fsh_rt_js_evaluate(ptr ${value(e.args[0]!)}, ptr ${panicAt(e)})`, made);
        return made;
      }
      // The std's timers. A timer's callable goes to the runtime, the timer task started with
      // the first; the next one due is waited for as a leaf future holding only its state.
      const timer = timerCalls.get(e);
      if (timer === "timerNext") {
        const frame = temp();
        emit(`${frame} = insertvalue ${llvm(types.get(e)!)} zeroinitializer, i32 0, 0`);
        return frame;
      }
      if (timer === "timerClear") return void emit(`call void @fsh_rt_timeout_clear(i64 ${value(e.args[0]!)})`);
      if (timer === "timerSet") {
        const callable = owned(e.args[0]!);
        const [ms, repeats] = [value(e.args[1]!), value(e.args[2]!)];
        const loop = valueType(e.args[3]!) as FutureType;
        const held = owned(e.args[3]!);
        const [block, table, repeat, claimed, id, start, skip, done] = [temp(), temp(), temp(), temp(), temp(), label(), label(), label()];
        emit(`${claimed} = call i32 @fsh_rt_timeouts_claim()`);
        const first = temp();
        emit(`${first} = icmp ne i32 ${claimed}, 0`);
        emit(`br i1 ${first}, label %${start}, label %${skip}`);
        startBlock(start);
        const [poll, drop, dropOutput] = taskGlue(loop);
        const [frame, task] = [alloca(llvm(loop)), temp()];
        emit(`store ${llvm(loop)} ${held}, ptr ${frame}`);
        unwinding(`call ptr @fsh_rt_spawn(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${sizeOf(llvm(loop))}, i64 ${sizeOf(pollType(loop))})`, task);
        emit(`call void @fsh_rt_timeouts_task(ptr ${task})`);
        emit(`br label %${done}`);
        startBlock(skip);
        dispose(held, loop);
        emit(`br label %${done}`);
        startBlock(done);
        emit(`${block} = extractvalue ${DYN} ${callable}, 0`);
        emit(`${table} = extractvalue ${DYN} ${callable}, 1`);
        emit(`${repeat} = zext i1 ${repeats} to i32`);
        emit(`${id} = call i64 @fsh_rt_timeout_set(ptr ${block}, ptr ${table}, i64 ${ms}, i32 ${repeat})`);
        return id;
      }
      // A file's future: the path, and a write's bytes, in its frame for the pool to take.
      if (fileCalls.has(e)) {
        const future = types.get(e) as FutureType;
        let frame = temp();
        emit(`${frame} = insertvalue ${llvm(future)} zeroinitializer, ptr ${owned(e.args[0]!)}, 1`);
        if (e.args[1]) {
          const next = temp();
          emit(`${next} = insertvalue ${llvm(future)} ${frame}, ${ARRAY} ${owned(e.args[1])}, 2`);
          frame = next;
        }
        return frame;
      }
      if (clocks.has(e)) {
        const now = temp();
        const clock = clocks.get(e);
        emit(clock === "Date.now" ? `${now} = call i64 @fsh_rt_date_now()` : `${now} = call double @fsh_rt_${clock === "Math.random" ? "math_random" : "performance_now"}()`);
        return now;
      }
      if (jsonCalls.get(e) === "stringify") return stringifyCall(e);
      if (jsonCalls.get(e) === "parse") return parseJsonCall(e);
      if (parses.has(e)) return parseCall(e, parses.get(e)!);
      if (asserts.has(e)) return assertCall(e);
      if (fixedPrints.has(e)) return toFixed(e);
      if (integerCalls.has(e)) return integerMethodCall(e);
      if (regexCalls.get(e) === "exec") return regexExec(e);
      if (regexStringCalls.has(e)) return regexString(e, regexStringCalls.get(e)!);
      if (regexCalls.get(e) === "test") {
        const re = value((e.callee as Extract<Expr, { kind: "member" }>).object);
        const [found, yes] = [temp(), temp()];
        emit(`${found} = call i32 @fsh_rt_regex_test(ptr ${re}, ptr ${value(e.args[0]!)})`);
        emit(`${yes} = icmp ne i32 ${found}, 0`);
        return yes;
      }
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
      if (e.callee.kind === "ident" && (e.callee.name === "spawn" || e.callee.name === "timer spawn")) {
        const future = valueType(e.args[0]!) as FutureType;
        const [poll, drop, dropOutput] = taskGlue(future);
        const [frame, task] = [alloca(llvm(future)), temp()];
        emit(`store ${llvm(future)} ${owned(e.args[0]!)}, ptr ${frame}`);
        const spawning = e.callee.name === "spawn" ? "fsh_rt_spawn" : "fsh_rt_spawn_now";
        unwinding(`call ptr @${spawning}(ptr ${poll}, ptr ${drop}, ptr ${dropOutput}, ptr ${frame}, i64 ${sizeOf(llvm(future))}, i64 ${sizeOf(pollType(future))})`, task);
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
        if (e.callee.name === "any") emit(`${made} = call ptr @fsh_rt_signal_any(${signalList(e.args[0]!)})`);
        else emit(`${made} = call ptr @fsh_rt_signal_timeout(i64 ${value(e.args[0]!)})`);
        if (!types.has(e)) pending.push({ v: made, type: blockType("AbortSignal") });
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "nowMs" && !calls.has(e)) {
        const made = temp();
        emit(`${made} = call i64 @fsh_rt_now_ms()`);
        return made;
      }
      if (e.callee.kind === "ident" && e.callee.name === "shutdownSignal" && !calls.has(e)) {
        const made = temp();
        emit(`${made} = call ptr @fsh_rt_signal_shutdown()`);
        if (!types.has(e)) pending.push({ v: made, type: blockType("AbortSignal") });
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
      if (e.callee.kind === "member" && (valueType(e.callee.object) as GeneratorType).async) {
        const made = temp();
        emit(`${made} = insertvalue ${llvm(types.get(e)!)} zeroinitializer, ptr ${receiver(e.callee.object)}, 1`);
        return made;
      }
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
    const pointer = target.body.closure ? (selfCalls.has(e) ? "%env" : current.envs?.has(e) ? envFor(target, current.envs.get(e)!.env) : receiver(e.callee)) : target.body.self && object ? thisPointer(target, object) : undefined;
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
      // Past either end, an Option's empty value: the runtime says so with NULL or -1.
      case "at": {
        const [raw, none] = [temp(), temp()];
        emit(`${raw} = call ptr @fsh_rt_str_at_or_null(ptr ${s}, i64 ${args[0]})`);
        emit(`${none} = icmp eq ptr ${raw}, null`);
        const option = unionType(["string", "null"]);
        emit(`${result} = select i1 ${none}, ${llvm(option)} ${convert("zeroinitializer", "null", option)}, ${llvm(option)} ${convert(raw, "string", option)}`);
        return given(result, option);
      }
      case "codePointAt": {
        const [raw, none, point] = [temp(), temp(), temp()];
        emit(`${raw} = call i64 @fsh_rt_str_code_point_at(ptr ${s}, i64 ${args[0]})`);
        emit(`${none} = icmp slt i64 ${raw}, 0`);
        emit(`${point} = trunc i64 ${raw} to i32`);
        const option = unionType(["u32", "null"]);
        emit(`${result} = select i1 ${none}, ${llvm(option)} ${convert("zeroinitializer", "null", option)}, ${llvm(option)} ${convert(point, "u32", option)}`);
        return given(result, option);
      }
      case "charAt":
        emit(`${result} = call ptr @fsh_rt_str_char_at(ptr ${s}, i64 ${args[0]})`);
        return given(result, "string");
      // A missing position is the end, which the runtime clamps to.
      case "lastIndexOf":
        emit(`${result} = call i64 @fsh_rt_str_last_index_of(ptr ${s}, ptr ${args[0]}, i64 ${args[1] ?? "9223372036854775807"})`);
        return given(result, "i64");
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
      case "replaceAll":
        emit(`${result} = call ptr @fsh_rt_str_${callee.name === "replace" ? "replace" : "replace_all"}(ptr ${s}, ptr ${args[0]}, ptr ${args[1]})`);
        return given(result, "string");
      // Each join makes a new string, the one before it released.
      case "concat": {
        if (args.length === 0) {
          emit(`call void @fsh_rt_str_retain(ptr ${s})`);
          return given(s, "string");
        }
        let joined = concat(s, args[0]!);
        for (const a of args.slice(1)) {
          const next = concat(joined, a);
          emit(`call void @fsh_rt_str_release(ptr ${joined})`);
          joined = next;
        }
        return given(joined, "string");
      }
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

  // Panics, as Rust's indexing does, unless a `usize` index is below a length. A rest tuple's
  // array is named as the tuple, its `before` fixed elements counted in.
  function bounds(length: string, index: string, at: Expr, before = 0) {
    const [outside, fail, ok] = [temp(), label(), label()];
    emit(`${outside} = icmp uge i64 ${index}, ${length}`);
    emit(`br i1 ${outside}, label %${fail}, label %${ok}`);
    startBlock(fail);
    const [told, asked] = before === 0 ? [length, index] : [temp(), temp()];
    if (before !== 0) {
      emit(`${told} = add i64 ${length}, ${before}`);
      emit(`${asked} = add i64 ${index}, ${before}`);
    }
    unwinding(`call void @fsh_rt_panic_bounds(ptr ${cString(`panicked at ${where(at)}:\n`)}, i64 ${told}, i64 ${asked})`);
    emit("unreachable");
    startBlock(ok);
  }

  function assign(e: Extract<Expr, { kind: "assign" }>): string {
    // A handle's property is written in JS, with a new JS value of what is assigned; the
    // assignment's own value is what the property holds, a handle as the new JS value.
    if (jsMembers.has(e.target) && e.target.kind === "member") {
      const object = jsHandle(e.target.object);
      const declared = jsShape(referent(valueType(e.target.object)))?.fields.find((f) => f.name === (e.target as Extract<Expr, { kind: "member" }>).name);
      const empty = declared?.optional ? "undefined" : "null";
      // A callback or a future goes as the stored callable or Promise it meets, as an argument does.
      const held = coercions.get(e.value) ?? types.get(e.value)!;
      const kept = isCallback(held) || isPromised(held);
      const type = types.get(e)!;
      jsSite = e.value;
      const v = kept ? owned(e.value) : jsOperand(e.value);
      const box = toJs(v, kept ? held : types.get(e.value)!, empty);
      const handle = typeof type !== "string" && type.kind === "block";
      if (handle) {
        emit(`call void @fsh_rt_block_retain(ptr ${box})`);
        pending.push({ v: box, type });
      }
      unwinding(`call void @fsh_rt_js_set(ptr ${object}, ptr ${text(e.target.name)}, ptr ${box}, ptr ${panicAt(e)})`);
      // A callback or a Promise is only written as a statement, whose value nothing reads.
      if (kept) return "zeroinitializer";
      return handle ? box : convert(v, types.get(e.value)!, type);
    }
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
    const statics = jsStatics.get(e);
    if (statics) return jsStatic(e, statics)!;
    if (jsMembers.has(e)) return jsGet(jsHandle(e.object), e.name, types.get(e)!, `property '${e.name}' of '${show(referent(valueType(e.object)))}' is`, e);
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
    if (isTuple(shared) && e.name === "length") return convert(tupleLength(whole(), shared as ObjectType), "usize", types.get(e)!);
    const object = shared as ObjectType | ClassType;
    const result = temp();
    emit(`${result} = extractvalue ${llvm(object)} ${value(e.object)}, ${fieldPath(object, e.name).join(", ")}`);
    // A field read through an interface or object parameter takes the type its bound declares.
    return convert(result, field(object, e.name)!.type, types.get(e)!);
  }

  // A nested function's environment built for one call, in a slot of its own.
  function envFor(target: Instance, env: Local[]): string {
    const at = alloca(llvm(target.closure!));
    emit(`store ${llvm(target.closure!)} ${environment(target, env)}, ptr ${at}`);
    return at;
  }

  // A closure's environment, from the bindings standing here for what it captures, in order:
  // where each lives, or a copy, or the value moved in.
  function environment(inner: Instance, froms: (Local | "this")[]): string {
    let result = "undef";
    froms.forEach((from, i) => {
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
    return froms.length === 0 ? "zeroinitializer" : result;
  }

  // A tuple's fixed elements in order, with where each is in its fields, and its rest array's.
  function tupleOrder(t: ObjectType): [{ f: Field; i: number }[], { f: Field; i: number } | undefined] {
    const all = t.fields.map((f, i) => ({ f, i }));
    return [all.filter(({ f }) => f.name !== "...").sort((a, b) => Number(a.f.name) - Number(b.f.name)), all.find(({ f }) => f.name === "...")];
  }

  // `write`, for a tuple's element `n`, only when it is within `length`, when one is known.
  function present(length: string | undefined, n: number, write: () => void) {
    if (length === undefined) return write();
    const [within, yes, after] = [temp(), label(), label()];
    emit(`${within} = icmp ult i64 ${n}, ${length}`);
    emit(`br i1 ${within}, label %${yes}, label %${after}`);
    startBlock(yes);
    write();
    emit(`br label %${after}`);
    startBlock(after);
  }

  // A tuple's length: its required elements, then up to the last optional one there.
  function tupleLength(v: string, t: ObjectType): string {
    const count = elementsOf(t).length;
    let length = String(t.required ?? count);
    for (let i = t.required ?? count; i < count; i++) {
      const [x, next] = [temp(), temp()];
      emit(`${x} = extractvalue ${llvm(t)} ${v}, ${fieldPath(t, String(i)).join(", ")}`);
      const union = field(t, String(i))!.type as UnionType;
      emit(`${next} = select i1 ${holds(x, union, union.members.filter((m) => m !== "null"))}, i64 ${i + 1}, i64 ${length}`);
      length = next;
    }
    if (t.rest !== undefined) {
      const [many, more, sum] = [temp(), temp(), temp()];
      emit(`${many} = extractvalue ${llvm(t)} ${v}, ${fieldPath(t, "...").join(", ")}`);
      emit(`${more} = extractvalue ${ARRAY} ${many}, 1`);
      emit(`${sum} = add i64 ${length}, ${more}`);
      length = sum;
    }
    return length;
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
    const held = unwraps(object) ? coercions.get(object)! : unfold(referent(types.get(object)!));
    return upcast(receiver(object, target.body.self?.owned), held as ClassType, target.body.owner!);
  }

  // Calls a function with its arguments' values, after the instance when it is a method.
  // `after` runs once the call returns, and before an error it raises goes on.
  // `after` runs once the call is over, however it ended; `unwound` only when it panicked.
  function invoke(target: Instance, pointer: string | undefined, args: string[], at?: Expr, after?: () => void, unwound?: () => void): string | undefined {
    const cleanup = after || unwound ? () => (after?.(), unwound?.()) : undefined;
    const type = target.returns;
    if (target.body.rust) return rustInvoke(target, pointer, args, at!, cleanup, after);
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

  // A call of a Rust function's shim: the handle a method works on, read from where it is held,
  // then each argument as it crosses, owned strings and arrays given up once Rust has made its
  // own of them; what it gives made into a Fish value; and a panic in it raised at the call.
  function rustInvoke(target: Instance, pointer: string | undefined, args: string[], at: Expr, cleanup?: () => void, after?: () => void): string | undefined {
    const load = (type: string, from: string) => {
      const v = temp();
      emit(`${v} = load ${type}, ptr ${from}`);
      return v;
    };
    const part = (whole: string, i: number) => {
      const v = temp();
      emit(`${v} = extractvalue ${ARRAY} ${whole}, ${i}`);
      return v;
    };
    const passed: string[] = [];
    const given: (() => void)[] = [];
    if (pointer && target.body.self && !target.body.self.constructor) {
      passed.push(`ptr ${load("ptr", pointer)}`);
      // A method taking its object over leaves the place it was in empty, as one in Fish does.
      if (target.body.self.owned) emit(`store ptr null, ptr ${pointer}`);
    }
    // An owned array is given up once Rust has its elements: Rust has made its own strings and
    // numbers, and taken the Rust values, which leave only the buffer.
    const giveUp = (v: string, c: Extract<Crossing, { kind: "array" }>, t: Type) => {
      if (c.element.kind !== "handle") return dispose(v, t);
      const emptied = temp();
      emit(`${emptied} = insertvalue ${ARRAY} ${v}, i64 0, 1`);
      dispose(emptied, t);
    };
    const pass = (c: Crossing, t: Type, v: string): string[] => {
      switch (c.kind) {
        case "plain":
          return [`${crossing(t)} ${v}`];
        case "handle":
          return [`ptr ${v}`];
        case "string":
          given.push(() => dispose(v, t));
          return [`ptr ${v}`];
        case "lent":
          return [`ptr ${load("ptr", v)}`];
        case "array": {
          const whole = c.lent ? load(ARRAY, v) : v;
          if (!c.lent) given.push(() => giveUp(v, c, t));
          return [`ptr ${part(whole, 0)}`, `i64 ${part(whole, 1)}`];
        }
        case "option": {
          const none = holds(v, t as UnionType, ["null"]);
          const inner = convert(v, t, c.inner);
          if (c.of.kind === "string") given.push(() => dispose(v, t));
          if (c.of.kind === "array" && !c.of.lent) {
            const array = c.of;
            given.push(() => {
              const [some, done] = [label(), label()];
              emit(`br i1 ${none}, label %${done}, label %${some}`);
              startBlock(some);
              giveUp(inner, array, c.inner);
              emit(`br label %${done}`);
              startBlock(done);
            });
          }
          if (c.of.kind === "plain" || c.of.kind === "array") {
            const some = temp();
            emit(`${some} = xor i1 ${none}, true`);
            return [`i1 zeroext ${some}`, ...pass(c.of.kind === "array" ? { ...c.of, lent: true } : c.of, c.inner, c.of.kind === "array" ? spilled(inner) : inner)];
          }
          const p = temp();
          emit(`${p} = select i1 ${none}, ptr null, ptr ${inner}`);
          return [`ptr ${p}`];
        }
      }
    };
    // An Option's array is read where it is spilled, as a lent one is.
    const spilled = (v: string) => {
      const slot = alloca(ARRAY);
      emit(`store ${ARRAY} ${v}, ptr ${slot}`);
      return slot;
    };
    args.forEach((a, i) => passed.push(...pass(rustCrossing(target.signature![i]!), target.signature![i]!, a.slice(a.lastIndexOf(" ") + 1))));
    const gives = rustGiven(target);
    const shim = shimGives(gives);
    const out = shim.out ? alloca(shim.out) : undefined;
    if (out) passed.push(`ptr ${out}`);
    const err = target.throws ? alloca("ptr") : undefined;
    if (err) {
      emit(`store ptr null, ptr ${err}`);
      passed.push(`ptr ${err}`);
    }
    const caught = alloca("ptr");
    emit(`store ptr null, ptr ${caught}`);
    passed.push(`ptr ${caught}`);
    const call = `call ${shim.returns} ${symbol(target)}(${passed.join(", ")})`;
    const result = shim.returns === "void" ? undefined : temp();
    unwinding(call, result, cleanup);
    given.forEach((g) => g());
    rustPanic(caught, at);
    after?.();
    if (err) rustErr(err, target.throws!, at);
    if (!gives) return undefined;
    const type = target.body.self?.constructor ? target.body.owner! : target.returns;
    if (gives.kind !== "option") return gives.kind === "array" ? load(ARRAY, out!) : result;
    const some = gives.of.kind === "plain" || gives.of.kind === "array" ? result! : temp();
    if (some !== result) emit(`${some} = icmp ne ptr ${result}, null`);
    const inner = gives.of.kind === "plain" ? load(llvm(gives.inner), out!) : gives.of.kind === "array" ? load(ARRAY, out!) : result!;
    const made = temp();
    emit(`${made} = select i1 ${some}, ${llvm(type)} ${convert(inner, gives.inner, type)}, ${llvm(type)} ${convert("zeroinitializer", "null", type)}`);
    return made;
  }

  // A Rust `Err` the shim handed back, raised at the call: the Rust value itself, or Fish's
  // `Error` with the Rust error's text as its message.
  function rustErr(err: string, thrown: Type, at: Expr) {
    const [error, failed, bad, ok] = [temp(), temp(), label(), label()];
    emit(`${error} = load ptr, ptr ${err}`);
    emit(`${failed} = icmp ne ptr ${error}, null`);
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(bad);
    if (rustClassOf(thrown)) raised(at, error);
    else {
      const made = (thrown as ClassType).fields.reduce((whole, f, i) => {
        const v = f.name === "name" ? text("Error") : f.name === "message" ? error : f.name === "cause" ? convert("zeroinitializer", "null", f.type) : undefined;
        if (v === undefined) throw new Error(`internal error: Error has a field '${f.name}' a Rust error doesn't fill`);
        const next = temp();
        emit(`${next} = insertvalue ${llvm(thrown)} ${whole}, ${llvm(f.type)} ${v}, ${i}`);
        return next;
      }, "undef");
      raised(at, made);
    }
    startBlock(ok);
  }

  // A panic a Rust function's shim caught, raised as a Fish panic at the call.
  function rustPanic(caught: string, at: Expr) {
    const [message, failed, bad, ok] = [temp(), temp(), label(), label()];
    emit(`${message} = load ptr, ptr ${caught}`);
    emit(`${failed} = icmp ne ptr ${message}, null`);
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(bad);
    unwinding(`call void @fsh_rt_panic_rust(ptr ${panicAt(at)}, ptr ${message})`);
    emit("unreachable");
    startBlock(ok);
  }

  // The future an async function's poll, or an async generator's resume, answers as.
  function pollOf(i: Instance): FutureType {
    return i.future ?? leafFuture("next", i.generator!);
  }

  // What a generator gives back from a `yield` or its end: what `next()` gives, which an async
  // one's resume gives as ready.
  function yieldedAs(answer: string): string {
    return current.generator?.async ? polled(pollOf(current), 1, answer) : answer;
  }

  // The IR type a function returns: its value, or for a throwing one, whether it failed, then
  // its value (`{}` for none) and its error.
  function resultType(i: Instance): string {
    if (i.generator?.async) return pollType(pollOf(i));
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
    const field = current.frame!.awaits.get(e)!;
    const at = `%await${field}`;
    emit(`store ${llvm(inner)} ${owned(e.operand)}, ptr ${at}`);
    settle();
    scopes.at(-1)!.push({ slot: at, type: inner });
    return suspend(inner, at, field, e);
  }

  // Polls the future in frame field `field`, at `at`, until it is done, this future or async
  // generator pending meanwhile; then it is finished and dropped, and gives its value, or its
  // error is raised at `e`.
  function suspend(inner: FutureType | HandleType | DynType, at: string, field: number, e: Expr): string | undefined {
    // A boxed future polls as a future giving what its Promise does, and throws nothing.
    const shape = inner.kind === "dyn" ? handleType(promiseElement(inner.of)!, undefined) : inner;
    const g = resuming!;
    const poll = label();
    g.resumes.push(poll);
    const resumed = g.resumes.length;
    if (!awaitsOf.has(current)) awaitsOf.set(current, []);
    awaitsOf.get(current)!.push({ state: resumed, field, type: inner });
    emit(`br label %${poll}`);
    startBlock(poll);
    const step = pollStep(inner, at, e);
    startBlock(step.waiting);
    // `yieldNow` asks to be polled again at once, behind whatever else is waiting.
    if (inner === YIELD_NOW) emit("call void @fsh_rt_wake(ptr %cx)");
    emit(`store i32 ${resumed}, ptr %state`);
    emit(`ret ${resultType(current)} ${polled(pollOf(current), 0)}`);
    const finish = () => {
      const old = temp();
      emit(`${old} = load ${llvm(inner)}, ptr ${at}`);
      emit(`store ${llvm(inner)} zeroinitializer, ptr ${at}`);
      dispose(old, inner);
    };
    if (shape.throws) {
      startBlock(step.failed);
      const error = step.error();
      finish();
      raised(e, error);
    } else if (inner !== YIELD_NOW && inner !== SLEEP) {
      startBlock(step.failed);
      emit("unreachable");
    }
    startBlock(step.ready);
    const v = step.value();
    finish();
    return v;
  }

  // A combined future's poll: each future not yet done is polled in turn, and one done keeps its
  // value, its outcome for `allSettled`, or its error for `any`. `race` is done with the first to
  // settle, `any` with the first success or the last error, `all` with the last or the first
  // error, `allSettled` with the last; then the ones still waiting are cancelled where they wait,
  // and the awaiter's drop of this frame drops them.
  function combinePoll(t: FutureType): string {
    const known = combinePolls.get(t);
    if (known) return known;
    const name = `@fsh.combine.${stableId("combine", `${described(t)} ${combinedOf.get(t)!.at.start}`, t)}`;
    combinePolls.set(t, name);
    const { kind, futures, at, array } = combinedOf.get(t)!;
    if (array) return combineArray(t, name, kind, array, at as Expr);
    const saved = { allocas, body, temps, labels, block, pending, scopes };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const field = (i: number) => {
      const p = temp();
      emit(`${p} = getelementptr ${llvm(t)}, ptr %frame, i32 0, i32 ${i}`);
      return p;
    };
    const valueOf = (f: FutureType | HandleType | DynType): Type => {
      const gives = f.kind === "dyn" ? promiseElement(f.of)! : f.gives;
      return gives === "void" ? "null" : gives;
    };
    // What each future's slot keeps: its value, its outcome, or for `any` its error.
    const kept = (i: number) => t.frame[2 + 3 * i]!.type;
    const finishWith = (tag: number, v?: string, error?: string) => emit(`ret ${pollType(t)} ${polled(t, tag, v, error)}`);
    const finished = (at: string, f: Type) => {
      const old = temp();
      emit(`${old} = load ${llvm(f)}, ptr ${at}`);
      emit(`store ${llvm(f)} zeroinitializer, ptr ${at}`);
      dispose(old, f);
    };
    const cancelOthers = (except: number) => futures.forEach((f, j) => {
      if (j !== except) whileWaiting(field(3 + 3 * j), () => cancelAt(field(1 + 3 * j), f));
    });
    futures.forEach((f, i) => {
      const [futureAt, valueAt, doneAt] = [field(1 + 3 * i), field(2 + 3 * i), field(3 + 3 * i)];
      const [d, over, skip, go] = [temp(), temp(), label(), label()];
      const thrown = f.kind === "dyn" ? undefined : f.throws;
      const outcome = settledParts(valueOf(f), thrown);
      const keep = (v: string, from: Type) => emit(`store ${llvm(kept(i))} ${convert(v, from, kept(i))}, ptr ${valueAt}`);
      emit(`${d} = load i32, ptr ${doneAt}`);
      emit(`${over} = icmp eq i32 ${d}, 2`);
      emit(`br i1 ${over}, label %${skip}, label %${go}`);
      startBlock(go);
      emit(`store i32 1, ptr ${doneAt}`);
      const step = pollStep(f, futureAt, at as Expr);
      startBlock(step.waiting);
      // `yieldNow` asks to be polled again at once, behind whatever else is waiting.
      if (f === YIELD_NOW) emit("call void @fsh_rt_wake(ptr %cx)");
      emit(`br label %${skip}`);
      startBlock(step.ready);
      const v = step.value() ?? "zeroinitializer";
      finished(futureAt, f);
      emit(`store i32 2, ptr ${doneAt}`);
      if (kind === "race" || kind === "any") {
        cancelOthers(i);
        finishWith(1, convert(v, valueOf(f), t.gives));
      } else {
        if (kind === "allSettled") keep(objectOf(outcome.fulfilled, { value: v }), outcome.fulfilled);
        else keep(v, valueOf(f));
        emit(`br label %${skip}`);
      }
      startBlock(step.failed);
      if (thrown) {
        const error = step.error();
        finished(futureAt, f);
        emit(`store i32 2, ptr ${doneAt}`);
        if (kind === "all" || kind === "race") {
          cancelOthers(i);
          finishWith(2, undefined, convert(error, thrown, t.throws!));
        } else {
          // An outcome, or for `any` an error kept for its AggregateError.
          if (kind === "allSettled") keep(objectOf(outcome.rejected!, { reason: error }), outcome.rejected!);
          else keep(error, thrown);
          emit(`br label %${skip}`);
        }
      } else emit("unreachable");
      startBlock(skip);
    });
    if (kind === "race") finishWith(0);
    else {
      let all = "true";
      futures.forEach((_, i) => {
        const [d, over, both] = [temp(), temp(), temp()];
        emit(`${d} = load i32, ptr ${field(3 + 3 * i)}`);
        emit(`${over} = icmp eq i32 ${d}, 2`);
        emit(`${both} = and i1 ${all}, ${over}`);
        all = both;
      });
      const [waiting, ready] = [label(), label()];
      emit(`br i1 ${all}, label %${ready}, label %${waiting}`);
      startBlock(waiting);
      finishWith(0);
      startBlock(ready);
      // What the slots keep moves out of the frame: into the tuple, or, for an `any` every one of
      // whose futures failed, into its AggregateError.
      const moved = futures.map((_, i) => {
        const [valueAt, v] = [field(2 + 3 * i), temp()];
        emit(`${v} = load ${llvm(kept(i))}, ptr ${valueAt}`);
        emit(`store ${llvm(kept(i))} zeroinitializer, ptr ${valueAt}`);
        return v;
      });
      if (kind === "any") {
        if (!t.throws) emit("unreachable");
        else finishWith(2, undefined, aggregated(t.throws as ClassType, moved.map((v, i) => [v, kept(i)] as const)));
      } else {
        const tuple = t.gives as ObjectType;
        let made = "zeroinitializer";
        moved.forEach((v, i) => {
          const next = temp();
          emit(`${next} = insertvalue ${llvm(tuple)} ${made}, ${llvm(kept(i))} ${v}, ${fieldPath(tuple, String(i)).join(", ")}`);
          made = next;
        });
        finishWith(1, made);
      }
    }
    out.push(`define internal ${pollType(t)} ${name}(ptr %frame, ptr %cx) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    return name;
  }

  // `combinePoll` over an array of `Promise<T>` values. Its first poll makes the values array and
  // a flag per future, every one zero.
  function combineArray(t: FutureType, name: string, kind: "all" | "race" | "allSettled" | "any", array: ArrayType, at: Expr): string {
    const saved = { allocas, body, temps, labels, block, pending, scopes };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const dyn = array.element as DynType;
    const given = promiseElement(dyn.of)!;
    const value = given === "void" ? "null" : given;
    // What the values array keeps: each value, or for `allSettled` its outcome.
    const keptType = (t.frame[2]!.type as ArrayType).element;
    const element = llvm(keptType);
    const field = (i: number) => {
      const p = temp();
      emit(`${p} = getelementptr ${llvm(t)}, ptr %frame, i32 0, i32 ${i}`);
      return p;
    };
    const [futuresAt, valuesAt, flagsAt] = [field(1), field(2), field(3)];
    const part = (at: string, i: number) => {
      const p = temp();
      emit(`${p} = getelementptr ${ARRAY}, ptr ${at}, i32 0, i32 ${i}`);
      return p;
    };
    const [futures, n] = [temp(), temp()];
    emit(`${futures} = load ptr, ptr ${part(futuresAt, 0)}`);
    emit(`${n} = load i64, ptr ${part(futuresAt, 1)}`);
    const [state, fresh, first, go] = [temp(), temp(), label(), label()];
    emit(`${state} = load i32, ptr %frame`);
    emit(`${fresh} = icmp eq i32 ${state}, 0`);
    emit(`br i1 ${fresh}, label %${first}, label %${go}`);
    startBlock(first);
    emit("store i32 1, ptr %frame");
    const [bytes, values, flags] = [temp(), temp(), temp()];
    emit(`${bytes} = mul i64 ${n}, ${sizeOf(element)}`);
    emit(`${values} = call ptr @fsh_rt_array_zeroed(i64 ${bytes})`);
    emit(`${flags} = call ptr @fsh_rt_array_zeroed(i64 ${n})`);
    for (const [slot, data] of [[valuesAt, values], [flagsAt, flags]] as const) {
      emit(`store ptr ${data}, ptr ${part(slot, 0)}`);
      emit(`store i64 ${n}, ptr ${part(slot, 1)}`);
      emit(`store i64 ${n}, ptr ${part(slot, 2)}`);
    }
    emit(`br label %${go}`);
    startBlock(go);
    const [valuesData, flagsData] = [temp(), temp()];
    emit(`${valuesData} = load ptr, ptr ${part(valuesAt, 0)}`);
    emit(`${flagsData} = load ptr, ptr ${part(flagsAt, 0)}`);
    const finishWith = (tag: number, v?: string, error?: string) => emit(`ret ${pollType(t)} ${polled(t, tag, v, error)}`);
    // Each index below `n`, in a loop of its own.
    const each = (body: (i: string, next: string) => void) => {
      const index = alloca("i64");
      emit(`store i64 0, ptr ${index}`);
      const [head, loop, next, done] = [label(), label(), label(), label()];
      emit(`br label %${head}`);
      startBlock(head);
      const [i, more] = [temp(), temp()];
      emit(`${i} = load i64, ptr ${index}`);
      emit(`${more} = icmp slt i64 ${i}, ${n}`);
      emit(`br i1 ${more}, label %${loop}, label %${done}`);
      startBlock(loop);
      body(i, next);
      startBlock(next);
      const step = temp();
      emit(`${step} = add i64 ${i}, 1`);
      emit(`store i64 ${step}, ptr ${index}`);
      emit(`br label %${head}`);
      startBlock(done);
    };
    const flagOf = (i: string) => {
      const [p, f] = [temp(), temp()];
      emit(`${p} = getelementptr i8, ptr ${flagsData}, i64 ${i}`);
      emit(`${f} = load i8, ptr ${p}`);
      return [p, f] as const;
    };
    const futureOf_ = (i: string) => {
      const p = temp();
      emit(`${p} = getelementptr ${DYN}, ptr ${futures}, i64 ${i}`);
      return p;
    };
    const cancelOthers = (except: string) => each((j, next) => {
      const [, f] = flagOf(j);
      const [waiting, other, both, yes] = [temp(), temp(), temp(), label()];
      emit(`${waiting} = icmp eq i8 ${f}, 1`);
      emit(`${other} = icmp ne i64 ${j}, ${except}`);
      emit(`${both} = and i1 ${waiting}, ${other}`);
      emit(`br i1 ${both}, label %${yes}, label %${next}`);
      startBlock(yes);
      cancelAt(futureOf_(j), dyn);
      emit(`br label %${next}`);
    });
    each((i, next) => {
      const [flagAt, f] = flagOf(i);
      const [over, poll] = [temp(), label()];
      emit(`${over} = icmp eq i8 ${f}, 2`);
      emit(`br i1 ${over}, label %${next}, label %${poll}`);
      startBlock(poll);
      emit(`store i8 1, ptr ${flagAt}`);
      const slot = futureOf_(i);
      const step = pollStep(dyn, slot, at);
      startBlock(step.waiting);
      emit(`br label %${next}`);
      startBlock(step.ready);
      const v = step.value() ?? "zeroinitializer";
      const old = temp();
      emit(`${old} = load ${DYN}, ptr ${slot}`);
      emit(`store ${DYN} zeroinitializer, ptr ${slot}`);
      dispose(old, dyn);
      emit(`store i8 2, ptr ${flagAt}`);
      if (kind === "race" || kind === "any") {
        cancelOthers(i);
        finishWith(1, v);
      } else {
        const p = temp();
        const outcome = settledParts(value, undefined).fulfilled;
        emit(`${p} = getelementptr ${element}, ptr ${valuesData}, i64 ${i}`);
        emit(`store ${element} ${kind === "allSettled" ? objectOf(outcome, { value: v }) : v}, ptr ${p}`);
        emit(`br label %${next}`);
      }
      startBlock(step.failed);
      emit("unreachable");
    });
    // A boxed future can't fail, so an `any` fails only over an empty array, as JavaScript rejects.
    if (kind === "race") finishWith(0);
    else if (kind === "any") {
      const [empty, none, waiting] = [temp(), label(), label()];
      emit(`${empty} = icmp eq i64 ${n}, 0`);
      emit(`br i1 ${empty}, label %${none}, label %${waiting}`);
      startBlock(none);
      finishWith(2, undefined, aggregateOf(t.throws as ClassType, "null", "0"));
      startBlock(waiting);
      finishWith(0);
    } else {
      const count = alloca("i64");
      emit(`store i64 0, ptr ${count}`);
      each((i, next) => {
        const [, f] = flagOf(i);
        const [over, c, added] = [temp(), temp(), temp()];
        emit(`${over} = icmp eq i8 ${f}, 2`);
        emit(`${c} = load i64, ptr ${count}`);
        emit(`${added} = add i64 ${c}, 1`);
        const [yes] = [label()];
        emit(`br i1 ${over}, label %${yes}, label %${next}`);
        startBlock(yes);
        emit(`store i64 ${added}, ptr ${count}`);
        emit(`br label %${next}`);
      });
      const [c, all, ready, waiting] = [temp(), temp(), label(), label()];
      emit(`${c} = load i64, ptr ${count}`);
      emit(`${all} = icmp eq i64 ${c}, ${n}`);
      emit(`br i1 ${all}, label %${ready}, label %${waiting}`);
      startBlock(waiting);
      finishWith(0);
      startBlock(ready);
      // The values move out of the frame.
      const v = temp();
      emit(`${v} = load ${ARRAY}, ptr ${valuesAt}`);
      emit(`store ${ARRAY} zeroinitializer, ptr ${valuesAt}`);
      finishWith(1, v);
    }
    out.push(`define internal ${pollType(t)} ${name}(ptr %frame, ptr %cx) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block, pending, scopes } = saved);
    return name;
  }

  // An object of `type` with the given fields, the rest, as a literal's, empty.
  function objectOf(type: ObjectType, given: Record<string, string>): string {
    let made = "zeroinitializer";
    for (const [name, v] of Object.entries(given)) {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(type)} ${made}, ${llvm(field(type, name)!.type)} ${v}, ${fieldPath(type, name).join(", ")}`);
      made = next;
    }
    return made;
  }

  // An `any`'s AggregateError: JavaScript's message, and each error in the list's order.
  function aggregated(type: ClassType, errors: (readonly [string, Type])[]): string {
    const list = field(type, "errors")!.type as ArrayType;
    const element = llvm(list.element);
    const [bytes, data] = [temp(), temp()];
    emit(`${bytes} = mul i64 ${errors.length}, ${sizeOf(element)}`);
    emit(`${data} = call ptr @fsh_rt_array_alloc(i64 ${bytes})`);
    errors.forEach(([v, from], i) => {
      const at = temp();
      emit(`${at} = getelementptr ${element}, ptr ${data}, i64 ${i}`);
      emit(`store ${element} ${convert(v, from, list.element)}, ptr ${at}`);
    });
    return aggregateOf(type, data, String(errors.length));
  }

  function aggregateOf(type: ClassType, data: string, n: string): string {
    const [a, b, c, made, done] = [temp(), temp(), temp(), temp(), temp()];
    emit(`${a} = insertvalue ${ARRAY} undef, ptr ${data}, 0`);
    emit(`${b} = insertvalue ${ARRAY} ${a}, i64 ${n}, 1`);
    emit(`${c} = insertvalue ${ARRAY} ${b}, i64 ${n}, 2`);
    emit(`${made} = insertvalue ${llvm(type)} zeroinitializer, ${ARRAY} ${c}, ${fieldPath(type, "errors").join(", ")}`);
    const [named] = [temp()];
    emit(`${done} = insertvalue ${llvm(type)} ${made}, ptr ${text("All promises were rejected")}, ${fieldPath(type, "message").join(", ")}`);
    emit(`${named} = insertvalue ${llvm(type)} ${done}, ptr ${text("AggregateError")}, ${fieldPath(type, "name").join(", ")}`);
    return named;
  }

  // `then` where a combined future's flag at `doneAt` says its future is waiting.
  function whileWaiting(doneAt: string, then: () => void) {
    const [d, waiting, yes, after] = [temp(), temp(), label(), label()];
    emit(`${d} = load i32, ptr ${doneAt}`);
    emit(`${waiting} = icmp eq i32 ${d}, 1`);
    emit(`br i1 ${waiting}, label %${yes}, label %${after}`);
    startBlock(yes);
    then();
    emit(`br label %${after}`);
    startBlock(after);
  }

  // Cancels the future of type `t` at `at`, paused where it waits: it leaves the waiters of what
  // it waits on, as an abort does, passing on a wake it was given, so nothing it waited on wakes
  // the task for it or loses a wake meant for another. Its drop comes after.
  function cancelAt(at: string, t: Type) {
    // A boxed future through its vtable: the slot after its poll.
    if (typeof t !== "string" && t.kind === "dyn" && promiseElement(t.of) !== undefined) {
      const [dyn, data, table, slot, fn] = [temp(), temp(), temp(), temp(), temp()];
      emit(`${dyn} = load ${DYN}, ptr ${at}`);
      emit(`${data} = extractvalue ${DYN} ${dyn}, 0`);
      emit(`${table} = extractvalue ${DYN} ${dyn}, 1`);
      emit(`${slot} = getelementptr ptr, ptr ${table}, i64 4`);
      emit(`${fn} = load ptr, ptr ${slot}`);
      emit(`call void ${fn}(ptr ${data}, ptr %cx)`);
      return;
    }
    if (typeof t === "string" || t.kind !== "future" || t === YIELD_NOW) return;
    const frame = t.frame;
    const load = (i: number, of: string) => {
      const [p, v] = [temp(), temp()];
      emit(`${p} = getelementptr ${llvm(t)}, ptr ${at}, i32 0, i32 ${i}`);
      emit(`${v} = load ${of}, ptr ${p}`);
      return [p, v] as const;
    };
    const leaf = leafOf.get(t);
    if (t === SLEEP || leaf?.method === "sleep") emit(`call void @fsh_rt_sleep_cancel(ptr %cx, ptr ${at})`);
    else if (leaf?.method === "acquire") emit(`call void @fsh_rt_semaphore_leave(ptr ${load(1, "ptr")[1]}, ptr %cx, ptr ${at})`);
    else if (leaf?.method === "send" || leaf?.method === "receive") emit(`call void @fsh_rt_channel_leave(ptr ${load(1, "ptr")[1]}, ptr %cx, ptr ${at})`);
    else if (leaf && ["connect", "accept", "read", "write"].includes(leaf.method)) emit(`call void @fsh_rt_socket_leave(ptr ${load(1, "ptr")[1]}, ptr %cx)`);
    else if (leaf?.method === "next") {
      const instance = generatorOf.get(leaf.of as GeneratorType)!;
      cancelled.add(instance);
      emit(`call void ${cancelSymbol(instance)}(ptr ${load(1, "ptr")[1]}, ptr %cx)`);
    }
    if (leaf?.signal) {
      const [flag] = load(frame.length - 1, "i32");
      emit(`call void @fsh_rt_signal_leave(ptr ${load(frame.length - 2, "ptr")[1]}, ptr ${flag}, ptr %cx)`);
    }
    if (leaf || t === SLEEP) return;
    const combined = combinedOf.get(t);
    if (combined?.array) {
      combinedArrayCancel(at, t, combined.array);
      return;
    }
    if (combined) {
      combined.futures.forEach((f, j) => {
        const [doneAt, futureAt] = [temp(), temp()];
        emit(`${doneAt} = getelementptr ${llvm(t)}, ptr ${at}, i32 0, i32 ${3 + 3 * j}`);
        emit(`${futureAt} = getelementptr ${llvm(t)}, ptr ${at}, i32 0, i32 ${1 + 3 * j}`);
        whileWaiting(doneAt, () => cancelAt(futureAt, f));
      });
      return;
    }
    const instance = futureOf.get(t);
    if (!instance) return;
    cancelled.add(instance);
    emit(`call void ${cancelSymbol(instance)}(ptr ${at}, ptr %cx)`);
  }

  // A combined future over an array cancels each future its flags say is waiting.
  function combinedArrayCancel(at: string, t: FutureType, array: ArrayType) {
    const field = (i: number, j: number, of: string) => {
      const [p, q, v] = [temp(), temp(), temp()];
      emit(`${p} = getelementptr ${llvm(t)}, ptr ${at}, i32 0, i32 ${i}`);
      emit(`${q} = getelementptr ${ARRAY}, ptr ${p}, i32 0, i32 ${j}`);
      emit(`${v} = load ${of}, ptr ${q}`);
      return v;
    };
    const [futures, flags, n] = [field(1, 0, "ptr"), field(3, 0, "ptr"), field(3, 1, "i64")];
    const index = alloca("i64");
    emit(`store i64 0, ptr ${index}`);
    const [head, loop, yes, next, done] = [label(), label(), label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const [i, more] = [temp(), temp()];
    emit(`${i} = load i64, ptr ${index}`);
    emit(`${more} = icmp slt i64 ${i}, ${n}`);
    emit(`br i1 ${more}, label %${loop}, label %${done}`);
    startBlock(loop);
    const [flagAt, f, waiting] = [temp(), temp(), temp()];
    emit(`${flagAt} = getelementptr i8, ptr ${flags}, i64 ${i}`);
    emit(`${f} = load i8, ptr ${flagAt}`);
    emit(`${waiting} = icmp eq i8 ${f}, 1`);
    emit(`br i1 ${waiting}, label %${yes}, label %${next}`);
    startBlock(yes);
    const slot = temp();
    emit(`${slot} = getelementptr ${DYN}, ptr ${futures}, i64 ${i}`);
    cancelAt(slot, array.element);
    emit(`br label %${next}`);
    startBlock(next);
    const step = temp();
    emit(`${step} = add i64 ${i}, 1`);
    emit(`store i64 ${step}, ptr ${index}`);
    emit(`br label %${head}`);
    startBlock(done);
  }

  function cancelSymbol(i: Instance): string {
    return symbol(i).replace(/^@"fsh\./, '@"fsh.cancel.');
  }

  // An async instance's cancel: the future it awaits in the state it is paused in is cancelled.
  function cancelFunction(i: Instance) {
    const saved = { allocas, body, temps, labels, block, pending, scopes };
    [allocas, body, temps, labels, block, pending, scopes] = [[], [], 0, 0, "entry", [], []];
    const awaits = awaitsOf.get(i) ?? [];
    const [state, done] = [temp(), label()];
    const cases = awaits.map(() => label());
    emit(`${state} = load i32, ptr %frame`);
    emit(`switch i32 ${state}, label %${done} [ ${awaits.map((a, n) => `i32 ${a.state}, label %${cases[n]}`).join(" ")} ]`);
    awaits.forEach((a, n) => {
      startBlock(cases[n]!);
      const p = temp();
      emit(`${p} = getelementptr ${llvm(i.future ?? i.generator!)}, ptr %frame, i32 0, i32 ${a.field}`);
      cancelAt(p, a.type);
      emit(`br label %${done}`);
    });
    startBlock(done);
    emit("ret void");
    out.push(`define internal void ${cancelSymbol(i)}(ptr %frame, ptr %cx) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
    ({ allocas, body, temps, labels, block, pending, scopes } = saved);
  }

  // One poll of the future in slot `at`: the blocks it goes on to, waiting, ready or failed,
  // and, called in those blocks, the value it gave and the error it threw. `e` places a panic.
  function pollStep(inner: FutureType | HandleType | DynType, at: string, e: Expr): { waiting: string; ready: string; failed: string; value: () => string | undefined; error: () => string } {
    const shape = inner.kind === "dyn" ? handleType(promiseElement(inner.of)!, undefined) : inner;
    const [result, tag, waiting, ready, failed] = [temp(), temp(), label(), label(), label()];
    const leaf = inner.kind === "future" ? leafOf.get(inner) : undefined;
    let given: string | undefined;
    // What is read only once it is ready, as reading it before would read nothing.
    let readied: (() => string | undefined) | undefined;
    let reason: string | undefined;
    // A joined task's panic reason, when it panicked.
    let why: string | undefined;
    // The poll result as the runtime gives it: a joined task's is its own, throwing no TaskPanic.
    const polledAs = inner.kind === "handle" && inner.joined ? inner.joined.base : shape;
    if (leaf?.method === "next") {
      // An async generator's `next()`: its resume, run where the generator lives.
      const [slot, generator] = [temp(), temp()];
      emit(`${slot} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 1`);
      emit(`${generator} = load ptr, ptr ${slot}`);
      const target = generatorOf.get(leaf.of as GeneratorType)!;
      unwinding(`call ${pollType(shape)} ${symbol(target)}(ptr ${generator}, ptr %cx)`, result);
      emit(`${tag} = extractvalue ${pollType(shape)} ${result}, 0`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} ]`);
    } else if (leaf) {
      // A semaphore's, channel's or socket's wait, or a sleep given a signal, polled by the
      // runtime, which wakes the task when it may go on. A send moves its value in, leaving its
      // slot empty.
      const [slot, handle, outcome] = [temp(), temp(), temp()];
      // The timer task's wait holds nothing but its state.
      if (leaf.method !== "timerNext") emit(`${slot} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 1`);
      if (leaf.method !== "sleep" && leaf.method !== "timerNext") emit(`${handle} = load ptr, ptr ${slot}`);
      // A socket's poll gives its result through `made`, and on failure the system's reason
      // through `reason`, for the IoError its awaiter is thrown; an abort leaves it null.
      const socket = ["bind", "connect", "accept", "read", "write"].includes(leaf.method);
      const file = leaf.method === "readFile" || leaf.method === "writeFile";
      if (socket || file) {
        reason = alloca("[4 x ptr]");
        emit(`store [4 x ptr] zeroinitializer, ptr ${reason}`);
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
        if (leaf.method === "acquire") emit(`call void @fsh_rt_semaphore_leave(ptr ${handle}, ptr %cx, ptr ${at})`);
        if (leaf.method === "send" || leaf.method === "receive") emit(`call void @fsh_rt_channel_leave(ptr ${handle}, ptr %cx, ptr ${at})`);
        if (leaf.method === "sleep") emit(`call void @fsh_rt_sleep_cancel(ptr %cx, ptr ${at})`);
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
      } else if (file) {
        // A file's job runs on the runtime's blocking pool, its frame the path, a write's bytes,
        // and the job once handed over.
        const reading = leaf.method === "readFile";
        const [made, jobAt] = [alloca(ARRAY), temp()];
        emit(`store ${ARRAY} zeroinitializer, ptr ${made}`);
        emit(`${jobAt} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 ${reading ? 2 : 3}`);
        let bytesAt = "null";
        if (!reading) {
          bytesAt = temp();
          emit(`${bytesAt} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        }
        emit(`${outcome} = call i32 @fsh_rt_file_poll(ptr ${handle}, ptr ${bytesAt}, ptr ${jobAt}, i32 ${reading ? 0 : 1}, ptr %cx, ptr ${made}, ptr ${reason})`);
        if (reading) {
          given = temp();
          emit(`${given} = load ${ARRAY}, ptr ${made}`);
        }
      } else if (leaf.method === "timerNext") {
        // The next timer's callable, or none once the program is done with timers.
        // Ended with nothing, it is ready all the same.
        const [made, raw, dyn, option, got, nothing] = [alloca("[2 x ptr]"), temp(), temp(), temp(), temp(), temp()];
        emit(`${raw} = call i32 @fsh_rt_timeout_next(ptr %cx, ptr ${made})`);
        emit(`${dyn} = load ${DYN}, ptr ${made}`);
        emit(`${got} = icmp eq i32 ${raw}, 1`);
        emit(`${nothing} = icmp eq i32 ${raw}, 2`);
        emit(`${option} = select i1 ${got}, ${llvm(shape.gives)} ${convert(dyn, leaf.of, shape.gives)}, ${llvm(shape.gives)} ${convert("zeroinitializer", "null", shape.gives)}`);
        given = option;
        emit(`${outcome} = select i1 ${nothing}, i32 1, i32 ${raw}`);
      } else if (leaf.method === "jsAwait") {
        // A JS promise: what it settled with, read as its declaration says once it fulfilled,
        // or what it rejected with, for the JsError its awaiter is thrown.
        const [waitingAt, made] = [temp(), alloca("ptr")];
        emit(`${waitingAt} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        emit(`${outcome} = call i32 @fsh_rt_js_await(ptr ${handle}, ptr ${waitingAt}, ptr %cx, ptr ${made})`);
        reason = made;
        readied = () => {
          const box = temp();
          emit(`${box} = load ptr, ptr ${made}`);
          if (leaf.of !== "void") return fromJs(box, leaf.of, "the awaited promise fulfilled with", e);
          emit(`call void @fsh_rt_js_release(ptr ${box})`);
          return undefined;
        };
      } else if (leaf.method === "sleep") {
        emit(`${outcome} = call i32 @fsh_rt_sleep(ptr ${at}, ptr %cx)`);
      } else if (leaf.method === "acquire") {
        const [permit, made] = [alloca("ptr"), temp()];
        emit(`${outcome} = call i32 @fsh_rt_semaphore_acquire(ptr ${handle}, ptr %cx, ptr ${permit}, ptr ${at})`);
        emit(`${made} = load ptr, ptr ${permit}`);
        given = made;
      } else if (leaf.method === "send") {
        const [moving, closed] = [temp(), temp()];
        emit(`${moving} = getelementptr ${llvm(inner)}, ptr ${at}, i32 0, i32 2`);
        emit(`${outcome} = call i32 @fsh_rt_channel_send(ptr ${handle}, ptr ${moving}, ptr %cx, ptr ${at})`);
        emit(`${closed} = icmp eq i32 ${outcome}, 3`);
        panicIf(closed, "send on a closed channel", e);
      } else {
        const buffer = alloca(llvm(leaf.of));
        emit(`${outcome} = call i32 @fsh_rt_channel_receive(ptr ${handle}, ptr ${buffer}, ptr %cx, ptr ${at})`);
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
      // Awaited plainly, a task that panicked panics its awaiter; joined, it fails with its reason.
      const base = inner.joined?.base ?? inner;
      const [buffer, task, outcome] = [alloca(pollType(base)), temp(), temp()];
      emit(`${task} = load ptr, ptr ${at}`);
      if (inner.joined) {
        why = alloca("ptr");
        emit(`${outcome} = call i32 @fsh_rt_join(ptr ${task}, ptr %cx, ptr ${buffer}, ptr null, ptr ${why})`);
      } else unwinding(`call i32 @fsh_rt_join(ptr ${task}, ptr %cx, ptr ${buffer}, ptr ${panicAt(e)}, ptr null)`, outcome);
      emit(`${result} = load ${pollType(base)}, ptr ${buffer}`);
      emit(`${tag} = trunc i32 ${outcome} to i8`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} i8 3, label %${failed} ]`);
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
      const fn = combinedOf.has(inner as FutureType) ? combinePoll(inner as FutureType) : symbol(futureOf.get(inner)!);
      unwinding(`call ${pollType(shape)} ${fn}(ptr ${at}, ptr %cx)`, result);
      emit(`${tag} = extractvalue ${pollType(shape)} ${result}, 0`);
      emit(`switch i8 ${tag}, label %${waiting} [ i8 1, label %${ready} i8 2, label %${failed} ]`);
    }
    const error = () => {
      const thrown = shape.throws!;
      let error = "";
      if (leaf?.method === "jsAwait") {
        error = jsError(reason!, thrown as ClassType);
      } else if (leaf && reason && !leaf.signal) {
        error = ioError(reason, thrown as ClassType);
      } else if (leaf && reason) {
        // Given a signal, it throws either: an AbortError when it was aborted, leaving no reason.
        const members = (thrown as UnionType).members as ClassType[];
        const [io, aborted] = [members.find((m) => m.name === "IoError")!, members.find((m) => m.name === "AbortError")!];
        const [text, none, ioAt, abortAt, join, made] = [temp(), temp(), label(), label(), label(), temp()];
        emit(`${text} = load ptr, ptr ${reason}`);
        emit(`${none} = icmp eq ptr ${text}, null`);
        emit(`br i1 ${none}, label %${abortAt}, label %${ioAt}`);
        startBlock(ioAt);
        const asIo = convert(ioError(reason, io), io, thrown);
        const fromIo = block;
        emit(`br label %${join}`);
        startBlock(abortAt);
        const asAbort = convert(abortError(aborted), aborted, thrown);
        const fromAbort = block;
        emit(`br label %${join}`);
        startBlock(join);
        emit(`${made} = phi ${llvm(thrown)} [ ${asIo}, %${fromIo} ], [ ${asAbort}, %${fromAbort} ]`);
        error = made;
      } else if (leaf) error = abortError(thrown);
      else if (why) error = joinError(why, tag, result, (inner as HandleType).joined!, thrown);
      else {
        error = temp();
        emit(`${error} = extractvalue ${pollType(shape)} ${result}, 2`);
      }
      return error;
    };
    const value = () => {
      let v: string | undefined = readied ? readied() : given;
      if (shape.gives !== "void" && (!leaf || leaf.method === "next")) {
        v = temp();
        emit(`${v} = extractvalue ${pollType(polledAs)} ${result}, 1`);
      }
      return v;
    };
    return { waiting, ready, failed, value, error };
  }

  // What a joined task's await throws: a TaskPanic holding the reason it panicked with, when its
  // outcome `tag` is 3, or else the error it threw itself.
  function joinError(why: string, tag: string, result: string, joined: { base: HandleType; panic: Type }, thrown: Type): string {
    const [base, panicked] = [joined.base, joined.panic as ClassType];
    const make = () => {
      const [reason, made] = [temp(), temp()];
      emit(`${reason} = load ptr, ptr ${why}`);
      emit(`${made} = insertvalue ${llvm(panicked)} zeroinitializer, ptr ${reason}, ${panicked.fields.findIndex((f) => f.name === "message")}`);
      return convert(made, panicked, thrown);
    };
    if (!base.throws) return make();
    const [isPanic, onPanic, onThrow, join, made] = [temp(), label(), label(), label(), temp()];
    emit(`${isPanic} = icmp eq i8 ${tag}, 3`);
    emit(`br i1 ${isPanic}, label %${onPanic}, label %${onThrow}`);
    startBlock(onPanic);
    const asPanic = make();
    const fromPanic = block;
    emit(`br label %${join}`);
    startBlock(onThrow);
    const own = temp();
    emit(`${own} = extractvalue ${pollType(base)} ${result}, 2`);
    const asOwn = convert(own, base.throws, thrown);
    const fromOwn = block;
    emit(`br label %${join}`);
    startBlock(join);
    emit(`${made} = phi ${llvm(thrown)} [ ${asPanic}, %${fromPanic} ], [ ${asOwn}, %${fromOwn} ]`);
    return made;
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
    // The runtime keeps the program's arguments for `process.argv`.
    if (!main.throws) return [`define i32 @main(i32 %argc, ptr %argv) ${unwinds} {`, "  call void @fsh_rt_args(i32 %argc, ptr %argv)", '  call void @"fsh.main"()', "  ret i32 0", "}"];
    current = main;
    ({ types, locals, calls, setters, coercions, jumps } = main);
    [allocas, body, temps, labels, block] = [[], [], 0, 0, "entry"];
    const type = resultType(main);
    const [result, failed, bad, ok, error] = [temp(), temp(), label(), label(), temp()];
    emit("call void @fsh_rt_args(i32 %argc, ptr %argv)");
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
    return [`define i32 @main(i32 %argc, ptr %argv) ${unwinds} {`, "entry:", ...allocas, ...body, "}"];
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
    emit("call void @fsh_rt_args(i32 %argc, ptr %argv)");
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
    return [`define i32 @main(i32 %argc, ptr %argv) ${unwinds} {`, "entry:", ...allocas, ...body, "}"];
  }

  // A JsError from the box of what JS threw at `thrown`: named, its message read from the value,
  // which it keeps.
  function jsError(thrown: string, error: ClassType): string {
    const [box, message] = [temp(), temp()];
    emit(`${box} = load ptr, ptr ${thrown}`);
    emit(`${message} = call ptr @fsh_rt_js_message(ptr ${box})`);
    let made = "zeroinitializer";
    const put = (name: string, v: string) => {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(error)} ${made}, ${llvm(field(error, name)!.type)} ${v}, ${fieldPath(error, name).join(", ")}`);
      made = next;
    };
    put("name", text("JsError"));
    put("message", message);
    put("cause", convert("zeroinitializer", "null", field(error, "cause")!.type));
    put("value", box);
    return made;
  }

  // An IoError from the parts the runtime gave at `parts`: its message, code, system call and
  // path, the path empty where the runtime gave none.
  function ioError(parts: string, io: ClassType): string {
    const part = (i: number) => {
      const [at, v] = [temp(), temp()];
      emit(`${at} = getelementptr [4 x ptr], ptr ${parts}, i32 0, i32 ${i}`);
      emit(`${v} = load ptr, ptr ${at}`);
      return v;
    };
    const [message, code, syscall, path] = [part(0), part(1), part(2), part(3)];
    // A part the runtime left out is an empty string, or for the path, no path.
    const orEmpty = (v: string) => {
      const [none, given] = [temp(), temp()];
      emit(`${none} = icmp eq ptr ${v}, null`);
      emit(`${given} = select i1 ${none}, ptr ${text("")}, ptr ${v}`);
      return given;
    };
    const option = io.fields.find((f) => f.name === "path")!.type;
    const [none, held] = [temp(), temp()];
    emit(`${none} = icmp eq ptr ${path}, null`);
    emit(`${held} = select i1 ${none}, ${llvm(option)} ${convert("zeroinitializer", "null", option)}, ${llvm(option)} ${convert(path, "string", option)}`);
    let made = "zeroinitializer";
    for (const [name, v] of [["message", orEmpty(message)], ["code", orEmpty(code)], ["syscall", orEmpty(syscall)], ["path", held]] as const) {
      const index = io.fields.findIndex((f) => f.name === name);
      const next = temp();
      emit(`${next} = insertvalue ${llvm(io)} ${made}, ${llvm(io.fields[index]!.type)} ${v}, ${index}`);
      made = next;
    }
    return made;
  }

  // The size of an LLVM type in bytes, as a constant.
  function sizeOf(type: string): string {
    return `ptrtoint (ptr getelementptr (${type}, ptr null, i32 1) to i64)`;
  }

  // What the runtime needs to run a future as a task, made once per future type: a poll that
  // writes the result into the task's output and says pending (0), ready (1), failed (2) or
  // panicked (3); a drop of the frame where it stopped; and a drop of the output it gave.
  function taskGlue(future: FutureType): [string, string, string] {
    const name = (kind: string) => `@"task.${kind}.${quoted(futureOf.get(future)!.symbol)}"`;
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
    // A reference already points where the receiver lives, or at the block it lives in.
    if (isRef(types.get(object)!)) return blockOf(evaluate(object), (types.get(object) as RefType).to);
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
    if (lendable(object)) return blockOf(address(object), stored(object));
    const type = llvm(types.get(object)!);
    const spilled = alloca(type);
    // A Rust handle made for the call moves into it, the call taking it over.
    if (owns && holdsRust(types.get(object)!)) {
      if (!fresh(object)) throw new Error("internal error: a Rust handle taken over by a method is read from a place nothing empties");
      emit(`store ${type} ${value(object, true)}, ptr ${spilled}`);
      return spilled;
    }
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
    // A value meeting a Dyn, or a recursive type, moves into its block; a temporary then drops
    // as what it became.
    if (to && boxes(type, to)) {
      const boxed = convert(result, type, to);
      if (!consume && fresh(e) && !known.has(e)) pending.push({ v: boxed, type: to });
      return boxed;
    }
    const dyn = boxedMembers.get(e) ?? (to && isDyn(to) ? to : undefined);
    if (to && dyn && !isDyn(type)) {
      const boxed = to === dyn ? box(result, type, dyn) : convert(box(result, type, dyn), dyn, to);
      if (!consume && fresh(e) && !known.has(e)) pending.push({ v: boxed, type: to });
      return boxed;
    }
    // A temporary taken out of a recursive type's block leaves the block to be freed.
    if (consume && to && !isRef(to) && unboxes(type, to) && fresh(e) && !known.has(e)) {
      const out = convert(result, type, to);
      freeBlocks(result, type);
      return out;
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
    if (lendable(e) && (stored(e) === to || unfold(stored(e)) === to)) return blockOf(address(e), stored(e));
    const slot = alloca(llvm(to));
    const made = evaluate(e);
    if (fresh(e)) pending.push({ v: made, type: types.get(e)! });
    emit(`store ${llvm(to)} ${convert(made, types.get(e)!, to)}, ptr ${slot}`);
    return slot;
  }

  // The calls an expression makes are made from its site, once its operands' own calls are done.
  function evaluate(e: Expr): string {
    const outer = site;
    site = e;
    const v = evaluated(e);
    site = outer;
    return v;
  }

  function evaluated(e: Expr): string {
    switch (e.kind) {
      case "int": {
        const type = types.get(e)!;
        return isFloat(type) ? floatConstant(Number(e.value), type) : String(e.value);
      }
      case "float":
        return floatConstant(e.value, types.get(e) as "f32" | "f64");
      case "regex":
        return regex(types.get(e) as RegexType);
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
          const held = (isRef(object) ? object.to : object) as ArrayType | FixedType;
          const v = temp();
          emit(`${v} = load ${llvm(held.element)}, ptr ${element(e)}`);
          return convert(v, held.element, types.get(e)!);
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
        // An overload's body narrows the implementation's value to the signature's return type.
        if ((e as Narrowing).narrows) {
          const [from, to] = [valueType(e.expr), types.get(e)!];
          const v = value(e.expr);
          if (from === to) return v;
          const kept = typeof to !== "string" && to.kind === "union" ? to.members : [to];
          const union = from as UnionType;
          panicIf(holds(v, union, union.members.filter((m) => !kept.includes(m))), "the implementation returned a value this overload signature doesn't declare", e);
          return convert(v, union, to);
        }
        // Through a reference, the Option it points to.
        const option = valueType(e.expr) as UnionType;
        const v = value(e.expr);
        // The checker's own unwraps, as of an iterator helper's count, say why they panic.
        panicIf(holds(v, option, ["null"]), (e as { reason?: string }).reason ?? "called `Option::unwrap()` on a `None` value", e);
        return convert(v, option, types.get(e)!);
      }
      case "ident": {
        // A top-level const: a scalar or string baked where it is read, an aggregate read through
        // a pointer to its global.
        const read = calls.get(e);
        if (read?.body.comptime === "const") return isRef(types.get(e)!) ? constantGlobal(read) : bake(comptimeBody(read), types.get(e)!);
        // A nested function used as a value is its closure, made here.
        const built = current.envs?.get(e);
        if (built) return environment(built.of, built.env);
        const exported = jsExports.get(e);
        if (exported) return fromJs(jsExport(exported, e), types.get(e)!, `'${exported.name}' from '${exported.module}' is`, e);
        // `undefined` is the empty value, unless a variable takes the name.
        if (!locals.has(e)) return "zeroinitializer";
        const local = resolved(e);
        const t = temp();
        emit(`${t} = load ${llvm(local.type)}, ptr ${slot(local)}`);
        if (current.copiesOut.has(e)) {
          // The box, through a reference and out of a union holding it.
          let [held, type] = [t, local.type];
          if (isRef(type)) {
            const through = temp();
            emit(`${through} = load ${llvm(type.to)}, ptr ${held}`);
            [held, type] = [through, type.to];
          }
          if (typeof type !== "string" && type.kind === "union") held = convert(held, type, type.members.find(isPlainJs)!);
          return jsRead(held, types.get(e)!);
        }
        // Where a check narrowed the variable, its value comes out of the union.
        return convert(t, local.type, types.get(e)!);
      }
      case "member":
        if (maths.has(e)) return floatConstant(MATH_CONSTANTS[e.name]!, "f64");
        const held = types.has(e.object) ? lower(valueType(e.object)) : undefined;
        if (typeof held !== "string" && held?.kind === "regex") {
          const t = held;
          if (e.name === "source") return text(t.source);
          if (e.name === "flags") return text([..."dgimsuvy"].filter((f) => t.flags.includes(f)).join(""));
          return t.flags.includes(REGEX_FLAGS[e.name]!) ? "1" : "0";
        }
        return unwraps(e.object) ? link(e, e.object, () => member(e))! : member(e);
      // A closure's value is each variable it holds, and a pointer to each it borrows, or to `this`.
      case "arrow": {
        const inner = calls.get(e)!;
        return environment(inner, [...inner.captures!.values()]);
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
        if (regexNews.has(e)) return regex(types.get(e) as RegexType);
        const made = jsNews.get(e);
        if (made) {
          const c = jsExport(made, e);
          const args = e.args ?? [];
          const [argv, box] = [jsArgv(args, optionalAt(e)), temp()];
          unwinding(`call ptr @fsh_rt_js_new(ptr ${c}, i64 ${args.length}, ptr ${argv}, ptr ${panicAt(e)})`, box);
          return fromJs(box, types.get(e)!, `'new ${made.name}' from '${made.module}' gave`, e);
        }
        if ((types.get(e) as Exclude<Type, string>).kind === "interior") return interiorNew(e, types.get(e) as InteriorType);
        if ((types.get(e) as Exclude<Type, string>).kind === "block") return blockNew(e, types.get(e) as BlockType);
        if ((types.get(e) as Exclude<Type, string>).kind === "map") return mapNew(types.get(e) as MapType, e.args?.[0]);
        // A Rust type's constructor gives the handle to the value it boxed.
        if (calls.get(e)!.body.rust) return invoke(calls.get(e)!, undefined, argValues(e.args ?? [], calls.get(e)!), e)!;
        // The constructor fills in a slot, which then holds the new instance. The slot starts
        // empty, so a field's first assignment has nothing to drop.
        const type = types.get(e) as ClassType;
        const instance = alloca(llvm(type));
        emit(`store ${llvm(type)} zeroinitializer, ptr ${instance}`);
        // A panic in the constructor drops the fields it has set. One that throws has set none.
        invoke(calls.get(e)!, instance, argValues(e.args ?? [], calls.get(e)!), e, undefined, () => dispose(unstash(instance, type), type));
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
        if (e.op === "??" && !isOption(lower(valueType(e.left)))) return owned(e.left);
        if (e.op === "??") return orElse(e);
        if (e.op === "+" && types.get(e) === "string") return concat(written(operand(e.left, [e.right]), valueType(e.left)), written(value(e.right), valueType(e.right)));
        const empty = jsEmptyTests.get(e);
        if (empty) {
          const [found, same] = [temp(), temp()];
          let box = value(empty[0]);
          if (isRef(valueType(empty[0]))) {
            const loaded = temp();
            emit(`${loaded} = load ptr, ptr ${box}`);
            box = loaded;
          }
          emit(`${found} = call i32 @fsh_rt_js_typeof(ptr ${box}, ptr ${text(empty[1])})`);
          emit(`${same} = icmp ${e.op === "===" ? "ne" : "eq"} i32 ${found}, 0`);
          return same;
        }
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
        // Values holding objects, arrays or instances compare part by part.
        if (compound(type)) {
          const same = deepEquals(a, b, type);
          if (e.op === "===") return same;
          const differ = temp();
          emit(`${differ} = xor i1 ${same}, true`);
          return differ;
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
      // A quote is made only while compiling; one reached when the program runs panics.
      case "tagged": {
        unwinding(`call void @fsh_rt_panic(ptr ${cString(`panicked at ${where(e)}:\na quote builds syntax while compiling, so it can't run in the program\n`)})`);
        emit("unreachable");
        startBlock(label());
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
        put(p.name, shorthand(p, local), local.type);
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
    if (holdsRust(local.type)) return [p.name, convert(shorthand(p, local), local.type, to)];
    const result = temp();
    emit(`${result} = load ${llvm(local.type)}, ptr ${slot(local)}`);
    return [p.name, copied(convert(result, local.type, to), to)];
  }

  // A shorthand property's value: its variable's, copied, or for a Rust value, moved out of it, as
  // the property written out moves it.
  function shorthand(p: Extract<ObjectProp, { kind: "shorthand" }>, local: Local): string {
    const read = temp();
    emit(`${read} = load ${llvm(local.type)}, ptr ${slot(local)}`);
    if (!holdsRust(local.type)) return copied(read, local.type);
    if (!current.consumes.has(p)) throw new Error("internal error: a Rust value in a shorthand property isn't moved");
    emit(`store ${llvm(local.type)} zeroinitializer, ptr ${slot(local)}`);
    return read;
  }

  // Writes a value to a place, giving the assignment's value: what was written, or, for a setter,
  // which keeps what it is given, a copy of its own released when the statement ends.
  function store(target: Expr, result: string): string {
    const setter = setters.get(target);
    if (setter && target.kind === "member") {
      const type = types.get(target)!;
      // A Rust value goes to the setter alone: the checker refuses such an assignment's value.
      if (holdsRust(type)) {
        invoke(setter, thisPointer(setter, target.object), [`${llvm(type)} ${result}`]);
        return result;
      }
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
    // An element or a field kept in a recursive type's block takes the value into a new block.
    const place = placeType(target);
    replace(address(target), place, place !== type && boxes(type, place) ? convert(result, type, place) : result);
    return result;
  }

  // Writes a value into a place, dropping the one it held.
  function replace(at: string, type: Type, v: string) {
    const old = temp();
    if (needsDrop(type)) emit(`${old} = load ${llvm(type)}, ptr ${at}`);
    emit(`store ${llvm(type)} ${v}, ptr ${at}`);
    if (needsDrop(type)) dispose(old, type);
  }

  // Where a value of `want` lives inside a place holding a `whole`: a union narrowed to one
  // member keeps it in place as its payload, and one narrowed into a member that holds itself
  // keeps it in that member's block.
  function narrowedPlace(at: string, whole: Type, want: Type): string {
    if (whole === want || typeof whole === "string") return at;
    if (whole.kind === "recursive") {
      const block = temp();
      emit(`${block} = load ptr, ptr ${at}`);
      return narrowedPlace(block, whole.of, want);
    }
    if (whole.kind !== "union") return at;
    const payload = temp();
    emit(`${payload} = getelementptr ${llvm(whole)}, ptr ${at}, i32 0, i32 1`);
    if (whole.members.includes(want)) return payload;
    const holder = whole.members.find((m) => typeof m !== "string" && m.kind === "recursive" && typeof m.of !== "string" && m.of.kind === "union" && m.of.members.includes(want));
    return holder ? narrowedPlace(payload, holder, want) : payload;
  }

  // Where an assignment target lives: a variable's slot, or a field inside one.
  function address(target: Expr): string {
    if (target.kind === "this") return "%this";
    if (target.kind === "index") return element(target);
    if (target.kind !== "member") {
      const local = resolved(target);
      return narrowedPlace(slot(local), local.type, types.get(target)!);
    }
    if (typeof referent(types.get(target.object)!) !== "string" && (referent(types.get(target.object)!) as Exclude<Type, string>).kind === "shared") return sharedField(target)[2];
    const holder = stored(target.object);
    const object = unfold(referent(holder)) as ObjectType | ClassType;
    // Through a reference, the field is inside what it points to, and in a recursive type's
    // block, inside the block.
    let base = isRef(holder) ? evaluate(target.object) : address(target.object);
    if (typeof holder !== "string" && holder.kind === "recursive") {
      const block = temp();
      emit(`${block} = load ptr, ptr ${base}`);
      base = block;
    }
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
    // A JsValue read out of JS lives nowhere until the read makes it.
    if (current.copiesOut.has(e)) return false;
    const local = e.kind === "ident" ? locals.get(e) : undefined;
    const type = types.get(e);
    return local !== undefined && (type === local.type || typeof type === "string" || type?.kind !== "union");
  }

  // The type a place is stored as. Read through a type parameter's bound, a field may have a
  // wider type than the one it is stored with.
  function stored(e: Expr): Type {
    if (e.kind === "index" && indexes(valueType(e.object))) return placeType(e);
    if (e.kind !== "member" || calls.has(e)) return types.get(e)!;
    const holder = unfold(referent(stored(e.object)));
    // A shared value's field is stored in its block's value.
    const object = typeof holder !== "string" && holder.kind === "shared" ? holder.of : holder;
    return field(object as ObjectType | ClassType, e.name)!.type;
  }

  // The right side runs only when the left side does not already decide the result.
  // What the left Option holds, or the right side, run only when the left is empty.
  function orElse(e: Extract<Expr, { kind: "binary" }>): string {
    const option = valueType(e.left) as UnionType;
    const type = types.get(e)!;
    // A Rust value is moved out of the left side, which is left empty, never copied.
    const rust = holdsRust(option);
    const v = rust && fresh(e.left) ? value(e.left, true) : value(e.left);
    if (rust && !fresh(e.left)) {
      if (!current.consumes.has(e.left) || !lendable(e.left)) throw new Error("internal error: a Rust value on the left of '??' isn't moved");
      take(e.left);
    }
    const [some, none, end] = [label(), label(), label()];
    emit(`br i1 ${holds(v, option, ["null"])}, label %${none}, label %${some}`);
    startBlock(some);
    // The result is a value of its own, like a conditional's.
    const kept = rust ? convert(v, option, type) : copied(convert(v, option, type), type);
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
    // A regex comptime made is its flags and pattern, as the interpreter holds it.
    if (typeof type !== "string" && type.kind === "regex") {
      const held = untagged(tagged) as string;
      const slash = held.indexOf("/");
      const [flags, pattern] = [held.slice(0, slash), held.slice(slash + 1)];
      return regex(regexType(pattern, flags, parsePattern(pattern, flags).captures));
    }
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
        const element = type.element;
        const items = v.items.map((x) => `${t} ${typeof untagged(x) === "number" ? floatConstant(untagged(x) as number, element as "f32" | "f64") : String(untagged(x))}`);
        const contents = `[${n} x ${t}] [${items.join(", ")}]`;
        const table = `@.table.${stableId("table", contents)}`;
        if (!tables.has(table)) globals.push(`${table} = private unnamed_addr constant ${contents}`);
        tables.add(table);
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
  // `re.exec(s)`: the runtime writes each group's start and end, and the match is built from
  // slices of s, with null for a group that took no part.
  function regexExec(e: Extract<Expr, { kind: "call" }>): string {
    const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
    const regexT = lower(valueType(object)) as RegexType;
    const option = (types.get(e) ?? unionType([matchType(regexT), "null"])) as UnionType;
    const re = value(object);
    const result = execOf(regexT, option, re, value(e.args[0]!));
    if (!types.has(e)) pending.push({ v: result, type: option });
    return result;
  }

  // The first match of a regex in s, or null.
  function execOf(regexT: RegexType, option: UnionType, re: string, s: string): string {
    const match = option.members.find((m) => m !== "null") as ObjectType;
    const groups = regexT.captures.length + 1;
    const [out, found, yes] = [alloca(`[${groups * 2} x i64]`), temp(), temp()];
    emit(`${found} = call i32 @fsh_rt_regex_match(ptr ${re}, ptr ${s}, ptr ${out})`);
    emit(`${yes} = icmp ne i32 ${found}, 0`);
    const [made, none, done] = [label(), label(), label()];
    emit(`br i1 ${yes}, label %${made}, label %${none}`);
    startBlock(made);
    const some = convert(matchValue(regexT, match, s, out), match, option);
    const filled = block;
    emit(`br label %${done}`);
    startBlock(none);
    const nothing = convert("zeroinitializer", "null", option);
    emit(`br label %${done}`);
    startBlock(done);
    const result = temp();
    emit(`${result} = phi ${llvm(option)} [ ${some}, %${filled} ], [ ${nothing}, %${none} ]`);
    return result;
  }

  // A match built from the starts and ends the runtime wrote at `slots`: slices of s, with null
  // for a group that took no part.
  function matchValue(regexT: RegexType, match: ObjectType, s: string, slots: string): string {
    const at = (k: number) => {
      const [p, v] = [temp(), temp()];
      emit(`${p} = getelementptr i64, ptr ${slots}, i64 ${k}`);
      emit(`${v} = load i64, ptr ${p}`);
      return v;
    };
    // A group's text, or null when it took no part; one of a name's groups that took part.
    const capture = (indexes: number[], type: Type) => {
      if (type === "string") {
        const v = temp();
        emit(`${v} = call ptr @fsh_rt_str_slice(ptr ${s}, i64 ${at(indexes[0]! * 2)}, i64 ${at(indexes[0]! * 2 + 1)}, i32 2)`);
        return v;
      }
      let result = convert("zeroinitializer", "null", type);
      for (const i of indexes) {
        const start = at(i * 2);
        const [took, yes, next, from] = [temp(), label(), label(), block];
        emit(`${took} = icmp sge i64 ${start}, 0`);
        emit(`br i1 ${took}, label %${yes}, label %${next}`);
        startBlock(yes);
        const text = temp();
        emit(`${text} = call ptr @fsh_rt_str_slice(ptr ${s}, i64 ${start}, i64 ${at(i * 2 + 1)}, i32 2)`);
        const some = convert(text, "string", type);
        const filled = block;
        emit(`br label %${next}`);
        startBlock(next);
        const merged = temp();
        emit(`${merged} = phi ${llvm(type)} [ ${result}, %${from} ], [ ${some}, %${filled} ]`);
        result = merged;
      }
      return result;
    };
    let built = "undef";
    match.fields.forEach((f, i) => {
      let v: string;
      if (/^\d+$/.test(f.name)) v = capture([Number(f.name)], f.type);
      else if (f.name === "index") v = at(0);
      else if (f.name === "input") v = copied(s, "string");
      else {
        const named = f.type as ObjectType;
        let inner = "undef";
        named.fields.forEach((g, j) => {
          const indexes = regexT.captures.flatMap((c, k) => (c.name === g.name ? [k + 1] : []));
          const next = temp();
          emit(`${next} = insertvalue ${llvm(named)} ${inner}, ${llvm(g.type)} ${capture(indexes, g.type)}, ${j}`);
          inner = next;
        });
        v = inner;
      }
      const next = temp();
      emit(`${next} = insertvalue ${llvm(match)} ${built}, ${llvm(f.type)} ${v}, ${i}`);
      built = next;
    });
    return built;
  }

  // A string method given a regex: search, match, matchAll, split, replace and replaceAll.
  function regexString(e: Extract<Expr, { kind: "call" }>, name: string): string {
    const callee = e.callee as Extract<Expr, { kind: "member" }>;
    const regexT = lower(valueType(e.args[0]!)) as RegexType;
    const s = operand(callee.object, e.args);
    const re = value(e.args[0]!);
    // A call used as a statement has no type of its own; what it makes, from this instance's
    // regex, is dropped at its end.
    const type = types.get(e) ?? regexStringType(name, regexT, regexT.any === true);
    const call = (line: string) => {
      const v = temp();
      emit(`${v} = call ${line}`);
      return v;
    };
    let result: string;
    if (name === "search") result = call(`i64 @fsh_rt_regex_search(ptr ${re}, ptr ${s})`);
    else if (name === "match" && !regexT.flags.includes("g")) result = execOf(regexT, type as UnionType, re, s);
    else if (name === "match") {
      const out = alloca(ARRAY);
      const found = call(`i32 @fsh_rt_regex_match_all(ptr ${out}, ptr ${re}, ptr ${s})`);
      const [yes, list] = [temp(), temp()];
      emit(`${yes} = icmp ne i32 ${found}, 0`);
      emit(`${list} = load ${ARRAY}, ptr ${out}`);
      const v = temp();
      emit(`${v} = select i1 ${yes}, ${llvm(type)} ${convert(list, arrayType("string"), type)}, ${llvm(type)} ${convert("zeroinitializer", "null", type)}`);
      result = v;
    } else if (name === "split") {
      const out = alloca(ARRAY);
      const element = (type as ArrayType).element;
      const tagged = typeof element !== "string" && element.kind === "union";
      const tags = tagged ? [(element as UnionType).members.indexOf("null"), (element as UnionType).members.indexOf("string")] : [0, 0];
      const limit = e.args[1] ? value(e.args[1]) : "-1";
      emit(`call void @fsh_rt_regex_split(ptr ${out}, ptr ${re}, ptr ${s}, i64 ${limit}, i32 ${tagged ? 1 : 0}, i32 ${tags[0]}, i32 ${tags[1]})`);
      result = temp();
      emit(`${result} = load ${ARRAY}, ptr ${out}`);
    } else result = regexLoop(e, name, regexT, re, s, type);
    if (!types.has(e) && needsDrop(type)) pending.push({ v: result, type });
    return result;
  }

  // matchAll and replace, which go through the matches one at a time: matchAll builds each
  // into an array, replace puts what replaces each, from a pattern or a function, between the
  // text around them.
  function regexLoop(e: Extract<Expr, { kind: "call" }>, name: string, regexT: RegexType, re: string, s: string, type: Type): string {
    // A regex whose flags aren't known here says in its program whether it is global.
    const global = name === "matchAll" || regexT.flags.includes("g") ? 1 : regexT.any ? -1 : 0;
    const it = temp();
    emit(`${it} = call ptr @fsh_rt_regex_iter(ptr ${re}, ptr ${s}, i32 ${global})`);
    const given = e.args[1];
    const callback = given?.kind === "arrow" ? given : undefined;
    const closure = callback && (types.get(callback) as ClosureType);
    const env = callback ? alloca(llvm(closure!)) : "";
    if (callback) emit(`store ${llvm(closure!)} ${owned(callback)}, ptr ${env}`);
    const pattern = name.startsWith("replace") && !callback ? value(given!) : undefined;
    const list = name === "matchAll" ? alloca(ARRAY) : undefined;
    if (list) emit(`store ${ARRAY} zeroinitializer, ptr ${list}`);
    const [head, body, done] = [label(), label(), label()];
    emit(`br label %${head}`);
    startBlock(head);
    const more = temp();
    emit(`${more} = call i32 @fsh_rt_regex_next(ptr ${it})`);
    const yes = temp();
    emit(`${yes} = icmp ne i32 ${more}, 0`);
    emit(`br i1 ${yes}, label %${body}, label %${done}`);
    startBlock(body);
    const slots = temp();
    emit(`${slots} = call ptr @fsh_rt_regex_slots(ptr ${it})`);
    if (list) appended(list, (type as ArrayType).element, matchValue(regexT, (type as ArrayType).element as ObjectType, s, slots));
    else if (pattern) emit(`call void @fsh_rt_regex_put_pattern(ptr ${it}, ptr ${pattern})`);
    else {
      const target = calls.get(callback!)!;
      const match = matchType(regexT);
      const whole = matchValue(regexT, match, s, slots);
      const parts = elementsOf(match);
      const groups = field(match, "groups");
      const kept = groups ? alloca(llvm(groups.type)) : undefined;
      const passed = closure!.params.map((p, i) => {
        if (i < parts.length) {
          const part = temp();
          emit(`${part} = extractvalue ${llvm(match)} ${whole}, ${match.fields.findIndex((f) => f.name === String(i))}`);
          return `${llvm(p)} ${convert(copied(part, parts[i]!), parts[i]!, p)}`;
        }
        if (i === parts.length) {
          const index = temp();
          emit(`${index} = extractvalue ${llvm(match)} ${whole}, ${match.fields.findIndex((f) => f.name === "index")}`);
          return `i64 ${index}`;
        }
        if (i === parts.length + 1) return `ptr ${copied(s, "string")}`;
        const g = temp();
        emit(`${g} = extractvalue ${llvm(match)} ${whole}, ${match.fields.findIndex((f) => f.name === "groups")}`);
        emit(`store ${llvm(groups!.type)} ${g}, ptr ${kept}`);
        return `ptr ${kept}`;
      });
      // The match is read back from a slot in the landing pad: at -O0 a value carried in
      // registers into one may be lost.
      const stash = alloca(llvm(match));
      emit(`store ${llvm(match)} ${whole}, ptr ${stash}`);
      const unwound = () => {
        const held = temp();
        emit(`${held} = load ${llvm(match)}, ptr ${stash}`);
        dispose(held, match);
        emit(`call void @fsh_rt_regex_close(ptr ${it})`);
        if (needsDrop(closure!)) dispose(unstash(env, closure!), closure!);
      };
      const gives = invoke(target, env, passed.slice(0, target.body.params.length), e, undefined, unwound)!;
      const text = convert(gives, closure!.returns, "string");
      emit(`call void @fsh_rt_regex_put(ptr ${it}, ptr ${text})`);
      dispose(text, "string");
      dispose(whole, match);
    }
    emit(`br label %${head}`);
    startBlock(done);
    if (callback && needsDrop(closure!)) dispose(unstash(env, closure!), closure!);
    if (list) {
      emit(`call void @fsh_rt_regex_close(ptr ${it})`);
      const v = temp();
      emit(`${v} = load ${ARRAY}, ptr ${list}`);
      return v;
    }
    const made = temp();
    emit(`${made} = call ptr @fsh_rt_regex_finish(ptr ${it})`);
    return made;
  }

  // A regex is a pointer to its compiled program, one constant per pattern and flags.
  function regex(t: RegexType): string {
    const key = `${t.flags}/${t.pattern}`;
    const made = regexes.get(key);
    if (made) return made;
    const program = compileRegex(parsePattern(t.pattern, t.flags));
    const name = `@.regex.${stableId("regex", key)}`;
    globals.push(`${name} = private unnamed_addr constant [${program.length} x i32] [${program.map((w) => `i32 ${w | 0}`).join(", ")}]`);
    regexes.set(key, name);
    return name;
  }

  function text(value: string): string {
    const made = texts.get(value);
    if (made) return made;
    const bytes = wtf8(value);
    let lit = "";
    for (const b of bytes) {
      const plain = b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c;
      lit += plain ? String.fromCharCode(b) : "\\" + b.toString(16).padStart(2, "0").toUpperCase();
    }
    const name = `@.text.${stableId("text constant", lit, value)}`;
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
    // Keyed by its bytes, which two strings with lone surrogates may share.
    const made = cStrings.get(lit);
    if (made) return made;
    const name = `@.str.${stableId("str", lit)}`;
    cStrings.set(lit, name);
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
