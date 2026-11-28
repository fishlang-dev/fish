// Rules the checker's source keeps, read by parsing src with the compiler's own parser and walking
// the trees in process. A node is told apart by what it is rather than by identity, and its tables
// are kept as indexes into one list of items.
import { join } from "node:path";
import { forEachChild, walk, walkWhile, type AnyNode } from "../../src/nodes.fsh";
import { parse, type ClassMember, type Expr, type Param, type PropertyName, type Pattern, type Stmt, type TypeNode } from "../../src/parser.fsh";
import { read, root } from "./support.fsh";

// The checker's files, read as Fish reads them: with the compiler's own parser.
function checker(): string[] {
  return ["check", "values", "typing", "resolve", "registry", "generics", "typefns", "comptime", "classes", "interfaces", "narrow", "unions", "match", "moves", "operators", "enums", "flow"];
}

type Parsed = { name: string; text: string; program: Stmt[] };

function source(name: string): string {
  return read(join(root(), "src", `${name}.fsh`));
}

function parsedFile(name: string): Parsed {
  const text = source(name);
  try {
    return { name, text, program: parse(text, { last: 0 }) };
  } catch (e) {
    assert(false, `${name}.fsh doesn't parse: ${e.message}`);
    return { name, text, program: [] };
  }
}

function parsedAll(names: Ref<string[]>): Parsed[] {
  let out: Parsed[] = [];
  for (const name of names) out.push(parsedFile(name));
  return out;
}

function lineOf(text: string, at: usize): usize {
  return text.slice(0, at as i64).split("\n").length;
}

function declared(s: Ref<Stmt>): Ref<Stmt> {
  return s.kind === "export" ? s.body : s;
}

function none(offenders: Ref<string[]>): void {
  assert(offenders.length === 0, `offenders:\n${offenders.join("\n")}`);
}

function typeName(t: Ref<TypeNode>): string | undefined {
  return t.kind === "ref" ? t.name : undefined;
}

// A module is a class whose methods take `this`, not a function returning its inner functions,
// since Fish has no methods as values to hand such a bag out with.
test("no top-level function in the checker returns an object of its own inner functions", () => {
  const parsed = parsedAll(checker());
  let offenders: string[] = [];
  for (const file of parsed) {
    for (const raw of file.program) {
      const top = declared(raw);
      if (top.kind !== "function" || top.body === undefined) continue;
      let inner = new Set<string>();
      for (const s of top.body!) {
        if (s.kind === "function") inner.add(s.name);
        if (s.kind === "let") {
          for (const d of s.declarations) {
            if (d.target.kind === "ident" && d.init !== undefined && (d.init.kind === "arrow" || d.init.kind === "function")) inner.add(d.target.name);
          }
        }
      }
      const fname = top.name;
      walkWhile({ of: "stmts", node: top.body! }, (n) => {
        if (n.of === "stmt" && n.node.kind === "function") return false;
        if (n.of === "expr" && (n.node.kind === "arrow" || n.node.kind === "function")) return false;
        if (n.of !== "stmt") return true;
        const s = n.node;
        if (s.kind !== "return" || s.value === undefined || s.value.kind !== "object") return true;
        let handed = false;
        for (const p of s.value.props) {
          if (p.kind === "shorthand" && inner.has(p.name)) handed = true;
          if (p.kind === "property" && p.value.kind === "ident" && inner.has(p.value.name)) handed = true;
        }
        if (handed) offenders.push(`${file.name}.fsh:${lineOf(file.text, s.start)}: ${fname}`);
        return true;
      });
    }
  }
  none(offenders);
});

// The method names an interface or object type with methods declares, by its name.
function hostMethods(program: Ref<Stmt[]>, methods: Mut<Map<string, Set<string>>>): void {
  for (const raw of program) {
    const s = declared(raw);
    let own = new Set<string>();
    if (s.kind === "interface") {
      for (const m of s.members) if (m.kind === "method" && typeof m.name === "string") own.add(m.name);
      if (own.size > 0) methods.set(s.name, own);
    } else if (s.kind === "typeAlias" && s.type.kind === "object") {
      for (const m of s.type.members) if (m.kind === "method" && typeof m.name === "string") own.add(m.name);
      if (own.size > 0) methods.set(s.name, own);
    }
  }
}

type Tables = { methods: Map<string, Set<string>>; fieldTypes: Map<string, string>; returns: Map<string, string> };

