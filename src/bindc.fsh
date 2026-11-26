import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `fishc bind c <header.h>`: a C header's declarations as Fish, read from clang's JSON AST. Its
// functions become `declare function`s, its structs `@c` classes, its enums Fish enums and its
// integer `#define`s constants; what can't cross yet is listed with the reason.

// The parts of clang's JSON AST read here; the rest of each node is left out as it is parsed.
type CLoc = { file?: string; line?: i64; col?: i64; spellingLoc?: CLoc; expansionLoc?: CLoc };
type CQual = { qualType: string; desugaredQualType?: string };
type CNode = {
  id?: string;
  kind: string;
  name?: string;
  loc?: CLoc;
  range?: { begin?: CLoc; end?: CLoc };
  type?: CQual;
  inner?: CNode[];
  tagUsed?: string;
  completeDefinition?: boolean;
  variadic?: boolean;
  isImplicit?: boolean;
  storageClass?: string;
  value?: string;
  isBitfield?: boolean;
  inline?: boolean;
};

// What a header gives: the Fish text, and each declaration left out with why.
export type Bound = { source: string; skipped: string[] };

// A struct the bindings declare: its Fish name, and its fields as Fish types, or why it can't be one.
type Struct = { name: string; fields: [string, string][] | undefined; why: string | undefined };

class Binder {
  // Whether C's plain `char` is signed on the machine the header is read for.
  charSigned: boolean;
  // The struct definitions anywhere in the translation unit, by their C name (`struct tm`), and
  // the typedef names each anonymous one is known by.
  definitions: Map<string, CNode>;
  // The structs to declare, in the order they are first needed, by C name.
  structs: Map<string, Struct>;
  // What each typedef name stands for, as clang spells that type.
  typedefs: Map<string, string>;
  order: string[];
  lines: string[];
  skipped: string[];

  constructor(charSigned: boolean) {
    this.charSigned = charSigned;
    this.definitions = new Map<string, CNode>();
    this.structs = new Map<string, Struct>();
    this.typedefs = new Map<string, string>();
    this.order = [];
    this.lines = [];
    this.skipped = [];
  }

