import { freshId, shared } from "./compilation.ts";
import { CompileError } from "./diag.ts";
import { parseExpression, type Expr, type ObjectProp, type Span } from "./parser.ts";

type Call = Extract<Expr, { kind: "call" }>;

const SETTINGS = ["args", "options", "strict", "allowPositionals", "allowNegative", "tokens"];
const OPTION_KEYS = ["type", "short", "multiple", "default"];

// The arguments std's parseArgs takes in place of a call's config literal: the arguments to
// read, the options as specs, the two settings Fish reads, and a builder of the values typed as
// @types/node types them, a field per option, optional unless it has a default.
export function parseArgsArgs(e: Call): Expr[] {
  if (e.args.length > 1) throw new CompileError("'parseArgs' takes one config object", e.args[1]!.start, e.args.at(-1)!.end);
  const config = e.args[0];
  if (config !== undefined && config.kind !== "object") throw literalOnly(config, "its config");
  const settings = new Map<string, Expr>();
  for (const p of config?.props ?? []) {
    const key = keyOf(p, "its config");
    if (!SETTINGS.includes(key)) throw new CompileError(`'${key}' isn't a parseArgs setting; they are ${SETTINGS.join(", ")}`, p.start, p.end);
    settings.set(key, p.kind === "shorthand" ? { id: freshId(), kind: "ident", name: p.name, start: p.start, end: p.end } : (p as Extract<ObjectProp, { kind: "property" }>).value);
  }
  const flag = (name: string, fallback: boolean): boolean => {
    const v = settings.get(name);
    if (v === undefined) return fallback;
    if (v.kind !== "bool") throw new CompileError(`'parseArgs' takes '${name}' as true or false written in the call, so its result's type is known while compiling`, v.start, v.end);
    return v.value;
  };
  if (!flag("strict", true)) throw new CompileError("'strict: false' in parseArgs isn't supported yet; its values would have no type", settings.get("strict")!.start, settings.get("strict")!.end);
  if (flag("tokens", false)) throw new CompileError("'tokens: true' in parseArgs isn't supported yet", settings.get("tokens")!.start, settings.get("tokens")!.end);
  const options = settings.get("options");
  if (options !== undefined && options.kind !== "object") throw literalOnly(options, "'options'");
  const defaults: Expr[] = [];
  const specs: string[] = [];
  const fields: string[] = [];
  const reads: string[] = [];
  const names = new Set<string>();
  (options?.props ?? []).forEach((p, i) => {
    const name = keyOf(p, "'options'");
    if (names.has(name)) throw new CompileError(`the option '${name}' is given twice`, p.start, p.end);
    names.add(name);
    const option = p.kind === "property" ? p.value : undefined;
    if (option?.kind !== "object") throw literalOnly(option ?? p, `the option '${name}'`);
    const set = new Map<string, Expr>();
    for (const q of option.props) {
      const key = keyOf(q, `the option '${name}'`);
      if (!OPTION_KEYS.includes(key) || q.kind !== "property") throw new CompileError(`'${key}' isn't an option setting; they are ${OPTION_KEYS.join(", ")}`, q.start, q.end);
      set.set(key, q.value);
    }
    const type = set.get("type");
    if (type?.kind !== "string" || (type.value !== "string" && type.value !== "boolean")) throw new CompileError(`the option '${name}' needs 'type: "string"' or 'type: "boolean"'`, (type ?? p).start, (type ?? p).end);
    const short = set.get("short");
    if (short !== undefined && (short.kind !== "string" || short.value.length !== 1 || short.value === "-")) {
      throw new CompileError(`the option '${name}' takes 'short' as one character written in the call, like short: "v"`, short.start, short.end);
    }
    const multiple = set.get("multiple");
    if (multiple !== undefined && multiple.kind !== "bool") throw new CompileError(`the option '${name}' takes 'multiple' as true or false written in the call`, multiple.start, multiple.end);
    const many = multiple?.value === true;
    const text = type.value === "string";
    const fallback = set.get("default");
    if (fallback && wrongDefault(fallback, type.value, many)) {
      throw new CompileError(`the option '${name}' gives a ${type.value}${many ? " array" : ""}, so its default is ${many ? `a ${type.value}[]` : `a ${type.value}`} too`, fallback.start, fallback.end);
    }
    specs.push(`{ name: ${JSON.stringify(name)}, short: ${JSON.stringify(short?.kind === "string" ? short.value : "")}, text: ${text}, multiple: ${many} }`);
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
    fields.push(`${key}${fallback ? "" : "?"}: ${type.value}${many ? "[]" : ""}`);
    // A default is an argument of the read, typed by its parameter, so `[]` is a string[].
    const read = `${text ? "text" : "flag"}${many ? (text ? "s" : "List") : ""}`;
    if (fallback) defaults.push(fallback);
    reads.push(`${key}: p.${read}${fallback ? `Or(${i}, fsh_default_${defaults.length - 1})` : `(${i})`}`);
  });
  const built = parseExpression(`[[${specs.join(", ")}], (p): { ${fields.join("; ")} } => ({ ${reads.join(", ")} })]`, shared.ids) as Extract<Expr, { kind: "array" }>;
  respan(built, e);
  const [list, builder] = built.elements as [Expr, Expr];
  // The builder's parameter takes a name a program can't write, so a default naming its own
  // `p` reads the program's.
  renamed(builder, "p", "parsed-args");
  placed(builder, defaults);
  const bool = (value: boolean): Expr => ({ id: freshId(), kind: "bool", value, start: e.start, end: e.end });
  return [settings.get("args") ?? { id: freshId(), kind: "null", start: e.start, end: e.end }, list, bool(flag("allowPositionals", false)), bool(flag("allowNegative", false)), builder];
}