function classTables(name: string | undefined, members: Ref<ClassMember[]>, t: Mut<Tables>): void {
  if (name === undefined) return;
  let own = new Set<string>();
  for (const m of members) {
    if (m.kind === "method" && typeof m.name === "string") {
      own.add(m.name);
      const r = (m.returnType !== undefined ? typeName(m.returnType!) : undefined);
      if (r !== undefined) t.returns.set(m.name, r);
    }
    if (m.kind === "field" && typeof m.name === "string") {
      const f = (m.type !== undefined ? typeName(m.type!) : undefined);
      if (f !== undefined) t.fieldTypes.set(m.name, f);
    }
  }
  t.methods.set(name, own);
}

// What a name or field holding a module's instance is typed as: annotations name the class.
function classOf(e: Ref<Expr>, typed: Ref<Map<string, string>>, t: Ref<Tables>): string | undefined {
  if (e.kind === "new" && e.callee.kind === "ident") return e.callee.name;
  if (e.kind === "ident") return typed.get(e.name);
  if (e.kind === "member") return t.fieldTypes.get(e.name);
  if (e.kind === "call" && e.callee.kind === "member") return t.returns.get(e.callee.name);
  return undefined;
}

function destructured(pattern: Ref<Pattern>, of: string | undefined, at: usize, file: Ref<Parsed>, t: Ref<Tables>, offenders: Mut<string[]>): void {
  if (of === undefined || pattern.kind !== "object") return;
  const own = t.methods.get(of);
  if (own === undefined) return;
  let taken: string[] = [];
  for (const p of pattern.props) if (typeof p.key === "string" && own.has(p.key)) taken.push(p.key);
  if (taken.length > 0) offenders.push(`${file.name}.fsh:${lineOf(file.text, at)}: ${taken.join(", ")} of ${of}`);
}

// Destructuring a method takes it off its object, which Fish can't call later, so a module's
// methods are called on the object. Its data fields may still be read out by name.
test("no code in the checker destructures a method out of a module class's instance", () => {
  const parsed = parsedAll(checker());
  let t: Tables = { methods: new Map(), fieldTypes: new Map(), returns: new Map() };
  for (const file of parsed) {
    // A host interface or object type a module is handed is held to the same rule.
    hostMethods(file.program, t.methods);
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "classNode") classTables(n.node.name, n.node.members, t);
      else if (n.of === "stmt" && n.node.kind === "class") classTables(n.node.name, n.node.members, t);
    });
  }
  let offenders: string[] = [];
  for (const file of parsed) {
    let typed = new Map<string, string>();
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "param") {
        const name = (n.node.type !== undefined ? typeName(n.node.type!) : undefined);
        if (n.node.pattern.kind === "ident" && name !== undefined) typed.set(n.node.pattern.name, name);
      }
      if (n.of === "declarator") {
        const d = n.node;
        const name = (d.type !== undefined ? typeName(d.type!) : undefined);
        if (d.target.kind === "ident" && name !== undefined) typed.set(d.target.name, name);
        if (d.target.kind === "ident" && d.init !== undefined && d.init.kind === "new" && d.init.callee.kind === "ident") typed.set(d.target.name, d.init.callee.name);
      }
    });
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "declarator") destructured(n.node.target, n.node.init !== undefined ? classOf(n.node.init!, typed, t) : undefined, n.node.start, file, t, offenders);
      if (n.of === "param") destructured(n.node.pattern, (n.node.type !== undefined ? typeName(n.node.type!) : undefined), n.node.start, file, t, offenders);
    });
  }
  none(offenders);
});

// Whether a type named so lends what it holds, so a field typed with it is seen through to its
// type argument.
function lentName(name: string): boolean {
  return name === "Mut" || name === "Ref";
}

function classNames(name: string | undefined, classes: Mut<Set<string>>): void {
  if (name !== undefined) classes.add(name);
}

// Whether a class's members make it a module with a host: a field typed as an interface with
// methods, or lent mutably as a class.
function hostedBy(name: string | undefined, members: Ref<ClassMember[]>, callable: Ref<Set<string>>, classes: Ref<Set<string>>, hosted: Mut<Set<string>>): void {
  if (name === undefined) return;
  for (const m of members) {
    if (m.kind !== "field") continue;
    if (m.type === undefined || m.type.kind !== "ref") continue;
    const lent = lentName(m.type.name);
    let inner = m.type.name;
    if (lent) {
      if (m.type.args.length === 0) continue;
      const a: Ref<TypeNode> = m.type.args[0];
      if (a.kind !== "ref") continue;
      inner = a.name;
    }
    if (callable.has(inner) || (lent && classes.has(inner))) {
      hosted.add(name);
      return;
    }
  }
}

