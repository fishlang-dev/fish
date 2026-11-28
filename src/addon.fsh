// `fishc build --addon`: a Node and Bun addon built on N-API from a Fish file's exports. The addon
// is a shared library built from a generated entry, which imports the file's exported functions
// and wraps each in a C function N-API calls, converting every argument from its JavaScript value
// and the result back. The conversions follow the signatures as written in the file, so a type
// crossing to JavaScript is named there: a primitive, or a `type` alias or field-only interface
// the file declares.
import { CompileError } from "./diag.fsh";
import type { Ids } from "./nodes.fsh";
import { parse, type Func, type Stmt, type TypeMember, type TypeNode } from "./parser.fsh";

// A value as it crosses to JavaScript. An `option` is empty as `null` or as `undefined`, as written.
type NumberShape = { kind: "number"; name: string };
type PlainShape = { kind: "bigint" | "boolean" | "string" | "bytes" | "void" };
type ArrayShape = { kind: "array"; of: Shape };
type FieldShape = { name: string; optional: boolean; shape: Shape };
type ObjectShape = { kind: "object"; fields: FieldShape[] };
type OptionShape = { kind: "option"; of: Shape; empty: "null" | "undefined" };
type Shape = NumberShape | PlainShape | ArrayShape | ObjectShape | OptionShape;

type Export = { name: string; params: { name: string; shape: Shape }[]; returns: Shape; async: boolean; throws: boolean };

// What the build writes: the generated entry, the C glue N-API loads, and the declarations.
export type Addon = { fish: string; glue: string; dts: string };

const NUMBERS = ["i8", "i16", "i32", "i64", "isize", "u8", "u16", "u32", "u64", "usize", "f32", "f64"];
const INTEGER_RANGES: [string, string, string][] = [
  ["i8", "-128", "127"], ["i16", "-32768", "32767"], ["i32", "-2147483648", "2147483647"], ["u8", "0", "255"], ["u16", "0", "65535"], ["u32", "0", "4294967295"],
  ["i64", "-9007199254740991", "9007199254740991"], ["isize", "-9007199254740991", "9007199254740991"], ["u64", "0", "9007199254740991"], ["usize", "0", "9007199254740991"],
];

// The declarations the file's signatures may name: its `type` aliases and interfaces.
type Named = Map<string, TypeNode | Stmt>;

function declared(program: Ref<Stmt[]>): Named {
  let named: Named = new Map();
  for (const s of program) {
    const d: Ref<Stmt> = s.kind === "export" ? s.body : s;
    if (d.kind === "typeAlias" && d.typeParams.length === 0) named.set(d.name, d.type.clone());
    if (d.kind === "interface" && d.typeParams.length === 0) named.set(d.name, d.clone());
  }
  return named;
}

const CROSSING = "an addon passes numbers, bigint, boolean, string, u8[], arrays, object types and their Options";

function refused(what: string, why: string, at: Ref<TypeNode>): CompileError {
  return new CompileError("E1003", `an addon can't pass ${what} to JavaScript; ${why}`, at.start, at.end);
}

// The shape of a written type, following the file's own aliases and interfaces. `within` names
// those being followed, since a type that holds itself has no end as a JavaScript value.
/** @throws {CompileError} */
function shapeOf(t: Ref<TypeNode>, named: Ref<Named>, within: Ref<string[]>): Shape {
  if (t.kind === "ref" && t.args.length === 0) {
    if (NUMBERS.includes(t.name)) return { kind: "number", name: t.name };
    if (t.name === "bigint") return { kind: "bigint" };
    if (t.name === "boolean") return { kind: "boolean" };
    if (t.name === "string") return { kind: "string" };
    if (t.name === "void") return { kind: "void" };
    if (t.name === "i128" || t.name === "u128") throw refused(`an '${t.name}'`, "pass it as a bigint", t);
    const d = named.get(t.name);
    if (d === undefined) throw refused(`'${t.name}'`, `it isn't a type this file declares; declare it here with 'type ${t.name} = ...'`, t);
    if (within.includes(t.name)) throw refused(`'${t.name}'`, "it holds itself, which a JavaScript value can't", t);
    const inner = [...within, t.name];
    if ("kind" in d && d.kind === "interface") return interfaceShape(d, named, inner, t);
    return shapeOf(d as TypeNode, named, inner);
  }
  if (t.kind === "ref" && t.name === "Option" && t.args.length === 1) return { kind: "option", of: shapeOf(t.args[0]!, named, within), empty: "null" };
  if (t.kind === "array") {
    const element: Ref<TypeNode> = t.element;
    if (element.kind === "ref" && element.name === "u8" && element.args.length === 0) return { kind: "bytes" };
    return { kind: "array", of: shapeOf(element, named, within) };
  }
  if (t.kind === "object") return membersShape(t.members, named, within);
  if (t.kind === "union") {
    let rest: TypeNode[] = [];
    let empty: "null" | "undefined" | undefined = undefined;
    for (const m of t.types) {
      if (m.kind === "ref" && (m.name === "null" || m.name === "undefined") && m.args.length === 0) empty = m.name === "null" ? "null" : "undefined";
      else if (m.kind === "literal" && m.value.kind === "null") empty = "null";
      else rest.push(m.clone());
    }
    if (empty !== undefined && rest.length === 1) return { kind: "option", of: shapeOf(rest[0]!, named, within), empty: empty! };
    throw refused("this union", "only 'T | null' and 'T | undefined' cross", t);
  }
  if (t.kind === "tuple") throw refused("a tuple", "use an object type", t);
  if (t.kind === "literal") throw refused("a literal type", "use its base type", t);
  if (t.kind === "function") throw refused("a function", CROSSING, t);
  throw refused(t.kind === "ref" ? `'${t.name}'` : "this type", CROSSING, t);
}

