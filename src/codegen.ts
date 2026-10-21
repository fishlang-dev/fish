import { selfOf, type Checked, type Instance, type Local, type Type } from "./check.ts";
import { isPrint } from "./values.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { lowering } from "./arithmetic.ts";
import { print, RUNTIME, write } from "./runtime.ts";
import type { BinaryOp, Expr, ObjectProp, Param, Stmt } from "./parser.ts";
import { conversions, llvm } from "./layout.ts";
import { field, fieldPath, INTEGERS, isFloat, isInteger, isOption, type ClassType, type Integer, type Numeric, type ObjectType, type UnionType } from "./typing.ts";

const isRef = (t: Type) => typeof t !== "string" && t.kind === "ref";

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

export type Options = { src: string; file: string; release: boolean };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
export function codegen({ instances }: Checked, { src, file, release }: Options): string {
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
  const handlers: { label: string; slot: string }[] = [];
  // The `finally` regions enclosing the code being emitted, innermost last.
  const finallies: Region[] = [];
  // Where a `break` and a `continue` go for each statement they can name.
  const exits = new Map<Stmt, { exit: string; next?: string }>();
  const builder = { emit, temp, label, startBlock, cString, alloca };
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
    const type = instance.returns;
    // Parameters are copied into slots like any other binding.
    const params = f.params.map((p) => {
      const local = resolved(p);
      allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
      emit(`store ${llvm(local.type)} %${local.name}.arg, ptr ${slot(local)}`);
      return `${llvm(local.type)} %${local.name}.arg`;
    });
    // A constructor or method works on its instance through a pointer, and a closure on what
    // it captured.
    if (f.self) params.unshift("ptr %this");
    if (f.closure) params.unshift("ptr %env");
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
    out.push(`define ${resultType(instance)} ${symbol(instance)}(${params.join(", ")}) {`, "entry:", ...allocas, ...body, "}", "");
  }
  const main = instances.find((i) => i.symbol === "main")!;
  // Built before the module is put together, since its message adds a global.
  const start = entry();

  return [
    ...globals,
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
        return;
      case "block":
        s.body.forEach(statement);
        return;
      case "if": {
        const cond = value(s.cond);
        const then = label();
        const otherwise = s.else ? label() : undefined;
        const end = label();
        emit(`br i1 ${cond}, label %${then}, label %${otherwise ?? end}`);
        startBlock(then);
        s.then.forEach(statement);
        emit(`br label %${end}`);
        if (s.else && otherwise) {
          startBlock(otherwise);
          s.else.forEach(statement);
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
        emit(`br i1 ${value(s.cond)}, label %${loop}, label %${end}`);
        startBlock(loop);
        exits.set(s, { exit: end, next: test });
        s.body.forEach(statement);
        emit(`br label %${test}`);
        startBlock(end);
        return;
      }
      case "for": {
        if (s.init) statement(s.init);
        const [test, loop, next, end] = [label(), label(), label(), label()];
        emit(`br label %${test}`);
        startBlock(test);
        emit(s.test ? `br i1 ${value(s.test)}, label %${loop}, label %${end}` : `br label %${loop}`);
        startBlock(loop);
        exits.set(s, { exit: end, next });
        s.body.forEach(statement);
        emit(`br label %${next}`);
        startBlock(next);
        if (s.update) effect(s.update);
        emit(`br label %${test}`);
        startBlock(end);
        return;
      }
      case "doWhile": {
        const [loop, test, end] = [label(), label(), label()];
        emit(`br label %${loop}`);
        startBlock(loop);
        exits.set(s, { exit: end, next: test });
        s.body.forEach(statement);
        emit(`br label %${test}`);
        startBlock(test);
        emit(`br i1 ${value(s.cond)}, label %${loop}, label %${end}`);
        startBlock(end);
        return;
      }
      case "switch": {
        const subject = value(s.discriminant);
        const subjectType = valueType(s.discriminant);
        const type = llvm(subjectType);
        const bodies = s.cases.map(() => label());
        const end = label();
        exits.set(s, { exit: end });
        // The tests run in order; when none matches, control goes to `default`, wherever it sits.
        s.cases.forEach((c, i) => {
          if (!c.test) return;
          const test = value(c.test);
          // Anything but two values of one primitive type, such as a union or an enum member,
          // compares by value.
          const testType = valueType(c.test);
          const primitive = typeof subjectType === "string" && testType === subjectType;
          const equal = primitive ? compare(type, subject, test) : equals(subject, subjectType, test, testType);
          const next = label();
          emit(`br i1 ${equal}, label %${bodies[i]}, label %${next}`);
          startBlock(next);
        });
        const fallback = s.cases.findIndex((c) => !c.test);
        emit(`br label %${fallback < 0 ? end : bodies[fallback]}`);
        s.cases.forEach((c, i) => {
          startBlock(bodies[i]!);
          c.body.forEach(statement);
          emit(`br label %${bodies[i + 1] ?? end}`);
        });
        startBlock(end);
        return;
      }
      case "labeled": {
        const end = label();
        exits.set(s, { exit: end });
        statement(s.body);
        emit(`br label %${end}`);
        startBlock(end);
        return;
      }
      case "break":
      case "continue": {
        const target = exits.get(jumps.get(s)!)!;
        jump(s.kind === "break" ? target.exit : target.next!);
        startBlock(label());
        return;
      }
      case "return":
        // An arrow's expression body may be a call returning nothing.
        if (s.value && current.returns === "void") {
          call(s.value as Extract<Expr, { kind: "call" }>);
          leave(undefined);
        } else leave(s.value ? value(s.value) : undefined);
        // Anything after a return goes in a fresh block that nothing branches to.
        startBlock(label());
        return;
      case "throw":
        raised(s, value(s.value));
        startBlock(label());
        return;
      // An error raised in the block is stored where the catch reads it, and the catch runs.
      // A `finally` runs however the two are left, then carries on the way they were left.
      case "try": {
        const region = s.finalizer ? enter() : undefined;
        const after = label();
        const done = () => (region ? exit(region, "normal", () => emit(`br label %${after}`)) : emit(`br label %${after}`));
        if (!s.handler) {
          s.block.forEach(statement);
          done();
        } else {
          const local = s.param ? resolved(s) : undefined;
          const type = current.caught.get(s)!;
          const handler = { label: label(), slot: alloca(llvm(type)) };
          handlers.push(handler);
          s.block.forEach(statement);
          handlers.pop();
          done();
          startBlock(handler.label);
          if (local) {
            allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
            const caught = temp();
            emit(`${caught} = load ${llvm(type)}, ptr ${handler.slot}`);
            emit(`store ${llvm(type)} ${caught}, ptr ${slot(local)}`);
          }
          s.handler.forEach(statement);
          done();
        }
        if (region) {
          finallies.pop();
          startBlock(region.label);
          s.finalizer!.forEach(statement);
          const chosen = temp();
          emit(`${chosen} = load i32, ptr ${region.chosen}`);
          const targets = region.exits.map(() => label());
          emit(`switch i32 ${chosen}, label %${targets[0]} [ ${targets.map((t, i) => `i32 ${i}, label %${t}`).join(" ")} ]`);
          region.exits.forEach((e, i) => {
            startBlock(targets[i]!);
            e.resume();
          });
        }
        startBlock(after);
        return;
      }
      case "let": {
        const local = resolved(s);
        allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
        emit(`store ${llvm(local.type)} ${value(s.declarations[0]!.init!)}, ptr ${slot(local)}`);
        return;
      }
    }
  }

  function effect(e: Expr) {
    if (e.kind === "call") call(e);
    else value(e);
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
        print(e.args, builder, value, valueType, convert);
        return undefined;
      }
      // The compiler's `clone()`: no value owns heap memory yet, so a copy of its bits is deep.
      const object = (e.callee as Extract<Expr, { kind: "member" }>).object;
      return convert(value(object), types.get(object)!, types.get(e)!);
    }
    const object = e.callee.kind === "member" ? e.callee.object : e.callee.kind === "super" ? e.callee : undefined;
    const pointer = target.body.closure ? receiver(e.callee) : target.body.self && object ? thisPointer(target, object) : undefined;
    const values = argValues(e.args, target);
    // A closure may take fewer parameters than the function type it was given as.
    const result = invoke(target, pointer, target.body.closure ? values.slice(0, target.body.params.length) : values, e);
    // A call through a type parameter returns what its bound's method declares.
    return result && types.has(e) ? convert(result, target.returns, types.get(e)!) : result;
  }

  // A call's arguments, typed, then an empty value for each optional parameter it leaves out.
  function argValues(args: Expr[], target: Instance): string[] {
    const values = args.map((a) => `${llvm(coercions.get(a) ?? types.get(a)!)} ${value(a)}`);
    for (const p of target.body.params.slice(args.length)) {
      const type = target.locals.get(p)!.type;
      values.push(`${llvm(type)} ${convert("zeroinitializer", "null", type)}`);
    }
    return values;
  }

  // A field read, or a getter's result.
  function member(e: Extract<Expr, { kind: "member" }>): string {
    const getter = calls.get(e);
    if (getter) return convert(invoke(getter, thisPointer(getter, e.object), [])!, getter.returns, types.get(e)!);
    // An enum member's value is known, and the enum's name is no value to evaluate.
    if (!types.has(e.object)) return "zeroinitializer";
    // Through a reference, the value it points to.
    const shared = coercions.get(e.object) ?? types.get(e.object)!;
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
    known.set(object, raw);
    const [some, none, end] = [label(), label(), label()];
    emit(`br i1 ${holds(raw, option, ["null"])}, label %${none}, label %${some}`);
    startBlock(some);
    const got = compute();
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
    return upcast(receiver(object), held as ClassType, target.body.owner!);
  }

  // Calls a function with its arguments' values, after the instance when it is a method.
  function invoke(target: Instance, pointer: string | undefined, args: string[], at?: Expr): string | undefined {
    const type = target.returns;
    const values = pointer ? [`ptr ${pointer}`, ...args] : args;
    const call = `call ${resultType(target)} ${symbol(target)}(${values.join(", ")})`;
    if (type === "void" && !target.throws) {
      emit(call);
      return undefined;
    }
    const result = temp();
    emit(`${result} = ${call}`);
    if (!target.throws) return result;
    // A call that failed raises its error where this function sends it.
    const [failed, bad, ok] = [temp(), label(), label()];
    emit(`${failed} = extractvalue ${resultType(target)} ${result}, 0`);
    emit(`br i1 ${failed}, label %${bad}, label %${ok}`);
    startBlock(bad);
    const error = temp();
    emit(`${error} = extractvalue ${resultType(target)} ${result}, 2`);
    raised(at!, error);
    startBlock(ok);
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
  // how many catches enclosed it.
  type Region = { label: string; chosen: string; exits: { key: string; resume: () => void }[]; start: number; handlers: number; slots: Map<string, string> };

  function enter(): Region {
    const region = { label: label(), chosen: alloca("i32"), exits: [], start: labels, handlers: handlers.length, slots: new Map() };
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
  function stash(region: Region, key: string, type: string, v: string): string {
    let slot = region.slots.get(key);
    if (!slot) region.slots.set(key, (slot = alloca(type)));
    emit(`store ${type} ${v}, ptr ${slot}`);
    return slot;
  }

  // Jumps to a label, through each `finally` whose region it leaves.
  function jump(to: string) {
    const region = finallies.at(-1);
    if (region && Number(to.slice(1)) < region.start) return exit(region, `jump ${to}`, () => jump(to));
    emit(`br label %${to}`);
  }

  // Leaves the function being emitted with a value, or with none, through any `finally`.
  function leave(v: string | undefined) {
    const region = finallies.at(-1);
    if (region) {
      const kept = v === undefined ? undefined : stash(region, "return", llvm(current.returns), v);
      return exit(region, "return", () => {
        let back: string | undefined;
        if (kept) {
          back = temp();
          emit(`${back} = load ${llvm(current.returns)}, ptr ${kept}`);
        }
        leave(back);
      });
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
  function route(error: string, to: Type) {
    const region = finallies.at(-1);
    if (region && handlers.length <= region.handlers) {
      const kept = stash(region, "error", llvm(to), error);
      return exit(region, "error", () => {
        const back = temp();
        emit(`${back} = load ${llvm(to)}, ptr ${kept}`);
        route(back, to);
      });
    }
    const handler = handlers.at(-1);
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
    if (!main.throws) return ["define i32 @main() {", '  call void @"fsh.main"()', "  ret i32 0", "}"];
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
    emit("ret i32 1");
    return ["define i32 @main() {", "entry:", ...allocas, ...body, "}"];
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
  // gets a slot.
  function receiver(object: Expr): string {
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
      emit(`store ${llvm(held)} ${value(object)}, ptr ${copy}`);
      return copy;
    }
    if (lendable(object)) return address(object);
    const type = llvm(types.get(object)!);
    const spilled = alloca(type);
    emit(`store ${type} ${value(object)}, ptr ${spilled}`);
    return spilled;
  }

  // An expression's value, copied down to the declared type it meets when that is narrower.
  function value(e: Expr): string {
    const to = coercions.get(e);
    const type = types.get(e)!;
    if (to && typeof to !== "string" && to.kind === "ref" && (typeof type === "string" || type.kind !== "ref")) return borrowed(e, to.to);
    const result = known.get(e) ?? evaluate(e);
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
    emit(`store ${llvm(to)} ${convert(evaluate(e), types.get(e)!, to)}, ptr ${slot}`);
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
        raised(e, value(e.value));
        startBlock(label());
        return "undef";
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
          if (!isRef(type)) {
            part = temp();
            emit(`${part} = load ${llvm(type)}, ptr ${slot(from as Local)}`);
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
        const values = new Map(e.props.map((p) => property(p, type)));
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
        // The constructor fills in a slot, which then holds the new instance.
        const type = types.get(e) as ClassType;
        const instance = alloca(llvm(type));
        const values = argValues(e.args ?? [], calls.get(e)!).map((v) => `, ${v}`);
        emit(`call void ${symbol(calls.get(e)!)}(ptr ${instance}${values.join("")})`);
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
      case "assign": {
        const op = ASSIGNMENTS[e.op]!;
        // `&&=` and `||=` skip the right side as `&&` and `||` do, and assign only when they
        // run it, which matters when the target is a setter.
        if (op === "&&" || op === "||") {
          return logical(op, value(e.target), () => {
            const assigned = value(e.value);
            store(e.target, assigned);
            return assigned;
          });
        }
        // The target is read before the right-hand side runs, as in JavaScript.
        const result = op === "=" ? value(e.value) : numeric(op, value(e.target), value(e.value), e, types.get(e)!);
        store(e.target, result);
        return result;
      }
      case "update": {
        const old = value(e.operand);
        const type = types.get(e)!;
        const result = numeric(e.op === "++" ? "+" : "-", old, isFloat(type) ? floatConstant(1, type) : "1", e, type);
        store(e.operand, result);
        return e.prefix ? result : old;
      }
      case "conditional": {
        const cond = value(e.cond);
        const [then, otherwise, end] = [label(), label(), label()];
        emit(`br i1 ${cond}, label %${then}, label %${otherwise}`);
        startBlock(then);
        const a = value(e.then);
        const thenEnd = block;
        emit(`br label %${end}`);
        startBlock(otherwise);
        const b = value(e.else);
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
        const tested = test(e, value, valueType);
        if (tested) return tested;
        const condition = COMPARISON[e.op];
        const [a, b] = [value(e.left), value(e.right)];
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
    if (p.kind === "property") return [p.key as string, value(p.value)];
    if (p.kind !== "shorthand") throw new Error("internal error: unchecked property");
    const local = resolved(p);
    const to = field(object, p.name)!.type;
    // A shorthand lent to a reference field points at its variable.
    if (isRef(to) && !isRef(local.type)) return [p.name, slot(local)];
    const result = temp();
    emit(`${result} = load ${llvm(local.type)}, ptr ${slot(local)}`);
    return [p.name, convert(result, local.type, to)];
  }

  function store(target: Expr, result: string) {
    const setter = setters.get(target);
    if (setter && target.kind === "member") {
      invoke(setter, thisPointer(setter, target.object), [`${llvm(types.get(target)!)} ${result}`]);
      return;
    }
    // A whole value written through a mutable reference goes where it points.
    const type = types.get(target)!;
    if (isRef(type) && coercions.has(target)) {
      // Through the reference as stored, unless an update keeps the member it was narrowed to.
      const whole = target.kind === "ident" && type === resolved(target).type;
      const pointer = whole ? temp() : evaluate(target);
      if (whole) emit(`${pointer} = load ptr, ptr ${slot(resolved(target))}`);
      emit(`store ${llvm(type.to)} ${result}, ptr ${pointer}`);
      return;
    }
    emit(`store ${llvm(type)} ${result}, ptr ${address(target)}`);
  }

  // Where an assignment target lives: a variable's slot, or a field inside one.
  function address(target: Expr): string {
    if (target.kind === "this") return "%this";
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
    const kept = convert(v, option, type);
    const someEnd = block;
    emit(`br label %${end}`);
    startBlock(none);
    const fallback = value(e.right);
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
    const b = right();
    const rhsEnd = block;
    emit(`br label %${end}`);
    startBlock(end);
    const result = temp();
    emit(`${result} = phi i1 [ ${op === "||"}, %${from} ], [ ${b}, %${rhsEnd} ]`);
    return result;
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