  // A C type, as clang spells it once its typedefs are expanded, as a Fish type, or a reason it
  // can't cross yet prefixed with `!`.
  fishType(this: Mut<this>, written: string, field: boolean): string {
    let t = written.trim().replaceAll("__restrict", "").replaceAll("restrict", "").replaceAll("volatile ", "").trim();
    // A typedef's name stands for what it names, through any typedefs that names.
    for (let hops = 0; hops < 32; hops++) {
      const bare = t.replace(/^const /, "");
      const named = /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare) ? this.typedefs.get(bare) : undefined;
      if (named === undefined) break;
      t = named;
    }
    if (t.includes("(*)") || t.includes("(^)")) return "!it takes a function pointer, which can't cross yet";
    const array = /^(.*?)\s*\[(\d+)\]$/.exec(t);
    if (array !== null) {
      if (!field) return "!an array parameter, which C passes as a pointer";
      const element = this.fishType(array[1]!, true);
      return element.startsWith("!") ? element : `FixedArray<${element}, ${array[2]!}>`;
    }
    if (t.endsWith("*")) {
      const pointee = t.slice(0, -1).trim();
      const constant = pointee.startsWith("const ") || pointee.endsWith(" const");
      const bare = pointee.replace(/^const /, "").replace(/ const$/, "").trim();
      let to = bare === "void" || bare === "char" || bare === "signed char" || bare === "unsigned char" ? "u8" : this.fishType(bare, false);
      if (to.startsWith("!")) {
        // A pointer to a struct that can't be laid out is still a pointer: it is opaque.
        if (!bare.startsWith("struct ")) return to;
        to = this.opaque(bare);
      }
      return `${constant ? "Ptr" : "MutPtr"}<${to}>`;
    }
    t = t.replace(/^const /, "").trim();
    const scalar = SCALARS.get(t);
    if (scalar !== undefined) return scalar;
    if (t === "char") return this.charSigned ? "i8" : "u8";
    if (t.startsWith("enum ")) return "i32";
    if (t.startsWith("union ")) return "!it holds a C union, which can't cross yet";
    if (t === "long double") return "!a 'long double', which Fish has no type for";
    if (t === "void") return "void";
    if (t.startsWith("struct ")) return this.struct(t);
    return `!its type '${written}' can't cross yet`;
  }

  // The Fish class a struct is declared as, its fields laid out, or why it can't be.
  struct(this: Mut<this>, c: string): string {
    const known = this.structs.get(c);
    if (known !== undefined) return known.why !== undefined ? `!${known.why}` : known.name;
    const node = this.definitions.get(c);
    const name = className(c, node !== undefined ? node.name : undefined);
    if (node === undefined) return `!it holds '${c}' by value, which the header doesn't define`;
    // Marked before its fields are read, so a struct holding a pointer to itself finds its name.
    this.structs.set(c, { name, fields: undefined, why: undefined });
    let fields: [string, string][] = [];
    let why: string | undefined = undefined;
    const fieldNodes = innerOf(node);
    for (const f of fieldNodes) {
      if (f.kind !== "FieldDecl") continue;
      if (f.isBitfield === true) why = `'${c}' has bit-fields, which can't be laid out yet`;
      const t = this.fishType(typeOf(f), true);
      if (t.startsWith("!")) why = `'${c}' can't be laid out: its field '${f.name ?? ""}' ${t.slice(1).replace(/^it /, "")}`;
      fields.push([f.name ?? `field${fields.length}`, t]);
    }
    this.structs.set(c, { name, fields: why === undefined ? fields : undefined, why });
    if (why !== undefined) return `!${why}`;
    this.order.push(c);
    return name;
  }

  // A struct known only through pointers: a class with no fields, which only pointers make sense of.
  opaque(this: Mut<this>, c: string): string {
    const known = this.structs.get(c);
    if (known !== undefined && known.why === undefined) return known.name;
    const defined = this.definitions.get(c);
    const name = className(c, defined !== undefined ? defined.name : undefined);
    this.structs.set(c, { name, fields: [], why: undefined });
    this.order.push(c);
    return name;
  }

  function(this: Mut<this>, f: Ref<CNode>): void {
    const name = f.name ?? "";
    if (f.storageClass === "static" || f.inline === true) {
      this.skip(name, "it is static or inline, so the library has no symbol for it");
      return;
    }
    if (f.variadic === true) {
      this.skip(name, "it is variadic, which can't be called yet");
      return;
    }
    const shape = typeOf(f);
    const open = paramsStart(shape);
    if (open < 0) {
      this.skip(name, `its type '${shape}' isn't a plain function`);
      return;
    }
    const returns = this.fishType(shape.slice(0, open).trim(), false);
    if (returns.startsWith("!")) {
      this.skip(name, returns.slice(1));
      return;
    }
    let params: string[] = [];
    let i = 0;
    const paramNodes = innerOf(f);
    for (const p of paramNodes) {
      if (p.kind !== "ParmVarDecl") continue;
      const t = this.fishType(typeOf(p), false);
      if (t.startsWith("!")) {
      this.skip(name, t.slice(1));
      return;
    }
      const given = p.name ?? "";
      params.push(`${given === "" || RESERVED.has(given) ? `a${i}` : given}: ${t}`);
      i++;
    }
    this.lines.push(`export declare function ${name}(${params.join(", ")}): ${returns};`);
  }

  enumeration(this: Mut<this>, e: Ref<CNode>, typedef: string | undefined): void {
    const name = e.name ?? typedef;
    let members: string[] = [];
    let next = 0n;
    const memberNodes = innerOf(e);
    for (const m of memberNodes) {
      if (m.kind !== "EnumConstantDecl") continue;
      const value = constantOf(m) ?? next;
      // An anonymous enum's members are constants of their own.
      if (name === undefined) this.lines.push(`export const ${m.name ?? ""}: i32 = ${value};`);
      else members.push(`  ${m.name ?? ""} = ${value},`);
      next = value + 1n;
    }
    if (name !== undefined && members.length > 0) this.lines.push(`export enum ${name} {\n${members.join("\n")}\n}`);
  }

  skip(this: Mut<this>, name: string, why: string): void {
    this.skipped.push(`${name}: ${why}`);
  }
}

// How clang spells each C number and boolean, as Fish's sized types for LP64 targets.
const SCALARS = new Map<string, string>([
  ["signed char", "i8"], ["unsigned char", "u8"], ["short", "i16"], ["unsigned short", "u16"],
  ["int", "i32"], ["unsigned int", "u32"], ["long", "i64"], ["unsigned long", "u64"],
  ["long long", "i64"], ["unsigned long long", "u64"], ["__int128", "i128"], ["unsigned __int128", "u128"],
  ["float", "f32"], ["double", "f64"], ["_Bool", "boolean"], ["bool", "boolean"],
]);

// Names a parameter can't take in Fish, which a C header may give one.
const RESERVED = new Set<string>(["this", "new", "class", "function", "default", "delete", "in", "of", "let", "var", "const", "enum", "export", "import", "type", "interface", "match", "comptime", "yield", "await", "async", "typeof", "instanceof", "void", "null", "true", "false", "super", "with", "package", "private", "public", "protected", "static", "unsafe", "move"]);

// A node's children.
function innerOf(n: Ref<CNode>): CNode[] {
  return n.inner !== undefined ? n.inner.clone() : [];
}

