// What the language server reads from a check to answer hover, definition and references: each
// expression's type, and the declaration each name use, call, member read and import names.
// Offsets are the program's, as the check's spans are; the server turns them into positions.
import type { Arenas, BodyId, ClassId, InstanceId } from "./arenas.fsh";
import type { Checked } from "./check.fsh";
import type { ClassInfo } from "./classes.fsh";
import type { Module } from "./modules.fsh";
import type { Callee, Site } from "./nodes.fsh";
import type { Expr, Stmt } from "./parser.fsh";
import type { ClassType, Type, Typing } from "./typing.fsh";

// A declaration, by where its name is written.
export type Declared = { start: usize; end: usize };
// A place that names a declaration.
export type Use = { start: usize; end: usize; decl: Declared };
// An expression and its type; `name` is set when the expression is a name or a member read.
export type Typed = { start: usize; end: usize; type: Type; name?: string };

export class Index {
  typed: Typed[];
  uses: Use[];
  // Every declaration a use names, by where its name starts.
  decls: Map<usize, Declared>;

  constructor(checked: Ref<Checked>, modules: Ref<Module[]>) {
    this.typed = [];
    this.uses = [];
    this.decls = new Map<usize, Declared>();
    this.read(checked, modules);
  }

  // A generic body's definition and its instances share nodes; the definition's types win, since
  // they are what the source says, `T` included.
  read(this: Mut<this>, checked: Ref<Checked>, modules: Ref<Module[]>) {
    const arenas: Ref<Arenas> = checked.tables.arenas;
    let classes = new Map<ClassType, ClassId>();
    for (let c: usize = 1; c <= arenas.classCount(); c++) classes.set(arenas.classOf(c as ClassId).type, c as ClassId);
    let typedAt = new Map<usize, [usize, boolean]>();
    let localDecls = new Map<usize, Declared>();
    for (let i: usize = 1; i <= arenas.instanceCount(); i++) {
      const instance = arenas.instanceOf(i as InstanceId);
      const definition = !instance.concrete;
      for (const [e, t] of instance.types.entries()) {
        const was = typedAt.get(e.id);
        if (was !== undefined && (was![1] || !definition)) continue;
        let typed: Typed = { start: e.start, end: e.end, type: t };
        if (e.name !== undefined) typed.name = e.name;
        if (was === undefined) {
          typedAt.set(e.id, [this.typed.length, definition]);
          this.typed.push(typed);
        } else {
          this.typed[was![0]] = typed;
          typedAt.set(e.id, [was![0], definition]);
        }
      }
      for (const [node, local] of instance.locals.entries()) {
        if (!checked.tables.declarations.has(node.id)) continue;
        localDecls.set(local, named(modules, node.start, node.end, arenas.localOf(local).name));
      }
    }
    let seen = new Set<string>();
    for (let i: usize = 1; i <= arenas.instanceCount(); i++) {
      const instance = arenas.instanceOf(i as InstanceId);
      for (const [node, local] of instance.locals.entries()) {
        if (checked.tables.declarations.has(node.id)) continue;
        const decl = localDecls.get(local);
        if (decl !== undefined) this.use(seen, named(modules, node.start, node.end, arenas.localOf(local).name), decl!);
      }
      for (const [site, called] of instance.calls.entries()) {
        const target = targetOf(arenas, called, modules);
        if (target === undefined) continue;
        const at = siteCallee(modules, site, target!.name);
        if (at !== undefined) this.use(seen, at!, target!.decl);
      }
      for (const [e, called] of instance.setters.entries()) {
        const target = targetOf(arenas, called, modules);
        if (target === undefined) continue;
        const at = calleeOf(modules, e, target!.name);
        if (at !== undefined) this.use(seen, at!, target!.decl);
      }
      for (const [e] of instance.types.entries()) {
        if (e.kind !== "member" || e.object === undefined || e.name === undefined || instance.calls.getById(e.id) !== undefined) continue;
        const object = instance.types.getById(e.object!.id);
        if (object === undefined) continue;
        const field = fieldOf(checked, classes, object!, e.name!);
        if (field !== undefined) this.use(seen, named(modules, e.object!.end, e.end, e.name!), field!);
      }
    }
    for (const m of modules) this.imports(seen, modules, m);
  }