// The checker's classes that call back into a host: one with a field typed as an interface with
// methods, or lending a class mutably.
function hostedModules(parsed: Ref<Parsed[]>): Set<string> {
  let classes = new Set<string>();
  let callable = new Set<string>();
  for (const file of parsed) {
    for (const raw of file.program) {
      const s = declared(raw);
      if (s.kind === "interface" && s.members.some((m) => m.kind === "method")) callable.add(s.name);
      if (s.kind === "typeAlias" && s.type.kind === "object" && s.type.members.some((m) => m.kind === "method")) callable.add(s.name);
    }
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "classNode") classNames(n.node.name, classes);
      else if (n.of === "stmt" && n.node.kind === "class") classNames(n.node.name, classes);
    });
  }
  let hosted = new Set<string>();
  for (const file of parsed) {
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "classNode") hostedBy(n.node.name, n.node.members, callable, classes, hosted);
      else if (n.of === "stmt" && n.node.kind === "class") hostedBy(n.node.name, n.node.members, callable, classes, hosted);
    });
  }
  return hosted;
}

function heldFields(name: string | undefined, members: Ref<ClassMember[]>, hosted: Ref<Set<string>>, file: Ref<Parsed>, offenders: Mut<string[]>): void {
  for (const m of members) {
    if (m.kind !== "field") continue;
    // Lent as `Mut<Host>`, it is the host a view is made over, not owned.
    let held: string[] = [];
    if (m.type !== undefined) {
      if (m.type.kind === "union") {
        for (const t of m.type.types) if (t.kind === "ref" && !lentName(t.name)) held.push(t.name);
      } else if (m.type.kind === "ref" && !lentName(m.type.name)) held.push(m.type.name);
    }
    if (m.init !== undefined && m.init.kind === "new" && m.init.callee.kind === "ident") held.push(m.init.callee.name);
    const field = typeof m.name === "string" ? m.name : "[object Object]";
    for (const h of held) if (hosted.has(h)) offenders.push(`${file.name}.fsh:${lineOf(file.text, m.start)}: ${name ?? "undefined"}.${field} holds ${h}`);
  }
}

// A module that calls back into its host is made where it is used, over that host, and keeps
// its lasting state in data the host owns. Owned as a field, its methods would run on the
// field while the host is lent to them, which Fish refuses.
test("no class in the checker holds, as a field, a module that calls back into its host", () => {
  const parsed = parsedAll(checker());
  const hosted = hostedModules(parsed);
  let offenders: string[] = [];
  for (const file of parsed) {
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "classNode") heldFields(n.node.name, n.node.members, hosted, file, offenders);
      else if (n.of === "stmt" && n.node.kind === "class") heldFields(n.node.name, n.node.members, hosted, file, offenders);
    });
  }
  assert(hosted.size > 0, "no class calls back into a host");
  none(offenders);
});

function stateful(name: string | undefined, members: Ref<ClassMember[]>, hosted: Ref<Set<string>>, file: Ref<Parsed>, offenders: Mut<string[]>): void {
  if (name === undefined || !hosted.has(name)) return;
  for (const m of members) {
    if (m.kind === "field" && m.init !== undefined) offenders.push(`${file.name}.fsh:${lineOf(file.text, m.start)}: ${name}.${typeof m.name === "string" ? m.name : "[object Object]"}`);
  }
}

// A view is made anew at each use, so state of its own would silently start over each time; what
// has to last lives in the data its host owns.
test("no module that calls back into its host keeps state of its own", () => {
  const parsed = parsedAll(checker());
  const hosted = hostedModules(parsed);
  let offenders: string[] = [];
  for (const file of parsed) {
    walk({ of: "stmts", node: file.program }, (n) => {
      if (n.of === "classNode") stateful(n.node.name, n.node.members, hosted, file, offenders);
      else if (n.of === "stmt" && n.node.kind === "class") stateful(n.node.name, n.node.members, hosted, file, offenders);
    });
  }
  none(offenders);
});

// Fish checks a file with everything it imports, so a checker file reaching the CLI, the package
// manager or codegen fails on their imports before its own code. A module joining this list is a
// choice: it is checked with the checker from then on.
function checkerReaches(): string[] {
  return [
    "arenas", "ast", "callbacks", "check", "classes", "compilation", "comptime", "declarations", "defaults", "diag", "edits", "enums", "expressions", "flow", "generics", "ids",
    "interfaces", "jsx", "keys", "lexer", "locals", "match", "moves", "narrow", "nodes", "operators", "overloads", "ownership", "parseargs", "parser", "patterns", "program",
    "quote", "reads", "rebuild", "regex", "registry", "resolve", "rust", "sizes", "std", "suggest", "typefns", "types", "typing", "unions", "unsupported", "values",
    "walk", "warnings",
  ];
}