// A node's type as the header writes it; typedef names are expanded where it is read.
function typeOf(n: Ref<CNode>): string {
  if (n.type === undefined) return "";
  return n.type.qualType;
}

// Where a function type's parameter list starts: its last top-level `(`.
function paramsStart(shape: string): i64 {
  let depth = 0;
  for (let i: i64 = (shape.length as i64) - 1; i >= 0; i--) {
    const ch = shape[i as usize]!;
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) return shape.slice(0, i).includes("(") ? -1 : i;
    }
  }
  return -1;
}

// An enum member's value, when the header writes one.
function constantOf(m: Ref<CNode>): bigint | undefined {
  const parts = innerOf(m);
  for (const x of parts) if (x.kind === "ConstantExpr" && x.value !== undefined) return integerOf(x.value!, 10);
  return undefined;
}

// The Fish name of a struct: its tag, or the typedef naming an anonymous one.
function className(c: string, named: string | undefined): string {
  const tag = c.slice("struct ".length as i64);
  if (!tag.startsWith("(")) return tag;
  return named ?? "Anonymous";
}

// The file a location names, the place a macro expands taking precedence.
function fileOf(loc: Ref<CLoc | undefined>): string | undefined {
  if (loc === undefined) return undefined;
  return loc.expansionLoc?.file ?? loc.spellingLoc?.file ?? loc.file;
}

// The file each of the translation unit's declarations is in. Clang names a location's file only
// when it differs from the location printed before it, in the order it prints them: a node's
// `loc`, then its `range`, then its children.
function filesOf(decls: Ref<CNode[]>): string[] {
  let out: string[] = [];
  let seen: Seen = { file: "" };
  for (const d of decls) {
    // A declaration's own location comes first.
    const own = fileOf(d.loc) ?? seen.file;
    visit(d, seen);
    out.push(d.isImplicit === true ? "" : own);
  }
  return out;
}

type Seen = { file: string };

// Notes the last file `n` and its children name, in the order clang prints them.
function visit(n: Ref<CNode>, seen: Mut<Seen>): void {
  if (n.loc !== undefined) located(n.loc, seen);
  if (n.range !== undefined) {
    if (n.range.begin !== undefined) located(n.range.begin, seen);
    if (n.range.end !== undefined) located(n.range.end, seen);
  }
  if (n.inner !== undefined) for (const c of n.inner) visit(c, seen);
}

function located(loc: Ref<CLoc>, seen: Mut<Seen>): void {
  if (loc.spellingLoc !== undefined && loc.spellingLoc.file !== undefined) seen.file = loc.spellingLoc.file;
  if (loc.expansionLoc !== undefined && loc.expansionLoc.file !== undefined) seen.file = loc.expansionLoc.file;
  if (loc.file !== undefined) seen.file = loc.file;
}

// The integer `text` writes in `base`, which may be negative in base 10, or undefined.
function integerOf(text: string, base: i64): bigint | undefined {
  const negative = base === 10 && text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  if (digits === "") return undefined;
  let v = 0n;
  for (let i: usize = 0; i < digits.length; i++) {
    const d = "0123456789abcdef".indexOf(digits[i]!.toLowerCase());
    if (d < 0 || d >= base) return undefined;
    v = v * BigInt(base) + BigInt(d);
  }
  return negative ? -v : v;
}

// The integer `#define`s a header writes: object-like macros whose value is an integer literal,
// maybe negative and parenthesized, with C's suffixes.
function defines(text: string): string[] {
  let out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s+\(?\s*(-?)\s*(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)[uUlL]*\s*\)?\s*(?:\/\/.*|\/\*.*\*\/\s*)?$/.exec(line);
    if (m === null) continue;
    const digits = m[3]!;
    const hex = /^0[xX]/.test(digits);
    const octal = !hex && digits.length > 1 && digits.startsWith("0");
    const value = hex ? integerOf(digits.slice(2), 16) : octal ? integerOf(digits.slice(1), 8) : integerOf(digits, 10);
    if (value === undefined) continue;
    const signed = m[2]! === "-" ? -value! : value!;
    const type = signed > 9223372036854775807n ? "u64" : "i64";
    out.push(`export const ${m[1]!}: ${type} = ${signed};`);
  }
  return out;
}

// The name a typedef right after an anonymous struct or enum gives it.
function typedefAfter(decls: Ref<CNode[]>, i: usize): string | undefined {
  if (i + 1 >= decls.length) return undefined;
  const next: Ref<CNode> = decls[i + 1]!;
  return next.kind === "TypedefDecl" ? next.name : undefined;
}

