// Writes `src/unquote.fsh`, which turns a value a macro made while compiling, of an `Ast` type,
// back into the syntax tree it stands for, from the parser's own AST types in `src/parser.fsh`:
// the `Ast` types mirror them field for field, so each record reads as a node of its kind.
// `tests/walk.test.ts` fails when the file is stale.
import { type CompileError } from "../../src/diag.fsh";
import { append, hasWord, indented, nodeTypes, ref, type NodeTypes, type Shape, type Ty } from "./dumpgen.fsh";

// The fields the compiler sets on nodes for its own passes, which no `Ast` type has.
const INTERNAL = ["narrows"];

const HEADER = `// Generated from the parser's AST types by \`fishc run scripts/unquotegen.fsh\`; a test fails when it is stale.
// A value a macro made while compiling, of an \`Ast\` type, as the syntax tree it stands for: each
// record a node of its kind, its fields read by name, an absent part \`undefined\`, and a node made
// from one given a fresh id once its parts have theirs.
import type { Value } from "./comptime.fsh";
import { nextId, type Ids } from "./ids.fsh";
`;

const HELPERS = `
/** @throws {Error} */
function field(v: Ref<Value>, name: string): Value {
  if (v !== null && typeof v === "object" && v.kind === "member") return field(v.value, name);
  if (v !== null && typeof v === "object" && v.kind === "record") {
    const x = v.fields.get(name);
    return x === undefined ? undefined : x;
  }
  throw new Error(\`internal error: an Ast value without a '\${name}'\`);
}

/** @throws {Error} */
function kindOf(v: Ref<Value>): string {
  const k = field(v, "kind");
  return text(k);
}

function absent(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return absent(v.value);
  return v === null || v === undefined;
}

function isText(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return isText(v.value);
  return typeof v === "string";
}

function isItems(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return isItems(v.value);
  return v !== null && typeof v === "object" && v.kind === "array";
}

/** @throws {Error} */
function text(v: Ref<Value>): string {
  if (v !== null && typeof v === "object" && v.kind === "member") return text(v.value);
  if (typeof v === "string") return v;
  throw new Error("internal error: an Ast value that isn't text where text belongs");
}

/** @throws {Error} */
function flag(v: Ref<Value>): boolean {
  if (v !== null && typeof v === "object" && v.kind === "member") return flag(v.value);
  if (typeof v === "boolean") return v;
  throw new Error("internal error: an Ast value that isn't a boolean where one belongs");
}

/** @throws {Error} */
function count(v: Ref<Value>): usize {
  if (v !== null && typeof v === "object" && v.kind === "member") return count(v.value);
  if (typeof v === "bigint") return Number(v.toString())! as usize;
  throw new Error("internal error: an Ast value that isn't an integer where an offset belongs");
}

/** @throws {Error} */
function float(v: Ref<Value>): f64 {
  if (v !== null && typeof v === "object" && v.kind === "member") return float(v.value);
  if (typeof v === "number") return v;
  throw new Error("internal error: an Ast value that isn't a float where one belongs");
}

/** @throws {Error} */
function big(v: Ref<Value>): bigint {
  if (v !== null && typeof v === "object" && v.kind === "member") return big(v.value);
  if (typeof v === "bigint") return v;
  throw new Error("internal error: an Ast value that isn't an integer where one belongs");
}

/** @throws {Error} */
function itemsOf(v: Ref<Value>): Value[] {
  if (v !== null && typeof v === "object" && v.kind === "member") return itemsOf(v.value);
  if (v !== null && typeof v === "object" && v.kind === "array") return [...v.items];
  throw new Error("internal error: an Ast value that isn't a list where one belongs");
}
`;

class Unquoter {
  readonly nt: NodeTypes;
  wordIndex: Map<string, usize>;
  wordTypes: string[];
  wordNames: string[];
  wordValues: string[][];
  unionIndex: Map<string, usize>;
  unionNames: string[];
  unionMembers: Ty[][];
  kindIndex: Map<string, usize>;
  kindLines: string[][];
  loops: usize;

  constructor(nt: NodeTypes) {
    this.nt = nt;
    this.wordIndex = new Map<string, usize>();
    this.wordTypes = [];
    this.wordNames = [];
    this.wordValues = [];
    this.unionIndex = new Map<string, usize>();
    this.unionNames = [];
    this.unionMembers = [];
    this.kindIndex = new Map<string, usize>();
    this.kindLines = [];
    this.loops = 0;
  }