/** @throws {CompileError} */
function interfaceShape(d: Ref<Stmt>, named: Ref<Named>, within: Ref<string[]>, at: Ref<TypeNode>): Shape {
  if (d.kind !== "interface") throw refused("this type", CROSSING, at);
  if (d.extends.length > 0) throw refused(`'${d.name}'`, "it extends another interface; write its fields out", at);
  return membersShape(d.members, named, within);
}

/** @throws {CompileError} */
function membersShape(members: Ref<TypeMember[]>, named: Ref<Named>, within: Ref<string[]>): Shape {
  let fields: FieldShape[] = [];
  for (const m of members) {
    if (m.kind !== "property" || m.type === undefined || typeof m.name !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(m.name)) throw new CompileError("E1003", "an addon's object types hold only fields named and typed as written, like 'x: f64'", m.start, m.end);
    fields.push({ name: m.name, optional: m.optional, shape: shapeOf(m.type!, named, within) });
  }
  fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const made: ObjectShape = { kind: "object", fields };
  return made;
}

// The Fish spelling of a shape.
function fishType(s: Ref<Shape>): string {
  switch (s.kind) {
    case "number":
      return s.name;
    case "bytes":
      return "u8[]";
    case "array":
      return `(${fishType(s.of)})[]`;
    case "object":
      return `{ ${s.fields.map((f) => `${f.name}${f.optional ? "?" : ""}: ${fishType(f.shape)}`).join("; ")} }`;
    case "option":
      return `${fishType(s.of)} | ${s.empty}`;
    default:
      return s.kind;
  }
}

// The TypeScript spelling of a shape, for the `.d.ts`.
function tsType(s: Ref<Shape>): string {
  switch (s.kind) {
    case "number":
      return "number";
    case "bytes":
      return "Uint8Array";
    case "array":
      return `(${tsType(s.of)})[]`;
    case "object":
      return `{ ${s.fields.map((f) => `${f.name}${f.optional ? "?" : ""}: ${tsType(f.shape)}`).join("; ")} }`;
    case "option":
      return `${tsType(s.of)} | ${s.empty}`;
    default:
      return s.kind;
  }
}

// Whether a shape crosses back as JSON, as an async result does.
function jsonable(s: Ref<Shape>): boolean {
  switch (s.kind) {
    case "bigint":
    case "bytes":
      return false;
    case "array":
      return jsonable(s.of);
    case "option":
      return jsonable(s.of);
    case "object":
      return s.fields.every((f) => jsonable(f.shape));
    default:
      return true;
  }
}