  use(this: Mut<this>, seen: Mut<Set<string>>, at: Declared, decl: Declared) {
    const key = `${at.start}:${decl.start}`;
    if (seen.has(key)) return;
    seen.add(key);
    this.decls.set(decl.start, { start: decl.start, end: decl.end });
    this.uses.push({ start: at.start, end: at.end, decl });
  }

  // An import's module string names the file it loads, and each name it imports that file's
  // declaration of it.
  imports(this: Mut<this>, seen: Mut<Set<string>>, modules: Ref<Module[]>, m: Ref<Module>) {
    for (const s of m.statements) {
      if (s.kind !== "import") continue;
      const target = m.targets.get(s);
      if (target === undefined) continue;
      const quoted = named(modules, s.start, s.end, s.module, true);
      this.use(seen, quoted, { start: target!.base, end: target!.base });
      if (s.named !== undefined) {
        for (const spec of s.named!) {
          const decl = topLevel(modules, target!, spec.name);
          if (decl !== undefined) this.use(seen, named(modules, spec.start, spec.end, spec.name), decl!);
        }
      }
      if (s.default !== undefined) {
        const decl = topLevel(modules, target!, "default");
        if (decl !== undefined) this.use(seen, named(modules, s.start, s.end, s.default!), decl!);
      }
    }
  }

  // The smallest typed expression at `offset`.
  typedAt(offset: usize): Typed | undefined {
    let best: i64 = -1;
    for (let i: usize = 0; i < this.typed.length; i++) {
      const t: Ref<Typed> = this.typed[i]!;
      if (t.start > offset || offset > t.end) continue;
      if (best < 0 || t.end - t.start < this.typed[best as usize]!.end - this.typed[best as usize]!.start) best = i as i64;
    }
    return best < 0 ? undefined : this.typed[best as usize]!.clone();
  }

  // The declaration named at `offset`: by the use there, or the declaration's own name.
  declAt(offset: usize): Declared | undefined {
    let best: i64 = -1;
    for (let i: usize = 0; i < this.uses.length; i++) {
      const u: Ref<Use> = this.uses[i]!;
      if (u.start > offset || offset > u.end) continue;
      if (best < 0 || u.end - u.start < this.uses[best as usize]!.end - this.uses[best as usize]!.start) best = i as i64;
    }
    if (best >= 0) return { start: this.uses[best as usize]!.decl.start, end: this.uses[best as usize]!.decl.end };
    for (const d of this.decls.values()) if (d.start <= offset && offset <= d.end && d.end > d.start) return { start: d.start, end: d.end };
    return undefined;
  }

  // Every place naming `decl`.
  usesOf(decl: Ref<Declared>): Declared[] {
    let out: Declared[] = [];
    for (const u of this.uses) if (u.decl.start === decl.start) out.push({ start: u.start, end: u.end });
    return out;
  }
}

// A method's, accessor's or static's own name, from the name its body is registered under.
function memberName(name: string): string {
  const parts = name.split(".");
  const last = parts[parts.length - 1]!;
  for (const prefix of ["static ", "get ", "set "]) if (last.startsWith(prefix)) return last.slice(prefix.length as i64);
  return last;
}

// The body an instance runs, by the member it copies when it is a copy, and its declared name;
// undefined for a closure, whose calls are calls of the local holding it, which `locals` covers.
function targetOf(arenas: Ref<Arenas>, called: InstanceId, modules: Ref<Module[]>): { name: string; decl: Declared } | undefined {
  let bodyId = arenas.instanceOf(called).body;
  const copied = arenas.bodyOf(bodyId).copyOf;
  if (copied !== undefined) bodyId = copied!;
  const body = arenas.bodyOf(bodyId);
  if (body.closure !== undefined) return undefined;
  const name = memberName(body.name);
  return { name, decl: named(modules, body.start, body.end, name) };
}