test("the checker's files reach only the modules meant to be checked with them", () => {
  let reached = new Set<string>();
  let pending = checker();
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (reached.has(name)) continue;
    reached.add(name);
    const text = source(name);
    // `from "./m.fsh"`, a side-effect `import "./m.fsh"`, and `import("./m.fsh")`, dynamic or in a type.
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']\.\/([\w.-]+)\.fsh["']/g)) pending.push(m[1]);
  }
  let got: string[] = [];
  for (const r of reached) got.push(r);
  got.sort();
  assert(JSON.stringify(got) === JSON.stringify(checkerReaches()), `reached:\n${JSON.stringify(got)}\n--- expected\n${JSON.stringify(checkerReaches())}`);
});

// A function, method, constructor, top-level arrow, nested function or interface method, and
// what it declares it throws.
type Item = {
  file: string;
  kind: string;
  className: string | undefined;
  name: string;
  start: usize;
  end: usize;
  hasBody: boolean;
  throwsSet: Set<string>;
  throwingParams: Set<string>;
};

// What the analysis reads: the items, each file's text and imports, and the items by where and
// what they are, kept as indexes into `items`.
type Throws = {
  items: Item[];
  texts: Map<string, string>;
  // `file|local` to the file it is imported from and the name it is exported as.
  imports: Map<string, [string, string]>;
  aliases: Set<string>;
  // `file|name` to its functions and top-level arrows.
  named: Map<string, usize[]>;
  // `class|name` to its members, interface methods included.
  members: Map<string, usize[]>;
  // `file|start` to the item a function, arrow or member there is.
  at: Map<string, usize>;
  impls: Map<string, string[]>;
  fieldReceivers: Map<string, string>;
  hostOfClass: Map<string, string>;
  paramReceivers: Map<string, string>;
};

function typeNames(t: Ref<TypeNode> | undefined): string[] {
  if (t === undefined) return [];
  if (t.kind === "ref") return [t.name];
  let out: string[] = [];
  if (t.kind === "union") for (const x of t.types) for (const n of typeNames(x)) out.push(n);
  return out;
}

function noNames(): string[] {
  return [];
}

function setOf(names: Ref<string[]>): Set<string> {
  let s = new Set<string>();
  for (const n of names) s.add(n);
  return s;
}

function throwingParams(params: Ref<Param[]>, aliases: Ref<Set<string>>): Set<string> {
  let res = new Set<string>();
  for (const p of params) {
    if (p.pattern.kind === "ident" && p.pattern.name !== "" && p.type !== undefined) {
      if (p.type.kind === "function" && p.type.throws !== undefined) res.add(p.pattern.name);
      if (p.type.kind === "ref" && aliases.has(p.type.name)) res.add(p.pattern.name);
    }
  }
  return res;
}

function listAt(map: Ref<Map<string, usize[]>>, key: string): usize[] {
  const got = map.get(key);
  if (got === undefined) return [];
  return got;
}

function addTo(map: Mut<Map<string, usize[]>>, key: string, i: usize): void {
  let list = listAt(map, key);
  list.push(i);
  map.set(key, list);
}

function add(cx: Mut<Throws>, item: Item, where: string): void {
  const i = cx.items.length;
  if (item.kind === "function" || item.kind === "arrow") addTo(cx.named, `${item.file}|${item.name}`, i);
  if (item.className !== undefined) addTo(cx.members, `${item.className}|${item.name}`, i);
  if (item.hasBody) cx.at.set(`${item.file}|${where}|${item.start}`, i);
  cx.items.push(item);
}

function item(file: string, kind: string, className: string | undefined, name: string, start: usize, end: usize, hasBody: boolean, throws: string[], params: Ref<Param[]>, aliases: Ref<Set<string>>): Item {
  return { file, kind, className, name, start, end, hasBody, throwsSet: setOf(throws), throwingParams: throwingParams(params, aliases) };
}

function nameOf(n: Ref<PropertyName>): string {
  return typeof n === "string" ? n : "";
}

function classItems(cx: Mut<Throws>, file: string, name: string | undefined, members: Ref<ClassMember[]>): void {
  for (const m of members) {
    if ((m.kind === "method" || m.kind === "get" || m.kind === "set") && typeof m.name === "string" && m.body !== undefined) {
      const throws = m.kind === "method" && m.throws !== undefined ? typeNames(m.throws!) : noNames();
      const it = item(file, m.kind, name, nameOf(m.name), m.start, m.end, true, throws, m.params, cx.aliases);
      add(cx, it, "member");
    } else if (m.kind === "constructor" && m.body !== undefined && name !== undefined) {
      const it = item(file, "constructor", name, "constructor", m.start, m.end, true, m.throws !== undefined ? typeNames(m.throws!) : noNames(), m.params, cx.aliases);
      add(cx, it, "member");
    }
  }
}

