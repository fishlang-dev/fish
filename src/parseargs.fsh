import type { Compilation, Declarations } from "./compilation.fsh";
import { nextId, respanExpr, type Ids } from "./nodes.fsh";
import { CompileError } from "./diag.fsh";
import { parseExpression, type Expr, type ObjectProp, type Pattern, type Span, type TypeMember, type TypeNode } from "./parser.fsh";
import { cloneExpr, cloneTypeMember, cloneTypeNode } from "./rebuild.fsh";

type Call = Extract<Expr, { kind: "call" }>;

const SETTINGS = ["args", "options", "strict", "allowPositionals", "allowNegative", "tokens"];
const OPTION_KEYS = ["type", "short", "multiple", "default"];

// The arguments std's parseArgs takes in place of a call's config literal: the arguments to
// read, the options as specs, the two settings Fish reads, and a builder of the values typed as
// @types/node types them, a field per option, optional unless it has a default.
/** @throws {CompileError} */
export function parseArgsArgs(ids: Mut<Ids>, e: Ref<Call>): Expr[] {
  if (e.args.length > 1) throw new CompileError("E0504", "'parseArgs' takes one config object", e.args[1]!.start, e.args[e.args.length - 1]!.end);
  const config = e.args.at(0);
  if (config !== undefined && config.kind !== "object") throw literalOnly(config.start, config.end, "its config");
  let settings = new Map<string, Expr>();
  if (config !== undefined) {
    for (const p of config.props) {
      const key = keyOf(p, "its config");
      if (!SETTINGS.includes(key)) throw new CompileError("E0504", `'${key}' isn't a parseArgs setting; they are ${SETTINGS.join(", ")}`, p.start, p.end);
      if (p.kind === "shorthand") settings.set(key, { id: nextId(ids), kind: "ident", name: p.name, start: p.start, end: p.end });
      else if (p.kind === "property") settings.set(key, cloneExpr(p.value));
    }
  }
  const flag = (name: string, fallback: boolean): boolean => {
    const v = settings.get(name);
    if (v === undefined) return fallback;
    if (v.kind !== "bool") throw new CompileError("E0504", `'parseArgs' takes '${name}' as true or false written in the call, so its result's type is known while compiling`, v.start, v.end);
    return v.value;
  };
  if (!flag("strict", true)) throw new CompileError("E0801", "'strict: false' in parseArgs isn't supported yet; its values would have no type", settings.get("strict")!.start, settings.get("strict")!.end);
  if (flag("tokens", false)) throw new CompileError("E0801", "'tokens: true' in parseArgs isn't supported yet", settings.get("tokens")!.start, settings.get("tokens")!.end);
  const options = settings.get("options");
  if (options !== undefined && options.kind !== "object") throw literalOnly(options.start, options.end, "'options'");
  let defaults: Expr[] = [];
  let specs: string[] = [];
  let fields: string[] = [];
  let reads: string[] = [];
  let names = new Set<string>();
  if (options !== undefined) {
    for (let i: usize = 0; i < options.props.length; i++) {
      const p: Ref<ObjectProp> = options.props[i]!;
      const name = keyOf(p, "'options'");
      if (names.has(name)) throw new CompileError("E0504", `the option '${name}' is given twice`, p.start, p.end);
      names.add(name);
      if (p.kind !== "property" || p.value.kind !== "object") {
        const spanAt: Span = p.kind === "property" ? { start: p.value.start, end: p.value.end } : { start: p.start, end: p.end };
        throw literalOnly(spanAt.start, spanAt.end, `the option '${name}'`);
      }
      let set = new Map<string, Expr>();
      for (const q of p.value.props) {
        const key = keyOf(q, `the option '${name}'`);
        if (!OPTION_KEYS.includes(key) || q.kind !== "property") throw new CompileError("E0504", `'${key}' isn't an option setting; they are ${OPTION_KEYS.join(", ")}`, q.start, q.end);
        set.set(key, cloneExpr(q.value));
      }
      const type = set.get("type");
      if (type === undefined || type.kind !== "string" || (type.value !== "string" && type.value !== "boolean")) {
        const spanAt: Span = type !== undefined ? { start: type.start, end: type.end } : { start: p.start, end: p.end };
        throw new CompileError("E0504", `the option '${name}' needs 'type: "string"' or 'type: "boolean"'`, spanAt.start, spanAt.end);
      }
      const short = set.get("short");
      if (short !== undefined && (short.kind !== "string" || short.value.length !== 1 || short.value === "-")) {
        throw new CompileError("E0504", `the option '${name}' takes 'short' as one character written in the call, like short: "v"`, short.start, short.end);
      }
      const multiple = set.get("multiple");
      if (multiple !== undefined && multiple.kind !== "bool") throw new CompileError("E0504", `the option '${name}' takes 'multiple' as true or false written in the call`, multiple.start, multiple.end);
      const many = multiple !== undefined && multiple.value === true;
      const text = type.value === "string";
      const fallback = set.get("default");
      if (fallback !== undefined && wrongDefault(fallback, type.value, many)) {
        throw new CompileError("E0504", `the option '${name}' gives a ${type.value}${many ? " array" : ""}, so its default is ${many ? `a ${type.value}[]` : `a ${type.value}`} too`, fallback.start, fallback.end);
      }
      specs.push(`{ name: ${JSON.stringify(name)}, short: ${JSON.stringify(short !== undefined && short.kind === "string" ? short.value : "")}, text: ${text}, multiple: ${many} }`);
      const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
      fields.push(`${key}${fallback !== undefined ? "" : "?"}: ${type.value}${many ? "[]" : ""}`);
      // A default is an argument of the read, typed by its parameter, so `[]` is a string[].
      const read = `${text ? "text" : "flag"}${many ? (text ? "s" : "List") : ""}`;
      const hasDefault = fallback !== undefined;
      if (fallback !== undefined) defaults.push(fallback);
      reads.push(`${key}: p.${read}${hasDefault ? `Or(${i}, fsh_default_${defaults.length - 1})` : `(${i})`}`);
    }
  }
  const list: Expr = respanExpr(parseExpression(`[${specs.join(", ")}]`, ids), e);
  let builder: Expr = respanExpr(parseExpression(`(p): { ${fields.join("; ")} } => ({ ${reads.join(", ")} })`, ids), e);
  // The builder's parameter takes a name a program can't write, so a default naming its own
  // `p` reads the program's.
  builder = finishBuilder(builder, defaults);
  const allowPos = flag("allowPositionals", false);
  const allowNeg = flag("allowNegative", false);
  let argsExpr: Expr = { id: nextId(ids), kind: "null", start: e.start, end: e.end };
  const gotArgs = settings.get("args");
  if (gotArgs !== undefined) argsExpr = gotArgs;
  return [
    argsExpr,
    list,
    { id: nextId(ids), kind: "bool", value: allowPos, start: e.start, end: e.end },
    { id: nextId(ids), kind: "bool", value: allowNeg, start: e.start, end: e.end },
    builder,
  ];
}

