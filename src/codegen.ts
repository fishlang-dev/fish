import type { Body, Checked, Local, Type } from "./check.ts";
import { isPrint } from "./values.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { lowering } from "./arithmetic.ts";
import { print, RUNTIME } from "./runtime.ts";
import type { BinaryOp, Expr, ObjectProp, Param, Stmt } from "./parser.ts";
import { field, fieldPath, type ClassType, type ObjectType } from "./typing.ts";

const PRIMITIVES = { i64: "i64", boolean: "i1", void: "void" };

// An object is a literal struct of its fields, in their sorted order. An instance is a
// literal struct of the base it embeds, if any, then its own fields in declaration order.
function llvm(t: Type): string {
  if (typeof t === "string") return PRIMITIVES[t];
  const parts = [...(t.kind === "class" && t.base ? [llvm(t.base)] : []), ...t.fields.map((f) => llvm(f.type))];
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}

const COMPARISON: Partial<Record<BinaryOp, string>> = {
  "===": "eq", "!==": "ne", "<": "slt", "<=": "sle", ">": "sgt", ">=": "sge",
};


export type Options = { src: string; file: string; release: boolean };

// Lowers a checked program to LLVM IR text. The module names no target triple, so clang uses the host's.
// User functions live under `fsh.` so the C entry point `main` can wrap Fish's `main()`.
// Release builds wrap on overflow; debug builds panic.
export function codegen({ funcs, calls, setters, types, locals, returns, coercions, jumps }: Checked, { src, file, release }: Options): string {
  const globals: string[] = [];
  const out: string[] = [];
  // Allocas go in the entry block, where mem2reg promotes them and loops don't grow the stack.
  let allocas: string[] = [];
  let body: string[] = [];
  let temps = 0;
  let labels = 0;
  // The label of the block being emitted into, which a phi names as its predecessor.
  let block = "entry";
  let currentFunction = "";
  // The class of the constructor or method being emitted, whose instance `%this` points to.
  let self: ClassType | undefined;
  // Where a `break` and a `continue` go for each statement they can name.
  const exits = new Map<Stmt, { exit: string; next?: string }>();
  const builder = { emit, temp, label, startBlock, cString };
  const { operate, arithmetic } = lowering(builder, src, file, release);

  for (const f of funcs) {
    currentFunction = f.name;
    self = f.self?.type;
    allocas = [];
    body = [];
    temps = 0;
    labels = 0;
    block = "entry";
    const type = returnType(f.name);
    // Parameters are copied into slots like any other binding.
    const params = f.params.map((p) => {
      const local = resolved(p);
      allocas.push(`  ${slot(local)} = alloca ${llvm(local.type)}`);
      emit(`store ${llvm(local.type)} %${local.name}.arg, ptr ${slot(local)}`);
      return `${llvm(local.type)} %${local.name}.arg`;
    });
    // A constructor or method works on its instance through a pointer.
    if (f.self) params.unshift("ptr %this");
    f.body.forEach(statement);
    // The last block is unreachable when every path returned; the checker guarantees it for values.
    const end = type === "void" ? "ret void" : "unreachable";
    out.push(`define ${llvm(type)} @"fsh.${f.name}"(${params.join(", ")}) {`, "entry:", ...allocas, ...body, `  ${end}`, "}", "");
  }

  return [
    ...globals,
    "",
    ...RUNTIME,
    "",
    ...out,
    "define i32 @main() {",
    '  call void @"fsh.main"()',
    "  ret i32 0",
    "}",
    "",
  ].join("\n");

  function emit(line: string) {
    body.push(`  ${line}`);
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
    return `%${local.name}.${local.id}`;
  }

  function returnType(name: string): Type {
    const type = returns.get(name);
    if (!type) throw new Error(`internal error: no return type for ${name}`);
    return type;
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
        const type = llvm(types.get(s.discriminant)!);
        const bodies = s.cases.map(() => label());
        const end = label();
        exits.set(s, { exit: end });
        // The tests run in order; when none matches, control goes to `default`, wherever it sits.
        s.cases.forEach((c, i) => {
          if (!c.test) return;
          const [equal, next] = [temp(), label()];
          emit(`${equal} = icmp eq ${type} ${subject}, ${value(c.test)}`);
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
        emit(`br label %${s.kind === "break" ? target.exit : target.next}`);
        startBlock(label());
        return;
      }
      case "return":
        emit(s.value ? `ret ${llvm(returnType(currentFunction))} ${value(s.value)}` : "ret void");
        // Anything after a return goes in a fresh block that nothing branches to.
        startBlock(label());
        return;
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
  // A method gets its receiver first, as a pointer, before the arguments run.
  function call(e: Extract<Expr, { kind: "call" }>): string | undefined {
    const target = calls.get(e);
    if (!target) {
      if (isPrint(e.callee)) print(e.args, builder, value, (a) => types.get(a)!);
      return undefined;
    }
    const values = e.args.map((a) => `${llvm(coercions.get(a) ?? types.get(a)!)} ${value(a)}`);
    const object = e.callee.kind === "member" ? e.callee.object : e.callee.kind === "super" ? e.callee : undefined;
    return invoke(target, object, values);
  }

  // Calls a function with its arguments' values, after its receiver when it is a method.
  function invoke(target: Body, object: Expr | undefined, args: string[]): string | undefined {
    const type = returnType(target.name);
    const values = target.self && object ? [`ptr ${upcast(receiver(object), types.get(object) as ClassType, target.owner!)}`, ...args] : args;
    const call = `call ${llvm(type)} @"fsh.${target.name}"(${values.join(", ")})`;
    if (type === "void") {
      emit(call);
      return undefined;
    }
    const result = temp();
    emit(`${result} = ${call}`);
    return result;
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
    let root: Expr = object;
    while (root.kind === "member" && !calls.has(root)) root = root.object;
    if (root.kind === "ident" || root.kind === "this") return address(object);
    const type = llvm(types.get(object)!);
    const slot = temp();
    allocas.push(`  ${slot} = alloca ${type}`);
    emit(`store ${type} ${value(object)}, ptr ${slot}`);
    return slot;
  }

  // An expression's value, copied down to the declared type it meets when that is narrower.
  function value(e: Expr): string {
    const result = evaluate(e);
    const to = coercions.get(e);
    return to ? project(result, types.get(e)!, to) : result;
  }

  // Builds a value of `to` from the matching fields of a wider value of `from`.
  function project(v: string, from: Type, to: Type): string {
    if (from === to || typeof from === "string" || typeof to === "string") return v;
    // A class built from a literal starts with its embedded base, built the same way.
    const embeds = to.kind === "class" && to.base;
    let result = "undef";
    const insert = (part: string, type: Type, i: number) => {
      const next = temp();
      emit(`${next} = insertvalue ${llvm(to)} ${result}, ${llvm(type)} ${part}, ${i}`);
      result = next;
    };
    if (embeds) insert(project(v, from, embeds), embeds, 0);
    to.fields.forEach((f, i) => {
      const part = temp();
      emit(`${part} = extractvalue ${llvm(from)} ${v}, ${fieldPath(from, f.name).join(", ")}`);
      insert(project(part, field(from, f.name)!.type, f.type), f.type, i + (embeds ? 1 : 0));
    });
    return result;
  }

  function evaluate(e: Expr): string {
    switch (e.kind) {
      case "int":
        return String(e.value);
      case "bool":
        return String(e.value);
      case "ident": {
        const local = resolved(e);
        const t = temp();
        emit(`${t} = load ${llvm(local.type)}, ptr ${slot(local)}`);
        return t;
      }
      case "member": {
        const getter = calls.get(e);
        if (getter) return invoke(getter, e.object, [])!;
        const object = types.get(e.object) as ObjectType | ClassType;
        const result = temp();
        emit(`${result} = extractvalue ${llvm(object)} ${value(e.object)}, ${fieldPath(object, e.name).join(", ")}`);
        return result;
      }
      case "object": {
        const type = types.get(e) as ObjectType;
        // Properties run in source order, then fill the fields in their sorted order.
        const values = new Map(e.props.map(property));
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
        const instance = temp();
        allocas.push(`  ${instance} = alloca ${llvm(type)}`);
        const values = (e.args ?? []).map((a) => `, ${llvm(coercions.get(a) ?? types.get(a)!)} ${value(a)}`);
        emit(`call void @"fsh.${type.name}.constructor"(ptr ${instance}${values.join("")})`);
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
        const operand = value(e.operand);
        if (e.op === "-") return arithmetic("-", "0", operand, e, "negate");
        const result = temp();
        emit(e.op === "~" ? `${result} = xor i64 ${operand}, -1` : `${result} = xor i1 ${operand}, true`);
        return result;
      }
      case "assign": {
        const op = ASSIGNMENTS[e.op]!;
        // The target is read before the right-hand side runs, as in JavaScript. `&&=` and `||=`
        // skip the right side as `&&` and `||` do, and storing the unchanged value is harmless.
        const result = op === "=" ? value(e.value)
          : op === "&&" || op === "||" ? logical(op, e.target, e.value)
          : operate(op, value(e.target), value(e.value), e);
        store(e.target, result);
        return result;
      }
      case "update": {
        const old = value(e.operand);
        const result = arithmetic(e.op === "++" ? "+" : "-", old, "1", e);
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
        if (e.op === "&&" || e.op === "||") return logical(e.op, e.left, e.right);
        const condition = COMPARISON[e.op];
        const [a, b] = [value(e.left), value(e.right)];
        if (!condition) return operate(e.op, a, b, e);
        const result = temp();
        emit(`${result} = icmp ${condition} ${llvm(types.get(e.left)!)} ${a}, ${b}`);
        return result;
      }
      default:
        throw new Error(`internal error: no lowering for ${e.kind}`);
    }
  }

  // A property's name and value.
  function property(p: ObjectProp): [string, string] {
    if (p.kind === "property") return [p.key as string, value(p.value)];
    if (p.kind !== "shorthand") throw new Error("internal error: unchecked property");
    const local = resolved(p);
    const result = temp();
    emit(`${result} = load ${llvm(local.type)}, ptr ${slot(local)}`);
    return [p.name, result];
  }

  function store(target: Expr, result: string) {
    const setter = setters.get(target);
    if (setter && target.kind === "member") {
      invoke(setter, target.object, [`${llvm(types.get(target)!)} ${result}`]);
      return;
    }
    emit(`store ${llvm(types.get(target)!)} ${result}, ptr ${address(target)}`);
  }

  // Where an assignment target lives: a variable's slot, or a field inside one.
  function address(target: Expr): string {
    if (target.kind === "this") return "%this";
    if (target.kind !== "member") return slot(resolved(target));
    const object = types.get(target.object) as ObjectType | ClassType;
    const result = temp();
    const path = fieldPath(object, target.name).map((i) => `i32 ${i}`).join(", ");
    emit(`${result} = getelementptr ${llvm(object)}, ptr ${address(target.object)}, i32 0, ${path}`);
    return result;
  }

  // The right side runs only when the left side does not already decide the result.
  function logical(op: "&&" | "||", left: Expr, right: Expr): string {
    const a = value(left);
    const from = block;
    const rhs = label();
    const end = label();
    emit(op === "&&" ? `br i1 ${a}, label %${rhs}, label %${end}` : `br i1 ${a}, label %${end}, label %${rhs}`);
    startBlock(rhs);
    const b = value(right);
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