function collect(cx: Mut<Throws>, file: string, prog: Ref<Stmt[]>): void {
  for (const raw of prog) {
    if (raw.kind === "import" && raw.module.startsWith("./") && raw.module.endsWith(".fsh") && raw.named !== undefined) {
      const fromFile = raw.module.slice(2, -4);
      for (const spec of raw.named!) cx.imports.set(`${file}|${spec.alias ?? spec.name}`, [fromFile, spec.name]);
    }
    const s = declared(raw);
    if (s.kind === "function" && s.body !== undefined) {
      const it = item(file, "function", undefined, s.name, s.start, s.end, true, s.throws !== undefined ? typeNames(s.throws!) : noNames(), s.params, cx.aliases);
      add(cx, it, "function");
    } else if (s.kind === "let") {
      for (const d of s.declarations) {
        if (d.target.kind === "ident" && d.init !== undefined && d.init.kind === "arrow") {
          const it = item(file, "arrow", undefined, d.target.name, d.init.start, d.init.end, true, d.init.throws !== undefined ? typeNames(d.init.throws!) : noNames(), d.init.params, cx.aliases);
          add(cx, it, "arrow");
        }
      }
    } else if (s.kind === "interface") {
      for (const m of s.members) {
        if (m.kind !== "method" || typeof m.name !== "string") continue;
        const it = item(file, "interfaceMethod", s.name, m.name, m.start, m.end, false, m.throws !== undefined ? typeNames(m.throws!) : noNames(), m.params, cx.aliases);
        add(cx, it, "");
      }
    } else if (s.kind === "typeAlias" && s.type.kind === "object") {
      for (const m of s.type.members) {
        if (m.kind !== "method" || typeof m.name !== "string") continue;
        const it = item(file, "interfaceMethod", s.name, m.name, m.start, m.end, false, m.throws !== undefined ? typeNames(m.throws!) : noNames(), m.params, cx.aliases);
        add(cx, it, "");
      }
    } else if (s.kind === "class") {
      classItems(cx, file, s.name, s.members);
    }
  }
  walk({ of: "stmts", node: prog }, (n) => {
    if (n.of !== "stmt" || n.node.kind !== "function" || n.node.body === undefined) return;
    if (cx.at.has(`${file}|function|${n.node.start}`)) return;
    const it = item(file, "nestedFunction", undefined, n.node.name, n.node.start, n.node.end, true, n.node.throws !== undefined ? typeNames(n.node.throws!) : noNames(), n.node.params, cx.aliases);
    add(cx, it, "function");
  });
}

// The items a class's method of this name is, or those of a class implementing the interface.
function classItem(cx: Ref<Throws>, className: string, methodName: string): usize[] {
  const direct = listAt(cx.members, `${className}|${methodName}`);
  if (direct.length > 0) return direct;
  const impls = cx.impls.get(className);
  let out: usize[] = [];
  if (impls !== undefined) for (const c of impls) for (const i of classItem(cx, c, methodName)) out.push(i);
  return out;
}

function receiverOf(cx: Ref<Throws>, e: Ref<Expr>, cur: Ref<Item>): string | undefined {
  const host = cur.className !== undefined ? cx.hostOfClass.get(cur.className!) : undefined;
  if (e.kind === "this") return cur.className;
  if (e.kind === "ident") {
    if (e.name === "host" && host !== undefined) return host;
    if (e.name === "members") return "Members";
    if (e.name === "host" && cur.file === "unions") return "Union";
    if (e.name === "host" && (cur.file === "classes" || cur.file === "interfaces")) return "Members";
    if (e.name === "b" && cur.file === "quote") return "Builder";
    if (e.name === "unsettled" && cur.file === "enums") return "Unsettled";
    return cx.paramReceivers.get(e.name);
  }
  if (e.kind === "member") {
    if (e.object.kind === "this" && e.name === "host" && host !== undefined) return host;
    const field = cx.fieldReceivers.get(e.name);
    if (field !== undefined) return field;
  }
  if (e.kind === "call") {
    if (e.callee.kind === "member") {
      const field = cx.fieldReceivers.get(e.callee.name);
      if (field !== undefined) return field;
    }
    if (e.callee.kind === "ident" && e.callee.name === "lexer") return "Lexer";
  }
  if (e.kind === "new" && e.callee.kind === "ident") return e.callee.name;
  return undefined;
}