// A literal default that isn't what the option gives; anything else is checked as a value.
function wrongDefault(v: Ref<Expr>, type: string, many: boolean): boolean {
  if (v.kind === "ident" && v.name === "undefined") return true;
  const literal = (x: Ref<Expr>) => x.kind === "string" || x.kind === "bool" || x.kind === "int" || x.kind === "float" || x.kind === "null" || x.kind === "object";
  const wrong = (x: Ref<Expr>) => x.kind === "array" || (literal(x) && x.kind !== (type === "string" ? "string" : "bool"));
  if (many) return v.kind === "array" ? v.elements.some((el) => el !== undefined && wrong(el)) : literal(v);
  return wrong(v);
}

function literalOnly(start: usize, end: usize, what: string): CompileError {
  return new CompileError("E0504", `'parseArgs' takes ${what} as an object literal written in the call, so its result's type is known while compiling`, start, end);
}

/** @throws {CompileError} */
function keyOf(p: Ref<ObjectProp>, within: string): string {
  if (p.kind === "shorthand") return p.name;
  if (p.kind === "property") {
    if (typeof p.key === "string") return p.key;
    if (p.key.kind === "string") return p.key.value;
  }
  if (p.kind === "method" && typeof p.key === "string") return p.key;
  throw new CompileError("E0504", `'parseArgs' takes ${within} with its keys written as names`, p.start, p.end);
}

// Renames the builder's parameter and puts the written defaults in place of their placeholders.
function finishBuilder(builder: Expr, defaults: Mut<Expr[]>): Expr {
  let b = builder;
  if (b.kind !== "arrow") return b;
  if (b.params.length > 0) {
    let param = b.params.shift()!;
    if (param.pattern.kind === "ident") param.pattern.name = "parsed-args";
    b.params.unshift(param);
  }
  if (Array.isArray(b.body) || b.body.kind !== "object") return b;
  let oldProps = b.body.props.splice(0);
  while (oldProps.length > 0) {
    let prop = oldProps.shift()!;
    if (prop.kind === "property" && prop.value.kind === "call") {
      if (prop.value.callee.kind === "member" && prop.value.callee.object.kind === "ident") {
        prop.value.callee.object.name = "parsed-args";
      }
      if (prop.value.args.length === 2) {
        prop.value.args.pop();
        prop.value.args.push(defaults.shift()!);
      }
    }
    b.body.props.push(prop);
  }
  return b;
}