  literals(t: Ref<Ty>): string[] {
    if (t.kind === "literal") return [t.text];
    if (t.kind === "union") {
      let out: string[] = [];
      for (const m of t.types) append(out, this.literals(m));
      return out;
    }
    if (t.kind === "ref" && this.nt.has(t.name)) return this.literals(this.nt.types[this.nt.at(t.name)]!);
    return [];
  }

  // The function reading text as the word type `t`, which names its values.
  word(this: Mut<this>, t: Ref<Ty>): string throws Error {
    if (ref(t, "string")) return "text";
    const type = this.nt.show(t);
    const at = this.wordIndex.get(type);
    if (at !== undefined) return this.wordNames[at]!;
    const name = `word${this.wordNames.length}`;
    this.wordIndex.set(type, this.wordNames.length);
    this.wordTypes.push(type);
    this.wordNames.push(name);
    this.wordValues.push(this.literals(t));
    return name;
  }

  unionName(this: Mut<this>, members: Ref<Ty[]>): string throws Error {
    const key = this.nt.showAll(members, " | ");
    const at = this.unionIndex.get(key);
    if (at !== undefined) return this.unionNames[at]!;
    const name = `unquoteUnion${this.unionNames.length}`;
    this.unionIndex.set(key, this.unionNames.length);
    this.unionNames.push(name);
    this.unionMembers.push(members.clone());
    return name;
  }

  // An expression giving the value `v`, of type `t`, as the tree has it. `field` writes the type
  // of the node's field it fills, when it fills one.
  value(this: Mut<this>, t: Ref<Ty>, v: string, field: string | undefined): string throws Error {
    const f = this.nt.formOf(t);
    switch (f.kind) {
      case "json":
        return `${this.word(t)}(${v})`;
      case "bigint":
        return `big(${v})`;
      case "plain":
        if (t.kind === "literal") return `${t.json} as const`;
        if (ref(t, "boolean")) return `flag(${v})`;
        if (ref(t, "f64")) return `float(${v})`;
        return `count(${v})`;
      case "node":
        return `unquote${f.name}(ids, ${v})`;
      case "union":
        return `${this.unionName(f.members)}(ids, ${v})`;
      case "array": {
        this.loops += 1;
        const x = `x${this.loops}`;
        // A list whose elements may be absent is typed by its field, as the checker reads a
        // recursive type's absent elements only through the field's own type.
        const optional = this.nt.formOf(f.element).kind === "option";
        const element = optional && field !== undefined ? `${field}[usize]` : this.nt.show(f.element);
        const inner = this.value(f.element, x, undefined);
        return `itemsOf(${v}).map((${x}): ${element} => ${inner})`;
      }
      case "option": {
        const inner = this.value(f.inner, v, undefined);
        return `absent(${v}) ? undefined : ${inner}`;
      }
      case "object":
        return this.build({ kind: undefined, kindType: undefined, owner: undefined, fields: f.fields.clone() }, v, undefined);
    }
    throw new Error("unreachable");
  }

  // A node of shape `s` made from the record `v`: its fields in order, then its id.
  build(this: Mut<this>, s: Ref<Shape>, v: string, type: string | undefined): string throws Error {
    let parts: string[] = [];
    const kind = s.kind;
    if (kind !== undefined) parts.push(`kind: ${JSON.stringify(kind)}`);
    let id = false;
    for (const f of s.fields) {
      if (f.name === "id") id = true;
      if (f.name === "id" || INTERNAL.includes(f.name)) continue;
      const x = `field(${v}, ${JSON.stringify(f.name)})`;
      const typed = type !== undefined && !f.optional ? `${type}[${JSON.stringify(f.name)}]` : undefined;
      let part = "";
      if (f.name === "start" || f.name === "end") part = `count(${x})`;
      else if (f.optional) {
        const inner = this.value(f.type, x, undefined);
        part = `absent(${x}) ? undefined : ${inner}`;
      } else part = this.value(f.type, x, typed);
      parts.push(`${f.name}: ${part}`);
    }
    if (id) parts.push("id: nextId(ids)");
    return `{ ${parts.join(", ")} }`;
  }