function classifyThrow(v: Ref<Expr>, cur: Ref<Item>): string[] {
  if (v.kind === "new" && v.callee.kind === "ident") {
    const name = v.callee.name;
    if (name === "Open" || name === "Stop" || name === "Return" || name === "Jump" || name === "Thrown" || name === "RegexSyntaxError") return [name];
    return ["CompileError"];
  }
  if (cur.file === "comptime" && v.kind === "ident") {
    if (v.name === "left") return ["Return", "Thrown"];
    if (v.name === "r") return ["Return"];
  }
  return ["CompileError"];
}

function without(from: Ref<Set<string>>, err: string): Set<string> {
  let res = new Set<string>();
  for (const e of from) if (e !== err) res.add(e);
  return res;
}

function filterCatch(cx: Ref<Throws>, cur: Ref<Item>, start: usize, end: usize, blockThrows: Ref<Set<string>>, handlerThrows: Ref<Set<string>>): Set<string> {
  const text = (cx.texts.get(cur.file) ?? "").slice(start as i64, end as i64);
  const file = cur.file;
  const name = cur.name;
  if (file === "resolve" && name === "conditional") return without(blockThrows, "Open");
  if (file === "resolve" && name === "interfaceMembers") return new Set<string>();
  if (file === "comptime") {
    if (name === "guarded") return new Set<string>(["CompileError"]);
    if (name === "expr") {
      let res = blockThrows.clone();
      for (const err of handlerThrows) res.add(err);
      return res;
    }
    if (name === "call" || name === "match") return without(blockThrows, "Return");
    if (name === "statement") {
      if (text.includes("instanceof Jump")) return blockThrows.clone();
      if (text.includes("instanceof Thrown")) {
        let res = without(blockThrows, "Thrown");
        for (const err of handlerThrows) res.add(err);
        return res;
      }
    }
  }
  if (file === "values") {
    if (name === "regexLiteral") return new Set<string>(["CompileError"]);
    if (text.includes("if (err instanceof CompileError) return undefined;") || text.includes("catch {")) return new Set<string>();
  }
  if (file === "check") {
    if (name === "partType") return new Set<string>();
    if (name === "check") return new Set<string>(["CompileError"]);
    if (text.includes("this.recover(e)") && !text.includes("throw new CompileError") && !text.includes("if (!f.js")) return new Set<string>();
  }
  if (file === "classes" && text.includes("catch { return []; }")) return new Set<string>();
  if (file === "registry" && text.includes("catch { return undefined; }")) return new Set<string>();
  if (file === "quote" && text.includes("catch {")) return new Set<string>();
  if (file === "regex" && text.includes("catch { return fail(")) return new Set<string>(["RegexSyntaxError"]);
  return handlerThrows.clone();
}

function addAll(out: Mut<Set<string>>, from: Ref<Set<string>>): void {
  for (const e of from) out.add(e);
}

function classifyCall(cx: Ref<Throws>, e: Ref<Expr>, cur: Ref<Item>, localFns: Ref<Map<string, usize>>, out: Mut<Set<string>>): void {
  if (e.kind !== "call") return;
  const callee: Ref<Expr> = e.callee;
  if (callee.kind === "ident") {
    if (cur.throwingParams.has(callee.name)) {
      out.add("CompileError");
      return;
    }
    const local = localFns.get(callee.name);
    if (local !== undefined) {
      addAll(out, cx.items[local].throwsSet);
      return;
    }
    const sameFile = listAt(cx.named, `${cur.file}|${callee.name}`);
    if (sameFile.length > 0) {
      for (const i of sameFile) addAll(out, cx.items[i].throwsSet);
      return;
    }
    const imp = cx.imports.get(`${cur.file}|${callee.name}`);
    if (imp !== undefined) {
      const [fromFile, exportedName] = imp;
      for (const i of listAt(cx.named, `${fromFile}|${exportedName}`)) addAll(out, cx.items[i].throwsSet);
    }
    return;
  }
  if (callee.kind === "member") {
    if (callee.name === "ensureChecked" || callee.name === "topKeys") {
      out.add("CompileError");
      return;
    }
    const recv = receiverOf(cx, callee.object, cur);
    if (recv !== undefined) for (const i of classItem(cx, recv, callee.name)) addAll(out, cx.items[i].throwsSet);
  }
}

function analyzeNode(cx: Ref<Throws>, n: AnyNode, cur: Ref<Item>, localFns: Ref<Map<string, usize>>): Set<string> {
  let out = new Set<string>();
  visit(cx, n, cur, localFns, out);
  return out;
}