// A literal default that isn't what the option gives; anything else is checked as a value.
function wrongDefault(v: Expr, type: string, many: boolean): boolean {
  if (v.kind === "ident" && v.name === "undefined") return true;
  const literal = (x: Expr) => x.kind === "string" || x.kind === "bool" || x.kind === "int" || x.kind === "float" || x.kind === "null" || x.kind === "object";
  const wrong = (x: Expr | undefined) => x !== undefined && (x.kind === "array" || (literal(x) && x.kind !== (type === "string" ? "string" : "bool")));
  if (many) return v.kind === "array" ? v.elements.some(wrong) : literal(v);
  return wrong(v);
}

function literalOnly(at: Span, what: string): CompileError {
  return new CompileError(`'parseArgs' takes ${what} as an object literal written in the call, so its result's type is known while compiling`, at.start, at.end);
}

function keyOf(p: ObjectProp, within: string): string {
  if (p.kind === "shorthand") return p.name;
  if ((p.kind === "property" || p.kind === "method") && typeof p.key === "string") return p.key;
  if (p.kind === "property" && typeof p.key !== "string" && p.key.kind === "string") return p.key.value;
  throw new CompileError(`'parseArgs' takes ${within} with its keys written as names`, p.start, p.end);
}

// Generated nodes take the call's span, so a message about one points at the call.
function respan(v: unknown, at: Span, seen: Set<unknown> = new Set<unknown>()) {
  if (typeof v !== "object" || v === null || seen.has(v)) return;
  seen.add(v);
  const node = v as Record<string, unknown>;
  if (typeof node.start === "number" && typeof node.end === "number") {
    node.start = at.start;
    node.end = at.end;
  }
  for (const child of Object.values(node)) respan(child, at, seen);
}

function renamed(v: unknown, from: string, to: string) {
  if (typeof v !== "object" || v === null) return;
  const node = v as Record<string, unknown>;
  if (node.kind === "ident" && node.name === from) node.name = to;
  for (const child of Object.values(node)) renamed(child, from, to);
}

// The written defaults in place of their placeholders.
function placed(v: unknown, defaults: Expr[]) {
  if (typeof v !== "object" || v === null) return;
  for (const [key, child] of Object.entries(v as Record<string, unknown>)) {
    const name = (child as { kind?: string; name?: string } | null)?.kind === "ident" ? (child as { name: string }).name : undefined;
    const index = name?.startsWith("fsh_default_") ? Number(name.slice("fsh_default_".length)) : undefined;
    if (index !== undefined) (v as Record<string, unknown>)[key] = defaults[index];
    else placed(child, defaults);
  }
}