// Where a call, `new` or accessor read the calls table keeps names what it runs.
function siteCallee(modules: Ref<Module[]>, s: Ref<Site>, name: string): Declared | undefined {
  if (s.callee !== undefined) {
    const c: Ref<Callee> = s.callee!;
    if (c.kind === "member" && c.objectEnd !== undefined) return named(modules, c.objectEnd!, c.end, c.name ?? name);
    if (c.kind === "ident" || c.kind === "super") return { start: c.start, end: c.end };
    return undefined;
  }
  if (s.kind === "member" && s.object !== undefined) return named(modules, s.object!.end, s.end, s.name ?? name);
  return undefined;
}

// Where a call, `new` or accessor read names what it runs.
function calleeOf(modules: Ref<Module[]>, e: Ref<Expr>, name: string): Declared | undefined {
  if (e.kind === "call" || e.kind === "new") {
    const callee: Ref<Expr> = e.callee;
    if (callee.kind === "member") return named(modules, callee.object.end, callee.end, callee.name);
    if (callee.kind === "ident" || callee.kind === "super") return { start: callee.start, end: callee.end };
    return undefined;
  }
  if (e.kind === "member") return named(modules, e.object.end, e.end, e.name);
  if (e.kind === "assign" && e.target.kind === "member") return named(modules, e.target.object.end, e.target.end, name);
  return undefined;
}

// The class field `name` a value of type `t` reads, by its declaration, through references and
// the classes it extends.
function fieldOf(checked: Ref<Checked>, classes: Ref<Map<ClassType, ClassId>>, t: Type, name: string): Declared | undefined {
  const typing: Ref<Typing> = checked.tables.typing;
  let at: Type = t;
  const r = typing.recOf(at);
  if (r?.kind === "ref") at = r.to;
  if (typing.kindOf(at) !== "class") return undefined;
  let id = classes.get(at as ClassType);
  while (id !== undefined) {
    const info: Ref<ClassInfo> = checked.tables.arenas.classOf(id!);
    for (const f of info.fields) if (f.name === name) return { start: f.start, end: f.start + f.name.length };
    id = info.base;
  }
  return undefined;
}

