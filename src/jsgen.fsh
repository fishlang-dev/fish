// `--target js`: a checked program as one JavaScript module and the `.d.ts` that types its exports.
// Each instance the program reaches from `main`, and from the entry file's exports, becomes a
// function, or a member of the class its owner becomes, so a generic function's instances keep the
// arithmetic of their own types. What JavaScript runs as Fish does, strings, arrays, Maps, Sets,
// Math, closures, generators and promises, is written as it was; integers go through `$fsh`
// (`src/jsruntime.fsh`). A form that needs the native runtime is refused at its span.
import { bodyOf, type InstanceId, type LocalId } from "./arenas.fsh";
import type { Body } from "./classes.fsh";
import type { Checked, Instance } from "./check.fsh";
import { CompileError, locate, sourceOf, type Source } from "./diag.fsh";
import type { Declarator, Expr, ObjectProp, Param, Pattern, PropertyName, Span, Stmt } from "./parser.fsh";
import { STD_BASE } from "./std.fsh";
import type { Tables } from "./compilation.fsh";
import { idOf, isFloat, isInteger, literalText, type ClassType, type Integer, type Type, type Typing } from "./typing.fsh";
import { printStream } from "./values.fsh";
import { jsRuntime } from "./jsruntime.fsh";

export type JsOptions = { src: string; file: string; sources: Source[]; release: boolean; library: boolean };
export type JsModule = { js: string; dts: string };

// The checked program as a module and its declarations.
/** @throws {CompileError} */
export function jsModule(checked: Checked, options: JsOptions): JsModule {
  let emitter = new JsEmitter(checked, options);
  return emitter.module();
}

// How an integer type is held in JavaScript: a number, or a BigInt.
type Held = "number" | "big";