const INTEGER_LIMITS: [string, string, string][] = [
  ["i8", "-128", "127"], ["i16", "-32768", "32767"], ["i32", "-2147483648", "2147483647"], ["i64", "-9223372036854775808", "9223372036854775807"], ["isize", "-9223372036854775808", "9223372036854775807"],
  ["u8", "0", "255"], ["u16", "0", "65535"], ["u32", "0", "4294967295"], ["u64", "0", "9223372036854775807"], ["usize", "0", "9223372036854775807"],
];

// A field of `parseArgs<T>()`'s type as the command line takes it: what it reads, whether it may be
// left out, and whether it may be given more than once.
type ArgKind = { base: string; optional: boolean; many: boolean };

function argRefused(what: string, start: usize, end: usize): CompileError {
  return new CompileError("E0504", `'parseArgs<T>()' reads ${what}`, start, end);
}

/** @throws {CompileError} */
function argKind(t: Ref<TypeNode>, optional: boolean): ArgKind {
  if (t.kind === "union") {
    let rest: TypeNode[] = [];
    let empty = false;
    for (const m of t.types) {
      if ((m.kind === "ref" && (m.name === "null" || m.name === "undefined") && m.args.length === 0) || (m.kind === "literal" && m.value.kind === "null")) empty = true;
      else rest.push(cloneTypeNode(m));
    }
    if (empty && rest.length === 1) return argKind(rest[0]!, true);
  }
  if (t.kind === "ref" && t.name === "Option" && t.args.length === 1) return argKind(t.args[0]!, true);
  if (t.kind === "array" && !optional) {
    const element = argKind(t.element, false);
    if (!element.optional && !element.many) return { base: element.base, optional: false, many: true };
  }
  if (t.kind === "ref" && t.args.length === 0 && (t.name === "boolean" || t.name === "string" || t.name === "f32" || t.name === "f64" || INTEGER_LIMITS.some((l) => l[0] === t.name))) return { base: t.name, optional, many: false };
  throw argRefused("fields that are booleans, strings or numbers, their Options, and arrays of them", t.start, t.end);
}

// The doc comment written just before `at` in its file, as one line of help.
function docBefore(files: Ref<Compilation["files"]>, at: usize): string {
  const f = files.findLast((f) => at >= f.base);
  if (f === undefined) return "";
  const before = f.src.slice(0, (at - f.base) as i64).trimEnd();
  if (!before.endsWith("*/")) return "";
  const open = before.lastIndexOf("/**");
  if (open < 0) return "";
  return before.slice(open + 3, (before.length - 2) as i64).split("\n").map((l) => l.trim().replace(/^\*\s?/, "")).filter((l) => l !== "").join(" ");
}

// The fields of `parseArgs<T>()`'s type as written: an object type, or an alias or interface
// naming one.
/** @throws {CompileError} */
export function writtenFields(t: Ref<TypeNode>, decls: Ref<Declarations>): TypeMember[] {
  if (t.kind === "object") return t.members.map((m) => cloneTypeMember(m));
  if (t.kind === "ref" && t.args.length === 0) {
    const alias = decls.aliases.get(t.name);
    if (alias !== undefined && alias.type.kind === "object") return alias.type.members.map((m) => cloneTypeMember(m));
    const named = decls.interfaces.get(t.name);
    if (named !== undefined && named.extends.length === 0) return named.members.map((m) => cloneTypeMember(m));
  }
  throw argRefused("an object type, an alias of one or an interface, written as its type argument", t.start, t.end);
}