// The file's exported functions as they cross.
/** @throws {CompileError} */
function exportsOf(program: Ref<Stmt[]>): Export[] {
  const named = declared(program);
  let found: Export[] = [];
  for (const s of program) {
    if (s.kind !== "export" || s.body.kind !== "function") continue;
    const f: Ref<Func> = s.body;
    if (f.body === undefined) continue;
    const at = { start: f.start, end: f.end };
    if (f.typeParams.length > 0) throw new CompileError("E1003", "an addon can't export a generic function, which JavaScript calls with no types; export one for each type", at.start, at.end);
    if (f.generator) throw new CompileError("E1003", "an addon can't export a generator", at.start, at.end);
    if (f.returnType === undefined) throw new CompileError("E1003", `'${f.name}' needs its return type written to be exported to JavaScript, 'void' if it returns nothing`, at.start, at.end);
    let params: { name: string; shape: Shape }[] = [];
    for (const p of f.params) {
      if (p.pattern.kind !== "ident" || p.type === undefined || p.rest || p.optional || p.default !== undefined) throw new CompileError("E1003", "an addon's exported function takes plain named parameters with their types written, like 'x: f64'", p.start, p.end);
      const shape = shapeOf(p.type!, named, []);
      if (shape.kind === "void") throw refused("'void' as a parameter", "leave the parameter out", p.type!);
      params.push({ name: p.pattern.name, shape });
    }
    const written: Ref<TypeNode> = f.returnType!;
    let returns: Shape = { kind: "void" };
    if (f.async) {
      if (written.kind !== "ref" || written.name !== "Promise" || written.args.length !== 1) throw new CompileError("E1003", `'${f.name}' is async, so its return type is written 'Promise<T>'`, written.start, written.end);
      returns = shapeOf(written.args[0]!, named, []);
      if (!jsonable(returns)) throw new CompileError("E1003", "an async export's result crosses back to JavaScript as JSON, which has no bigint or bytes; give it as a string", written.start, written.end);
    } else returns = shapeOf(written, named, []);
    found.push({ name: f.name, params, returns, async: f.async, throws: f.throws !== undefined });
  }
  if (found.length === 0) throw new CompileError("E1003", "an addon has nothing for JavaScript to call; mark functions with 'export'", 0, 0);
  return found;
}

// The conversions, made once per type and named by their order.
function more(lines: Mut<string[]>, added: string[]): void {
  for (const l of added) lines.push(l);
}

class Converters {
  keys: string[] = [];
  code: string[] = [];

  // The function reading a JavaScript value as `s`, throwing a TypeError naming `at` if it isn't one.
  input(this: Mut<this>, s: Ref<Shape>): string {
    const key = `in ${fishType(s)}`;
    const known = this.keys.indexOf(key);
    if (known >= 0) return `fishaddon_in${known}`;
    const name = `fishaddon_in${this.keys.length}`;
    this.keys.push(key);
    this.code.push("");
    const slot = this.code.length - 1;
    const t = fishType(s);
    let body: string[] = [];
    switch (s.kind) {
      case "number": {
        more(body, [`  if (unsafe { fishaddon_kind(env, v) } !== 3) throw new TypeError(\`\${at} must be a number\`);`, "  const n = unsafe { fishaddon_number(env, v) };"]);
        const range = INTEGER_RANGES.find((r) => r[0] === s.name);
        if (range !== undefined) body.push(`  if (!(Math.floor(n) === n && n >= ${range[1]} && n <= ${range[2]})) throw new TypeError(\`\${at} must be an integer from ${range[1]} to ${range[2]}\`);`);
        body.push(`  return n as ${s.name};`);
        break;
      }
      case "boolean":
        more(body, [`  if (unsafe { fishaddon_kind(env, v) } !== 2) throw new TypeError(\`\${at} must be a boolean\`);`, "  return unsafe { fishaddon_bool(env, v) } !== 0;"]);
        break;
      case "string":
        more(body, [`  if (unsafe { fishaddon_kind(env, v) } !== 4) throw new TypeError(\`\${at} must be a string\`);`, "  return fishaddon_text(env, v);"]);
        break;
      case "bigint":
        more(body, [`  if (unsafe { fishaddon_kind(env, v) } !== 9) throw new TypeError(\`\${at} must be a bigint\`);`, "  return fishaddon_bigint(fishaddon_text(env, unsafe { fishaddon_bigint_text(env, v) }));"]);
        break;
      case "bytes":
        more(body, [`  if (unsafe { fishaddon_kind(env, v) } !== 101) throw new TypeError(\`\${at} must be a Uint8Array\`);`, "  const size = unsafe { fishaddon_bytes_size(env, v) };", "  let out: u8[] = new Array(size).fill(0 as u8);", "  if (size > 0) unsafe { fishaddon_bytes_copy(env, v, mutPtrOf(out[0]), size) };", "  return out;"]);
        break;
      case "array": {
        const of = this.input(s.of);
        more(body, [`  if (unsafe { fishaddon_kind(env, v) } !== 100) throw new TypeError(\`\${at} must be an array\`);`, `  let out: ${t} = [];`, "  const n = unsafe { fishaddon_length(env, v) };", `  for (let i: i64 = 0; i < n; i++) out.push(${of}(env, unsafe { fishaddon_element(env, v, i) }, \`\${at}[\${i}]\`));`, "  return out;"]);
        break;
      }
      case "object": {
        body.push(`  if (unsafe { fishaddon_kind(env, v) } !== 6) throw new TypeError(\`\${at} must be an object\`);`);
        let parts: string[] = [];
        if (s.kind === "object") for (const f of s.fields) {
          const read = `unsafe { fishaddon_property(env, v, cString("${f.name}")) }`;
          if (f.optional) {
            const of = this.input(f.shape);
            more(body, [`  const f_${f.name} = ${read};`, `  const k_${f.name} = unsafe { fishaddon_kind(env, f_${f.name}) };`]);
            parts.push(`${f.name}: k_${f.name} === 0 ? undefined : ${of}(env, f_${f.name}, \`\${at}.${f.name}\`)`);
          } else parts.push(`${f.name}: ${this.input(f.shape)}(env, ${read}, \`\${at}.${f.name}\`)`);
        }
        more(body, [`  return { ${parts.join(", ")} };`]);
        break;
      }
      case "option": {
        if (s.kind !== "option") break;
        const of = this.input(s.of);
        more(body, ["  const k = unsafe { fishaddon_kind(env, v) };", `  if (k === 0 || k === 1) return ${s.empty};`, `  return ${of}(env, v, at);`]);
        break;
      }
      case "void":
        body.push("  return;");
        break;
    }
    this.code[slot] = `function ${name}(env: Ptr<u8>, v: Ptr<u8>, at: string): ${t} throws TypeError {\n${body.join("\n")}\n}\n`;
    return name;
  }

