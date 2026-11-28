// `fishc bloat`: what a program's code is made of, function by function and per generic body.
// Read from the IR text codegen gives (bytes of text) or from a linked binary's symbols (bytes of
// machine code), never from the compiler's tables, so reporting can't change what a build emits.

// A function and its size, its IR text or its machine code.
export type Sized = { name: string; bytes: i64 };
// A generic body's instances, or a family of generated helpers such as drop glue, summed.
export type Group = { name: string; instances: i64; bytes: i64 };
export type Bloat = { unit: string; total: i64; functions: Sized[]; groups: Group[] };

// Each function an LLVM module defines, from its `define` line to its closing brace, the newline
// after each line counted. IR text is ASCII, so its length is its size in bytes.
export function irFunctions(ir: string): Sized[] {
  let found: Sized[] = [];
  let name = "";
  let bytes: i64 = 0;
  let inside = false;
  for (const line of ir.split("\n")) {
    if (!inside && line.startsWith("define ")) {
      inside = true;
      name = definedName(line);
      bytes = 0;
    }
    if (!inside) continue;
    bytes += (line.length as i64) + 1;
    if (line === "}") {
      found.push({ name, bytes });
      inside = false;
    }
  }
  return found;
}

// The name a `define` line gives, quotes kept. IR escapes a quote inside one as `\22`.
export function definedName(line: string): string {
  const at = line.indexOf("@");
  if (at < 0) return "";
  const m = line.charCodeAt((at + 1) as usize) === 34 ? /^"[^"]*"/.exec(line.slice(at + 1)) : /^[\w.$-]+/.exec(line.slice(at + 1));
  return m === null ? "" : m[0]!;
}

// Each code symbol `nm -n` lists, sized up to the next symbol's address. The last one has nothing
// after it to measure against and is left out.
export function binaryFunctions(nm: string): Sized[] {
  let found: Sized[] = [];
  let last: { name: string; at: i64; code: boolean } | undefined = undefined;
  for (const line of nm.split("\n")) {
    const m = /^([0-9a-fA-F]+) ([A-Za-z]) (.+)$/.exec(line);
    if (m === null) continue;
    const at = parseInt(m[1]!, 16)!;
    if (last !== undefined && last.code && at > last.at) found.push({ name: last.name, bytes: at - last.at });
    // Mach-O puts an underscore before every C-level name.
    const raw = m[3]!.startsWith("_") ? m[3]!.slice(1) : m[3]!;
    last = { name: spelled(raw), at, code: m[2]! === "T" || m[2]! === "t" };
  }
  return found;
}

// A binary's symbol spelled as the IR spells it, so both group alike: quoted, except a helper's,
// whose name is a lowercase hash of eight or more characters after its family, and C's.
const spelled = (raw: string): string => (!raw.startsWith("fsh.") || /^fsh\.[a-z]+\.[0-9a-z]{8,}$/.test(raw) ? raw : `"${raw}"`);

// The generic body or helper family a function belongs to, or the function itself. An instance's
// symbol carries its type arguments in `<...>` and a `#hash` for them; a private member's `#` follows
// a dot and is kept. Generated helpers (`@fsh.drop.<hash>`) are the only unquoted `fsh.` names.
export function groupOf(name: string): string {
  if (!name.startsWith('"')) {
    const family = /^(fsh\.[a-z]+)\./.exec(name);
    return family === null ? name : `${family[1]!}.*`;
  }
  return withoutArguments(name.slice(1, -1)).replace(/([^.])#[0-9a-z]+(\.[0-9]+)?/g, "$1").replace(/~[0-9a-z]+(\.[0-9]+)?/g, "");
}

// A symbol with each top-level `<...>` taken out, a function type's `=>` not closing one.
function withoutArguments(name: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c === 60) depth++;
    else if (c === 62 && depth > 0 && (i === 0 || name.charCodeAt(i - 1) !== 61)) depth--;
    else if (depth === 0) out += name[i]!;
  }
  return out;
}

// The report: every function largest first, and every group with more than one member or whose
// members' names differ from its own, largest first.
export function bloat(unit: string, sized: Ref<Sized[]>): Bloat {
  let functions: Sized[] = sized.map((s) => ({ name: s.name, bytes: s.bytes }));
  functions.sort((a, b) => (b.bytes !== a.bytes ? b.bytes - a.bytes : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let total: i64 = 0;
  let byGroup = new Map<string, Group>();
  let renamed = new Set<string>();
  for (const f of functions) {
    total += f.bytes;
    const g = groupOf(f.name);
    if (g !== f.name && g !== f.name.slice(1, -1)) renamed.add(g);
    const had = byGroup.get(g);
    if (had === undefined) byGroup.set(g, { name: g, instances: 1, bytes: f.bytes });
    else byGroup.set(g, { name: g, instances: had.instances + 1, bytes: had.bytes + f.bytes });
  }
  let groups: Group[] = [];
  for (const [g, v] of byGroup) if (v.instances > 1 || renamed.has(g)) groups.push({ name: v.name, instances: v.instances, bytes: v.bytes });
  groups.sort((a, b) => (b.bytes !== a.bytes ? b.bytes - a.bytes : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { unit, total, functions, groups };
}

export const share = (bytes: i64, total: i64): string => `${(total === 0 ? 0 : ((bytes as f64) * 100) / (total as f64)).toFixed(1)}%`.padStart(7);

// The two tables, `top` rows each.
export function formatBloat(b: Ref<Bloat>, top: i64): string {
  let out = `${b.total} bytes of ${b.unit} in ${b.functions.length} functions, ${b.groups.length} generic bodies and helper families\n\nlargest functions:\n`;
  for (const f of b.functions.slice(0, top)) out += `${`${f.bytes}`.padStart(12)}${share(f.bytes, b.total)}  ${f.name}\n`;
  out += "\nlargest generic bodies and helper families:\n";
  out += `${"bytes".padStart(12)}${"".padStart(7)}${"instances".padStart(11)}  name\n`;
  for (const g of b.groups.slice(0, top)) out += `${`${g.bytes}`.padStart(12)}${share(g.bytes, b.total)}${`${g.instances}`.padStart(11)}  ${g.name}\n`;
  return out;
}

export function bloatJson(b: Ref<Bloat>): string {
  const fns = b.functions.map((f) => `    { "name": ${JSON.stringify(f.name)}, "bytes": ${f.bytes} }`).join(",\n");
  const gs = b.groups.map((g) => `    { "name": ${JSON.stringify(g.name)}, "instances": ${g.instances}, "bytes": ${g.bytes} }`).join(",\n");
  return `{\n  "unit": ${JSON.stringify(b.unit)},\n  "total": ${b.total},\n  "functions": [\n${fns}\n  ],\n  "groups": [\n${gs}\n  ]\n}\n`;
}
