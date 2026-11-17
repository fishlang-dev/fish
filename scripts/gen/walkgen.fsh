// Writes `src/walk.ts`, which visits the child nodes of every node kind, from the parser's own AST
// types in `src/parser.ts`, so the compiler can walk a tree without reading arbitrary objects'
// fields, which Fish can't. Beside it, `src/rebuild.ts` puts the replacements a rewrite table holds
// in place in a tree, updates node ids and spans, and clones AST subtrees by the same fields.
// `tests/walk.test.ts` fails when either file is stale.
import { type CompileError } from "../../tests/compiler/diag.fsh";
import { append, hasWord, indented, nodeTypes, ref, refTo, type Field, type NodeTypes, type Shape, type Ty } from "./dumpgen.fsh";

function method(name: string): string {
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

function owner(m: Ref<Ty>): string {
  if (m.kind !== "ref") return "";
  if (m.name === "Extract") {
    const from: Ref<Ty> = m.args[0]!;
    return from.kind === "ref" ? from.name : "";
  }
  return m.name;
}

// The kinds of `shapes` not yet in `seen`, all of them added to it once read, as one member's
// repeated kinds are each kept.
function freshKinds(shapes: Ref<Shape[]>, seen: Mut<Set<string>>): string[] {
  let kinds: string[] = [];
  for (const s of shapes) {
    const k = s.kind;
    if (k !== undefined && !seen.has(k)) kinds.push(k);
  }
  for (const k of kinds) seen.add(k);
  return kinds;
}

// The shapes of `all` with a kind not seen before, each added as it is kept.
function uniqueShapes(all: Ref<Shape[]>, seen: Mut<Set<string>>): Shape[] {
  let out: Shape[] = [];
  for (const s of all) {
    const k = s.kind;
    if (k === undefined || seen.has(k)) continue;
    seen.add(k);
    out.push(s.clone());
  }
  return out;
}

function without(all: Ref<Ty[]>, at: i64): Ty[] {
  let out = all.clone();
  out.splice(at, 1);
  return out;
}

class Walkgen {
  readonly nt: NodeTypes;
  unionIndex: Map<string, usize>;
  unionNames: string[];
  unionMembers: Ty[][];
  walkDepth: usize;
  rebuildDepth: usize;
  cloneDepth: usize;

  constructor(nt: NodeTypes) {
    this.nt = nt;
    this.unionIndex = new Map<string, usize>();
    this.unionNames = [];
    this.unionMembers = [];
    this.walkDepth = 0;
    this.rebuildDepth = 0;
    this.cloneDepth = 0;
  }

  unionName(this: Mut<this>, members: Ref<Ty[]>): string throws Error {
    const key = this.nt.showAll(members, " | ");
    const at = this.unionIndex.get(key);
    if (at !== undefined) return this.unionNames[at]!;
    const name = `visitOneOf${this.unionNames.length}`;
    this.unionIndex.set(key, this.unionNames.length);
    this.unionNames.push(name);
    this.unionMembers.push(members.clone());
    return name;
  }

  // Whether a value of one of `members` may hold a node.
  holdsNodes(members: Ref<Ty[]>): boolean throws Error {
    for (const m of this.nt.expandAll(members)) {
      if (ref(m, "string")) continue;
      if (ref(m, "Extract")) return true;
      const f = this.nt.formOf(m);
      if (f.kind === "node") return true;
      if (f.kind === "array" && this.holdsNodes([f.element.clone()])) return true;
      if (f.kind === "option" && this.holdsNodes([f.inner.clone()])) return true;
      if (f.kind === "union" && this.holdsNodes(f.members)) return true;
      if (f.kind === "object") {
        let types: Ty[] = [];
        for (const x of f.fields) types.push(x.type.clone());
        if (this.holdsNodes(types)) return true;
      }
    }
    return false;
  }

  hasId(name: string): boolean throws Error {
    for (const s of this.nt.shapes(this.nt.types[this.nt.at(name)]!)) if (!s.fields.some((f) => f.name === "id")) return false;
    return true;
  }

  aliasShapes(name: string): Shape[] throws Error {
    return this.nt.shapes(this.nt.types[this.nt.at(name)]!);
  }

  // What a walk of kind `mode` does with each child: `of` its tag, `val` it, `field` the node's
  // field it sits in.
  leaf(mode: string, of: string, val: string, field: string): string[] {
    switch (mode) {
      case "each":
        return [`v({ of: ${JSON.stringify(of)}, node: ${val} });`];
      case "named":
        return [`v(${JSON.stringify(field)}, { of: ${JSON.stringify(of)}, node: ${val} });`];
      case "collect":
        return [`collectIdsNode({ of: ${JSON.stringify(of)}, node: ${val} }, seen, order, shared);`];
      default:
        return [`if (i === k) return visitAt({ of: ${JSON.stringify(of)}, node: ${val} }, steps, d + 1, each);`, `i += 1;`];
    }
  }

  // Statements visiting the nodes `value`, of type `t`, holds.
  visits(this: Mut<this>, mode: string, t: Ref<Ty>, value: string, field: string): string[] throws Error {
    const f = this.nt.formOf(t);
    switch (f.kind) {
      case "node":
        return this.leaf(mode, method(f.name), value, field);
      case "union": {
        if (!this.holdsNodes(f.members)) return [];
        this.unionName(f.members);
        return this.unionVisits(mode, f.members, value, field);
      }
      case "array": {
        if (ref(f.element, "Stmt")) return this.leaf(mode, "stmts", value, field);
        const ef = this.nt.formOf(f.element);
        if (ef.kind === "node" && mode === "step") {
          const of = JSON.stringify(method(ef.name));
          return [
            `if (k >= i && k < i + ${value}.length) return visitAt({ of: ${of}, node: ${value}[k - i]! }, steps, d + 1, each);`,
            `i += ${value}.length;`,
          ];
        }
        this.walkDepth += 1;
        const x = `x${this.walkDepth}`;
        const inner = this.visits(mode, f.element, x, field);
        this.walkDepth -= 1;
        return inner.length > 0 ? [`for (const ${x} of ${value}) {`, ...indented(inner, "  "), `}`] : [];
      }
      case "option": {
        const inner = this.visits(mode, f.inner, `${value}!`, field);
        return inner.length > 0 ? [`if (${value} !== undefined) {`, ...indented(inner, "  "), `}`] : [];
      }
      case "object":
        return this.fieldVisits(mode, f.fields, value, field);
      default:
        return [];
    }
  }

  unionVisits(this: Mut<this>, mode: string, members: Ref<Ty[]>, u: string, field: string): string[] throws Error {
    const expanded = this.nt.expandAll(members);
    let rest = expanded.filter((m) => !ref(m, "string"));
    const hasString = expanded.some((m) => ref(m, "string"));
    const array = rest.findIndex((m) => m.kind === "array");
    let inner: string[] = [];
    if (array >= 0) {
      const visited = this.visits(mode, rest[array as usize]!, u, field);
      rest = without(rest, array);
      const leaf = this.leaf(mode, method(owner(rest[0]!)), u, field);
      append(inner, [`if (Array.isArray(${u})) {`, ...indented(visited, "  "), `} else {`, ...indented(leaf, "  "), `}`]);
    } else if (rest.length === 1) {
      append(inner, this.leaf(mode, method(owner(rest[0]!)), u, field));
    } else {
      let seen = new Set<string>();
      inner.push(`switch (${u}.kind) {`);
      for (const m of rest) {
        const kinds = freshKinds(this.nt.shapes(m), seen);
        for (const k of kinds) {
          inner.push(`  case ${JSON.stringify(k)}:`);
          append(inner, indented(this.leaf(mode, method(owner(m)), u, field), "    "));
          inner.push(`    break;`);
        }
      }
      inner.push(`}`);
    }
    return hasString ? [`if (typeof ${u} !== "string") {`, ...indented(inner, "  "), `}`] : inner;
  }

  // `outer` is the node's field an object of fields sits in, which names its children's field.
  fieldVisits(this: Mut<this>, mode: string, fields: Ref<Field[]>, value: string, outer: string | undefined): string[] throws Error {
    let out: string[] = [];
    for (const f of fields) {
      const inner = this.visits(mode, f.type, `${value}.${f.name}${f.optional ? "!" : ""}`, outer ?? f.name);
      if (f.optional && inner.length > 0) append(out, [`if (${value}.${f.name} !== undefined) {`, ...indented(inner, "  "), `}`]);
      else append(out, inner);
    }
    return out;
  }

  children(this: Mut<this>, mode: string, name: string, target: string): string[] throws Error {
    const all = this.aliasShapes(name);
    if (all.length === 1 && all[0]!.kind === undefined) return this.fieldVisits(mode, all[0]!.fields, target, undefined);
    let out: string[] = [];
    for (const s of uniqueShapes(all, new Set<string>())) {
      const body = this.fieldVisits(mode, s.fields, target, undefined);
      if (body.length > 0) append(out, [`  case ${JSON.stringify(s.kind!)}:`, ...indented(body, "    "), `    break;`]);
    }
    return out.length > 0 ? [`switch (${target}.kind) {`, ...out, `}`] : [];
  }

  // The rebuild: each node replaced by what the rewrite table holds for it, its children first
  // rebuilt in turn. `get` reads a place holding nodes of type `t`, `set` writes it. `field` names
  // the node field the value is read from, when it is one, as `m.else` for an optional `else` read
  // into a local first.
  rebuilds(this: Mut<this>, t: Ref<Ty>, get: string, set: string, field: string): string[] throws Error {
    const f = this.nt.formOf(t);
    switch (f.kind) {
      case "node":
        return [`${set} = rebuilt${f.name}(${get}, r);`];
      case "union":
        return this.holdsNodes(f.members) ? [`${set} = rebuilt${this.unionName(f.members).slice(5)}(${get}, r);`] : [];
      case "array": {
        if (ref(f.element, "Stmt")) {
          if (!/^\w+\.\w+$/.test(field)) return [`rebuiltStmts(${get}, r);`];
          const dot = field.indexOf(".");
          this.rebuildDepth += 1;
          const l = `l${this.rebuildDepth}`;
          return [`const ${l} = r.currentList(${field.slice(0, dot)}.id, ${JSON.stringify(field.slice(dot + 1))});`, `if (${l} !== undefined) ${get} = ${l};`, `rebuiltStmts(${get}, r);`];
        }
        this.rebuildDepth += 1;
        const i = `i${this.rebuildDepth}`;
        const x = `e${this.rebuildDepth}`;
        const ef = this.nt.formOf(f.element);
        if (ef.kind === "option") {
          const inner = this.rebuilds(ef.inner, x, x, x);
          if (inner.length === 0) return [];
          return [
            `if (${get}.length > 0) {`,
            `  let ${i} = ${get}.splice(0);`,
            `  ${i}.reverse();`,
            `  while (${i}.length > 0) {`,
            `    const last = ${i}.pop();`,
            `    if (last === undefined) {`,
            `      ${get}.push(undefined);`,
            `    } else {`,
            `      let ${x} = last!;`,
            ...indented(inner, "      "),
            `      ${get}.push(${x});`,
            `    }`,
            `  }`,
            `}`,
          ];
        }
        const inner = this.rebuilds(f.element, x, x, x);
        if (inner.length === 0) return [];
        return [
          `if (${get}.length > 0) {`,
          `  let ${i} = ${get}.splice(0);`,
          `  ${i}.reverse();`,
          `  while (${i}.length > 0) {`,
          `    let ${x} = ${i}.pop()!;`,
          ...indented(inner, "    "),
          `    ${get}.push(${x});`,
          `  }`,
          `}`,
        ];
      }
      case "option": {
        this.rebuildDepth += 1;
        const v = `o${this.rebuildDepth}`;
        const inner = this.rebuilds(f.inner, v, v, set);
        return inner.length > 0 ? [`if (${set} !== undefined) {`, `  let ${v} = ${set}!;`, ...indented(inner, "  "), `  ${set} = ${v};`, `}`] : [];
      }
      case "object":
        return this.fieldRebuilds(f.fields, get);
      default:
        return [];
    }
  }

  fieldRebuilds(this: Mut<this>, fields: Ref<Field[]>, value: string): string[] throws Error {
    let out: string[] = [];
    for (const f of fields) {
      if (f.optional) {
        this.rebuildDepth += 1;
        const v = `v${this.rebuildDepth}`;
        const inner = this.rebuilds(f.type, v, v, v);
        if (inner.length > 0) append(out, [`if (${value}.${f.name} !== undefined) {`, `  let ${v} = ${value}.${f.name}!;`, ...indented(inner, "  "), `  ${value}.${f.name} = ${v};`, `}`]);
        continue;
      }
      const place = `${value}.${f.name}`;
      append(out, this.rebuilds(f.type, place, place, place));
    }
    return out;
  }

  rebuildChildren(this: Mut<this>, name: string): string[] throws Error {
    this.rebuildDepth = 0;
    const all = this.aliasShapes(name);
    if (all.length === 1 && all[0]!.kind === undefined) return this.fieldRebuilds(all[0]!.fields, "m");
    let out: string[] = [];
    for (const s of uniqueShapes(all, new Set<string>())) {
      const body = this.fieldRebuilds(s.fields, "m");
      if (body.length > 0) append(out, [`  case ${JSON.stringify(s.kind!)}:`, ...indented(body, "    "), `    break;`]);
    }
    return out.length > 0 ? [`switch (m.kind) {`, ...out, `}`] : [];
  }

  // Deep-cloning AST subtrees without `structuredClone`.
  clonedValue(this: Mut<this>, t: Ref<Ty>, val: string): string throws Error {
    const f = this.nt.formOf(t);
    switch (f.kind) {
      case "node":
        return `clone${f.name}(${val})`;
      case "union":
        return this.holdsNodes(f.members) ? `clone${this.unionName(f.members).slice(5)}(${val})` : val;
      case "array": {
        if (ref(f.element, "Stmt")) return `cloneStmts(${val})`;
        this.cloneDepth += 1;
        const x = `x${this.cloneDepth}`;
        const ef = this.nt.formOf(f.element);
        if (ef.kind === "option") {
          const inner = this.clonedValue(ef.inner, `${x}!`);
          const innerForm = this.nt.formOf(ef.inner);
          const elemType = innerForm.kind === "node" ? `Extract<${innerForm.name}, { kind: "array" }>["elements"][usize]` : this.nt.show(f.element);
          this.cloneDepth -= 1;
          return `${val}.map((${x}): ${elemType} => (${x} !== undefined ? ${inner} : undefined))`;
        }
        const inner = this.clonedValue(f.element, x);
        this.cloneDepth -= 1;
        return inner === x ? `[...${val}]` : `${val}.map((${x}) => ${inner})`;
      }
      case "option": {
        const inner = this.clonedValue(f.inner, `${val}!`);
        return inner === `${val}!` ? val : `${val} !== undefined ? ${inner} : undefined`;
      }
      case "object": {
        let parts: string[] = [];
        for (const fld of f.fields) parts.push(`${fld.name}: ${this.clonedField(fld.type, `${val}.${fld.name}`, fld.optional)}`);
        return `{ ${parts.join(", ")} }`;
      }
      default:
        return val;
    }
  }

  clonedField(this: Mut<this>, t: Ref<Ty>, val: string, optional: boolean): string throws Error {
    if (!optional) return this.clonedValue(t, val);
    const inner = this.clonedValue(t, `${val}!`);
    return inner === `${val}!` ? val : `${val} !== undefined ? ${inner} : undefined`;
  }

  shapeExpr(this: Mut<this>, s: Ref<Shape>): string throws Error {
    let parts: string[] = [];
    const kind = s.kind;
    if (kind !== undefined) parts.push(`kind: ${JSON.stringify(kind)} as const`);
    for (const f of s.fields) parts.push(`${f.name}: ${this.clonedField(f.type, `n.${f.name}`, f.optional)}`);
    return `{ ${parts.join(", ")} }`;
  }

  cloneBody(this: Mut<this>, name: string): string[] throws Error {
    const all = this.aliasShapes(name);
    if (all.length === 1) return [`return ${this.shapeExpr(all[0]!)};`];
    let out: string[] = [`switch (n.kind) {`];
    for (const s of uniqueShapes(all, new Set<string>())) {
      out.push(`  case ${JSON.stringify(s.kind!)}:`);
      out.push(`    return ${this.shapeExpr(s)};`);
    }
    append(out, [`  default:`, `    return clone${name}(n);`, `}`]);
    return out;
  }

  rebuildMember(m: Ref<Ty>, k: string | undefined, type: string): string {
    if (k === "block" && ref(m, "Extract")) return `rebuiltStmts(n.body, r);\n    return n;`;
    return `return rebuilt${owner(m)}(n, r) as ${type};`;
  }

  // `return n.id` and the like for each kind of a node type, the last as the default.
  byKind(name: string, pad: string, line: string): string[] throws Error {
    const uniq = uniqueShapes(this.aliasShapes(name), new Set<string>());
    let out: string[] = [];
    for (let j: usize = 0; j < uniq.length; j++) {
      out.push(j === uniq.length - 1 ? `${pad}default:` : `${pad}case ${JSON.stringify(uniq[j]!.kind!)}:`);
      out.push(`${pad}  ${line}`);
    }
    return out;
  }

  rebuildSource(this: Mut<this>, nodes: Ref<string[]>): string[] throws Error {
    let rebuilt: string[] = [
      `// What a rebuild reads each node's replacement through: the node itself when it has none.`,
      `export interface Replacements {`,
      `  isEmpty(): boolean;`,
    ];
    for (const name of nodes) if (this.hasId(name)) rebuilt.push(`  ${currentMethod(name)}(node: ${name}): ${name};`);
    append(rebuilt, [`  // A statement list checking edited, by its owner's id and the field holding it.`, `  currentList(owner: usize, field: string): Stmt[] | undefined;`, `}`, ``]);
    for (const name of nodes) {
      const start = `  let m = ${this.hasId(name) ? `r.${currentMethod(name)}(n)` : "n"};`;
      const body = this.rebuildChildren(name);
      append(rebuilt, [`export function rebuilt${name}(n: ${name}, r: Ref<Replacements>): ${name} {`, start, ...indented(body, "  "), `  return m;`, `}`, ``]);
    }
    append(rebuilt, [
      `export function rebuiltStmts(n: Mut<Stmt[]>, r: Ref<Replacements>): void {`,
      `  if (r.isEmpty() || n.length === 0) return;`,
      `  let a = n.splice(0);`,
      `  a.reverse();`,
      `  while (a.length > 0) {`,
      `    n.push(rebuiltStmt(a.pop()!, r));`,
      `  }`,
      `}`,
      ``,
    ]);
    for (let i: usize = 0; i < this.unionNames.length; i++) {
      const name = this.unionNames[i]!;
      const members = this.unionMembers[i]!.clone();
      const type = this.nt.showAll(members, " | ");
      let body: string[] = [];
      const expanded = this.nt.expandAll(members);
      let rest = expanded.filter((m) => !ref(m, "string"));
      const array = rest.findIndex((m) => m.kind === "array");
      if (array >= 0) {
        const inner = this.rebuilds(rest[array as usize]!, "n", "n", "n");
        append(body, [`if (Array.isArray(n)) {`, ...indented(inner, "  "), `  return n;`, `}`]);
        rest = without(rest, array);
      }
      if (expanded.some((m) => ref(m, "string"))) body.unshift(`if (typeof n === "string") return n;`);
      if (rest.length === 1) body.push(this.rebuildMember(rest[0]!, undefined, type));
      else {
        let seen = new Set<string>();
        body.push(`switch (n.kind) {`);
        for (const m of rest) {
          const kinds = freshKinds(this.nt.shapes(m), seen);
          for (const k of kinds) {
            body.push(`  case ${JSON.stringify(k)}:`);
            body.push(`    ${this.rebuildMember(m, k, type)}`);
          }
        }
        append(body, [`}`, `return n;`]);
      }
      append(rebuilt, [`// ${type}`, `export function rebuilt${name.slice(5)}(n: ${type}, r: Ref<Replacements>): ${type} {`, ...indented(body, "  "), `}`, ``]);
    }

    for (const name of nodes) {
      if (!this.hasId(name)) continue;
      const all = this.aliasShapes(name);
      if (all.length === 1) {
        append(rebuilt, [
          `export function withId${name}(n: ${name}, id: usize, by: usize, at?: [usize, usize]): ${name} {`,
          `  n.id = id;`,
          `  if (at !== undefined) {`,
          `    n.start = at[0];`,
          `    n.end = at[1];`,
          `  } else if (by !== 0) {`,
          `    n.start += by;`,
          `    n.end += by;`,
          `  }`,
          `  return n;`,
          `}`,
          ``,
          `export function idOf${name}(n: Ref<${name}>): usize {`,
          `  return n.id;`,
          `}`,
          ``,
          `export function mark${name}(n: Ref<${name}>): [usize, usize] {`,
          `  return [n.id, n.start * 1048576 + n.end];`,
          `}`,
          ``,
        ]);
        continue;
      }
      let casesId: string[] = [];
      for (const s of uniqueShapes(all, new Set<string>())) {
        append(casesId, [
          `    case ${JSON.stringify(s.kind!)}:`,
          `      n.id = id;`,
          `      if (at !== undefined) {`,
          `        n.start = at[0];`,
          `        n.end = at[1];`,
          `      } else if (by !== 0) {`,
          `        n.start += by;`,
          `        n.end += by;`,
          `      }`,
          `      return n;`,
        ]);
      }
      append(casesId, [`    default:`, `      return n;`]);
      const casesGetId = this.byKind(name, "    ", `return n.id;`);
      const casesMark = this.byKind(name, "    ", `return [n.id, n.start * 1048576 + n.end];`);
      append(rebuilt, [
        `export function withId${name}(n: ${name}, id: usize, by: usize, at?: [usize, usize]): ${name} {`,
        `  switch (n.kind) {`,
        ...casesId,
        `  }`,
        `}`,
        ``,
        `export function idOf${name}(n: Ref<${name}>): usize {`,
        `  switch (n.kind) {`,
        ...casesGetId,
        `  }`,
        `}`,
        ``,
        `export function mark${name}(n: Ref<${name}>): [usize, usize] {`,
        `  switch (n.kind) {`,
        ...casesMark,
        `  }`,
        `}`,
        ``,
      ]);
    }

    for (const name of nodes) {
      const body = this.cloneBody(name);
      append(rebuilt, [`export function clone${name}(n: Ref<${name}>): ${name} {`, ...indented(body, "  "), `}`, ``]);
    }
    append(rebuilt, [`export function cloneStmts(n: Ref<Stmt[]>): Stmt[] {`, `  return n.map((s) => cloneStmt(s));`, `}`, ``]);
    for (let i: usize = 0; i < this.unionNames.length; i++) {
      const name = this.unionNames[i]!;
      const members = this.unionMembers[i]!.clone();
      const fnName = `clone${name.slice(5)}`;
      const type = this.nt.showAll(members, " | ");
      let body: string[] = [];
      const expanded = this.nt.expandAll(members);
      let rest = expanded.filter((m) => !ref(m, "string"));
      const array = rest.findIndex((m) => m.kind === "array");
      if (array >= 0) {
        body.push(`if (Array.isArray(n)) return ${this.clonedValue(rest[array as usize]!, "n")};`);
        rest = without(rest, array);
      }
      if (expanded.some((m) => ref(m, "string"))) body.unshift(`if (typeof n === "string") return n;`);
      if (rest.length === 1) body.push(`return clone${owner(rest[0]!)}(n) as ${type};`);
      else {
        let seen = new Set<string>();
        let allShapes: Shape[] = [];
        for (const m of rest) append2(allShapes, uniqueShapes(this.nt.shapes(m), seen));
        body.push(`switch (n.kind) {`);
        for (const s of allShapes) {
          body.push(`  case ${JSON.stringify(s.kind!)}:`);
          body.push(`    return ${this.shapeExpr(s)};`);
        }
        append(body, [`  default:`, `    return ${fnName}(n);`, `}`]);
      }
      append(rebuilt, [`// ${type}`, `export function ${fnName}(n: Ref<${type}>): ${type} {`, ...indented(body, "  "), `}`, ``]);
    }
    return rebuilt;
  }

  // The cases of a switch over a tagged node's `of`, each tag's body made by `body`.
  idCases(tags: Ref<string[]>, types: Ref<string[]>, line: string, none: string): string[] throws Error {
    let out: string[] = [];
    for (let idx: usize = 0; idx < tags.length; idx++) {
      const type = types[idx]!;
      out.push(idx === tags.length - 1 ? `    default:` : `    case ${JSON.stringify(tags[idx]!)}:`);
      if (type === "Stmt[]" || !this.hasId(type)) {
        out.push(`      return ${none};`);
        continue;
      }
      if (this.aliasShapes(type).length === 1) {
        out.push(`      return ${line};`);
        continue;
      }
      out.push(`      switch (n.node.kind) {`);
      append(out, this.byKind(type, "        ", `return ${line};`));
      out.push(`      }`);
    }
    return out;
  }

  walkCases(this: Mut<this>, mode: string, tags: Ref<string[]>, types: Ref<string[]>, stmts: string[]): string[] throws Error {
    let out: string[] = [];
    for (let idx: usize = 0; idx < tags.length; idx++) {
      const type = types[idx]!;
      out.push(`    case ${JSON.stringify(tags[idx]!)}:`);
      if (mode === "step") {
        let body = type === "Stmt[]" ? stmts.clone() : this.children(mode, type, "n.node");
        if (type !== "Stmt[]") body.push(`break;`);
        append(out, indented(body, "      "));
        continue;
      }
      const body = type === "Stmt[]" ? stmts.clone() : this.children(mode, type, "n.node");
      append(out, indented(body, "      "));
      out.push(`      break;`);
    }
    return out;
  }

  sources(this: Mut<this>): string[] throws Error {
    let nodes: string[] = [];
    for (const name of this.nt.names) if (this.nt.isNode(name)) nodes.push(name);
    const rebuilt = this.rebuildSource(nodes);

    let tags: string[] = [];
    let types: string[] = [];
    for (const name of nodes) {
      tags.push(method(name));
      types.push(name);
    }
    tags.push("stmts");
    types.push("Stmt[]");
    const eachCases = this.walkCases("each", tags, types, [`for (const x of n.node) {`, `  v({ of: "stmt", node: x });`, `}`]);
    const namedCases = this.walkCases("named", tags, types, [`for (const x of n.node) {`, `  v("", { of: "stmt", node: x });`, `}`]);
    const collectCases = this.walkCases("collect", tags, types, [`for (const x of n.node) {`, `  collectIdsNode({ of: "stmt", node: x }, seen, order, shared);`, `}`]);
    const stepCases = this.walkCases("step", tags, types, [`if (k < n.node.length) return visitAt({ of: "stmt", node: n.node[k]! }, steps, d + 1, each);`, `break;`]);
    const nodeIdCases = this.idCases(tags, types, "n.node.id as i64", "-1");
    const spanKeyCases = this.idCases(tags, types, "n.node.start * 1048576 + n.node.end", "0");

    let anyNode: string[] = [];
    let nodeTypes: string[] = [];
    let reborrow: string[] = [];
    for (let i: usize = 0; i < tags.length; i++) {
      const of = JSON.stringify(tags[i]!);
      anyNode.push(`  | { of: ${of}; node: Ref<${types[i]!}> }${i === tags.length - 1 ? ";" : ""}`);
      nodeTypes.push(`  ${tags[i]!}: ${types[i]!};`);
      if (i < tags.length - 1) reborrow.push(`  if (n.of === ${of}) return { of: ${of}, node: n.node };`);
    }
    const visitor = [
      `// A node of any of the parser's types, tagged with which it is, since kinds repeat across them,`,
      `// or a list of statements, \`stmts\`, which is a scope of its own.`,
      `export type AnyNode =`,
      ...anyNode,
      ``,
      `// The type of node each tag names.`,
      `export type NodeTypes = {`,
      ...nodeTypes,
      `};`,
      ``,
      `// Hands each node \`n\` holds to \`v\`, in the order its type lists the fields, with a list of`,
      `// statements given whole.`,
      `export function forEachChild(n: AnyNode, v: (c: AnyNode) => void): void {`,
      `  switch (n.of) {`,
      ...eachCases,
      `  }`,
      `}`,
      ``,
      `// Hands each node \`n\` holds to \`v\` as \`forEachChild\` does, with the name of the field it sits`,
      `// in; a statement in a list given as \`n\` has none.`,
      `export function forEachNamedChild(n: AnyNode, v: (field: string, c: AnyNode) => void): void {`,
      `  switch (n.of) {`,
      ...namedCases,
      `  }`,
      `}`,
      ``,
      `// Reborrows \`n\` so a walk can pass a copy of the tagged reference to a callback.`,
      `export function reborrowAnyNode(n: Ref<AnyNode>): AnyNode {`,
      ...reborrow,
      `  return { of: "stmts", node: n.node };`,
      `}`,
      ``,
      `// Walks down \`steps\` from \`n\`, calling \`each\` on every first child along the way until a leaf`,
      `// or a node \`each\` skips is reached, or gives -1 when \`steps[d]\` is past the last child at \`d\`.`,
      `export function visitAt(n: AnyNode, steps: Mut<usize[]>, d: usize, each: (n: AnyNode) => boolean): i32 {`,
      `  if (d === steps.length) {`,
      `    if (n.of !== "stmts" && !each(reborrowAnyNode(n))) return 0;`,
      `    steps.push(0);`,
      `  }`,
      `  const k = steps[d]!;`,
      `  let i: usize = 0;`,
      `  switch (n.of) {`,
      ...stepCases,
      `  }`,
      `  if (d + 1 === steps.length && k === 0) {`,
      `    steps.pop();`,
      `    return 0;`,
      `  }`,
      `  return -1;`,
      `}`,
      ``,
      `// The id of \`n\`, or -1 when \`n\` has no id.`,
      `export function nodeIdOf(n: Ref<AnyNode>): i64 {`,
      `  switch (n.of) {`,
      ...nodeIdCases,
      `  }`,
      `}`,
      ``,
      `// A span fingerprint of \`n\` for detecting two distinct nodes sharing an id.`,
      `export function nodeSpanKey(n: Ref<AnyNode>): usize {`,
      `  switch (n.of) {`,
      ...spanKeyCases,
      `  }`,
      `}`,
      ``,
      `// Collects every distinct node id under \`n\` in pre-order, refusing two different nodes that`,
      `// share one id, and noting in \`shared\` any id reached more than once.`,
      `export function collectIdsNode(n: AnyNode, seen: Mut<Map<usize, usize>>, order: Mut<usize[]>, shared: Mut<Set<usize>>): void {`,
      `  const rawId = nodeIdOf(n);`,
      `  if (rawId >= 0) {`,
      `    const id = rawId as usize;`,
      `    const mark = nodeSpanKey(n);`,
      `    const was = seen.get(id);`,
      `    if (was !== undefined) {`,
      `      assert(was === mark, \`internal error: two nodes share id \${id}\`);`,
      `      shared.add(id);`,
      `      return;`,
      `    }`,
      `    seen.set(id, mark);`,
      `    order.push(id);`,
      `  }`,
      `  switch (n.of) {`,
      ...collectCases,
      `  }`,
      `}`,
      ``,
    ];
    let readers = new Readers(this.nt.clone());
    const read = readers.source();
    let both = visitor.clone();
    append(both, read);
    const walk = [
      `// Generated from the parser's AST types by \`fishc run scripts/walkgen.fsh\`; a test fails when it is stale.`,
      `// Visits each node a node holds, tagged, in the order its type lists the fields.`,
      `import assert from "node:assert";`,
      `import type { ${this.importsOf(both).join(", ")} } from "./parser.ts";`,
      ``,
      ...visitor,
      ...read,
    ];
    const rebuild = [
      `// Generated from the parser's AST types by \`fishc run scripts/walkgen.fsh\`; a test fails when it is stale.`,
      `// Each \`rebuilt\` function gives a node as the rewrite table has it, each node under it put in`,
      `// place the same way, writing the slots that held replaced nodes.`,
      `import type { ${this.importsOf(rebuilt).join(", ")} } from "./parser.ts";`,
      ``,
      ...rebuilt,
    ];
    return [text(walk), text(rebuild)];
  }

  importsOf(lines: Ref<string[]>): string[] {
    let names = this.nt.names.clone();
    names.push("Span");
    return names.filter((name) => lines.some((l) => hasWord(l, name)));
  }
}

function append2(out: Mut<Shape[]>, more: Shape[]): void {
  let rest = more;
  while (rest.length > 0) out.push(rest.shift()!);
}

function currentMethod(name: string): string {
  return name === "Expr" ? "current" : `current${name}`;
}

function text(lines: Ref<string[]>): string {
  return lines.join("\n").trimEnd() + "\n";
}

// How a reader hands a value on: the text around the expression for it.
type Push = { before: string; after: string };

function pushed(p: Ref<Push>, value: string): string {
  return `${p.before}${value}${p.after}`;
}

// A tree as a value a quote can read without reading an object's fields by name, which Fish
// can't: `quoteTree` copies a node into tagged values, each node its tag and its fields in order,
// an optional field only when it is there.
class Readers {
  readonly nt: NodeTypes;
  helperIndex: Map<string, usize>;
  helperNames: string[];
  helperLines: string[][];
  kindIndex: Map<string, usize>;
  kindLines: string[][];
  loops: usize;

  constructor(nt: NodeTypes) {
    this.nt = nt;
    this.helperIndex = new Map<string, usize>();
    this.helperNames = [];
    this.helperLines = [];
    this.kindIndex = new Map<string, usize>();
    this.kindLines = [];
    this.loops = 0;
  }

  plain(t: Ref<Ty>, v: string): string {
    if (t.kind === "literal") return t.bool ? `{ kind: "boolean", value: ${v} }` : `{ kind: "int", value: ${v} as i64 }`;
    if (ref(t, "boolean")) return `{ kind: "boolean", value: ${v} }`;
    if (ref(t, "f64")) return `{ kind: "float", value: ${v} }`;
    return `{ kind: "int", value: ${v} as i64 }`;
  }

  // A function taking `type`, written once per distinct type: its name, and its index in the
  // helpers when it is new and its lines are still to be written.
  helper(this: Mut<this>, prefix: string, type: string): [string, i64] {
    const key = `${prefix} ${type}`;
    const at = this.helperIndex.get(key);
    if (at !== undefined) return [this.helperNames[at]!, -1];
    const name = `${prefix}${this.helperNames.length}`;
    const fresh = this.helperNames.length;
    this.helperIndex.set(key, fresh);
    this.helperNames.push(name);
    this.helperLines.push([]);
    return [name, fresh as i64];
  }

  written(this: Mut<this>, at: i64, name: string, type: string, body: Ref<string[]>): void {
    if (at >= 0) this.helperLines[at as usize] = [`function ${name}(n: Ref<${type}>): QuoteValue {`, ...indented(body, "  "), `}`, ``];
  }

  // Statements handing `push` the value of `v`, of type `t`. Lists are read in place, as a helper
  // taking an array of a recursive node type isn't checked yet.
  value(this: Mut<this>, t: Ref<Ty>, v: string, push: Ref<Push>): string[] throws Error {
    const f = this.nt.formOf(t);
    switch (f.kind) {
      case "json":
        return [pushed(push, `{ kind: "text", value: ${v} }`)];
      case "plain":
        return [pushed(push, this.plain(t, v))];
      case "bigint":
        return [pushed(push, `{ kind: "bigint", value: ${v} }`)];
      case "node":
        return [pushed(push, `{ kind: "node", of: ${JSON.stringify(method(f.name))}, fields: fieldsOf${f.name}(${v}) }`)];
      case "union": {
        const type = this.nt.showAll(f.members, " | ");
        const [name, at] = this.helper("oneOf", type);
        if (at >= 0) {
          const body = this.union(f.members);
          this.written(at, name, type, body);
        }
        return [pushed(push, `${name}(${v})`)];
      }
      case "object": {
        const type = this.nt.show(t);
        const [name, at] = this.helper("recordOf", type);
        if (at >= 0) {
          const body = ["let out: QuoteField[] = [];", ...this.fields(f.fields, "n"), "return { kind: \"record\", fields: out };"];
          this.written(at, name, type, body);
        }
        return [pushed(push, `${name}(${v})`)];
      }
      case "array": {
        this.loops += 1;
        const n = this.loops;
        const items = `items${n}`;
        const x = `x${n}`;
        const element = this.nt.formOf(f.element);
        const add: Push = { before: `${items}.push(`, after: `);` };
        const each = element.kind === "option" ? this.optional(element.inner, x, add) : this.value(f.element, x, add);
        return [`let ${items}: QuoteValue[] = [];`, `for (const ${x} of ${v}) {`, ...indented(each, "  "), `}`, pushed(push, `{ kind: "list", items: ${items} }`)];
      }
      case "option":
        return this.optional(f.inner, v, push);
    }
    throw new Error("unreachable");
  }

  // An Option's value, or none.
  optional(this: Mut<this>, inner: Ref<Ty>, v: string, push: Ref<Push>): string[] throws Error {
    const first = `if (${v} === undefined) ${pushed(push, `{ kind: "none" }`)}`;
    const rest = this.value(inner, v, push);
    return [first, `else {`, ...indented(rest, "  "), `}`];
  }

  fields(this: Mut<this>, all: Ref<Field[]>, v: string): string[] throws Error {
    let out: string[] = [];
    for (const f of all) {
      const path = `${v}.${f.name}`;
      const form = this.nt.formOf(f.type);
      const push: Push = { before: `out.push({ name: ${JSON.stringify(f.name)}, value: `, after: ` });` };
      if (f.optional) {
        const inner = form.kind === "option" ? this.value(form.inner, path, push) : this.value(f.type, path, push);
        append(out, [`if (${path} !== undefined) {`, ...indented(inner, "  "), `}`]);
      } else append(out, this.value(f.type, path, push));
    }
    return out;
  }

  // A node's fields, its kind first when it has one.
  shapeFields(this: Mut<this>, s: Ref<Shape>): string[] throws Error {
    let out = ["let out: QuoteField[] = [];"];
    if (s.kind !== undefined) out.push(`out.push({ name: "kind", value: { kind: "text", value: n.kind } });`);
    append(out, this.fields(s.fields, "n"));
    out.push("return out;");
    return out;
  }

  cases(this: Mut<this>, all: Ref<Shape[]>, v: string): string[] throws Error {
    if (all.length === 1 && all[0]!.kind === undefined) return this.shapeFields(all[0]!);
    let out: string[] = [];
    for (const s of uniqueShapes(all, new Set<string>())) {
      const owner = s.owner ?? "undefined";
      const kind = s.kind!;
      const name = `fieldsOf${owner}_${kind}`;
      if (!this.kindIndex.has(name)) {
        const body = this.shapeFields(s);
        this.kindIndex.set(name, this.kindLines.length);
        this.kindLines.push([`function ${name}(n: Ref<Extract<${owner}, { kind: ${s.kindType ?? "undefined"} }>>): QuoteField[] {`, ...indented(body, "  "), `}`, ``]);
      }
      append(out, [`  case ${JSON.stringify(kind)}:`, `    return ${name}(${v});`]);
    }
    return [`switch (${v}.kind) {`, ...out, `}`, `return [];`];
  }

  // A union's value: a string, an array, or the node it is, told apart by kind.
  union(this: Mut<this>, members: Ref<Ty[]>): string[] throws Error {
    let body: string[] = [];
    let rest = this.nt.expandAll(members);
    if (rest.some((m) => ref(m, "string"))) {
      body.push("if (typeof n === \"string\") return { kind: \"text\", value: `${n}` };");
      rest = rest.filter((m) => !ref(m, "string"));
    }
    const array = rest.findIndex((m) => m.kind === "array");
    if (array >= 0) {
      const ret: Push = { before: "return ", after: ";" };
      const inner = this.value(rest[array as usize]!, "n", ret);
      append(body, [`if (Array.isArray(n)) {`, ...indented(inner, "  "), `}`]);
      rest = without(rest, array);
    }
    if (rest.length === 1 && this.nt.isNode(owner(rest[0]!))) {
      const o = owner(rest[0]!);
      body.push(`return { kind: "node", of: ${JSON.stringify(method(o))}, fields: fieldsOf${o}(n) };`);
      return body;
    }
    let seen = new Set<string>();
    body.push("switch (n.kind) {");
    for (const m of rest) {
      const o = owner(m);
      if (!this.nt.isNode(o)) throw new Error(`the field readers can't tell apart a union holding '${this.nt.show(m)}'`);
      for (const s of uniqueShapes(this.nt.shapes(m), seen)) {
        body.push(`  case ${JSON.stringify(s.kind!)}:`);
        body.push(`    return { kind: "node", of: ${JSON.stringify(method(o))}, fields: fieldsOf${o}(n) };`);
      }
    }
    append(body, ["}", `return { kind: "none" };`]);
    return body;
  }

  source(this: Mut<this>): string[] throws Error {
    let tags: string[] = [];
    let readers: string[] = [];
    for (let i: usize = 0; i < this.nt.names.length; i++) {
      const name = this.nt.names[i]!;
      if (!this.nt.isNode(name)) continue;
      const of = JSON.stringify(method(name));
      append(tags, [`    case ${of}:`, `      return { kind: "node", of: ${of}, fields: fieldsOf${name}(n.node) };`]);
      const all = this.nt.shapes(this.nt.types[i]!).map((s): Shape => ({ kind: s.kind, kindType: s.kindType, owner: s.owner ?? name, fields: s.fields.clone() }));
      const body = this.cases(all, "n");
      append(readers, [`function fieldsOf${name}(n: Ref<${name}>): QuoteField[] {`, ...indented(body, "  "), `}`, ``]);
    }
    const stmts: Ty = { kind: "array", element: refTo("Stmt") };
    const ret: Push = { before: "return ", after: ";" };
    const quoted = this.value(stmts, "n.node", ret);
    let out = [
      `// What a node's field holds, for a quote to read: text, a number, a boolean, a list, a node by`,
      `// its tag and fields, an object of fields that isn't a node, or nothing.`,
      `export type QuoteValue =`,
      `  | { kind: "none" }`,
      `  | { kind: "text"; value: string }`,
      `  | { kind: "boolean"; value: boolean }`,
      `  | { kind: "int"; value: i64 }`,
      `  | { kind: "bigint"; value: bigint }`,
      `  | { kind: "float"; value: f64 }`,
      `  | { kind: "list"; items: QuoteValue[] }`,
      `  | { kind: "node"; of: string; fields: QuoteField[] }`,
      `  | { kind: "record"; fields: QuoteField[] };`,
      `export type QuoteField = { name: string; value: QuoteValue };`,
      ``,
      `export function quoteTree(n: AnyNode): QuoteValue {`,
      `  switch (n.of) {`,
      ...tags,
      `    case "stmts": {`,
      ...indented(quoted, "      "),
      `    }`,
      `  }`,
      `  return { kind: "none" };`,
      `}`,
      ``,
      ...readers,
    ];
    for (const lines of this.kindLines) append(out, lines);
    for (const lines of this.helperLines) append(out, lines);
    return out;
  }
}

// The walkers, `src/walk.ts`, and the rebuild, `src/rebuild.ts`, from the parser's source.
export function walkSources(source: string): string[] throws Error | CompileError {
  let g = new Walkgen(nodeTypes(source));
  return g.sources();
}