  // The function making the JavaScript value for a Fish one of shape `s`.
  output(this: Mut<this>, s: Ref<Shape>): string {
    const key = `out ${fishType(s)}`;
    const known = this.keys.indexOf(key);
    if (known >= 0) return `fishaddon_out${known}`;
    const name = `fishaddon_out${this.keys.length}`;
    this.keys.push(key);
    this.code.push("");
    const slot = this.code.length - 1;
    let body: string[] = [];
    switch (s.kind) {
      case "number":
        body.push("  return unsafe { fishaddon_make_number(env, x as f64) };");
        break;
      case "boolean":
        body.push("  return unsafe { fishaddon_make_bool(env, x ? 1 : 0) };");
        break;
      case "string":
        body.push("  return fishaddon_string(env, x);");
        break;
      case "bigint":
        more(body, ["  const text = new TextEncoder().encode(x.toString());", "  return unsafe { fishaddon_make_bigint(env, ptrOf(text[0]), text.length as i64) };"]);
        break;
      case "bytes":
        body.push("  return unsafe { fishaddon_make_bytes(env, x.length === 0 ? nullPtr<u8>() : ptrOf(x[0]), x.length as i64) };");
        break;
      case "array": {
        const of = this.output(s.of);
        more(body, ["  const out = unsafe { fishaddon_make_array(env) };", "  let i: i64 = 0;", "  for (const e of x) {", `    unsafe { fishaddon_set_element(env, out, i, ${of}(env, e)) };`, "    i++;", "  }", "  return out;"]);
        break;
      }
      case "object": {
        body.push("  const out = unsafe { fishaddon_make_object(env) };");
        if (s.kind === "object") for (const f of s.fields) {
          const set = `unsafe { fishaddon_set_property(env, out, cString("${f.name}"), ${this.output(f.shape)}(env, `;
          if (f.optional) {
            more(body, [`  const f_${f.name} = x.${f.name};`, `  if (f_${f.name} !== undefined) ${set}f_${f.name}!)) };`]);
          } else body.push(`  ${set}x.${f.name})) };`);
        }
        body.push("  return out;");
        break;
      }
      case "option": {
        if (s.kind !== "option") break;
        const of = this.output(s.of);
        more(body, [`  if (x === ${s.empty}) return unsafe { fishaddon_make_${s.empty}(env) };`, `  return ${of}(env, x!);`]);
        break;
      }
      case "void":
        body.push("  return unsafe { fishaddon_make_undefined(env) };");
        break;
    }
    const param = s.kind === "void" ? "" : `, x: ${s.kind === "number" || s.kind === "boolean" ? fishType(s) : `Ref<${fishType(s)}>`}`;
    this.code[slot] = `function ${name}(env: Ptr<u8>${param}): Ptr<u8> {\n${body.join("\n")}\n}\n`;
    return name;
  }
}

