import { nextId, respanExpr, type Ids } from "./nodes.ts";
import { CompileError } from "./diag.ts";
import { parseExpression, type Expr, type ObjectProp, type Pattern, type Span } from "./parser.ts";
import { cloneExpr } from "./rebuild.ts";

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