  // A switch over the node kinds of `all`, each kind made by a function of its own.
  cases(this: Mut<this>, all: Ref<Shape[]>): string[] throws Error {
    if (all.length === 1 && all[0]!.kind === undefined) {
      const made = this.build(all[0]!, "v", undefined);
      return [`return ${made};`];
    }
    let out: string[] = [];
    let seen = new Set<string>();
    for (const s of all) {
      const kind = s.kind;
      const owner = s.owner ?? "undefined";
      if (kind === undefined) throw new Error(`unquotegen can't tell apart the nodes of ${owner}`);
      if (seen.has(kind)) continue;
      seen.add(kind);
      const name = `unquote${owner}_${kind}`;
      if (!this.kindIndex.has(name)) {
        const at = this.kindLines.length;
        this.kindIndex.set(name, at);
        this.kindLines.push([]);
        const type = `Extract<${owner}, { kind: ${s.kindType ?? "undefined"} }>`;
        const made = this.build(s, "v", type);
        this.kindLines[at] = fn(name, type, [`return ${made};`], false);
      }
      append(out, [`  case ${JSON.stringify(kind)}:`, `    return ${name}(ids, v);`]);
    }
    return [`const kind = kindOf(v);`, `switch (kind) {`, ...out, `}`, `throw new Error(\`internal error: an Ast value of kind '\${kind}', which no node here has\`);`];
  }

  source(this: Mut<this>): string throws Error {
    let out: string[] = [];
    for (let i: usize = 0; i < this.nt.names.length; i++) {
      const name = this.nt.names[i]!;
      if (!this.nt.isNode(name)) continue;
      const all = this.nt.shapes(this.nt.types[i]!).map((s): Shape => ({ kind: s.kind, kindType: s.kindType, owner: s.owner ?? name, fields: s.fields.clone() }));
      append(out, fn(`unquote${name}`, name, this.cases(all), true));
    }
    // Unions found while writing the node makers, and those found while writing these.
    for (let i: usize = 0; i < this.unionNames.length; i++) {
      const name = this.unionNames[i]!;
      const members = this.unionMembers[i]!.clone();
      let body: string[] = [];
      let rest = this.nt.expandAll(members);
      if (rest.some((m) => ref(m, "string"))) {
        body.push(`if (isText(v)) return text(v);`);
        rest = rest.filter((m) => !ref(m, "string"));
      }
      const array = rest.findIndex((m) => m.kind === "array");
      if (array >= 0) {
        const made = this.value(rest[array as usize]!, "v", undefined);
        body.push(`if (isItems(v)) return ${made};`);
        rest.splice(array, 1);
      }
      // One node type left is that type's maker's; several are told apart by kind here.
      const only = rest.length === 1 ? this.onlyNode(rest[0]!) : undefined;
      if (only !== undefined) body.push(`return unquote${only}(ids, v);`);
      else {
        let shapes: Shape[] = [];
        for (const m of rest) {
          let some = this.nt.shapes(m);
          while (some.length > 0) shapes.push(some.shift()!);
        }
        append(body, this.cases(shapes));
      }
      append(out, fn(name, this.nt.showAll(members, " | "), body, false));
    }
    for (const lines of this.kindLines) append(out, lines);
    for (let i: usize = 0; i < this.wordNames.length; i++) {
      const values: Ref<string[]> = this.wordValues[i]!;
      append(out, [`/** @throws {Error} */`, `function ${this.wordNames[i]!}(v: Ref<Value>): ${this.wordTypes[i]!} {`, `  const s = text(v);`]);
      for (const x of values) out.push(`  if (s === ${JSON.stringify(x)}) return ${JSON.stringify(x)};`);
      const named = values.map((x) => `'${x}'`).join(", ").replaceAll("`", "\\`");
      append(out, [`  throw new Error(\`internal error: '\${s}' where an Ast value names one of ${named}\`);`, `}`, ``]);
    }
    let imports: string[] = [];
    for (const name of this.nt.names) if (out.some((l) => hasWord(l, name))) imports.push(name);
    const all = [HEADER.trimEnd(), `import type { ${imports.join(", ")} } from "./parser.fsh";`, HELPERS, ...out];
    return all.join("\n").trimEnd() + "\n";
  }

  onlyNode(m: Ref<Ty>): string | undefined {
    return m.kind === "ref" && this.nt.isNode(m.name) ? m.name : undefined;
  }
}

function fn(name: string, type: string, body: Ref<string[]>, exported: boolean): string[] {
  return [`/** @throws {Error} */`, `${exported ? "export " : ""}function ${name}(ids: Mut<Ids>, v: Ref<Value>): ${type} {`, ...indented(body, "  "), `}`, ``];
}

export function unquoteSource(source: string): string throws Error | CompileError {
  let u = new Unquoter(nodeTypes(source));
  return u.source();
}