// The C functions the generated entry calls, all in the glue.
const DECLARED = `declare function fishaddon_arg(env: Ptr<u8>, info: Ptr<u8>, i: i64): Ptr<u8>;
declare function fishaddon_kind(env: Ptr<u8>, v: Ptr<u8>): i32;
declare function fishaddon_number(env: Ptr<u8>, v: Ptr<u8>): f64;
declare function fishaddon_bool(env: Ptr<u8>, v: Ptr<u8>): i32;
declare function fishaddon_string_size(env: Ptr<u8>, v: Ptr<u8>): i64;
declare function fishaddon_string_copy(env: Ptr<u8>, v: Ptr<u8>, out: MutPtr<u8>, size: i64): void;
declare function fishaddon_bigint_text(env: Ptr<u8>, v: Ptr<u8>): Ptr<u8>;
declare function fishaddon_bytes_size(env: Ptr<u8>, v: Ptr<u8>): i64;
declare function fishaddon_bytes_copy(env: Ptr<u8>, v: Ptr<u8>, out: MutPtr<u8>, size: i64): void;
declare function fishaddon_length(env: Ptr<u8>, v: Ptr<u8>): i64;
declare function fishaddon_element(env: Ptr<u8>, v: Ptr<u8>, i: i64): Ptr<u8>;
declare function fishaddon_property(env: Ptr<u8>, v: Ptr<u8>, name: Ptr<u8>): Ptr<u8>;
declare function fishaddon_make_number(env: Ptr<u8>, n: f64): Ptr<u8>;
declare function fishaddon_make_bool(env: Ptr<u8>, b: i32): Ptr<u8>;
declare function fishaddon_make_string(env: Ptr<u8>, text: Ptr<u8>, size: i64): Ptr<u8>;
declare function fishaddon_make_bigint(env: Ptr<u8>, text: Ptr<u8>, size: i64): Ptr<u8>;
declare function fishaddon_make_bytes(env: Ptr<u8>, data: Ptr<u8>, size: i64): Ptr<u8>;
declare function fishaddon_make_null(env: Ptr<u8>): Ptr<u8>;
declare function fishaddon_make_undefined(env: Ptr<u8>): Ptr<u8>;
declare function fishaddon_make_object(env: Ptr<u8>): Ptr<u8>;
declare function fishaddon_set_property(env: Ptr<u8>, o: Ptr<u8>, name: Ptr<u8>, v: Ptr<u8>): void;
declare function fishaddon_make_array(env: Ptr<u8>): Ptr<u8>;
declare function fishaddon_set_element(env: Ptr<u8>, a: Ptr<u8>, i: i64, v: Ptr<u8>): void;
declare function fishaddon_throw(env: Ptr<u8>, type: i32, text: Ptr<u8>, size: i64): Ptr<u8>;
declare function fishaddon_deferred(env: Ptr<u8>): i64;
declare function fishaddon_promise(id: i64): Ptr<u8>;
declare function fishaddon_settle(id: i64, ok: i32, text: Ptr<u8>, size: i64): void;

function fishaddon_text(env: Ptr<u8>, v: Ptr<u8>): string {
  const size = unsafe { fishaddon_string_size(env, v) };
  let bytes: u8[] = new Array(size + 1).fill(0 as u8);
  unsafe { fishaddon_string_copy(env, v, mutPtrOf(bytes[0]), size + 1) };
  bytes.pop();
  return new TextDecoder().decode(bytes);
}

// A bigint from the decimal text JavaScript's String gives one.
function fishaddon_bigint(text: string): bigint {
  let n: bigint = 0n;
  for (const c of text) if (c !== "-") n = n * 10n + BigInt(c.charCodeAt(0) - 48);
  return text.startsWith("-") ? -n : n;
}

function fishaddon_string(env: Ptr<u8>, s: Ref<string>): Ptr<u8> {
  const bytes = new TextEncoder().encode(s);
  return unsafe { fishaddon_make_string(env, bytes.length === 0 ? nullPtr<u8>() : ptrOf(bytes[0]), bytes.length as i64) };
}

function fishaddon_thrown(env: Ptr<u8>, type: i32, message: Ref<string>): Ptr<u8> {
  const bytes = new TextEncoder().encode(message);
  return unsafe { fishaddon_throw(env, type, bytes.length === 0 ? nullPtr<u8>() : ptrOf(bytes[0]), bytes.length as i64) };
}

function fishaddon_settled(id: i64, ok: i32, text: Ref<string>): void {
  const bytes = new TextEncoder().encode(text);
  unsafe { fishaddon_settle(id, ok, bytes.length === 0 ? nullPtr<u8>() : ptrOf(bytes[0]), bytes.length as i64) };
}
`;