function analyzeStmts(cx: Ref<Throws>, stmts: Ref<Stmt[]>, cur: Ref<Item>, localFns: Ref<Map<string, usize>>): Set<string> {
  let out = new Set<string>();
  for (const s of stmts) addAll(out, analyzeNode(cx, { of: "stmt", node: s }, cur, localFns));
  return out;
}

function visit(cx: Ref<Throws>, node: AnyNode, cur: Ref<Item>, localFns: Ref<Map<string, usize>>, out: Mut<Set<string>>): void {
  if (node.of === "stmt") {
    const s = node.node;
    if (s.kind === "function" && s.start !== cur.start) return;
    if (s.kind === "throw") {
      for (const err of classifyThrow(s.value, cur)) out.add(err);
    } else if (s.kind === "try") {
      const blockThrows = analyzeStmts(cx, s.block, cur, localFns);
      if (s.handler === undefined) {
        addAll(out, blockThrows);
      } else {
        const handlerThrows = analyzeStmts(cx, s.handler!, cur, localFns);
        addAll(out, filterCatch(cx, cur, s.start, s.end, blockThrows, handlerThrows));
      }
      if (s.finalizer !== undefined) addAll(out, analyzeStmts(cx, s.finalizer!, cur, localFns));
      return;
    }
  }
  if (node.of === "expr") {
    const e = node.node;
    if (e.kind === "throw") {
      for (const err of classifyThrow(e.value, cur)) out.add(err);
    } else if (e.kind === "call") {
      if (cur.file === "comptime" && e.callee.kind === "ident" && e.callee.name === "guarded") {
        out.add("CompileError");
        return;
      }
      classifyCall(cx, e, cur, localFns, out);
    } else if (e.kind === "new" && e.callee.kind === "ident") {
      for (const i of listAt(cx.members, `${e.callee.name}|constructor`)) if (cx.items[i].kind === "constructor") addAll(out, cx.items[i].throwsSet);
    }
  }
  forEachChild(node, (c) => visit(cx, c, cur, localFns, out));
}

// The nested functions of `file` inside the item at `i`, by name.
function localFunctions(cx: Ref<Throws>, i: usize): Map<string, usize> {
  const it: Ref<Item> = cx.items[i];
  let m = new Map<string, usize>();
  for (let j: usize = 0; j < cx.items.length; j++) {
    const o: Ref<Item> = cx.items[j];
    if (o.file === it.file && o.kind === "nestedFunction" && o.start > it.start && o.end <= it.end) m.set(o.name, j);
  }
  return m;
}

function missingFrom(cx: Ref<Throws>, i: usize, found: Ref<Set<string>>, offenders: Mut<string[]>): void {
  const it: Ref<Item> = cx.items[i];
  let missing: string[] = [];
  for (const err of found) if (!it.throwsSet.has(err)) missing.push(err);
  if (missing.length === 0) return;
  const label = it.className !== undefined ? `${it.className!}.${it.name}` : it.name;
  offenders.push(`${it.file}.fsh:${lineOf(cx.texts.get(it.file) ?? "", it.start)}: ${label} missing @throws {${missing.join(" | ")}}`);
}

// Analyzes the body of each item `prog` holds, found where `collect` found it.
function analyzeFile(cx: Ref<Throws>, file: string, prog: Ref<Stmt[]>, offenders: Mut<string[]>): void {
  walk({ of: "stmts", node: prog }, (n) => {
    if (n.of === "stmt" && n.node.kind === "function" && n.node.body !== undefined) {
      const i = cx.at.get(`${file}|function|${n.node.start}`);
      if (i !== undefined) missingFrom(cx, i, analyzeStmts(cx, n.node.body!, cx.items[i], localFunctions(cx, i)), offenders);
    } else if (n.of === "expr" && n.node.kind === "arrow") {
      const i = cx.at.get(`${file}|arrow|${n.node.start}`);
      if (i === undefined) return;
      const found = Array.isArray(n.node.body) ? analyzeStmts(cx, n.node.body, cx.items[i], localFunctions(cx, i)) : analyzeNode(cx, { of: "expr", node: n.node.body }, cx.items[i], localFunctions(cx, i));
      missingFrom(cx, i, found, offenders);
    } else if (n.of === "classMember") {
      const m = n.node;
      if ((m.kind === "method" || m.kind === "get" || m.kind === "set" || m.kind === "constructor") && m.body !== undefined) {
        const i = cx.at.get(`${file}|member|${m.start}`);
        if (i !== undefined) missingFrom(cx, i, analyzeStmts(cx, m.body!, cx.items[i], localFunctions(cx, i)), offenders);
      }
    }
  });
}

