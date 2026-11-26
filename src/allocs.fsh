// `fishc allocs`: every heap allocation site a program's IR holds, by function and per generic body.
// A site is a call to a runtime function that may allocate, which the runtime's own C source decides,
// so the list follows the runtime as it changes. Only the IR text codegen gives is read, never the
// compiler's tables, so reporting can't change what a build emits.
import { bloat, definedName, share, type Bloat, type Sized } from "./bloat.fsh";

// C's allocators. A runtime function that calls one, or calls another that does, joins them.
const LIBC = ["malloc", "calloc", "realloc", "strdup", "strndup", "aligned_alloc", "posix_memalign"];

// Every function a C source defines that may allocate on the heap. A definition begins at column 0
// with its name and `(`, and its body ends at the next `}` at column 0, as the runtime is written; a
// function-like macro counts as a definition of one line. Comments, literals and a leading
// `__attribute__((...))` are taken out first.
export function allocators(c: string): Set<string> {
  const code = c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, " ").replace(/^__attribute__\(\(\w+\)\) /gm, "");
  let bodies = new Map<string, string>();
  let name = "";
  let body: string[] = [];
  for (const line of code.split("\n")) {
    if (name === "") {
      const macro = /^#define ([A-Za-z_]\w*)\(/.exec(line);
      const start = macro !== null ? macro : /^[A-Za-z_][\w \t*]*?\b([A-Za-z_]\w*)\s*\(/.exec(line);
      if (start === null || line.trimEnd().endsWith(";") || line.startsWith("typedef")) continue;
      name = start[1]!;
      body = [line.slice(start[0]!.length as i64)];
      if (macro === null && !line.trimEnd().endsWith("}")) continue;
    } else if (line !== "}") {
      body.push(line);
      continue;
    }
    // A name defined twice, under `#if` and `#else`, may allocate through either.
    bodies.set(name, `${bodies.get(name) ?? ""}\n${body.join("\n")}`);
    name = "";
  }
  let calls = new Map<string, Set<string>>();
  for (const [f, text] of bodies) {
    let callees = new Set<string>();
    for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) callees.add(m[1]!);
    calls.set(f, callees);
  }
  let found = new Set<string>(LIBC.clone());
  let grew = true;
  while (grew) {
    grew = false;
    for (const [f, callees] of calls) {
      if (found.has(f)) continue;
      for (const g of callees) {
        if (found.has(g)) {
          found.add(f);
          grew = true;
          break;
        }
      }
    }
  }
  return found;
}

// One function's sites, and how many go through each allocator, most first.
export type Count = { name: string; sites: i64 };
export type Allocs = { functions: i64; sites: Bloat; through: Map<string, Count[]>; allocators: Count[] };

// The sites in each function `ir` defines: each call or invoke of one of `allocating`, except one
// the IR declares `noreturn`, a panic whose allocations are on its way out.
export function allocs(ir: string, allocating: Ref<Set<string>>): Allocs {
  let ending = new Set<string>();
  for (const m of ir.matchAll(/^declare [^\n]*@([\w.$-]+)\([^\n]*\bnoreturn\b/gm)) ending.add(m[1]!);
  let functions: i64 = 0;
  let sized: Sized[] = [];
  let through = new Map<string, Count[]>();
  let byAllocator = new Map<string, i64>();
  let name = "";
  let here = new Map<string, i64>();
  let inside = false;
  for (const line of ir.split("\n")) {
    if (!inside) {
      if (line.startsWith("define ")) {
        inside = true;
        name = definedName(line);
        here = new Map<string, i64>();
        functions++;
      }
      continue;
    }
    if (line === "}") {
      inside = false;
      let n: i64 = 0;
      for (const [, k] of here) n += k;
      if (n > 0) {
        sized.push({ name, bytes: n });
        through.set(name, mostFirst(here));
      }
      continue;
    }
    const m = /\b(?:call|invoke) [^@]*@([\w.$-]+)\(/.exec(line);
    if (m === null || !allocating.has(m[1]!) || ending.has(m[1]!)) continue;
    here.set(m[1]!, (here.get(m[1]!) ?? 0) + 1);
    byAllocator.set(m[1]!, (byAllocator.get(m[1]!) ?? 0) + 1);
  }
  return { functions, sites: bloat("allocation sites", sized), through, allocators: mostFirst(byAllocator) };
}

function mostFirst(counts: Ref<Map<string, i64>>): Count[] {
  let out: Count[] = [];
  for (const [name, sites] of counts) out.push({ name, sites });
  out.sort((a, b) => (b.sites !== a.sites ? b.sites - a.sites : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

const listed = (counts: Ref<Count[]>, most: i64): string => counts.slice(0, most).map((c) => `${c.name} ${c.sites}`).join(", ") + ((counts.length as i64) > most ? `, ${(counts.length as i64) - most} more` : "");

// The three tables: allocators in full, then `top` rows of functions and of generic bodies.
export function formatAllocs(a: Ref<Allocs>, top: i64): string {
  let out = `${a.sites.total} heap allocation sites in ${a.sites.functions.length} of ${a.functions} functions, through ${a.allocators.length} runtime functions\n\nsites by runtime function:\n`;
  for (const c of a.allocators) out += `${`${c.sites}`.padStart(8)}${share(c.sites, a.sites.total)}  ${c.name}\n`;
  out += "\nfunctions with the most sites:\n";
  for (const f of a.sites.functions.slice(0, top)) out += `${`${f.bytes}`.padStart(8)}${share(f.bytes, a.sites.total)}  ${f.name}  (${listed(a.through.get(f.name)!, 3)})\n`;
  out += "\ngeneric bodies and helper families with the most sites:\n";
  out += `${"sites".padStart(8)}${"".padStart(7)}${"instances".padStart(11)}  name\n`;
  for (const g of a.sites.groups.slice(0, top)) out += `${`${g.bytes}`.padStart(8)}${share(g.bytes, a.sites.total)}${`${g.instances}`.padStart(11)}  ${g.name}\n`;
  return out;
}

const countsJson = (counts: Ref<Count[]>): string => `[${counts.map((c) => `{ "name": ${JSON.stringify(c.name)}, "sites": ${c.sites} }`).join(", ")}]`;

export function allocsJson(a: Ref<Allocs>): string {
  const fns = a.sites.functions.map((f) => `    { "name": ${JSON.stringify(f.name)}, "sites": ${f.bytes}, "through": ${countsJson(a.through.get(f.name)!)} }`).join(",\n");
  const gs = a.sites.groups.map((g) => `    { "name": ${JSON.stringify(g.name)}, "instances": ${g.instances}, "sites": ${g.bytes} }`).join(",\n");
  const as = a.allocators.map((c) => `    { "name": ${JSON.stringify(c.name)}, "sites": ${c.sites} }`).join(",\n");
  return `{\n  "sites": ${a.sites.total},\n  "functions": ${a.functions},\n  "allocators": [\n${as}\n  ],\n  "allocating": [\n${fns}\n  ],\n  "groups": [\n${gs}\n  ]\n}\n`;
}