function wrapper(e: Ref<Export>, conv: Mut<Converters>): string {
  let lines: string[] = [];
  let args: string[] = [];
  for (let i = 0; i < e.params.length; i++) {
    lines.push(`    const a${i} = ${conv.input(e.params[i]!.shape)}(env, unsafe { fishaddon_arg(env, info, ${i}) }, "argument ${i + 1}");`);
    args.push(`a${i}`);
  }
  const call = `${e.name}(${args.join(", ")})`;
  let extra = "";
  if (e.async) {
    more(lines, ["    const id = unsafe { fishaddon_deferred(env) };", `    spawn(fishaddon_run_${e.name}(id${args.map((a) => `, ${a}`).join("")}));`, "    return unsafe { fishaddon_promise(id) };"]);
    const params = e.params.map((p, i) => `, a${i}: ${fishType(p.shape)}`).join("");
    const done = e.returns.kind === "void" ? [`    await ${call};`, `    fishaddon_settled(id, 1, "null");`] : [`    const r = await ${call};`, "    fishaddon_settled(id, 1, JSON.stringify(r));"];
    const run = e.throws ? ["  try {", ...done, "  } catch (e) {", "    fishaddon_settled(id, 0, e.message);", "  }"] : done.map((l) => l.slice(2));
    extra = `\nasync function fishaddon_run_${e.name}(id: i64${params}): Promise<void> {\n${run.join("\n")}\n}\n`;
  } else if (e.returns.kind === "void") {
    more(lines, [`    ${call};`, "    return unsafe { fishaddon_make_undefined(env) };"]);
  } else {
    const out = conv.output(e.returns);
    more(lines, [`    const r = ${call};`, `    return ${out}(env, r);`]);
  }
  const throwing = e.params.length > 0 || (e.throws && !e.async);
  const body = throwing ? ["  try {", ...lines, "  } catch (e) {", "    return fishaddon_thrown(env, e instanceof TypeError ? 1 : 0, e.message);", "  }"] : lines.map((l) => l.slice(2));
  return `export function fishaddon_${e.name}(env: Ptr<u8>, info: Ptr<u8>): Ptr<u8> {\n${body.join("\n")}\n}\n${extra}`;
}

