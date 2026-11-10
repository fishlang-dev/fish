// Where the compiler relies on JavaScript forgiving what Fish panics on: copies src with every `x!`
// and `a[i]` checked, runs the checker over test programs, and prints each site that saw an absent
// value or an index out of range. Native builds find these one per build; this finds them together.
// Usage: bun scripts/selfhosttrap.ts <every-nth-program> [offset]
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../src/parser.ts";

type Edit = { at: number; end: number; text: string };
const SRC = join(import.meta.dir, "..", "src");
const dir = mkdtempSync(join(tmpdir(), "fish-trap-"));
const copy = join(dir, "src");
mkdirSync(copy);
const sites: string[] = [];
const site = (file: string, text: string, at: number) => {
  const from = text.lastIndexOf("\n", at) + 1;
  sites.push(`${file}:${text.slice(0, at).split("\n").length}:${at - from + 1}: ${text.slice(from, text.indexOf("\n", at)).trim().slice(0, 130)}`);
  return sites.length - 1;
};

// Where `x!` starts, parentheses around `x` included: the node's own span begins inside them.
function openingOf(text: string, v: { start: number; end: number }): number {
  if (text[v.end - 2] !== ")") return v.start;
  let depth = 0;
  for (let i = v.end - 2; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(" && --depth === 0) return i < v.start ? i : v.start;
  }
  return v.start;
}

function instrument(file: string, text: string): string {
  const edits: Edit[] = [];
  const walk = (v: any, parent: any, key: string, target: boolean): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, parent, key, false));
    if (!v || typeof v !== "object") return;
    const place = target || (parent?.kind === "assign" && key === "target") || parent?.kind === "update" || (parent?.kind === "unary" && (parent.op === "++" || parent.op === "--"));
    const callee = parent?.kind === "call" && key === "callee";
    if (v.kind === "nonNull" && !place && !callee && text[v.end - 1] === "!") {
      edits.push({ at: openingOf(text, v), end: openingOf(text, v), text: "__nn(" }, { at: v.end - 1, end: v.end, text: `,${site(file, text, v.start)})` });
    }
    if (v.kind === "index" && "object" in v && !place && !callee && !v.optional && text[v.end - 1] === "]") {
      const open = text.indexOf("[", v.object.end);
      edits.push({ at: v.start, end: v.start, text: "__ix(" }, { at: open, end: open + 1, text: "," }, { at: v.end - 1, end: v.end, text: `,${site(file, text, v.start)})` });
    }
    for (const [k, x] of Object.entries(v)) walk(x, v, k, v.kind === "nonNull" && place);
  };
  walk(parse(text, { last: 0 }), undefined, "", false);
  let out = text;
  // Reversed first, so of two wrappers starting together the outer one, found first, ends up outside.
  for (const e of edits.reverse().sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

const skip = /^(ast|astgen|casemap)\.ts$/;
for (const f of readdirSync(SRC)) {
  if (!f.endsWith(".ts")) continue;
  const text = readFileSync(join(SRC, f), "utf8");
  writeFileSync(join(copy, f), f.endsWith(".d.ts") || skip.test(f) ? text : instrument(f, text));
}

let current = "";
const hit = new Map<number, number>();
const first = new Map<number, string>();
const noted = (id: number) => {
  hit.set(id, (hit.get(id) ?? 0) + 1);
  if (!first.has(id)) first.set(id, new Error().stack!.split("\n").slice(3, 7).map((l) => l.replace(/\/.*\/src\//, "")).join(" <") + `\n         in ${current}`);
};
const g = globalThis as unknown as Record<string, unknown>;
g.__nn = (v: unknown, id: number) => {
  if (v === null || v === undefined) noted(id);
  return v;
};
g.__ix = (o: unknown, i: unknown, id: number) => {
  if ((Array.isArray(o) || typeof o === "string") && typeof i === "number" && (i < 0 || i >= o.length)) noted(id);
  return (o as Record<string, unknown>)[i as string];
};

const programs = join(import.meta.dir, "..", "tests", "programs");
const sources: string[] = [];
for (const f of readdirSync(programs).filter((n) => n.endsWith(".fsh")).sort()) {
  for (const part of readFileSync(join(programs, f), "utf8").split(/^(?=\/\/ case: )/m)) sources.push(part);
}
const [every, offset] = [Number(process.argv[2] ?? 10), Number(process.argv[3] ?? 0)];
const chosen = sources.filter((_, i) => i % every === offset);

const { check } = await import(join(copy, "check.ts"));
const { parse: parseCopy } = await import(join(copy, "parser.ts"));
const { newCompilation } = await import(join(copy, "compilation.ts"));
const { cachedSession } = await import(join(copy, "stdcache.ts"));
const session = cachedSession();
let [accepted, rejected, crashed] = [0, 0, 0];
for (const source of chosen) {
  current = source.slice(0, 80).replace(/\n/g, " ");
  const compilation = newCompilation(session);
  try {
    check(compilation, parseCopy(source, compilation.ids));
    accepted++;
  } catch (e) {
    if ((e as { code?: string }).code !== undefined) rejected++;
    else {
      crashed++;
      console.error(`crashed: ${(e as Error).message.slice(0, 200)}\n${(e as Error).stack?.split("\n").slice(1, 5).join("\n")}\n${source.slice(0, 200)}`);
    }
  }
}
console.log(`${chosen.length} programs: ${accepted} accepted, ${rejected} rejected, ${crashed} crashed`);
for (const [id, count] of [...hit].sort((a, b) => sites[a[0]]!.localeCompare(sites[b[0]]!))) console.log(`${String(count).padStart(7)}x ${sites[id]}\n         ${first.get(id)}`);