// The bindings for `header`, from clang's JSON AST of it, `ast`, and its text.
/** @throws {JsonError} */
export function bindings(ast: string, header: string, text: string, charSigned: boolean): Bound {
  let unit = JSON.parse<CNode>(ast);
  let binder = new Binder(charSigned);
  let decls: CNode[] = [];
  if (unit.inner !== undefined) decls = unit.inner!;
  const files = filesOf(decls);
  const own = resolve(header);
  // Every struct defined anywhere is known, so one the header uses by value from another header
  // is declared too; an anonymous one takes the name its typedef gives it.
  for (let i: usize = 0; i < decls.length; i++) {
    const d: Ref<CNode> = decls[i]!;
    if (d.kind === "TypedefDecl" && d.name !== undefined && d.type !== undefined) {
      // An anonymous struct's typedef is spelled by clang the other way round: its type
      // `struct point`, desugared as the name itself.
      const desugared = d.type.desugaredQualType;
      binder.typedefs.set(d.name, desugared !== undefined && desugared !== d.name ? desugared : d.type.qualType);
    }
    if (d.kind === "RecordDecl" && d.tagUsed === "struct" && d.completeDefinition === true) {
      const named = d.name !== undefined && d.name !== "";
      const typedef = !named ? typedefAfter(decls, i) : undefined;
      const key = named ? `struct ${d.name!}` : typedef !== undefined ? `struct ${typedef}` : "";
      if (key !== "") binder.definitions.set(key, typedef !== undefined ? { ...d, name: typedef } : { ...d });
    }
  }
  for (let i: usize = 0; i < decls.length; i++) {
    const d: Ref<CNode> = decls[i]!;
    if (files[i]! === "" || resolve(files[i]!) !== own) continue;
    if (d.kind === "FunctionDecl") binder.function(d);
    else if (d.kind === "EnumDecl") {
      binder.enumeration(d, d.name === undefined || d.name === "" ? typedefAfter(decls, i) : undefined);
    } else if (d.kind === "RecordDecl" && d.tagUsed === "struct" && d.completeDefinition === true) {
      const after = typedefAfter(decls, i);
      const key = d.name !== undefined && d.name !== "" ? `struct ${d.name}` : after !== undefined ? `struct ${after}` : "";
      if (key !== "") {
        const made = binder.struct(key);
        if (made.startsWith("!")) binder.skip(key, made.slice(1));
      }
    } else if (d.kind === "RecordDecl" && d.tagUsed === "union") binder.skip(`union ${d.name ?? ""}`, "C unions can't cross yet");
    else if (d.kind === "VarDecl") binder.skip(d.name ?? "", "C global variables can't be reached yet");
  }
  let out: string[] = [`// Generated by 'fishc bind c' from ${header}; generate it again rather than editing it.`, ""];
  for (const c of binder.order) {
    const s = binder.structs.get(c)!;
    let fields: [string, string][] = [];
    if (s.fields !== undefined) fields = s.fields!;
    out.push("@c");
    out.push(`export class ${s.name} {`);
    for (const [name, t] of fields) out.push(`  ${name}: ${t} = ${initial(t, binder.structs)};`);
    out.push("}");
    out.push("");
  }
  for (const line of binder.lines) out.push(line);
  const constants = defines(text);
  if (constants.length > 0) out.push("");
  for (const line of constants) out.push(line);
  out.push("");
  return { source: out.join("\n"), skipped: [...binder.skipped] };
}

// A field's value in a struct made by `new`, which C would leave zeroed.
function initial(t: string, structs: Ref<Map<string, Struct>>): string {
  if (t === "boolean") return "false";
  if (t.startsWith("Ptr<") || t.startsWith("MutPtr<")) return `unsafe { nullPtr<${t.slice(t.indexOf("<") + 1, -1)}>() }`;
  const fixed = /^FixedArray<(.*), (\d+)>$/.exec(t);
  if (fixed !== null) return `FixedArray.filled<${fixed[1]!}, ${fixed[2]!}>(${initial(fixed[1]!, structs)})`;
  if (SCALARS_FISH.has(t)) return "0";
  return `new ${t}()`;
}

const SCALARS_FISH = new Set<string>(["i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128", "f32", "f64"]);

// Reads a header through clang and gives its bindings.
/** @throws {Error | IoError | JsonError} */
export function bindHeader(header: string, cc: string, args: string[]): Bound {
  const text = readFileSync(header, "utf8");
  const run = Bun.spawnSync([cc, "-x", "c", "-fsyntax-only", "-Xclang", "-ast-dump=json", ...args, header], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`${cc} couldn't read '${header}':\n${new TextDecoder().decode(run.stderr)}`);
  const signed = !(process.platform === "linux" && process.arch === "arm64");
  return bindings(new TextDecoder().decode(run.stdout), header, text, signed);
}