// The C glue: N-API's handles as opaque pointers and the functions used, declared here, since an
// addon is built against no header and N-API's functions are found in the process that loads it.
const GLUE = String.raw`#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef struct napi_deferred__ *napi_deferred;
typedef struct napi_threadsafe_function__ *napi_threadsafe_function;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
typedef void (*napi_finalize)(napi_env, void *, void *);
typedef void (*napi_threadsafe_function_call_js)(napi_env, napi_value, void *, void *);
napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
napi_status napi_typeof(napi_env, napi_value, int *);
napi_status napi_is_array(napi_env, napi_value, _Bool *);
napi_status napi_is_typedarray(napi_env, napi_value, _Bool *);
napi_status napi_get_typedarray_info(napi_env, napi_value, int *, size_t *, void **, napi_value *, size_t *);
napi_status napi_get_value_double(napi_env, napi_value, double *);
napi_status napi_get_value_bool(napi_env, napi_value, _Bool *);
napi_status napi_get_value_string_utf8(napi_env, napi_value, char *, size_t, size_t *);
napi_status napi_coerce_to_string(napi_env, napi_value, napi_value *);
napi_status napi_get_array_length(napi_env, napi_value, uint32_t *);
napi_status napi_get_element(napi_env, napi_value, uint32_t, napi_value *);
napi_status napi_get_named_property(napi_env, napi_value, const char *, napi_value *);
napi_status napi_create_double(napi_env, double, napi_value *);
napi_status napi_get_boolean(napi_env, _Bool, napi_value *);
napi_status napi_create_string_utf8(napi_env, const char *, size_t, napi_value *);
napi_status napi_create_buffer_copy(napi_env, size_t, const void *, void **, napi_value *);
napi_status napi_get_null(napi_env, napi_value *);
napi_status napi_get_undefined(napi_env, napi_value *);
napi_status napi_get_global(napi_env, napi_value *);
napi_status napi_create_object(napi_env, napi_value *);
napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
napi_status napi_create_array(napi_env, napi_value *);
napi_status napi_set_element(napi_env, napi_value, uint32_t, napi_value);
napi_status napi_call_function(napi_env, napi_value, napi_value, size_t, const napi_value *, napi_value *);
napi_status napi_throw(napi_env, napi_value);
napi_status napi_create_error(napi_env, napi_value, napi_value, napi_value *);
napi_status napi_create_type_error(napi_env, napi_value, napi_value, napi_value *);
napi_status napi_create_promise(napi_env, napi_deferred *, napi_value *);
napi_status napi_resolve_deferred(napi_env, napi_deferred, napi_value);
napi_status napi_reject_deferred(napi_env, napi_deferred, napi_value);
napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
napi_status napi_create_threadsafe_function(napi_env, napi_value, napi_value, napi_value, size_t, size_t, void *, napi_finalize, void *, napi_threadsafe_function_call_js, napi_threadsafe_function *);
napi_status napi_call_threadsafe_function(napi_threadsafe_function, void *, int);
napi_status napi_release_threadsafe_function(napi_threadsafe_function, int);

napi_value fishaddon_arg(napi_env env, napi_callback_info info, int64_t i) {
  napi_value argv[16];
  size_t argc = 16;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (i < (int64_t)argc && i < 16) return argv[i];
  napi_value u;
  napi_get_undefined(env, &u);
  return u;
}

// N-API's value types, with arrays as 100 and Uint8Arrays, Buffers among them, as 101.
int32_t fishaddon_kind(napi_env env, napi_value v) {
  _Bool is = 0;
  if (napi_is_array(env, v, &is) == 0 && is) return 100;
  if (napi_is_typedarray(env, v, &is) == 0 && is) {
    int type = -1;
    size_t length = 0;
    napi_get_typedarray_info(env, v, &type, &length, NULL, NULL, NULL);
    return type == 1 ? 101 : 6;
  }
  int t = 0;
  napi_typeof(env, v, &t);
  return t;
}

double fishaddon_number(napi_env env, napi_value v) {
  double d = 0;
  napi_get_value_double(env, v, &d);
  return d;
}

int32_t fishaddon_bool(napi_env env, napi_value v) {
  _Bool b = 0;
  napi_get_value_bool(env, v, &b);
  return b;
}

int64_t fishaddon_string_size(napi_env env, napi_value v) {
  size_t n = 0;
  napi_get_value_string_utf8(env, v, NULL, 0, &n);
  return (int64_t)n;
}

void fishaddon_string_copy(napi_env env, napi_value v, char *out, int64_t size) {
  size_t n = 0;
  napi_get_value_string_utf8(env, v, out, (size_t)size, &n);
}

napi_value fishaddon_bigint_text(napi_env env, napi_value v) {
  napi_value s;
  napi_coerce_to_string(env, v, &s);
  return s;
}

int64_t fishaddon_bytes_size(napi_env env, napi_value v) {
  size_t length = 0;
  napi_get_typedarray_info(env, v, NULL, &length, NULL, NULL, NULL);
  return (int64_t)length;
}

void fishaddon_bytes_copy(napi_env env, napi_value v, void *out, int64_t size) {
  size_t length = 0;
  void *data = NULL;
  napi_get_typedarray_info(env, v, NULL, &length, &data, NULL, NULL);
  memcpy(out, data, length < (size_t)size ? length : (size_t)size);
}

int64_t fishaddon_length(napi_env env, napi_value v) {
  uint32_t n = 0;
  napi_get_array_length(env, v, &n);
  return n;
}

napi_value fishaddon_element(napi_env env, napi_value v, int64_t i) {
  napi_value e;
  napi_get_element(env, v, (uint32_t)i, &e);
  return e;
}

napi_value fishaddon_property(napi_env env, napi_value v, const char *name) {
  napi_value p;
  if (napi_get_named_property(env, v, name, &p) != 0) napi_get_undefined(env, &p);
  return p;
}

napi_value fishaddon_make_number(napi_env env, double d) {
  napi_value v;
  napi_create_double(env, d, &v);
  return v;
}

napi_value fishaddon_make_bool(napi_env env, int32_t b) {
  napi_value v;
  napi_get_boolean(env, b != 0, &v);
  return v;
}

napi_value fishaddon_make_string(napi_env env, const char *text, int64_t size) {
  napi_value v;
  napi_create_string_utf8(env, size == 0 ? "" : text, (size_t)size, &v);
  return v;
}

static napi_value fishaddon_global_call(napi_env env, const char *holder, const char *name, napi_value arg) {
  napi_value global, object, fn, result;
  napi_get_global(env, &global);
  object = global;
  if (holder) napi_get_named_property(env, global, holder, &object);
  napi_get_named_property(env, object, name, &fn);
  if (napi_call_function(env, object, fn, 1, &arg, &result) != 0) napi_get_undefined(env, &result);
  return result;
}

napi_value fishaddon_make_bigint(napi_env env, const char *text, int64_t size) {
  return fishaddon_global_call(env, NULL, "BigInt", fishaddon_make_string(env, text, size));
}

napi_value fishaddon_make_bytes(napi_env env, const void *data, int64_t size) {
  napi_value v;
  napi_create_buffer_copy(env, (size_t)size, size == 0 ? "" : data, NULL, &v);
  return v;
}

napi_value fishaddon_make_null(napi_env env) {
  napi_value v;
  napi_get_null(env, &v);
  return v;
}

napi_value fishaddon_make_undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

napi_value fishaddon_make_object(napi_env env) {
  napi_value v;
  napi_create_object(env, &v);
  return v;
}

void fishaddon_set_property(napi_env env, napi_value o, const char *name, napi_value v) {
  napi_set_named_property(env, o, name, v);
}

napi_value fishaddon_make_array(napi_env env) {
  napi_value v;
  napi_create_array(env, &v);
  return v;
}

void fishaddon_set_element(napi_env env, napi_value a, int64_t i, napi_value v) {
  napi_set_element(env, a, (uint32_t)i, v);
}

// Throws an Error, or a TypeError for type 1, and gives NULL, which N-API takes as no result.
napi_value fishaddon_throw(napi_env env, int32_t type, const char *text, int64_t size) {
  napi_value message, error;
  napi_create_string_utf8(env, size == 0 ? "" : text, (size_t)size, &message);
  if (type == 1) napi_create_type_error(env, NULL, message, &error);
  else napi_create_error(env, NULL, message, &error);
  napi_throw(env, error);
  return NULL;
}

// A pending Promise: settled on the JavaScript thread through its own thread-safe function, with
// the text its task gave, JSON for a result and a message for an error.
typedef struct {
  napi_deferred deferred;
  napi_value promise;
  napi_threadsafe_function tsfn;
  int32_t ok;
  char *text;
  size_t size;
} fishaddon_pending;

static void fishaddon_settle_js(napi_env env, napi_value js, void *context, void *data) {
  fishaddon_pending *p = data;
  if (env) {
    napi_value text;
    napi_create_string_utf8(env, p->text, p->size, &text);
    if (p->ok) napi_resolve_deferred(env, p->deferred, fishaddon_global_call(env, "JSON", "parse", text));
    else {
      napi_value error;
      napi_create_error(env, NULL, text, &error);
      napi_reject_deferred(env, p->deferred, error);
    }
  }
  napi_release_threadsafe_function(p->tsfn, 0);
  free(p->text);
  free(p);
}

int64_t fishaddon_deferred(napi_env env) {
  fishaddon_pending *p = calloc(1, sizeof *p);
  napi_create_promise(env, &p->deferred, &p->promise);
  napi_value name;
  napi_create_string_utf8(env, "fish", 4, &name);
  napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, NULL, fishaddon_settle_js, &p->tsfn);
  return (int64_t)(intptr_t)p;
}

napi_value fishaddon_promise(int64_t id) {
  return ((fishaddon_pending *)(intptr_t)id)->promise;
}

void fishaddon_settle(int64_t id, int32_t ok, const char *text, int64_t size) {
  fishaddon_pending *p = (fishaddon_pending *)(intptr_t)id;
  p->ok = ok;
  p->size = (size_t)size;
  p->text = malloc(p->size + 1);
  if (size > 0) memcpy(p->text, text, p->size);
  p->text[p->size] = 0;
  napi_call_threadsafe_function(p->tsfn, p, 1);
}
`;