// Where `name` is first written within `start..end` of the program, as a whole word, or the start
// of the span when it isn't; `quoted` looks for it as a string literal's text.
function named(modules: Ref<Module[]>, start: usize, end: usize, name: string, quoted = false): Declared {
  for (const m of modules) {
    if (start < m.base || start > m.base + m.src.length) continue;
    const text = m.src.slice((start - m.base) as i64, (Math.min(end, m.base + m.src.length) - m.base) as i64);
    let from: i64 = 0;
    while (true) {
      const at = text.indexOf(name, from);
      if (at < 0) break;
      const before = at === 0 ? "" : text.charAt(at - 1);
      const after = text.charAt(at + (name.length as i64));
      const word = quoted ? (before === '"' || before === "'") : !/[\w$#]/.test(before) && !/[\w$]/.test(after);
      if (word) return { start: start + (at as usize), end: start + (at as usize) + name.length };
      from = at + 1;
    }
    break;
  }
  return { start, end: start };
}

// A module's top-level declaration of `name`, exported or not.
function topLevel(modules: Ref<Module[]>, m: Ref<Module>, name: string): Declared | undefined {
  for (const s of m.statements) {
    const found = declares(s, name);
    if (found) return named(modules, s.start, s.end, name === "default" ? "default" : name);
  }
  return undefined;
}

function declares(s: Ref<Stmt>, name: string): boolean {
  if (s.kind === "export") return declares(s.body, name);
  if (s.kind === "exportDefault") return name === "default";
  if (s.kind === "function" || s.kind === "typeAlias" || s.kind === "interface" || s.kind === "enum") return s.name === name;
  if (s.kind === "class") return s.name === name;
  if (s.kind === "let") {
    for (const d of s.declarations) if (d.target.kind === "ident" && d.target.name === name) return true;
  }
  return false;
}

// A member completion offers: a field, a method, or an accessor read as a property.
export type Member = { name: string; kind: "field" | "method" | "property"; type?: Type };

// The members a value of type `t` offers after `.` at `offset`. A private or `#` member is offered
// only inside its own class, where using it compiles, and std's `__` names never are.
export function membersOf(checked: Ref<Checked>, t: Type, offset: usize): Member[] {
  const typing: Ref<Typing> = checked.tables.typing;
  let at: Type = t;
  const r = typing.recOf(at);
  if (r?.kind === "ref") at = r.to;
  const d = typing.recOf(at);
  if (d?.kind === "dyn") at = d.of;
  let out: Member[] = [];
  const kind = typing.kindOf(at);
  if (kind === "class") {
    const arenas: Ref<Arenas> = checked.tables.arenas;
    let id: ClassId | undefined = undefined;
    for (let c: usize = 1; c <= arenas.classCount(); c++) if (arenas.classOf(c as ClassId).type === at) id = c as ClassId;
    while (id !== undefined) {
      const info: Ref<ClassInfo> = arenas.classOf(id!);
      const inside = within(checked, offset, info.node.id);
      const fields = typing.fieldsOf(info.type);
      for (const f of info.fields) {
        if (!offered(f.name, f.access, inside)) continue;
        const typed = fields.find((x) => x.name === f.name);
        let m: Member = { name: f.name, kind: "field" };
        if (typed !== undefined) m.type = typed!.type;
        out.push(m);
      }
      for (const [name, body] of info.methods) if (offered(name, arenas.bodyOf(body).access, inside)) out.push({ name, kind: "method" });
      for (const [name, body] of info.getters) if (offered(name, arenas.bodyOf(body).access, inside)) out.push({ name, kind: "property" });
      id = info.base;
    }
    return unique(out);
  }
  if (kind === "interface") {
    const i = typing.recOf(at);
    if (i?.kind === "interface") {
      for (const f of i.fields) if (offered(f.name, f.access, false)) out.push({ name: f.name, kind: "field", type: f.type });
      for (const m of i.methods) if (offered(m.name, undefined, false)) out.push({ name: m.name, kind: "method" });
    }
    return unique(out);
  }
  if (typeof at === "string") return [];
  for (const f of typing.fieldsOf(at as Exclude<Type, string>)) if (offered(f.name, f.access, false)) out.push({ name: f.name, kind: "field", type: f.type });
  return unique(out);
}

// The statics of the class named `name`: its static methods and accessors and its static fields.
export function staticsOf(checked: Ref<Checked>, name: string, offset: usize): Member[] {
  const arenas: Ref<Arenas> = checked.tables.arenas;
  let out: Member[] = [];
  for (let c: usize = 1; c <= arenas.classCount(); c++) {
    const info: Ref<ClassInfo> = arenas.classOf(c as ClassId);
    if (info.node.name !== name) continue;
    const inside = within(checked, offset, info.node.id);
    for (const [key, body] of info.statics) {
      const accessor = key.startsWith("get ") || key.startsWith("set ");
      const shown = accessor ? key.slice(4) : key;
      const kind: Member["kind"] = accessor ? "property" : "method";
      if (offered(shown, arenas.bodyOf(body).access, inside)) out.push({ name: shown, kind });
    }
    for (const [key, f] of info.staticFields) if (offered(key, f.access, inside)) out.push({ name: key, kind: "field" });
    break;
  }
  return unique(out);
}

function offered(name: string, access: string | undefined, inside: boolean): boolean {
  if (name.startsWith("__") || name === "constructor") return false;
  return inside || (access !== "private" && !name.startsWith("#"));
}

// Whether `offset` is within a constructor, method or accessor of the class declared by `node`.
function within(checked: Ref<Checked>, offset: usize, node: usize): boolean {
  const arenas: Ref<Arenas> = checked.tables.arenas;
  for (let b: usize = 1; b <= arenas.bodyCount(); b++) {
    const body = arenas.bodyOf(b as BodyId);
    if (body.owner === undefined || body.start > offset || offset > body.end) continue;
    for (let c: usize = 1; c <= arenas.classCount(); c++) {
      const info: Ref<ClassInfo> = arenas.classOf(c as ClassId);
      if (info.type === body.owner! && info.node.id === node) return true;
    }
  }
  return false;
}

// A member a class and the class it extends both declare is offered once.
function unique(members: Member[]): Member[] {
  let seen = new Set<string>();
  let out: Member[] = [];
  let rest = members;
  while (rest.length > 0) {
    const m = rest.shift()!;
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    out.push(m);
  }
  return out;
}
