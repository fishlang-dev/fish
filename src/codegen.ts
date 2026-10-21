import { selfOf, type Checked, type Instance, type Local, type Type } from "./check.ts";
import { isPrint } from "./values.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { lowering } from "./arithmetic.ts";
import { locate } from "./diag.ts";
import { print, RUNTIME, write } from "./runtime.ts";
import type { BinaryOp, Expr, ObjectProp, Param, Stmt } from "./parser.ts";
import { ARRAY, conversions, llvm } from "./layout.ts";
import { field, fieldPath, INTEGERS, isCopy, unionType, type ArrayType, isFloat, isInteger, isOption, type ClassType, type Integer, type Numeric, type ObjectType, type UnionType } from "./typing.ts";

const isRef = (t: Type) => typeof t !== "string" && t.kind === "ref";

const isArray = (t: Type): t is ArrayType => typeof t !== "string" && t.kind === "array";

// What a reference points to, or the type itself.
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
const symbol = (i: Instance) => `@"fsh.${i.symbol.replace(/["\\]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()}`)}"`;

export type Options = { src: string; file: string; release: boolean; panic: "unwind" | "abort" };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
export function codegen({ instances }: Checked, { src, file, release, panic }: Options): string {
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
  const handlers: { label: string; slot: string; depth: number }[] = [];
  // The `finally` regions enclosing the code being emitted, innermost last.
  const finallies: Region[] = [];
  // Where a `break` and a `continue` go for each statement they can name.
  const exits = new Map<Stmt, { exit: string; next?: string; depth: number }>();
  // Values the statement being emitted made and nothing took over, released when it ends.
  // Each keeps a slot it is stored in across a call that may panic, for its landing pad.
  let pending: { v: string; type: Type; slot?: string }[] = [];
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
  const builder = { emit, temp, label, startBlock, cString, alloca, text, mayPanic: (call: string) => unwinding(call) };
  const intrinsics = new Set<string>();
  const { operate, arithmetic, panicIf } = lowering(builder, src, file, release, intrinsics);
  const { convert, test, equals, unionField, holds } = conversions(builder);

  for (const instance of instances) {
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
    scopes = [[]];
    const type = instance.returns;
    // Parameters are copied into slots like any other binding.
    const params = f.params.map((p) => {
      const local = resolved(p);
      allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
      own(slot(local), local.type);
      emit(`store ${llvm(local.type)} %${local.name}.arg, ptr ${slot(local)}`);
      return `${llvm(local.type)} %${local.name}.arg`;
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
      emit(`${at} = getelementptr ${llvm(instance.closure!)}, ptr %env, i32 0, i32 ${i}`);
      if (!isRef(instance.closure!.fields[i]!.type)) return captured.set(alias, at);
      const pointer = from === "this" ? "%this" : temp();
      emit(`${pointer} = load ptr, ptr ${at}`);
      captured.set(alias, pointer);
    });
    if (f.closure) self = selfOf(f)?.type;
    f.body.forEach(statement);
    // The last block is unreachable when every path returned; the checker guarantees it for values.
    if (type === "void") leave(undefined);
    else emit("unreachable");
    out.push(`define ${resultType(instance)} ${symbol(instance)}(${params.join(", ")}) ${unwinds} {`, "entry:", ...allocas, ...body, "}", "");
  }
  const main = instances.find((i) => i.symbol === "main")!;
  // Built before the module is put together, since its message adds a global.
  const start = entry();

  return [
    ...globals,
    // The runtime reads which way a panic goes.
    `@fsh_panic_abort = constant i32 ${panic === "abort" ? 1 : 0}`,
    "",
    ...RUNTIME,
    ...intrinsics,
    "",
    ...out,
    ...start,
    "",
  ].join("\n");

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

  function slot(local: Local): string {
    return captured.get(local) ?? `%${local.name}.${local.id}`;
  }

  function resolved(node: Expr | Stmt | Param | ObjectProp): Local {
    const local = locals.get(node);
    if (!local) throw new Error("internal error: unresolved name");
    return local;
  }

  function statement(s: Stmt) {
    switch (s.kind) {
      case "expr":
        effect(s.expr);
        settle();
        return;
      case "block":
        scoped(s.body);
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
        const type = valueType(s.right) as ArrayType;
        const local = resolved(s.left as Stmt);
        scopes.push([]);
        let array: string;
        if (fresh(s.right)) {
          array = value(s.right, true);
          const held = alloca(ARRAY);
          own(held, type);
          emit(`store ${ARRAY} ${array}, ptr ${held}`);
        } else array = value(s.right);
        settle();
        const [data, length, counter] = [temp(), temp(), alloca("i64")];
        emit(`${data} = extractvalue ${ARRAY} ${array}, 0`);
        emit(`${length} = extractvalue ${ARRAY} ${array}, 1`);
        emit(`store i64 0, ptr ${counter}`);
        const [test, loop, next, end] = [label(), label(), label(), label()];
        emit(`br label %${test}`);
        startBlock(test);
        const [i, more] = [temp(), temp()];
        emit(`${i} = load i64, ptr ${counter}`);
        emit(`${more} = icmp ult i64 ${i}, ${length}`);
        emit(`br i1 ${more}, label %${loop}, label %${end}`);
        startBlock(loop);
        exits.set(s, { exit: end, next, depth: scopes.length });
        scopes.push([]);
        allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
        own(slot(local), local.type);
        const at = temp();
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
        const after = temp();
        emit(`${after} = add i64 ${i}, 1`);
        emit(`store i64 ${after}, ptr ${counter}`);
        emit(`br label %${test}`);
        startBlock(end);
        drop(scopes.length - 1);
        scopes.pop();
        return;
      }
      case "doWhile": {
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
        const held = [...pending];
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
          settle(held.length);
          const next = label();
          emit(`br i1 ${equal}, label %${enter(bodies[i]!)}, label %${next}`);
          startBlock(next);
        });
        const fallback = s.cases.findIndex((c) => !c.test);
        emit(`br label %${enter(fallback < 0 ? end : bodies[fallback]!)}`);
        pending = [];
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
        // An arrow's expression body may be a call returning nothing.
        if (s.value && current.returns === "void") {
          effect(s.value);
          settle();
          leave(undefined);
        } else {
          const v = s.value ? owned(s.value) : undefined;
          settle();
          leave(v);
        }
        // Anything after a return goes in a fresh block that nothing branches to.
        startBlock(label());
        return;
      case "throw":
        raised(s, owned(s.value));
        pending = [];
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
          const handler = { label: label(), slot: alloca(llvm(type)), depth: scopes.length };
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
            allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
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
        allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
        own(slot(local), local.type);
        emit(`store ${llvm(local.type)} ${owned(s.declarations[0]!.init!)}, ptr ${slot(local)}`);
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

  // An expression run for its effect, dropping any value it makes.
  function effect(e: Expr) {
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
    if (type === undefined || typeof type === "string") return false;
    if (type.kind === "union") return type.members.some(needsDrop);
    if (type.kind === "array") return true;
    return parts(type).some(([t]) => needsDrop(t));
  }

  // The parts of an aggregate value, each with its index: an instance's embedded base, then its
  // fields; an object's or a closure's fields.
  function parts(type: Exclude<Type, string>): [Type, number][] {
    if (type.kind !== "object" && type.kind !== "class" && type.kind !== "closure") return [];
    const base: [Type, number][] = type.kind === "class" && type.base ? [[type.base, 0]] : [];
    return [...base, ...type.fields.map((f, i): [Type, number] => [f.type, i + base.length])];
  }

  // A copy of a value, holding its own reference to each string in it.
  function copied(v: string, type: Type): string {
    if (!needsDrop(type)) return v;
    if (type === "string") {
      emit(`call void @fsh_rt_str_retain(ptr ${v})`);
      return v;
    }
    const result = temp();
    emit(`${result} = call ${llvm(type)} ${helper("copy", type as Exclude<Type, string>)}(${llvm(type)} ${v})`);
    return result;
  }

  // Gives up a value: releases a reference to everything it owns.
  function dispose(v: string, type: Type) {
    if (!needsDrop(type)) return;
    if (type === "string") return emit(`call void @fsh_rt_str_release(ptr ${v})`);
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
    const saved = { allocas, body, temps, labels, block };
    [allocas, body, temps, labels, block] = [[], [], 0, 0, "entry"];
    const t = llvm(type);
    const each = (v: string, part: Type) => (kind === "drop" ? (dispose(v, part), v) : copied(v, part));
    let result = "%v";
    if (type.kind === "array") {
      result = kind === "drop" ? dropArray(type) : copyArray(type);
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
        const part = each(convert("%v", type, m), m);
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
    ({ allocas, body, temps, labels, block } = saved);
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
    elements(type.element, data, length, (at, i) => {
      const [v, to] = [temp(), temp()];
      emit(`${v} = load ${t}, ptr ${at}`);
      emit(`${to} = getelementptr ${t}, ptr ${copy}, i64 ${i}`);
      emit(`store ${t} ${copied(v, type.element)}, ptr ${to}`);
    });
    return built(copy, length, length);
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
      const v = owned(e.args[0]!);
      emit(`call void @fsh_rt_array_reserve(ptr ${at}, i64 ${bytes(type.element, "1")})`);
      field(lengthAt, 1);
      field(dataAt, 0);
      const [length, data, slot, more] = [temp(), temp(), temp(), temp()];
      emit(`${length} = load i64, ptr ${lengthAt}`);
      emit(`${data} = load ptr, ptr ${dataAt}`);
      emit(`${slot} = getelementptr ${t}, ptr ${data}, i64 ${length}`);
      emit(`store ${t} ${v}, ptr ${slot}`);
      emit(`${more} = add i64 ${length}, 1`);
      emit(`store i64 ${more}, ptr ${lengthAt}`);
      return undefined;
    }
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

  // Whether an expression makes a value of its own, rather than reading one that lives somewhere.
  // A conditional or `??` makes one from whichever side it gives.
  function fresh(e: Expr): boolean {
    if (!needsDrop(types.get(e))) return false;
    switch (e.kind) {
      case "call":
      case "new":
      case "object":
      case "arrow":
      case "template":
      case "conditional":
      case "array":
        return true;
      case "binary":
        return e.op === "+" || e.op === "??";
      case "member":
        return calls.has(e);
      // A string's index makes a string; an array's reads an element.
      case "index":
        return !isArray(valueType(e.object));
      default:
        return false;
    }
  }

  // An expression's value for a place to own: one it made, the value of a place it moves out
  // of, which is left empty, or else a copy holding another reference to what it owns. A
  // conversion that leaves part of a value behind copies the part it keeps.
  function owned(e: Expr): string {
    const to = coercions.get(e);
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
    return !needsDrop(from) || members(from).every((m) => members(to).includes(m)) || members(from).includes(to);
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
  function settle(mark = 0) {
    for (const { v, type } of pending.splice(mark).reverse()) dispose(v, type);
  }

  // A variable the innermost scope owns. Its slot starts empty, so dropping it before it is set,
  // or again after, does nothing.
  function own(at: string, type: Type, empty = true) {
    if (!needsDrop(type)) return;
    if (empty) allocas.push(`  store ${llvm(type)} zeroinitializer, ptr ${at}`);
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
      // The compiler's `clone()`: a copy holding another reference to what the value owns.
      const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
      return copied(convert(value(object), types.get(object)!, types.get(e)!), types.get(e)!);
    }
    const object = e.callee.kind === "member" ? e.callee.object : e.callee.kind === "super" ? e.callee : undefined;
    const before = spills.length;
    const pointer = target.body.closure ? receiver(e.callee) : target.body.self && object ? thisPointer(target, object) : undefined;
    const mine = spills.splice(before);
    // A closure may take fewer parameters than the function type it was given as.
    const values = argValues(e.args, target, target.body.closure ? target.body.params.length : e.args.length);
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
    const values = delivered((hand) => args.flatMap((a, i) => (i < taken ? [`${llvm(valueType(a))} ${hand(owned(a), valueType(a))}`] : (value(a), []))));
    for (const p of target.body.params.slice(args.length)) {
      const type = target.locals.get(p)!.type;
      values.push(`${llvm(type)} ${convert("zeroinitializer", "null", type)}`);
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
    const { line, col } = locate(src, at.start);
    unwinding(`call void @fsh_rt_panic_bounds(ptr ${cString(`panicked at ${file}:${line}:${col}:\n`)}, i64 ${length}, i64 ${index})`);
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
    for (let e = target; e.kind === "member" || e.kind === "index"; e = e.object) if (e.kind === "index" && isArray(valueType(e.object))) nodes.unshift(e.index);
    for (const index of nodes) fixed.set(index, value(index));
    const result = run();
    for (const index of nodes) fixed.delete(index);
    return result;
  }

  // A field read, or a getter's result.
  function member(e: Extract<Expr, { kind: "member" }>): string {
    const getter = calls.get(e);
    if (getter) return convert(invoke(getter, thisPointer(getter, e.object), [])!, getter.returns, types.get(e)!);
    // An enum member's value is known, and the enum's name is no value to evaluate.
    if (!types.has(e.object)) return "zeroinitializer";
    // Through a reference, the value it points to.
    const shared = coercions.get(e.object) ?? types.get(e.object)!;
    if (shared === "string") return convert(units(value(e.object)), "usize", types.get(e)!);
    if (typeof shared !== "string" && shared.kind === "array") {
      const length = temp();
      emit(`${length} = extractvalue ${ARRAY} ${value(e.object)}, 1`);
      return convert(length, "usize", types.get(e)!);
    }
    if (typeof shared !== "string" && shared.kind === "union") return unionField(value(e.object), shared, e.name, types.get(e)!);
    const object = shared as ObjectType | ClassType;
    const result = temp();
    emit(`${result} = extractvalue ${llvm(object)} ${value(e.object)}, ${fieldPath(object, e.name).join(", ")}`);
    // A field read through an interface or object parameter takes the type its bound declares.
    return convert(result, field(object, e.name)!.type, types.get(e)!);
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
  function invoke(target: Instance, pointer: string | undefined, args: string[], at?: Expr, after?: () => void): string | undefined {
    const type = target.returns;
    const values = pointer ? [`ptr ${pointer}`, ...args] : args;
    const call = `call ${resultType(target)} ${symbol(target)}(${values.join(", ")})`;
    if (type === "void" && !target.throws) {
      unwinding(call, undefined, after);
      after?.();
      return undefined;
    }
    const result = temp();
    unwinding(call, result, after);
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
    if (!i.throws) return llvm(i.returns);
    return `{ i1, ${i.returns === "void" ? "{}" : llvm(i.returns)}, ${llvm(i.throws)} }`;
  }

  // A `finally` region being emitted: the block its `finally` starts, the slot naming the way
  // control left, each way out with how to resume it, the labels made before the region, and
  // how many catches and scopes enclosed it.
  type Region = { label: string; chosen: string; exits: { key: string; resume: () => void }[]; start: number; handlers: number; depth: number; slots: Map<string, { slot: string; type: Type }> };

  function enter(): Region {
    const region = { label: label(), chosen: alloca("i32"), exits: [], start: labels, handlers: handlers.length, depth: scopes.length, slots: new Map() };
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
    if (region) {
      const kept = v === undefined ? undefined : stash(region, "return", current.returns, v);
      return exit(region, "return", () => leave(kept && unstash(kept, current.returns)));
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
  // What the statement made so far, and what the scopes left own, are dropped on the way.
  function route(error: string, to: Type) {
    for (const { v, type } of [...pending].reverse()) dispose(v, type);
    const region = finallies.at(-1);
    if (region && handlers.length <= region.handlers) {
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
    const type = resultType(current);
    const [a, b] = [temp(), temp()];
    emit(`${a} = insertvalue ${type} undef, i1 true, 0`);
    emit(`${b} = insertvalue ${type} ${a}, ${llvm(to)} ${error}, 2`);
    emit(`ret ${type} ${b}`);
  }

  // The C entry point. An error escaping Fish's `main` is printed to stderr, exiting with 1.
  function entry(): string[] {
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
      case "as":
        return cast(value(e.expr), coercions.get(e.expr) ?? types.get(e.expr)!, types.get(e)! as Numeric);
      case "bool":
        return String(e.value);
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
        if (typeof object !== "string" && object.kind === "array") {
          const v = temp();
          emit(`${v} = load ${llvm(object.element)}, ptr ${element(e)}`);
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
        const type = types.get(e) as ArrayType;
        const t = llvm(type.element);
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
        // `undefined` is the empty value, unless a variable takes the name.
        if (!locals.has(e)) return "zeroinitializer";
        const local = resolved(e);
        const t = temp();
        emit(`${t} = load ${llvm(local.type)}, ptr ${slot(local)}`);
        // Where a check narrowed the variable, its value comes out of the union.
        return convert(t, local.type, types.get(e)!);
      }
      case "member":
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
      const object = types.has(e.object) ? referent(types.get(e.object)!) : undefined;
      if (!object || (typeof object !== "string" && object.kind === "union")) return false;
    }
    if (e.kind === "this") return true;
    // An array's element lives in its buffer, wherever the array itself is.
    if (e.kind === "index") return isArray(valueType(e.object));
    const local = e.kind === "ident" ? locals.get(e) : undefined;
    const type = types.get(e);
    return local !== undefined && (type === local.type || typeof type === "string" || type?.kind !== "union");
  }

  // The type a place is stored as. Read through a type parameter's bound, a field may have a
  // wider type than the one it is stored with.
  function stored(e: Expr): Type {
    if (e.kind !== "member" || calls.has(e)) return types.get(e)!;
    return field(referent(stored(e.object)) as ObjectType | ClassType, e.name)!.type;
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