function glue(exports: Ref<Export[]>): string {
  const externs = exports.map((e) => `napi_value fishaddon_${e.name}(napi_env, napi_callback_info);`).join("\n");
  const registered = exports.map((e) => `  napi_create_function(env, "${e.name}", ${e.name.length}, fishaddon_${e.name}, NULL, &fn);\n  napi_set_named_property(env, exports, "${e.name}", fn);`).join("\n");
  return `${GLUE}\n${externs}\n\nnapi_value napi_register_module_v1(napi_env env, napi_value exports) {\n  napi_value fn;\n${registered}\n  return exports;\n}\n`;
}

function declarations(exports: Ref<Export[]>): string {
  return exports.map((e) => `export declare function ${e.name}(${e.params.map((p) => `${p.name}: ${tsType(p.shape)}`).join(", ")}): ${e.async ? `Promise<${tsType(e.returns)}>` : tsType(e.returns)};\n`).join("");
}

// The addon for the file `src`, whose generated entry imports it as `specifier`.
/** @throws {CompileError} */
export function addonOf(src: string, specifier: string): Addon {
  let ids: Ids = { last: 0 };
  const program = parse(src, ids);
  const exports = exportsOf(program);
  let conv = new Converters();
  let wrappers: string[] = [];
  for (const e of exports) wrappers.push(wrapper(e, conv));
  const fish = `import { ${exports.map((e) => e.name).join(", ")} } from ${JSON.stringify(specifier)};\n\n${DECLARED}\n${conv.code.join("\n")}\n${wrappers.join("\n")}`;
  return { fish, glue: glue(exports), dts: declarations(exports) };
}
