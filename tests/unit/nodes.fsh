// Ports tests/nodes.test.ts. Regexes are literals, so where the Bun test builds one from a list
// of names, a literal matching any name captures it and the name is looked up in the list.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NodeMap, NodeSet, nodeIdOf, renumberExpr, Rewrites, walk, type AnyNode } from "../compiler/nodes.fsh";
import { parse, type Expr } from "../compiler/parser.fsh";
import { cloneExpr } from "../compiler/rebuild.fsh";
import { Typing, TypeMap, TypeSet, type Type } from "../compiler/typing.fsh";
import { nodeSpanKey } from "../compiler/walk.fsh";
import { read, root } from "./support.fsh";

function srcDir(): string {
  return join(root(), "src");
}

// src's TypeScript files.
function sources(): string[] {
  try {
    return readdirSync(srcDir()).filter((f) => f.endsWith(".ts"));
  } catch (e) {
    assert(false, e.message);
    return [];
  }
}

// A node's kind, with a class statement's ClassNode counted as the class, as the two share an id.
function kindOf(n: Ref<AnyNode>): string {
  switch (n.of) {
    case "typeNode":
      return n.node.kind;
    case "expr":
      return n.node.kind;
    case "stmt":
      return n.node.kind;
    case "typeMember":
      return n.node.kind;
    case "objectProp":
      return n.node.kind;
    case "classMember":
      return n.node.kind;
    case "pattern":
      return n.node.kind;
    case "typeAlias":
      return n.node.kind;
    case "interface":
      return n.node.kind;
    case "func":
      return n.node.kind;
    case "classNode":
      return "class";
  }
  return "";
}

// Every node under `roots` has an id, and no two nodes share one: two seen under one id are one
// node, copied, only when they are the same kind of node at the same span. `ids` holds what each
// id was seen as, shared between the trees of one compilation.
function audit(roots: AnyNode, ids: Mut<Map<i64, string>>, where: string): string[] {
  let problems: string[] = [];
  let seen = new Map<i64, string>();
  walk(roots, (n) => {
    if (n.of === "stmts" || n.of === "jsName") return;
    const id = nodeIdOf(n);
    const kind = kindOf(n);
    const span = nodeSpanKey(n);
    const at = `${where}: a ${kind === "" ? n.of : kind} at ${span / 1048576}`;
    const shown = `${kind} ${span}`;
    if (id < 1) problems.push(`${at} has no id`);
    else if (seen.has(id) && seen.get(id)! !== shown) problems.push(`${at} shares id ${id} with another node`);
    else seen.set(id, shown);
  });
  for (const [id, shown] of seen) {
    if (ids.has(id) && ids.get(id)! !== shown) problems.push(`${where}: a node shares id ${id} with another file's`);
    else ids.set(id, shown);
  }
  return problems;
}

test("every node of the compiler's own source has an id of its own", () => {
  let ids = new Map<i64, string>();
  let counter = { last: 0 as usize };
  let problems: string[] = [];
  for (const f of sources()) {
    try {
      const program = parse(read(join(srcDir(), f)), counter);
      for (const p of audit({ of: "stmts", node: program }, ids, f)) problems.push(p);
    } catch (e) {
      problems.push(`${f}: ${e.message}`);
    }
  }
  assert(problems.length === 0, problems.slice(0, 20).join("\n"));
});

test("a node table reads one entry for a node and its replacement, and refuses a node without an id", () => {
  let map = new NodeMap<Expr, string>();
  let rewrites = new Rewrites();
  const node: Extract<Expr, { kind: "ident" }> = { id: 7, kind: "ident", name: "x", start: 0, end: 1 };
  map.set(node.clone(), "kept");
  const by = rewrites.replace(node, { id: 0, kind: "ident", name: "y", start: 0, end: 1 });
  assert(map.get(by) === "kept", "the replacement reads no entry");
  assert(new NodeSet<Expr>([node.clone()]).has(by), "the set doesn't hold the replacement");
});

test("renumbering and moving spans refuse two different nodes under one id", () => {
  const a: Extract<Expr, { kind: "ident" }> = { id: 5, kind: "ident", name: "a", start: 0, end: 1 };
  let last: usize = 100;
  const shared: Expr = { id: 6, kind: "binary", op: "+", left: a.clone(), right: a.clone(), start: 0, end: 5 };
  const renumbered = renumberExpr(cloneExpr(shared), () => {
    last++;
    return last;
  });
  if (renumbered.kind !== "binary") {
    assert(false, "not a binary");
    return;
  }
  const left = nodeIdOf({ of: "expr", node: renumbered.left });
  const right = nodeIdOf({ of: "expr", node: renumbered.right });
  assert(left === right, `a node copied twice got ids ${left} and ${right}`);
});