// `parseArgs<T>()`: the call of std's port with specs from T's fields, its builder reading each
// field as T types it, inside std's helper answering --help and turning a bad argument into exit
// code 2. `parsed` is the name std's port goes by in the program, which names its helper too.
/** @throws {CompileError} */
export function typedParseArgs(ids: Mut<Ids>, e: Ref<Call>, members: Ref<TypeMember[]>, files: Ref<Compilation["files"]>, parsed: string): { call: Expr; inner: Expr } {
  const typed = parsed.replace("parseArgs", "__typedArgs");
  if (e.args.length > 0) throw new CompileError("E0504", "'parseArgs<T>()' takes no arguments; it reads the program's own", e.args[0]!.start, e.args[e.args.length - 1]!.end);
  const written: Ref<TypeNode> = e.typeArgs[0]!;
  let specs: string[] = [];
  let reads: string[] = [];
  let lines: [string, string][] = [];
  let positionals = false;
  for (const m of members) {
    if (m.kind !== "property" || typeof m.name !== "string" || m.type === undefined) throw argRefused("fields with their types written, like 'port: u16'", m.start, m.end);
    const name = m.name;
    if (name === "positionals") {
      const t: Ref<TypeNode> = m.type!;
      if (t.kind !== "array" || t.element.kind !== "ref" || t.element.name !== "string" || m.optional) throw argRefused("'positionals' as a 'string[]', the arguments that aren't options", t.start, t.end);
      positionals = true;
      reads.push("positionals: p.positionals.clone()");
      continue;
    }
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) throw argRefused(`fields named in camelCase, which it gives as --kebab-case options; '${name}' isn't`, m.start, m.end);
    const kind = argKind(m.type!, m.optional);
    const i = specs.length;
    const flag = `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    const text = kind.base !== "boolean";
    specs.push(`{ name: ${JSON.stringify(flag.slice(2))}, short: "", text: ${text}, multiple: ${kind.many} }`);
    const f = JSON.stringify(flag);
    const limits = INTEGER_LIMITS.find((l) => l[0] === kind.base);
    let read = "";
    if (kind.base === "boolean") read = kind.many ? `p.flagListOr(${i}, [])` : kind.optional ? `p.flag(${i})` : `p.flagOr(${i}, false)`;
    else if (kind.base === "string") read = kind.many ? `p.textsOr(${i}, [])` : kind.optional ? `p.text(${i})` : `p.textGiven(${i}, ${f}, @usage@)`;
    else if (limits !== undefined) {
      const bounds = `${limits[1]} as i64, ${limits[2]} as i64`;
      const cast = kind.base === "i64" ? "" : ` as ${kind.base}`;
      if (kind.many) read = `p.integers(${i}, ${f}, @usage@, ${bounds}).map((x) => x${cast})`;
      else if (!kind.optional) read = `(p.integer(${i}, ${f}, @usage@, true, ${bounds})!${cast})`;
      else if (kind.base === "i64") read = `p.integer(${i}, ${f}, @usage@, false, ${bounds})`;
      else read = `((n: i64 | null): ${kind.base} | null => (n === null ? null : n!${cast}))(p.integer(${i}, ${f}, @usage@, false, ${bounds}))`;
    } else {
      const cast = kind.base === "f64" ? "" : ` as ${kind.base}`;
      if (kind.many) read = `p.floats(${i}, ${f}, @usage@).map((x) => x${cast})`;
      else if (!kind.optional) read = `(p.float(${i}, ${f}, @usage@, true)!${cast})`;
      else if (kind.base === "f64") read = `p.float(${i}, ${f}, @usage@, false)`;
      else read = `((n: f64 | null): ${kind.base} | null => (n === null ? null : n!${cast}))(p.float(${i}, ${f}, @usage@, false))`;
    }
    reads.push(`${name}: ${read}`);
    lines.push([`${flag}${text ? ` <${kind.base === "string" ? "text" : kind.base}>` : ""}${kind.many ? "..." : ""}`, docBefore(files, m.start)]);
  }
  lines.push(["-h, --help", "Show this help"]);
  const width = lines.reduce((w, l) => Math.max(w, l[0].length as i64), 0 as i64);
  const usage = ` [options]${positionals ? " [<args>...]" : ""}\n\nOptions:\n${lines.map((l) => `  ${l[0].padEnd(width as usize)}  ${l[1]}`.trimEnd()).join("\n")}`;
  // The builder's type is T as written, put in place of the placeholder once parsed.
  const source = `typed(@usage@, () => parse(null, [${specs.join(", ")}], ${positionals}, false, (p): Placeholder => ({ ${reads.join(", ")} })).values)`;
  let call: Expr = respanExpr(parseExpression(source.replaceAll("@usage@", JSON.stringify(usage)), ids), e);
  if (call.kind === "call" && call.callee.kind === "ident") call.callee.name = typed;
  let inner: Expr | undefined = undefined;
  if (call.kind === "call" && call.args.length === 2 && call.args[1]!.kind === "arrow") {
    let arrow = call.args.pop()!;
    if (arrow.kind === "arrow" && !Array.isArray(arrow.body) && arrow.body.kind === "member" && arrow.body.object.kind === "call") {
      let parse = arrow.body.object;
      if (parse.callee.kind === "ident") parse.callee.name = parsed;
      if (parse.args.length === 5 && parse.args[4]!.kind === "arrow") {
        let builder = parse.args.pop()!;
        if (builder.kind === "arrow") builder.returnType = cloneTypeNode(written);
        parse.args.push(builder);
      }
      inner = cloneExpr(parse);
      arrow.body.object = parse;
    }
    call.args.push(arrow);
  }
  return { call, inner: inner! };
}
