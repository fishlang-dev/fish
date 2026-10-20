import type { Checked, Instance, Local, Type } from "./check.ts";
import { isPrint } from "./values.ts";
import { ASSIGNMENTS } from "./operators.ts";
import { lowering } from "./arithmetic.ts";
import { print, RUNTIME } from "./runtime.ts";
import type { BinaryOp, Expr, ObjectProp, Param, Stmt } from "./parser.ts";
import { conversions, llvm } from "./layout.ts";
import { field, fieldPath, type ClassType, type ObjectType } from "./typing.ts";

const isRef = (t: Type) => typeof t !== "string" && t.kind === "ref";

// What a reference points to, or the type itself.
const referent = (t: Type): Type => (typeof t !== "string" && t.kind === "ref" ? t.to : t);

const COMPARISON: Partial<Record<BinaryOp, string>> = {
  "===": "eq", "!==": "ne", "<": "slt", "<=": "sle", ">": "sgt", ">=": "sge",
};

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
  // Where a `break` and a `continue` go for each statement they can name.
  const exits = new Map<Stmt, { exit: string; next?: string }>();
  const builder = { emit, temp, label, startBlock, cString, alloca };
  const { operate, arithmetic } = lowering(builder, src, file, release);
  const { convert, test, equals, unionField } = conversions(builder);

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
    // A constructor or method works on its instance through a pointer.
    if (f.self) params.unshift("ptr %this");
    f.body.forEach(statement);
    // The last block is unreachable when every path returned; the checker guarantees it for values.
    const end = type === "void" ? "ret void" : "unreachable";
    out.push(`define ${llvm(type)} ${symbol(instance)}(${params.join(", ")}) {`, "entry:", ...allocas, ...body, `  ${end}`, "}", "");
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
    return `%${local.name}.${local.id}`;
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
        emit(`br label %${s.kind === "break" ? target.exit : target.next}`);
        startBlock(label());
        return;
      }
      case "return":
        emit(s.value ? `ret ${llvm(current.returns)} ${value(s.value)}` : "ret void");
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
  function compare(type: string, a: string, b: string): string {
    const result = temp();
    emit(`${result} = icmp eq ${type} ${a}, ${b}`);
    return result;
  }

  // A method's receiver runs before its arguments, as in JavaScript.
  function call(e: Extract<Expr, { kind: "call" }>): string | undefined {
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
    const pointer = target.body.self && object ? thisPointer(target, object) : undefined;
    const values = e.args.map((a) => `${llvm(coercions.get(a) ?? types.get(a)!)} ${value(a)}`);
    const result = invoke(target, pointer, values);
    // A call through a type parameter returns what its bound's method declares.
    return result && types.has(e) ? convert(result, target.returns, types.get(e)!) : result;
  }

  // A pointer to the instance a method works on: its receiver, or the base embedded in it
  // that declares the method.
  function thisPointer(target: Instance, object: Expr): string {
    return upcast(receiver(object), referent(types.get(object)!) as ClassType, target.body.owner!);
  }

  // Calls a function with its arguments' values, after the instance when it is a method.
  function invoke(target: Instance, pointer: string | undefined, args: string[]): string | undefined {
    const type = target.returns;
    const values = pointer ? [`ptr ${pointer}`, ...args] : args;
    const call = `call ${llvm(type)} ${symbol(target)}(${values.join(", ")})`;
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
    // A reference already points where the receiver lives.
    if (isRef(types.get(object)!)) return evaluate(object);
    let root: Expr = object;
    while (root.kind === "member" && !calls.has(root)) root = root.object;
    if (root.kind === "ident" || root.kind === "this") return address(object);
    const type = llvm(types.get(object)!);
    const slot = alloca(type);
    emit(`store ${type} ${value(object)}, ptr ${slot}`);
    return slot;
  }

  // An expression's value, copied down to the declared type it meets when that is narrower.
  function value(e: Expr): string {
    const to = coercions.get(e);
    const type = types.get(e)!;
    if (to && typeof to !== "string" && to.kind === "ref" && (typeof type === "string" || type.kind !== "ref")) return borrowed(e, to.to);
    const result = evaluate(e);
    return to ? convert(result, type, to) : result;
  }

  // The type of what `value` gives for an expression: its own, or what it is converted to.
  function valueType(e: Expr): Type {
    return coercions.get(e) ?? types.get(e)!;
  }

  // A pointer to a value lent to a reference: where a place holding exactly that type lives,
  // or else a slot holding a copy converted to it.
  function borrowed(e: Expr, to: Type): string {
    if (types.get(e) === to && lendable(e)) return address(e);
    const slot = alloca(llvm(to));
    emit(`store ${llvm(to)} ${convert(evaluate(e), types.get(e)!, to)}, ptr ${slot}`);
    return slot;
  }

  function evaluate(e: Expr): string {
    switch (e.kind) {
      case "int":
        return String(e.value);
      case "bool":
        return String(e.value);
      // A string literal on its own has only its literal type, which takes no space.
      case "string":
        return "zeroinitializer";
      case "ident": {
        const local = resolved(e);
        const t = temp();
        emit(`${t} = load ${llvm(local.type)}, ptr ${slot(local)}`);
        // Where a check narrowed the variable, its value comes out of the union.
        return convert(t, local.type, types.get(e)!);
      }
      case "member": {
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
        const values = (e.args ?? []).map((a) => `, ${llvm(coercions.get(a) ?? types.get(a)!)} ${value(a)}`);
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
        const operand = value(e.operand);
        if (e.op === "-") return arithmetic("-", "0", operand, e, "negate");
        const result = temp();
        emit(e.op === "~" ? `${result} = xor i64 ${operand}, -1` : `${result} = xor i1 ${operand}, true`);
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
        const result = op === "=" ? value(e.value) : operate(op, value(e.target), value(e.value), e);
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
        if (e.op === "&&" || e.op === "||") return logical(e.op, value(e.left), () => value(e.right));
        const tested = test(e, value, valueType);
        if (tested) return tested;
        const condition = COMPARISON[e.op];
        const [a, b] = [value(e.left), value(e.right)];
        if (!condition) return operate(e.op, a, b, e);
        // An operand keeps a literal type only when both are the same string literal.
        const type = coercions.get(e.left) ?? types.get(e.left)!;
        if (typeof type !== "string") return String(e.op === "===");
        const result = temp();
        emit(`${result} = icmp ${condition} ${llvm(type)} ${a}, ${b}`);
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
    const result = temp();
    emit(`${result} = load ${llvm(local.type)}, ptr ${slot(local)}`);
    return [p.name, convert(result, local.type, field(object, p.name)!.type)];
  }

  function store(target: Expr, result: string) {
    const setter = setters.get(target);
    if (setter && target.kind === "member") {
      invoke(setter, thisPointer(setter, target.object), [`${llvm(types.get(target)!)} ${result}`]);
      return;
    }
    emit(`store ${llvm(types.get(target)!)} ${result}, ptr ${address(target)}`);
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