function stringMap(pairs: Ref<[string, string][]>): Map<string, string> {
  let m = new Map<string, string>();
  for (const [k, v] of pairs) m.set(k, v);
  return m;
}

// Every fallible function, method, constructor, top-level arrow, nested function and interface
// method in the checker and its helper modules declares what it throws via `@throws` or `throws`.
test("every fallible function, method, constructor and interface method in the checker declares throws", () => {
  const files = checkerReaches();
  const parsed = parsedAll(files);
  const pairs: [string, string][] = [
    ["ResolverHost", "Checker"], ["TypeFunctionsHost", "Resolver"], ["RegistryHost", "Checker"],
    ["GenericClassesHost", "Checker"], ["InstancingHost", "Checker"], ["Context", "BodyChecker"],
    ["Members", "ClassMembers"], ["Union", "Expressions"], ["RecursiveMaker", "Resolver"],
    ["InstanceMaker", "Checker"],
  ];
  let impls = new Map<string, string[]>();
  for (const [iface, impl] of pairs) impls.set(iface, [impl]);
  let cx: Throws = {
    items: [],
    texts: new Map(),
    imports: new Map(),
    aliases: new Set(),
    named: new Map(),
    members: new Map(),
    at: new Map(),
    impls,
    fieldReceivers: stringMap([
      ["cx", "Checker"], ["ctx", "Context"], ["typing", "Typing"], ["arenas", "Arenas"], ["rewrites", "Rewrites"],
      ["resolver", "Resolver"], ["registry", "Registry"], ["genericClasses", "GenericClasses"],
      ["instancing", "Instancing"], ["typeFunctions", "TypeFunctions"], ["exprs", "Expressions"],
      ["tokens", "Lexer"], ["c", "Cursor"], ["recursiveMaker", "RecursiveMaker"], ["instanceMaker", "InstanceMaker"],
    ]),
    hostOfClass: stringMap([
      ["Resolver", "ResolverHost"], ["TypeFunctions", "TypeFunctionsHost"], ["Registry", "RegistryHost"],
      ["GenericClasses", "GenericClassesHost"], ["Instancing", "InstancingHost"], ["ClassMembers", "Checker"],
    ]),
    paramReceivers: stringMap([
      ["c", "Cursor"], ["typing", "Typing"], ["arenas", "Arenas"], ["rewrites", "Rewrites"],
      ["members", "Members"], ["run", "Interpreter"], ["tokens", "Lexer"],
    ]),
  };
  for (const file of parsed) {
    cx.texts.set(file.name, file.text);
    for (const raw of file.program) {
      const s = declared(raw);
      if (s.kind === "typeAlias" && s.type.kind === "function" && s.type.throws !== undefined) cx.aliases.add(s.name);
    }
  }
  for (const file of parsed) collect(cx, file.name, file.program);

  let offenders: string[] = [];
  for (const [iface, implsOf] of cx.impls.clone()) {
    for (let im: usize = 0; im < cx.items.length; im++) {
      if (cx.items[im].kind !== "interfaceMethod" || cx.items[im].className !== iface) continue;
      let missing: string[] = [];
      for (const impl of implsOf) {
        const name = cx.items[im].name;
        for (const cm of classItem(cx, impl, name)) {
          const errs = cx.items[cm].throwsSet.clone();
          for (const err of errs) {
            if (!cx.items[im].throwsSet.has(err)) {
              missing.push(err);
              cx.items[im].throwsSet.add(err);
            }
          }
        }
      }
      if (missing.length > 0) {
        const it: Ref<Item> = cx.items[im];
        offenders.push(`${it.file}.fsh:${lineOf(cx.texts.get(it.file) ?? "", it.start)}: ${it.className ?? ""}.${it.name} missing @throws {${missing.join(" | ")}}`);
      }
    }
  }
  for (let im: usize = 0; im < cx.items.length; im++) {
    const it: Ref<Item> = cx.items[im];
    if (it.kind !== "interfaceMethod" || it.className !== "Builder" || it.name !== "name") continue;
    if (!it.throwsSet.has("CompileError")) {
      offenders.push(`${it.file}.fsh:${lineOf(cx.texts.get(it.file) ?? "", it.start)}: Builder.name missing @throws {CompileError}`);
      cx.items[im].throwsSet.add("CompileError");
    }
  }
  for (const file of parsed) analyzeFile(cx, file.name, file.program, offenders);
  none(offenders);
});