// The integer types held as BigInts: those wider than a double holds exactly, and `bigint`.
export function heldAs(t: Integer | "bigint"): Held {
  return t === "u64" || t === "i128" || t === "u128" || t === "bigint" ? "big" : "number";
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// A name as JavaScript can declare it: one that isn't an identifier, as a pattern's made-up
// binding is, takes `fallback`.
export function jsName(name: string, fallback: string): string {
  return IDENTIFIER.test(name) && !name.startsWith("$fsh") ? name : fallback;
}

// A member's name after `.`: a private name loses the class a subclass's copy was renamed for,
// and one that isn't an identifier is read with brackets.
export function memberText(name: string, optional: boolean): string {
  const shown = name.startsWith("#") ? name.replace(/@.*$/, "") : name;
  if (IDENTIFIER.test(shown) || /^#[\w$]+$/.test(shown)) return `${optional ? "?." : "."}${shown}`;
  return `${optional ? "?." : ""}[${JSON.stringify(shown)}]`;
}

// A method's name as a class body declares it: a computed one, as `[Symbol.iterator]`, as written.
function declaredName(name: string): string {
  const shown = name.startsWith("#") ? name.replace(/@.*$/, "") : name;
  if (shown.startsWith("[") || IDENTIFIER.test(shown) || /^#[\w$]+$/.test(shown)) return shown;
  return JSON.stringify(shown);
}

// How a class member is declared, read from its body's name: `C.m`, `C.static m`, `C.get x`.
export function memberOf(bodyName: string): { name: string; static: boolean; accessor: "get" | "set" | undefined } | undefined {
  const m = /\.(static )?((?:get|set) )?(#?[\w$]+(?:@[\w$]+)?|\[[^\]]*\])$/.exec(bodyName);
  if (m === null) return undefined;
  const accessor = m[2] === "get " ? "get" : m[2] === "set " ? "set" : undefined;
  return { name: m[3]!, static: m[1] !== undefined, accessor };
}

// The JavaScript operators an integer operator becomes, by the `$fsh` helper it goes through.
const ARITHMETIC = new Set<string>(["+", "-", "*", "/", "%", "**"]);
const BITWISE = new Set<string>(["&", "|", "^"]);
const SHIFTS = new Set<string>(["<<", ">>", ">>>"]);

class JsEmitter {
  checked: Checked;
  src: string;
  file: string;
  sources: Source[];
  release: boolean;
  library: boolean;
  current: InstanceId = 0 as InstanceId;
  // Each function's and class's module-level name, and every name taken.
  names = new Map<InstanceId, string>();
  classNames = new Map<usize, string>();
  taken = new Set<string>(["$fsh"]);
  // The classes reached, bases first, and the members of each, by class.
  classOrder: ClassType[] = [];
  members = new Map<usize, InstanceId[]>();
  // Each method's name in its class: its member name, or one made for a generic method's later instances.
  methodNames = new Map<InstanceId, string>();
  queue: InstanceId[] = [];
  reached = new Set<InstanceId>();
  texts = new Map<InstanceId, string>();
  // Where the program first calls each of std's functions, which is where one refused is reported.
  calledAt = new Map<InstanceId, Span>();
  classesByName = new Map<string, ClassType>();

  constructor(checked: Checked, options: JsOptions) {
    this.checked = checked;
    this.src = options.src;
    this.file = options.file;
    this.sources = [...options.sources];
    this.release = options.release;
    this.library = options.library;
  }

  inst(id: InstanceId): Ref<Instance> {
    return this.checked.tables.arenas.instanceOf(id)!;
  }

  bodyAt(id: InstanceId): Ref<Body> {
    return bodyOf(this.checked.tables.arenas, this.checked.tables.arenas.instanceOf(id)!);
  }

  typeOf(e: Ref<Expr>): Type | undefined {
    return this.inst(this.current).types.get(e);
  }

  // A type with what JavaScript holds the same way taken off: references, brands, literals and
  // recursive aliases.
  plain(t: Type | undefined): Type | undefined {
    let at = t;
    for (let i = 0; i < 16; i++) {
      if (at === undefined || typeof at === "string") return at;
      const r = this.checked.tables.typing.rec(at);
      if (r.kind === "ref") at = r.to;
      else if (r.kind === "brand") at = r.base;
      else if (r.kind === "recursive") at = r.of;
      else if (r.kind === "literal") {
        const v = r.value;
        return typeof v === "string" ? "string" : typeof v === "boolean" ? "boolean" : "i64";
      } else return at;
    }
    return at;
  }

  integer(t: Type | undefined): Integer | "bigint" | undefined {
    const p = this.plain(t);
    if (p === undefined) return undefined;
    if (p === "bigint") return "bigint";
    return isInteger(p) ? p : undefined;
  }

  kind(t: Type | undefined): string | undefined {
    const p = this.plain(t);
    return p === undefined || typeof p === "string" ? undefined : this.checked.tables.typing.kindOf(p);
  }

  // A tuple or fixed array, which copies where Fish copies it.
  copies(t: Type | undefined): boolean {
    const p = this.plain(t);
    if (p === undefined || typeof p === "string") return false;
    const r = this.checked.tables.typing.rec(p);
    return r.kind === "fixed" || (r.kind === "object" && r.tuple === true);
  }

  place(at: Ref<Span>): string {
    const where = sourceOf(this.src, this.file, at.start, this.sources);
    const { line, col } = locate(where.src, where.offset);
    return JSON.stringify(`${where.file}:${line}:${col}`);
  }

  refused(what: string, at: Ref<Span>): CompileError {
    return new CompileError("E0803", `${what} are not supported on the js target yet`, at.start, at.end);
  }

  fresh(this: Mut<this>, wanted: string): string {
    const base = jsName(wanted.replace(/[^\w$]/g, "_"), "f");
    let name = base;
    let n = 2;
    while (this.taken.has(name)) {
      name = `${base}$${n}`;
      n++;
    }
    this.taken.add(name);
    return name;
  }

  // A local's name in the module. A closure's binding for a capture is named as the variable it
  // captures, which JavaScript's own scoping then reaches.
  localName(id: LocalId): string {
    let at = id;
    let holder = this.current;
    for (let depth = 0; depth < 64 && this.inUser() !== undefined; depth++) {
      const captures = this.inst(holder).captures;
      if (captures === undefined) break;
      const outer = captures!.get(at);
      if (outer === undefined || outer === "this") break;
      const parent = this.bodyAt(holder).closure?.parent;
      if (parent === undefined) break;
      at = outer as LocalId;
      holder = parent!;
    }
    const name = this.checked.tables.arenas.localOf(at)!.name;
    return jsName(name === "%" ? "$topic" : name, `$v${at}`);
  }

  // Whether the instance being emitted is the program's own, or undefined before any is.
  inUser(): boolean | undefined {
    if ((this.current as usize) === 0) return undefined;
    return this.bodyAt(this.current).start < STD_BASE;
  }

  // The module-level name of a function, reaching it.
  /** @throws {CompileError} */
  functionName(this: Mut<this>, id: InstanceId, at: Ref<Span>): string {
    this.reach(id, at);
    const known = this.names.get(id);
    if (known !== undefined) return known;
    const wanted = this.bodyAt(id).comptime === "const" ? `${this.bodyAt(id).name}$const` : this.inst(id).symbol.replace(/#.*$/, "");
    const name = this.fresh(wanted);
    this.names.set(id, name);
    return name;
  }

  /** @throws {CompileError} */
  reach(this: Mut<this>, id: InstanceId, at: Ref<Span>): void {
    if (this.reached.has(id)) return;
    if (this.bodyAt(id).foreign === true) throw this.refused(this.bodyAt(id).rust !== undefined ? "Rust functions" : "C functions", at);
    if (this.bodyAt(id).js !== undefined) throw this.refused("npm packages", at);
    const owner = this.bodyAt(id).self?.type;
    const ofStd = this.bodyAt(id).start >= STD_BASE;
    this.reached.add(id);
    this.noteCaller(id, ofStd, at);
    if (owner !== undefined) {
      this.reachClass(owner, at);
      return;
    }
    this.queue.push(id);
  }

  // Where a function of std's is reported when it's refused: at the program's call that reached it.
  noteCaller(this: Mut<this>, id: InstanceId, ofStd: boolean, at: Ref<Span>): void {
    const caller = this.calledAt.get(this.current);
    if (caller !== undefined) this.calledAt.set(id, caller!);
    else if (ofStd && this.inUser() !== false) this.calledAt.set(id, { start: at.start, end: at.end });
  }

  // A class reached: its base first, then every member it compiles, since a call through its
  // base runs an override nothing names.
  /** @throws {CompileError} */
  reachClass(this: Mut<this>, c: ClassType, at: Ref<Span>): string {
    const key = idOf(c);
    const known = this.classNames.get(key);
    if (known !== undefined) return known;
    if (this.checked.tables.typing.rec(c).rust !== undefined) throw this.refused("Rust types", at);
    if (this.checked.tables.typing.rec(c).fields.some((f) => f.name === "#embedded base")) throw this.refused("classes extending Map or Set", at);
    const base = this.checked.tables.typing.rec(c).base;
    const wanted = this.checked.tables.typing.rec(c).generic?.name ?? this.checked.tables.typing.rec(c).name;
    if (base !== undefined) this.reachClass(base!, at);
    const name = this.fresh(wanted);
    this.classNames.set(key, name);
    this.classOrder.push(c);
    let own: InstanceId[] = [];
    const all = [...this.checked.instances];
    for (const id of all) {
      const x = this.inst(id);
      const body = this.bodyAt(id);
      if (x.retired === true || !x.concrete || body.closure !== undefined || body.abstract === true || body.template === true || body.comptime !== undefined) continue;
      const self = body.self?.type;
      if (self === undefined || idOf(self) !== key) continue;
      own.push(id);
    }
    let seen = new Map<string, usize>();
    for (const id of own) {
      const m = memberOf(this.bodyAt(id).name);
      if (this.bodyAt(id).self!.constructor || m === undefined) continue;
      const slot = `${m.static ? "static " : ""}${m.accessor !== undefined ? m.accessor! : ""} ${m.name}`;
      const count = seen.get(slot) ?? 0;
      seen.set(slot, count + 1);
      this.methodNames.set(id, count === 0 ? m.name : `${m.name.replace(/[^\w$]/g, "_")}$${count + 1}`);
    }
    for (const id of own) {
      if (this.reached.has(id)) continue;
      const ofStd = this.bodyAt(id).start >= STD_BASE;
      this.reached.add(id);
      this.noteCaller(id, ofStd, at);
      this.queue.push(id);
    }
    this.members.set(key, own);
    return name;
  }

  /** @throws {CompileError} */
  module(this: Mut<this>): JsModule {
    const none: Span = { start: 0, end: 0 };
    const all = [...this.checked.instances];
    let main: InstanceId | undefined = undefined;
    let exports: [string, InstanceId][] = [];
    for (const id of all) {
      const owner = this.bodyAt(id).self?.type;
      if (owner !== undefined) {
        const named = this.checked.tables.typing.rec(owner!).name;
        this.classesByName.set(named, owner!);
        continue;
      }
      if (this.inst(id).symbol === "main" && this.bodyAt(id).closure === undefined) main = id;
      if (this.exportable(id)) exports.push([this.bodyAt(id).name, id]);
    }
    const mainName = main !== undefined && !this.library ? this.functionName(main!, none) : undefined;
    let exported: string[] = [];
    for (const [name, id] of exports) exported.push(`${this.functionName(id, none)} as ${name}`);
    this.drain();
    let out: string[] = [jsRuntime(this.release)];
    const order = [...this.classOrder];
    for (const c of order) out.push(this.classText(c));
    for (const [id, text] of this.texts) if (this.bodyAt(id).self === undefined) out.push(text);
    if (this.library) for (const c of order) if (this.isUser(c)) exported.push(this.classNames.get(idOf(c))!);
    if (exported.length > 0) out.push(`export { ${exported.join(", ")} };`);
    if (mainName !== undefined) out.push(`$fsh.main(${mainName});`);
    return { js: `${out.join("\n")}\n`, dts: this.declarations(exports) };
  }

  // An entry file's exported function, with no type parameters, which the module exports.
  exportable(id: InstanceId): boolean {
    const body = this.bodyAt(id);
    if (body.exported !== true || body.closure !== undefined || !this.inst(id).concrete || body.start >= STD_BASE) return false;
    if (body.typeParams !== undefined && body.typeParams!.length > 0) return false;
    return sourceOf(this.src, this.file, body.start, this.sources).file === this.file;
  }

  isUser(c: ClassType): boolean {
    const own = this.members.get(idOf(c));
    if (own === undefined) return false;
    for (const id of own!) if (this.bodyAt(id).start < STD_BASE) return true;
    return false;
  }

  // Every function reached, emitted in turn. One of std's that is refused is reported where the
  // program first calls it.
  /** @throws {CompileError} */
  drain(this: Mut<this>): void {
    while (this.queue.length > 0) {
      const id = this.queue.shift()!;
      try {
        const text = this.instanceText(id);
        this.texts.set(id, text);
      } catch (e) {
        const at = this.calledAt.get(id);
        if (at !== undefined && e.start >= STD_BASE) {
          const name = this.bodyAt(id).name.replace(/^__/, "");
          throw new CompileError(e.code, `${e.message}: std's '${name}', which this reaches, uses them`, at!.start, at!.end);
        }
        throw e;
      }
    }
  }

  classText(c: ClassType): string {
    const r = this.checked.tables.typing.rec(c);
    const name = this.classNames.get(idOf(c))!;
    const base = r.base !== undefined ? this.classNames.get(idOf(r.base!)) : undefined;
    let lines: string[] = [`class ${name}${base !== undefined ? ` extends ${base}` : ""} {`];
    let inherited = new Set<string>();
    if (r.base !== undefined) {
      const base = this.checked.tables.typing.rec(r.base!);
      for (const f of base.fields) inherited.add(f.name.replace(/@.*$/, ""));
    }
    for (const f of r.fields) {
      const shown = f.name.replace(/@.*$/, "");
      if (/^#[\w$]+$/.test(shown) && !inherited.has(shown)) lines.push(`  ${shown};`);
    }
    const own = this.members.get(idOf(c));
    if (own !== undefined) {
      for (const id of own!) {
        const text = this.texts.get(id);
        if (text !== undefined) lines.push(text!);
      }
    }
    lines.push("}");
    return lines.join("\n");
  }

  // One instance's function, or its class member, as JavaScript.
  /** @throws {CompileError} */
  instanceText(this: Mut<this>, id: InstanceId): string {
    const outer = this.current;
    this.current = id;
    try {
      const member = this.bodyAt(id).self !== undefined;
      const constant = this.bodyAt(id).comptime === "const";
      const header = constant ? `const ${this.names.get(id)!} = $fsh.once(function ()` : this.header(id);
      const statements = this.takeBody(id);
      let text = "";
      try {
        text = this.block(statements, member ? "    " : "  ");
      } finally {
        this.putBody(id, statements);
      }
      const pad = member ? "  " : "";
      return `${pad}${header} {\n${text}${pad}}${constant ? ");" : ""}`;
    } finally {
      this.current = outer;
    }
  }

  // A body's statements, taken out while they are emitted, so reading them borrows nothing of the
  // emitter that the emitting changes.
  takeBody(this: Mut<this>, id: InstanceId): Stmt[] {
    const bodyId = this.inst(id).body;
    const apart = this.inst(id).lowered;
    return apart !== undefined ? this.checked.tables.arenas.loweredMut(apart).body.splice(0) : this.checked.tables.arenas.bodyMut(bodyId).body.splice(0);
  }

  putBody(this: Mut<this>, id: InstanceId, statements: Stmt[]): void {
    const bodyId = this.inst(id).body;
    const apart = this.inst(id).lowered;
    if (apart !== undefined) this.checked.tables.arenas.loweredMut(apart).body = statements;
    else this.checked.tables.arenas.bodyMut(bodyId).body = statements;
  }

  /** @throws {CompileError} */
  header(id: InstanceId): string {
    const body = this.bodyAt(id);
    const params = this.params(id);
    const prefix = `${body.async === true ? "async " : ""}`;
    const star = body.generator === true ? "*" : "";
    if (body.self === undefined) return `${prefix}function${star} ${this.names.get(id)!}(${params})`;
    if (body.self!.constructor) return `constructor(${params})`;
    const m = memberOf(body.name)!;
    const name = declaredName(this.methodNames.get(id) ?? m.name);
    return `${m.static ? "static " : ""}${prefix}${m.accessor !== undefined ? `${m.accessor} ` : ""}${star}${name}(${params})`;
  }

  /** @throws {CompileError} */
  params(id: InstanceId): string {
    let out: string[] = [];
    const count = this.bodyAt(id).params.length;
    for (let i: usize = 0; i < count; i++) {
      const p: Ref<Param> = this.bodyAt(id).params[i]!;
      if (p.comptime) throw this.refused("comptime parameters", p);
      const local = this.inst(id).locals.get(p);
      if (local === undefined) throw this.refused("parameters of this form", p);
      const t = this.checked.tables.arenas.localOf(local!)!.type;
      if (typeof t !== "string" && this.checked.tables.typing.kindOf(t) === "ref") {
        const r = this.checked.tables.typing.rec(t);
        if (r.kind === "ref" && r.mutable && this.byValue(r.to)) throw this.refused("mutable borrows of numbers, strings and booleans", p);
      }
      out.push(`${p.rest ? "..." : ""}${this.localName(local!)}`);
    }
    return out.join(", ");
  }

  // Whether JavaScript passes a value of the type as a copy, so a borrow of it can't change it.
  byValue(t: Type): boolean {
    const p = this.plain(t);
    if (p === undefined || typeof p === "string") return true;
    const kind = this.checked.tables.typing.kindOf(p);
    return kind === "union" || kind === "literal";
  }

  /** @throws {CompileError} */
  block(this: Mut<this>, list: Ref<Stmt[]>, pad: string): string {
    let out = "";
    for (const s of list) out += this.statement(s, pad);
    return out;
  }

  /** @throws {CompileError} */
  statement(this: Mut<this>, s: Ref<Stmt>, pad: string): string {
    if (this.inst(this.current).unreached?.has(s) === true) return "";
    const inner = `${pad}  `;
    switch (s.kind) {
      case "expr":
        return `${pad}${this.expr(s.expr)};\n`;
      case "let": {
        if (s.keyword === "using" || s.keyword === "await using") throw this.refused("'using' declarations", s);
        const keyword = s.keyword === "const" ? "const" : "let";
        let parts: string[] = [];
        for (const d of s.declarations) parts.push(this.declarator(s, d));
        return `${pad}${keyword} ${parts.join(", ")};\n`;
      }
      case "return":
        return `${pad}return${s.value !== undefined ? ` ${this.value(s.value!)}` : ""};\n`;
      case "if": {
        let text = `${pad}if (${this.expr(s.cond)}) {\n${this.block(s.then, inner)}${pad}}`;
        if (s.else !== undefined) text += ` else {\n${this.block(s.else!, inner)}${pad}}`;
        return `${text}\n`;
      }
      case "while":
        return `${pad}while (${this.expr(s.cond)}) {\n${this.block(s.body, inner)}${pad}}\n`;
      case "doWhile":
        return `${pad}do {\n${this.block(s.body, inner)}${pad}} while (${this.expr(s.cond)});\n`;
      case "for": {
        const init = s.init === undefined ? "" : this.statement(s.init!, "").trim().replace(/;$/, "");
        const test = s.test === undefined ? "" : this.expr(s.test!);
        const update = s.update === undefined ? "" : this.expr(s.update!);
        return `${pad}for (${init}; ${test}; ${update}) {\n${this.block(s.body, inner)}${pad}}\n`;
      }
      case "forOf":
      case "forIn": {
        const left: Ref<Stmt | Pattern> = s.left;
        let head = "";
        if (left.kind === "let") head = `const ${this.declarator(left, left.declarations[0]!)}`;
        else if (left.kind === "ident") head = jsName(left.name, "$_");
        else throw this.refused("loops assigning to a pattern", { start: s.start, end: s.end });
        return `${pad}for ${s.await ? "await " : ""}(${head} ${s.kind === "forOf" ? "of" : "in"} ${this.expr(s.right)}) {\n${this.block(s.body, inner)}${pad}}\n`;
      }
      case "switch": {
        let text = `${pad}switch (${this.expr(s.discriminant)}) {\n`;
        for (const c of s.cases) {
          text += c.test !== undefined ? `${inner}case ${this.expr(c.test!)}: {\n` : `${inner}default: {\n`;
          text += `${this.block(c.body, `${inner}  `)}${inner}}\n`;
        }
        return `${text}${pad}}\n`;
      }
      case "labeled":
        return `${pad}${s.label}:\n${this.statement(s.body, pad)}`;
      case "break":
      case "continue":
        return `${pad}${s.kind}${s.label !== undefined ? ` ${s.label}` : ""};\n`;
      case "throw":
        return `${pad}throw ${this.value(s.value)};\n`;
      case "try": {
        let text = `${pad}try {\n${this.block(s.block, inner)}${pad}}`;
        if (s.handler !== undefined) {
          const param: Ref<Pattern | undefined> = s.param;
          const named = param !== undefined && param.kind === "ident" ? jsName(param.name, "$e") : "$e";
          let head = `${inner}$fsh.pass(${named});\n`;
          if (param !== undefined && param.kind !== "ident") head += `${inner}let ${this.pattern(param!)} = $e;\n`;
          text += ` catch (${named}) {\n${head}${this.block(s.handler!, inner)}${pad}}`;
        }
        if (s.finalizer !== undefined) text += ` finally {\n${this.block(s.finalizer!, inner)}${pad}}`;
        return `${text}\n`;
      }
      case "block":
        return `${pad}{\n${this.block(s.body, inner)}${pad}}\n`;
      case "empty":
      case "typeAlias":
      case "interface":
      case "class":
      case "enum":
      case "comptime":
        return "";
      case "debugger":
        return `${pad}debugger;\n`;
      case "unsafe":
        throw this.refused("'unsafe' blocks", s);
      default:
        throw this.refused(`'${s.kind}' statements here`, { start: s.start, end: s.end });
    }
  }

  /** @throws {CompileError} */
  declarator(this: Mut<this>, s: Ref<Stmt>, d: Ref<Declarator>): string {
    const local = this.inst(this.current).locals.get(s);
    const target = d.target.kind === "ident" && local !== undefined ? this.localName(local!) : this.pattern(d.target);
    return d.init !== undefined ? `${target} = ${this.value(d.init!)}` : target;
  }

  /** @throws {CompileError} */
  pattern(this: Mut<this>, p: Ref<Pattern>): string {
    switch (p.kind) {
      case "ident":
        return jsName(p.name, "$_");
      case "object": {
        let parts: string[] = [];
        for (const prop of p.props) parts.push(`${this.key(prop.key)}: ${this.pattern(prop.value)}`);
        if (p.rest !== undefined) parts.push(`...${this.pattern(p.rest!)}`);
        return `{ ${parts.join(", ")} }`;
      }
      case "array": {
        let parts: string[] = [];
        for (const e of p.elements) parts.push(e === undefined ? "" : this.pattern(e!));
        if (p.rest !== undefined) parts.push(`...${this.pattern(p.rest!)}`);
        return `[${parts.join(", ")}]`;
      }
      case "default":
        return `${this.pattern(p.target)} = ${this.value(p.value)}`;
      case "expr":
        return this.expr(p.expr);
      default:
        throw this.refused("match patterns", { start: p.start, end: p.end });
    }
  }

  /** @throws {CompileError} */
  key(this: Mut<this>, k: Ref<PropertyName>): string {
    if (typeof k === "string") return IDENTIFIER.test(k) ? k : JSON.stringify(k);
    return `[${this.expr(k)}]`;
  }

  // An expression read as a value that goes somewhere: a tuple or fixed array read from where it
  // lives is copied, as Fish copies one.
  /** @throws {CompileError} */
  value(this: Mut<this>, e: Ref<Expr>): string {
    const text = this.expr(e);
    if ((e.kind === "ident" || e.kind === "member" || e.kind === "index") && this.copies(this.typeOf(e))) return `$fsh.copy(${text})`;
    return text;
  }

  /** @throws {CompileError} */
  args(this: Mut<this>, list: Ref<Expr[]>): string {
    let out: string[] = [];
    for (const a of list) out.push(a.kind === "spread" ? `...${this.expr(a.value)}` : this.value(a));
    return out.join(", ");
  }

  /** @throws {CompileError} */
  expr(this: Mut<this>, e: Ref<Expr>): string {
    switch (e.kind) {
      case "int": {
        const t = this.integer(this.typeOf(e));
        if (t !== undefined && heldAs(t!) === "big") return `${e.value}n`;
        if (isFloat(this.plain(this.typeOf(e)) ?? "i64")) return `${e.value}`;
        if (e.value > 9007199254740991n) throw this.refused("integers beyond 2^53 - 1 held as numbers", e);
        return `${e.value}`;
      }
      case "float":
        return `${e.value}`;
      case "bigint":
        return `${e.value}n`;
      case "null":
        return "null";
      case "this":
        return "this";
      case "super":
        return "super";
      case "regex":
        return `/${e.pattern}/${e.flags}`;
      case "bool":
        return e.value ? "true" : "false";
      case "string":
        return JSON.stringify(e.value);
      case "template": {
        let text = "`";
        for (let i: usize = 0; i < e.raw.length; i++) {
          text += e.raw[i]!;
          if (i < e.exprs.length) text += `\${${this.expr(e.exprs[i]!)}}`;
        }
        return `${text}\``;
      }
      case "ident":
        return this.ident(e);
      case "spread":
        return `...${this.expr(e.value)}`;
      case "array": {
        let parts: string[] = [];
        for (const x of e.elements) {
          if (x === undefined) {
            parts.push("");
            continue;
          }
          const element: Ref<Expr> = x!;
          parts.push(element.kind === "spread" ? `...${this.expr(element.value)}` : this.value(element));
        }
        return `[${parts.join(", ")}]`;
      }
      case "object":
        return this.object(e);
      case "arrow":
      case "function":
        return this.closure(e);
      case "member":
        return this.member(e);
      case "index": {
        const object = this.expr(e.object);
        const held = this.kind(this.typeOf(e.object));
        if ((held === "array" || held === "fixed") && !e.optional) return `$fsh.at(${object}, ${this.expr(e.index)}, ${this.place(e)})`;
        return `${object}${e.optional ? "?." : ""}[${this.expr(e.index)}]`;
      }
      case "call":
        return this.call(e);
      case "new":
        return this.made(e);
      case "instantiation":
        return this.expr(e.expr);
      case "nonNull": {
        const inner = this.expr(e.expr);
        const t = this.typeOf(e.expr);
        if (e.redundant === true || t === undefined || (t !== "null" && !this.checked.tables.typing.isOption(t!))) return inner;
        return `$fsh.some(${inner}, ${JSON.stringify(e.reason ?? "called `Option::unwrap()` on a `None` value")}, ${this.place(e)})`;
      }
      case "throw":
        return `$fsh.raise(${this.value(e.value)})`;
      case "unary":
        return this.unary(e);
      case "update":
        return this.update(e);
      case "binary":
        return this.binary(e);
      case "conditional":
        return `(${this.expr(e.cond)} ? ${this.value(e.then)} : ${this.value(e.else)})`;
      case "assign":
        return this.assign(e);
      case "pipe":
        return `(($topic) => ${this.value(e.body)})(${this.value(e.value)})`;
      case "topic":
        return "$topic";
      case "destructure":
        return `(${this.pattern(e.pattern)} = ${this.value(e.value)})`;
      case "sequence": {
        let parts: string[] = [];
        for (const x of e.exprs) parts.push(this.expr(x));
        return `(${parts.join(", ")})`;
      }
      case "yield":
        return `(yield${e.delegate ? "*" : ""}${e.value !== undefined ? ` ${this.value(e.value!)}` : ""})`;
      case "as":
      case "satisfies":
      case "assertion":
        return this.converted(e.expr, this.typeOf(e), { start: e.start, end: e.end });
      case "match":
        throw this.refused("'match' expressions", e);
      case "comptime":
        throw this.refused("comptime expressions", e);
      case "unsafe":
        throw this.refused("'unsafe' expressions", e);
      case "class":
        throw this.refused("class expressions", e);
      case "tagged":
        throw this.refused("tagged templates", e);
      default:
        throw this.refused(`'${e.kind}' expressions`, { start: e.start, end: e.end });
    }
  }

  // `x as T`: a number converted to another numeric type, or the value as it is.
  /** @throws {CompileError} */
  converted(this: Mut<this>, inner: Ref<Expr>, to: Type | undefined, at: Ref<Span>): string {
    const text = this.expr(inner);
    const from = this.plain(this.typeOf(inner));
    const target = this.plain(to);
    if (from === undefined || target === undefined || from === target) return text;
    const numeric = (t: Type) => isInteger(t) || isFloat(t) || t === "bigint";
    if (!numeric(from!) || !numeric(target!)) return text;
    const same = (t: Type): string => (isFloat(t) ? "float" : heldAs(t as Integer | "bigint"));
    if (isFloat(from!) && target === "f64") return text;
    if (same(from!) === "number" && target === "f64") return text;
    return `$fsh.cast(${text}, ${JSON.stringify(from)}, ${JSON.stringify(target)}, ${this.place(at)})`;
  }

  /** @throws {CompileError} */
  ident(this: Mut<this>, e: Ref<Extract<Expr, { kind: "ident" }>>): string {
    const read = this.inst(this.current).calls.get(e);
    if (read !== undefined && this.bodyAt(read!).comptime === "const") return `${this.functionName(read!, e)}()`;
    if (this.checked.tables.jsExports.has(e)) throw this.refused("npm packages", e);
    const local = this.inst(this.current).locals.get(e);
    if (local !== undefined) return this.localName(local!);
    const literal = this.literal(this.typeOf(e));
    return literal ?? (e.name === "undefined" ? "undefined" : e.name);
  }

  // A literal type's value, as an enum member or a constant read gives it.
  literal(t: Type | undefined): string | undefined {
    if (t === undefined || typeof t === "string") return undefined;
    const r = this.checked.tables.typing.rec(t);
    if (r.kind !== "literal") return undefined;
    return typeof r.value === "string" ? JSON.stringify(r.value) : literalText(r.value);
  }

  /** @throws {CompileError} */
  member(this: Mut<this>, e: Ref<Extract<Expr, { kind: "member" }>>): string {
    if (e.object.kind === "ident" && !this.inst(this.current).locals.has(e.object)) {
      const literal = this.literal(this.typeOf(e));
      const owner = this.literal(this.typeOf(e)) !== undefined ? this.enumOwned(this.typeOf(e)) : false;
      if (literal !== undefined && owner) return literal!;
    }
    return `${this.expr(e.object)}${memberText(e.name, e.optional)}`;
  }

  enumOwned(t: Type | undefined): boolean {
    if (t === undefined || typeof t === "string") return false;
    const r = this.checked.tables.typing.rec(t);
    return r.kind === "literal" && r.owner !== undefined;
  }

  /** @throws {CompileError} */
  object(this: Mut<this>, e: Ref<Extract<Expr, { kind: "object" }>>): string {
    let parts: string[] = [];
    for (const p of e.props) parts.push(this.property(p));
    const text = `{ ${parts.join(", ")} }`;
    return this.kind(this.typeOf(e)) === "map" ? `$fsh.dict(${text})` : `(${text})`;
  }

  /** @throws {CompileError} */
  property(this: Mut<this>, p: Ref<ObjectProp>): string {
    switch (p.kind) {
      case "property":
        return `${this.key(p.key)}: ${this.value(p.value)}`;
      case "shorthand": {
        const local = this.inst(this.current).locals.get(p);
        return `${this.key(p.name)}: ${local !== undefined ? this.localName(local!) : p.name}`;
      }
      case "spread":
        return `...${this.expr(p.value)}`;
      default:
        throw this.refused("object literal methods and accessors", { start: p.start, end: p.end });
    }
  }

  // An arrow or function expression, written in place from its closure's instance.
  /** @throws {CompileError} */
  closure(this: Mut<this>, e: Ref<Expr>): string {
    const id = this.inst(this.current).calls.get(e);
    if (id === undefined) throw this.refused("functions of this form", { start: e.start, end: e.end });
    const outer = this.current;
    this.current = id!;
    try {
      if (this.bodyAt(id!).generator === true) throw this.refused("generator function expressions", { start: e.start, end: e.end });
      const prefix = this.bodyAt(id!).async === true ? "async " : "";
      const params = this.params(id!);
      const statements = this.takeBody(id!);
      let text = "";
      try {
        text = this.block(statements, "    ");
      } finally {
        this.putBody(id!, statements);
      }
      return e.kind === "function" ? `(${prefix}function (${params}) {\n${text}  })` : `(${prefix}(${params}) => {\n${text}  })`;
    } finally {
      this.current = outer;
    }
  }

  /** @throws {CompileError} */
  call(this: Mut<this>, e: Ref<Extract<Expr, { kind: "call" }>>): string {
    const callee: Ref<Expr> = e.callee;
    if (callee.kind === "super") return `super(${this.args(e.args)})`;
    if (this.checked.tables.printCalls.has(e)) {
      let parts: string[] = [];
      for (const a of e.args) {
        const text = this.value(a);
        const t = this.integer(this.typeOf(a));
        parts.push(t !== undefined && t !== "bigint" && heldAs(t!) === "big" ? `$fsh.text(${text})` : text);
      }
      const stream = callee.kind === "member" ? callee.name : "log";
      return `console.${printStream(callee) === 1 ? "log" : stream}(${parts.join(", ")})`;
    }
    const asserted = this.checked.tables.asserts.get(e);
    if (asserted !== undefined) {
      const message = e.args.length > 1 ? `() => ${this.value(e.args[1]!)}` : "undefined";
      return `$fsh.check(${this.expr(e.args[0]!)}, ${message}, ${JSON.stringify(asserted)}, ${this.place(e)})`;
    }
    const parsed = this.checked.tables.parses.get(e);
    if (parsed !== undefined) return `$fsh.parse(${JSON.stringify(parsed)}, ${this.args(e.args)})`;
    if (this.checked.tables.stringBuilds.has(e)) return `${this.expr(callee)}(...${this.expr(e.args[0]!)})`;
    this.refuseNative(e);
    const target = this.inst(this.current).calls.get(e);
    const args = this.args(e.args);
    const open = e.optional ? "?.(" : "(";
    if (target === undefined) {
      if (callee.kind === "member" && callee.name === "clone" && e.args.length === 0) return `$fsh.clone(${this.expr(callee.object)})`;
      if (this.kind(this.typeOf(callee)) === "variant") throw this.refused("data-carrying enum variants", e);
      return `${this.expr(callee)}${open}${args})`;
    }
    if (this.bodyAt(target!).closure !== undefined || this.inst(this.current).envs?.has(callee) === true || this.inst(this.current).envs?.has(e) === true) return `${this.expr(callee)}${open}${args})`;
    const selfType = this.bodyAt(target!).self?.type;
    const constructs = this.bodyAt(target!).self?.constructor === true;
    if (selfType !== undefined && !constructs) {
      const m = memberOf(this.bodyAt(target!).name);
      const owner = this.reachClass(selfType!, e);
      this.reach(target!, e);
      const name = memberText(this.methodNames.get(target!) ?? m?.name ?? "", false);
      if (m !== undefined && m.static) return `${owner}${name}${open}${args})`;
      if (callee.kind === "member") return `${this.expr(callee.object)}${callee.optional ? "?" : ""}${name}${open}${args})`;
      if (callee.kind === "index") return `${this.expr(callee.object)}${name}${open}${args})`;
      throw this.refused("methods called this way", e);
    }
    if (callee.kind === "ident" && this.inst(this.current).locals.has(callee)) return `${this.expr(callee)}${open}${args})`;
    // A method of a built-in type that std writes as a function takes its receiver first.
    const receiver = callee.kind === "member" && this.bodyAt(target!).params.length === e.args.length + 1 ? this.value(callee.object) : undefined;
    const given = receiver !== undefined ? (args === "" ? receiver! : `${receiver!}, ${args}`) : args;
    return `${this.functionName(target!, e)}${open}${given})`;
  }

  // The calls only the native runtime can make.
  /** @throws {CompileError} */
  refuseNative(e: Ref<Expr>): void {
    const t: Ref<Tables> = this.checked.tables;
    const at: Span = { start: e.start, end: e.end };
    if (t.jsCalls.has(e) || t.jsStatics.has(e)) throw this.refused("npm packages", at);
    if (t.integerCalls.has(e)) throw this.refused("the integer methods named for how they overflow", at);
    if (t.simdCalls.has(e)) throw this.refused("SIMD lanes", at);
    if (t.fileCalls.has(e) || t.syncFileCalls.has(e)) throw this.refused("file reads and writes", at);
    if (t.joinCalls.has(e) || t.groupCalls.has(e) || t.blockingRuns.has(e)) throw this.refused("threads and task groups", at);
    if (t.inspectCalls.has(e)) throw this.refused("'inspect' calls", at);
    if (t.deepEqualities.has(e)) throw this.refused("deep equality checks", at);
  }

  /** @throws {CompileError} */
  made(this: Mut<this>, e: Ref<Extract<Expr, { kind: "new" }>>): string {
    if (this.checked.tables.jsNews.has(e)) throw this.refused("npm packages", e);
    const args = e.args !== undefined ? this.args(e.args!) : "";
    const target = this.inst(this.current).calls.get(e);
    if (target !== undefined) {
      const selfType = this.bodyAt(target!).self?.type;
      if (selfType !== undefined && this.bodyAt(target!).self?.constructor === true) {
        const name = this.reachClass(selfType!, e);
        this.reach(target!, e);
        return `new ${name}(${args})`;
      }
    }
    const kind = this.kind(this.typeOf(e));
    if (kind === "interior" || kind === "shared" || kind === "handle" || kind === "block") throw this.refused("cells, shared values and runtime handles", e);
    return `new ${this.expr(e.callee)}(${args})`;
  }

  /** @throws {CompileError} */
  unary(this: Mut<this>, e: Ref<Extract<Expr, { kind: "unary" }>>): string {
    const operand = this.value(e.operand);
    const t = this.integer(this.typeOf(e));
    if (e.op === "-" && t !== undefined) {
      const zero = heldAs(t!) === "big" ? "0n" : "0";
      return `$fsh.ar("-", ${zero}, ${operand}, ${JSON.stringify(t)}, ${this.place(e)}, "negate")`;
    }
    if (e.op === "~" && t !== undefined) return `$fsh.not(${operand}, ${JSON.stringify(t)}, ${this.place(e)})`;
    if (e.op === "typeof") {
      const held = this.integer(this.typeOf(e.operand));
      if (held !== undefined && held !== "bigint" && heldAs(held!) === "big") return `"number"`;
      return `(typeof ${operand})`;
    }
    if (e.op === "await" || e.op === "void" || e.op === "delete") return `(${e.op} ${operand})`;
    return `(${e.op}${operand})`;
  }

  // A JavaScript target the value goes into, and how to read it again: `x`, `o.f` or `o[i]`.
  /** @throws {CompileError} */
  update(this: Mut<this>, e: Ref<Extract<Expr, { kind: "update" }>>): string {
    const t = this.integer(this.typeOf(e.operand));
    if (t === undefined) return e.prefix ? `(${e.op}${this.expr(e.operand)})` : `(${this.expr(e.operand)}${e.op})`;
    const one = heldAs(t!) === "big" ? "1n" : "1";
    const op = e.op === "++" ? "+" : "-";
    const named = JSON.stringify(t);
    const place = this.place(e);
    const step = (old: string) => `$fsh.ar("${op}", ${old}, ${one}, ${named}, ${place})`;
    return this.changed(e.operand, step, !e.prefix);
  }

  // A target changed through `step`, which reads it: an update or a compound assignment. A member
  // or element goes through `$fsh.upd`, so its object and key run once.
  /** @throws {CompileError} */
  changed(this: Mut<this>, target: Ref<Expr>, step: (old: string) => string, post: boolean): string {
    if (target.kind === "member") return `$fsh.upd(${this.expr(target.object)}, ${JSON.stringify(target.name.replace(/@.*$/, ""))}, ($old) => ${step("$old")}, ${post ? "true" : "false"})`;
    if (target.kind === "index") {
      const held = this.kind(this.typeOf(target.object));
      const object = this.expr(target.object);
      const index = this.expr(target.index);
      if (held === "array" || held === "fixed") return `(($o, $k) => $fsh.upd($o, $fsh.ix($o, $k, ${this.place(target)}), ($old) => ${step("$old")}, ${post ? "true" : "false"}))(${object}, ${index})`;
      return `$fsh.upd(${object}, ${index}, ($old) => ${step("$old")}, ${post ? "true" : "false"})`;
    }
    const name = this.expr(target);
    if (post) return `(($old) => (${name} = ${step("$old")}, $old))(${name})`;
    return `(${name} = ${step(name)})`;
  }

  /** @throws {CompileError} */
  binary(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): string {
    const op = e.op;
    if (op === "===" || op === "!==" || op === "==" || op === "!=") return this.equality(e);
    if (op === "instanceof") return `(${this.expr(e.left)} instanceof ${this.className(e.right)})`;
    const t = this.integer(this.typeOf(e));
    const operand = this.integer(this.typeOf(e.left));
    const left = this.value(e.left);
    const right = this.value(e.right);
    if (t !== undefined && ARITHMETIC.has(op)) return `$fsh.ar("${op}", ${left}, ${right}, ${JSON.stringify(t)}, ${this.place(e)})`;
    if (t !== undefined && BITWISE.has(op)) return `$fsh.bit("${op}", ${left}, ${right}, ${JSON.stringify(t)}, ${this.place(e)})`;
    if (operand !== undefined && SHIFTS.has(op)) return `$fsh.sh("${op}", ${left}, ${right}, ${JSON.stringify(operand)}, ${this.place(e)})`;
    if (BITWISE.has(op) && this.plain(this.typeOf(e)) === "boolean") return `((${left} ${op} ${right}) !== 0)`;
    return `(${left} ${op} ${right})`;
  }

  // A class named on the right of `instanceof`, by the name it has in the module.
  /** @throws {CompileError} */
  className(this: Mut<this>, e: Ref<Expr>): string {
    if (e.kind === "ident" && !this.inst(this.current).locals.has(e)) {
      const c = this.classesByName.get(e.name);
      if (c !== undefined) return this.reachClass(c!, e);
    }
    return this.expr(e);
  }

  /** @throws {CompileError} */
  equality(this: Mut<this>, e: Ref<Extract<Expr, { kind: "binary" }>>): string {
    const negated = e.op === "!==" || e.op === "!=";
    const empty = (x: Ref<Expr>) => x.kind === "null" || (x.kind === "ident" && x.name === "undefined" && !this.inst(this.current).locals.has(x)) || this.typeOf(x) === "null";
    if (empty(e.left) || empty(e.right)) return `(${this.expr(e.left)} ${negated ? "!=" : "=="} ${this.expr(e.right)})`;
    if (this.compound(this.typeOf(e.left)) || this.compound(this.typeOf(e.right))) throw this.refused("comparisons of objects, arrays and instances", e);
    return `(${this.expr(e.left)} ${negated ? "!==" : "==="} ${this.expr(e.right)})`;
  }

  // Whether a value of the type is an object, an array or an instance, which Fish compares by
  // what it holds and JavaScript by identity.
  compound(t: Type | undefined): boolean {
    const kind = this.kind(t);
    return kind === "object" || kind === "class" || kind === "array" || kind === "map" || kind === "fixed" || kind === "variant";
  }

  /** @throws {CompileError} */
  assign(this: Mut<this>, e: Ref<Extract<Expr, { kind: "assign" }>>): string {
    const target: Ref<Expr> = e.target;
    if (target.kind === "ident") {
      const local = this.inst(this.current).locals.get(target);
      if (local !== undefined && this.kind(this.checked.tables.arenas.localOf(local!)!.type) === "ref") throw this.refused("assignments through a borrow", e);
    }
    const op = e.op;
    const t = this.integer(this.typeOf(target));
    if (op !== "=" && op !== "&&=" && op !== "||=" && op !== "??=" && t !== undefined) {
      const bare = op.slice(0, -1);
      const value = this.value(e.value);
      const place = this.place(e);
      const named = JSON.stringify(t);
      const helper = ARITHMETIC.has(bare) ? "ar" : BITWISE.has(bare) ? "bit" : "sh";
      return this.changed(target, (old: string) => `$fsh.${helper}("${bare}", ${old}, ${value}, ${named}, ${place})`, false);
    }
    let left = "";
    if (target.kind === "index") {
      const held = this.kind(this.typeOf(target.object));
      const object = this.expr(target.object);
      left = held === "array" || held === "fixed" ? `${object}[$fsh.ix(${object}, ${this.expr(target.index)}, ${this.place(target)})]` : `${object}[${this.expr(target.index)}]`;
    } else left = this.expr(target);
    return `(${left} ${op} ${this.value(e.value)})`;
  }

  // The `.d.ts` for the exports: each function's parameters and result, and each class a
  // signature names, by its public fields.
  declarations(exports: Ref<[string, InstanceId][]>): string {
    let lines: string[] = [];
    let named = new Map<usize, ClassType>();
    for (const [name, id] of exports) {
      let params: string[] = [];
      const count = this.bodyAt(id).params.length;
      for (let i: usize = 0; i < count; i++) {
        const p: Ref<Param> = this.bodyAt(id).params[i]!;
        const local = this.inst(id).locals.get(p);
        const t = local !== undefined ? this.checked.tables.arenas.localOf(local!)!.type : "never";
        const shown = local !== undefined ? this.localName(local!) : `arg${i}`;
        params.push(`${p.rest ? "..." : ""}${shown}: ${this.tsType(t, named)}`);
      }
      const returns = this.inst(id).returns;
      const shown = this.tsType(returns, named);
      const result = this.bodyAt(id).async === true && this.kind(returns) !== "future" ? `Promise<${shown}>` : shown;
      lines.push(`export declare function ${name}(${params.join(", ")}): ${result};`);
    }
    for (const [key, c] of named) {
      const r = this.checked.tables.typing.rec(c);
      let fields: string[] = [];
      let none = new Map<usize, ClassType>();
      for (const f of r.fields) if (!f.name.startsWith("#") && f.access === undefined) fields.push(`  ${f.name}: ${this.tsType(f.type, none)};`);
      const name = this.classNames.get(key) ?? r.name;
      lines.unshift(`export declare class ${name} {\n${fields.join("\n")}${fields.length > 0 ? "\n" : ""}  private constructor();\n}`);
    }
    if (lines.length === 0) lines.push("export {};");
    return `${lines.join("\n")}\n`;
  }

  // How TypeScript names a type a declaration gives: sized numbers as `number`, or `bigint` for
  // those held as BigInts, and the rest structurally. A class is named, and kept in `named`.
  tsType(t: Type, named: Mut<Map<usize, ClassType>>): string {
    const typing: Ref<Typing> = this.checked.tables.typing;
    const p = this.plain(t) ?? "never";
    if (typeof p === "string") {
      if (isFloat(p)) return "number";
      if (p === "bigint") return "bigint";
      if (isInteger(p)) return heldAs(p) === "big" ? "bigint" : "number";
      return p;
    }
    const r = typing.rec(p);
    switch (r.kind) {
      case "array":
      case "fixed":
        return `${this.wrapped(this.tsType(r.element, named))}[]`;
      case "object": {
        if (r.tuple === true) {
          let parts: string[] = [];
          for (const f of r.fields) parts.push(this.tsType(f.type, named));
          return `[${parts.join(", ")}]`;
        }
        let parts: string[] = [];
        for (const f of r.fields) parts.push(`${IDENTIFIER.test(f.name) ? f.name : JSON.stringify(f.name)}: ${this.tsType(f.type, named)}`);
        return `{ ${parts.join("; ")} }`;
      }
      case "union": {
        let parts: string[] = [];
        for (const m of r.members) parts.push(m === "null" ? "null | undefined" : this.tsType(m, named));
        return parts.join(" | ");
      }
      case "map":
        return r.set ? `Set<${this.tsType(r.key, named)}>` : `Map<${this.tsType(r.key, named)}, ${this.tsType(r.value, named)}>`;
      case "class": {
        named.set(idOf(p), p as ClassType);
        return this.classNames.get(idOf(p)) ?? r.name;
      }
      case "closure":
      case "function": {
        let parts: string[] = [];
        for (let i: usize = 0; i < r.params.length; i++) parts.push(`arg${i}: ${this.tsType(r.params[i]!, named)}`);
        return `((${parts.join(", ")}) => ${this.tsType(r.returns, named)})`;
      }
      case "future":
        return `Promise<${this.tsType(r.gives, named)}>`;
      default:
        return "unknown";
    }
  }

  wrapped(text: string): string {
    return text.includes(" ") ? `(${text})` : text;
  }
}