// The group of two alternatives that took part in a match: one that didn't reads as null.
function either(a: string | null, b: string | null): string {
  return a ?? b ?? "";
}

// The names `text` gives as aliases of those `names` lists, by `type X = Y` or `Y as X`.
function aliasesIn(text: string, names: Ref<string[]>): string[] {
  let found: string[] = [];
  for (const m of text.matchAll(/\btype (\w+) = (?:(?:Extract|Exclude)<(\w+),|(\w+) [&|;])/g)) {
    if (names.includes(either(m[2], m[3]))) found.push(m[1]);
  }
  for (const m of text.matchAll(/\b(\w+) as (?=(\w+))/g)) {
    if (names.includes(m[1])) found.push(m[2]);
  }
  return found;
}

// The AST types a table may not be keyed by: every type in src/parser.ts carrying `Id`, and any
// alias a file gives one, as `type Arrow = Extract<Expr, ...>`, `type Decl = Stmt & ...` or
// `Func as Declared`. Tables keyed by `object` or `unknown` are left out: they key reflective
// walks over any value, arrays and non-node objects included.
test("no Map, WeakMap, Set or WeakSet in src is keyed by an AST node", () => {
  const parser = read(join(srcDir(), "parser.ts"));
  let nodes: string[] = [];
  for (const m of parser.matchAll(/^export type (\w+) = Span & Id\b/gm)) nodes.push(m[1]);
  assert(nodes.includes("Expr"), `no Expr among ${nodes.join(", ")}`);
  let offenders: string[] = [];
  for (const f of sources()) {
    const text = read(join(srcDir(), f));
    let names = nodes.clone();
    for (const a of aliasesIn(text, nodes)) names.push(a);
    names.push("Span");
    for (const m of text.matchAll(/\b(?:Weak)?(?:Map|Set)<\s*(?:(?:Extract|Exclude)<\s*)?(\w+)\b(?!\[)/g)) {
      if (names.includes(m[1])) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert(offenders.length === 0, offenders.join("\n"));
});

test("a type table keys primitives and types by id, in the order they were added", () => {
  let typing = new Typing();
  const a = typing.arrayType("i64");
  const entries: (readonly [Type, string])[] = [["i64", "int"], [a, "a"]];
  const map = new TypeMap<Type, string>(entries);
  assert(map.get("i64") === "int" && map.get("string") === undefined && map.get(a) === "a", "the table reads the wrong values");
  const keys = [...map.keys()];
  assert(keys.length === 2 && keys[0] === "i64" && keys[1] === a, "the keys aren't in the order they were added");
  const set = [...new TypeSet<Type>(["bigint", a, "bigint"])];
  assert(set.length === 2 && set[0] === "bigint" && set[1] === a, "the set isn't in the order its types were added");
});

// The types a table may not be keyed by: `Type`, `Bound`, each kind's id and record in
// src/typing.ts, and any alias a file gives one, as `type Shape = ObjectType | UnionType`. A type
// keys by its id through TypeMap and TypeSet, which give a primitive its own integer.
test("no Map, WeakMap, Set or WeakSet in src is keyed by a type", () => {
  const typing = read(join(srcDir(), "typing.ts"));
  let kinds: string[] = [];
  for (const m of typing.matchAll(/^export type (\w+)Type = Brand<usize, "\w+">;/gm)) {
    kinds.push(`${m[1]}Type`);
    kinds.push(`${m[1]}Record`);
  }
  assert(kinds.includes("ObjectType"), `no ObjectType among ${kinds.join(", ")}`);
  assert(kinds.length === 52, `${kinds.length} kinds of type, not 52`);
  let types = ["Type", "Bound", "TypeRecord"];
  for (const k of kinds) types.push(k);
  let offenders: string[] = [];
  for (const f of sources()) {
    const text = read(join(srcDir(), f));
    let names = types.clone();
    for (const m of text.matchAll(/\btype (\w+) = (?:(?:Extract|Exclude)<(\w+)\b|(\w+)(?: [&|]|;))/g)) {
      if (types.includes(either(m[2], m[3]))) names.push(m[1]);
    }
    for (const m of text.matchAll(/\b(?:Weak)?(?:Map|Set)<\s*(?:(?:Extract|Exclude)<\s*)?(\w+)\b(?![\[.])/g)) {
      if (names.includes(m[1])) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert(offenders.length === 0, offenders.join("\n"));
});

// The checker's other records a table may not be keyed by: an Instance, a Body, a Local and a
// ClassInfo, and a list of type parameters. Instances, bodies and locals key by their ids, a class
// by its type's, and a list by its first parameter.
test("no Map, WeakMap, Set or WeakSet in src is keyed by an instance, body, local, class or type parameter list", () => {
  let offenders: string[] = [];
  for (const f of sources()) {
    const text = read(join(srcDir(), f));
    for (const m of text.matchAll(/\b(?:Weak)?(?:Map|Set)<\s*(?:Instance|Body|Local|ClassInfo|TypeParam\[\])(?![\w.])/g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert(offenders.length === 0, offenders.join("\n"));
});

// The checker's records and its tables, by where each is declared. They name one another by id,
// read back through the compilation's arenas, which alone hold the records themselves.
function records(): [string, string][] {
  return [["compilation.ts", "Tables"], ["check.ts", "Checked"], ["check.ts", "Instance"], ["check.ts", "Local"], ["classes.ts", "Body"], ["classes.ts", "ClassInfo"], ["values.ts", "DynTable"]];
}

test("no instance, body, local or class holds another, nor does a checker table, but through its id", () => {
  let offenders: string[] = [];
  for (const [f, name] of records()) {
    const text = read(join(srcDir(), f));
    const prefix = `export type ${name} = `;
    const start = text.startsWith(prefix) ? 0 : text.indexOf(`\n${prefix}`) + 1;
    assert(start > 0 || text.startsWith(prefix), `${f} declares no ${name}`);
    if (start === 0 && !text.startsWith(prefix)) continue;
    const first = text.slice(start, text.indexOf("\n", start));
    // A declaration whose first line opens a brace runs to the line closing it.
    const declared = (first.endsWith("{") ? text.slice(start, text.indexOf("\n};", start)) : first).slice(prefix.length as i64);
    for (const line of declared.replace(/\/\/.*$/gm, "").split("\n")) {
      if (/^\s*arenas: Arenas;$/.test(line)) continue;
      for (const m of line.matchAll(/\b(?:Instance|Body|Local|ClassInfo)\b/g)) offenders.push(`${name}: ${line.trim()} (${m[0]})`);
    }
  }
  assert(offenders.length === 0, offenders.join("\n"));
});

// The checker's files: the checker, codegen and what they share.
function checker(): string[] {
  return ["check", "values", "classes", "resolve", "typefns", "operators", "typing", "generics", "interfaces", "flow", "narrow", "match", "moves", "comptime", "unions", "enums", "registry", "unsupported", "compilation", "codegen", "layout", "arithmetic", "runtime", "locals", "warnings"];
}

// The checker's working tables, its own and codegen's, hold ids too, keys and values alike.
test("no Map or Set in the checker holds an instance, body, local or class", () => {
  let offenders: string[] = [];
  for (const name of checker()) {
    const f = `${name}.ts`;
    const text = read(join(srcDir(), f));
    for (const m of text.matchAll(/\b(?:Map|Set)<([^;=()]*)/g)) if (/\b(?:Instance|Body|Local|ClassInfo)\b/.test(m[1])) offenders.push(`${f}: ${m[0]}`);
  }
  assert(offenders.length === 0, offenders.join("\n"));
});

// Tables still keyed by objects, each until it is given a key of its own: a walk's set of the
// values it has visited, and codegen's.
function objectKeyed(): string[] {
  return ["check.ts: Set<unknown", "locals.ts: Set<unknown", "warnings.ts: Set<unknown", "codegen.ts: WeakSet<object"];
}

// Fish's Map and Set key on strings and numbers, so every table the checker keeps does: by a
// string, an integer, an arena id, a string-literal union, or through NodeMap, TypeMap and their
// kin, which key by id. Type parameters, `K` and `T`, are a generic table's own.
test("no Map, WeakMap, Set or WeakSet in the checker is keyed by anything but strings or integers", () => {
  let offenders: string[] = [];
  const allowed = objectKeyed();
  for (const name of checker()) {
    const f = `${name}.ts`;
    const text = read(join(srcDir(), f));
    for (const m of text.matchAll(/\b(?:Weak)?(?:Map|Set)<\s*([A-Za-z_][\w.]*(?:\[\])?|"[^"]*")/g)) {
      if (/^(?:string|usize|isize|[iu](?:8|16|32|64|128)|f32|f64|number|bigint|boolean|BinaryOp|(?:Instance|Body|Local|Class)Id|[KT]|"[^"]*")$/.test(m[1])) continue;
      const at = `${f}: ${m[0]}`;
      if (!allowed.includes(at)) offenders.push(at);
    }
  }
  assert(offenders.length === 0, offenders.join("\n"));
});

// The passes that lower the tree, before checking and while it runs.
function lowering(): string[] {
  return ["check", "values", "narrow", "classes", "generics", "overloads", "defaults", "keys", "modules", "js", "locals", "macros", "quote", "tests", "parseargs"];
}

// Fields that hold a node's children, as the generated rebuild writes them; a `name` holds a node
// only when computed, and a rename writes a string.
function children(): string[] {
  let found: string[] = [];
  for (const m of read(join(srcDir(), "rebuild.ts")).matchAll(/^\s+m\.(\w+)/gm)) {
    const field = m[1];
    if (field !== "name" && !found.includes(field)) found.push(field);
  }
  return found;
}

// What may still change in place, each for its reason:
function inPlace(): string[] {
  return [
    // the spans of nodes just made, before any tree holds them;
    "parseargs.ts: Object.assign(node, { start", "tests.ts: walk(\"func\", made, ({ node }) => void Object.assign(node, { start", "values.ts: walk(\"expr\", e, ({ node }) => void Object.assign(node, { start",
    // a Body's overloads, given as ids, an enum's record, a Body's template mark and a Local's type, which are no nodes;
    "check.ts: for (const f of this.funcs) if (f.overloadNames) f.overloads =", "check.ts: for (const e of this.enums.values())", "classes.ts: f.template = true", "check.ts: local.type = type;",
    // lists of statements the checker walks, which it edits as a copy recorded by the list's owner
    // in the rewrite table for the rebuild: a statement that becomes several, nested functions
    // hoisted, statements added after the one being checked, and the same edits given to a later
    // copy of a list; and, before checking, a local declaration hoisted out and an export a library
    // lists, each where the list is read next;
    "check.ts: list.splice(", "check.ts: list[i] = block;", "check.ts: while (added.length > 0) list.splice(", "check.ts: while (parts.length > 0) list.splice(", "check.ts: let removed = list.splice(", "locals.ts: stmts[stmts.indexOf(local)] =",
    "check.ts: if (wrapped !== undefined && wrapped.kind === \"block\"", "check.ts: if (inserted !== undefined && inserted.length > 0",
    "modules.ts: let removed = l.body.splice(at, 1);", "modules.ts: l.body.splice(at, 0, {", "macros.ts: statements.splice(", "modules.ts: if (startsMain(statements[i]!)) statements.splice(",
    // a file's statements lent to linking and put back where they were;
    "modules.ts: let taken = m.statements.splice(0);",
    // a package's function just made, given the overloads it lists before any tree holds it;
    "modules.ts: if (listed.length > 0 && made.kind === \"function\" && made.js !== undefined) made.js.overloads =",
    // the edits a rebuild makes to the node it is handed, which it owns there, as a rename does;
    "modules.ts: if (at !== undefined && n.kind === \"call\") n.args.splice(", "modules.ts: let props = n.props.splice(0);", "modules.ts: if (!isEncoding(p)) n.props.push(p);",
  ];
}

// Whether `line` writes a child field of a node: an assignment to one, or a push, splice or unshift
// of a list one holds. Each start is tried in a lookahead, so no match hides one overlapping it.
function writesChild(line: string, fields: Ref<string[]>): boolean {
  for (const m of line.matchAll(/\b(?=(?:e|s|d|p|n|node|x|c|call|callee|loop|impl|decl|main|f|arrow|same|at|made|given|local|m|t)(?:\.\w+)*\.(\w+)(?:\[[^\]]*\])?!? (?:=|\?\?=) )/g)) {
    if (fields.includes(m[1])) return true;
  }
  for (const m of line.matchAll(/\b(?=(?:e|s|d|p|n|node|x|c|f|decl)\.(\w+)\.(?:push|splice|unshift)\()/g)) {
    if (fields.includes(m[1])) return true;
  }
  return false;
}

// Lowering records a replacement in a rewrite table, which a rebuild puts in place, rather than
// changing a node's kind or children where it is, as Fish can't through a shared reference.
test("no lowering pass changes a node's kind or children in place", () => {
  const fields = children();
  const allowed = inPlace();
  let offenders: string[] = [];
  for (const name of lowering()) {
    const f = `${name}.ts`;
    for (const line of read(join(srcDir(), f)).split("\n")) {
      const text = `${f}: ${line.trim()}`;
      const found = /Object\.assign\((?!\{|<)/.test(line) || /\bdelete \(/.test(line) || writesChild(line, fields) || /\b(?:list|stmts|statements|place\.list|l\.body)(?:\.splice\(|\[[^\]]+\] = )/.test(line);
      if (found && !allowed.some((a) => text.startsWith(a))) offenders.push(text);
    }
  }
  assert(offenders.length === 0, offenders.join("\n"));
});
