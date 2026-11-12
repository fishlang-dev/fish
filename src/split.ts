import assert from "node:assert";
// A dev build's IR split into two modules: std's part, whose text is the same whatever the
// program's own code says, so its object can be cached, and the program's part, compiled fresh.
//
// Std's part is every definition its functions reach, stopping at the program's: its own functions,
// and the generated glue that reaches them, such as a Dyn's thunk calling one of its closures,
// whose text changes with the closure's body even when std's generic function holding it doesn't.
// The program's part is everything else: those, what only they reach, and the entry glue (`main`,
// the constants' filler, the constructor list). Private constants are copied into
// each part that uses them, since they can't be referenced across modules. Every other
// definition loses `internal`, so the other part can reach it through a declaration. A `-g` build's
// debug metadata goes with the program's part, the only one whose functions refer to it.

// `name` as the IR spells it, and `key` without the quotes it may have, so `@"f"` and `@f` meet.
type Item = { kind: "define" | "declare" | "global"; name: string; key: string; text: string };

const key = (name: string) => name.replace(/^"(.*)"$/, "$1");

const NAME = /@("[^"]*"|[\w.$-]+)/;
const NAMES = /@("[^"]*"|[\w.$-]+)/g;

function items(ir: string): Item[] {
  let found: Item[] = [];
  const lines = ir.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;
    const named = NAME.exec(line);
    const name = named === null ? "" : named[1]!;
    if (line.startsWith("define ")) {
      const end = lines.indexOf("}", i as i64);
      found.push({ kind: "define", name, key: key(name), text: lines.slice(i as i64, end + 1).join("\n") });
      i = end as usize;
    } else if (line.startsWith("declare ")) found.push({ kind: "declare", name, key: key(name), text: line });
    else if (line.startsWith("!")) continue;
    else if (line.startsWith("@")) found.push({ kind: "global", name, key: key(name), text: line });
    else assert(false, `can't split the IR at '${line}'`);
  }
  return found;
}

// The names an item refers to, its own included. String constants' bytes are left out, since an
// `@` in them names nothing.
function references(item: Ref<Item>): string[] {
  let out: string[] = [];
  for (const m of item.text.replace(/ x i8\] c"[^"]*"/g, "").matchAll(NAMES)) out.push(key(m[1]!));
  return out;
}

const copied = (item: Ref<Item>) => item.kind === "global" && / = private unnamed_addr constant /.test(item.text);

// A definition as the other part declares it.
function declaration(item: Ref<Item>): string {
  if (item.kind === "global") {
    const found = / = (?:\w+ )*?(global|constant) (.*)$/.exec(item.text)!;
    return `@${item.name} = external ${found[1]!} ${typeAt(found[2]!)}`;
  }
  const header = item.text.slice(0, item.text.indexOf("\n"));
  const at = header.indexOf(`@${item.name}(`);
  const open = (at as usize) + item.name.length + 1;
  const params = header.slice(open as i64, (closing(header, open) + 1) as i64).replace(/ %("[^"]*"|[\w.$-]+)/g, "");
  return `declare ${header.slice("define ".length as i64, at).replace(/^internal /, "")}@${item.name}${params}`;
}

// The index of the bracket closing the one at `open`.
function closing(text: string, open: usize): usize {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if ("([{<".includes(text[i]!)) depth++;
    else if (")]}>".includes(text[i]!) && --depth === 0) return i;
  }
  assert(false, `unbalanced IR: '${text}'`);
  return text.length;
}

// The type at the start of `text`.
const typeAt = (text: string) => ("{[<".includes(text[0]!) ? text.slice(0, (closing(text, 0) + 1) as i64) : text.split(" ")[0]!);

const exposed = (item: Ref<Item>) => (item.kind === "define" ? item.text.replace(/^define internal /, "define ") : item.text.replace(/ = (internal|private) /, " = "));

// The IR split into std's part and the program's. `stdSymbols` names std's functions and
// `ownSymbols` the program's, as the IR spells them.
export function split(ir: string, stdSymbols: string[], ownSymbols: string[]): { std: string; program: string } {
  const std = keysOf(stdSymbols);
  const own = keysOf(ownSymbols);
  const all = items(ir);
  // Where each key's item sits in `all`; of two items with one key, the later.
  let byName = new Map<string, usize>();
  for (let i: usize = 0; i < all.length; i++) byName.set(all[i]!.key, i);
  // The entry glue referring to each name, by its place in `all`.
  let referrers = new Map<string, usize[]>();
  for (let i: usize = 0; i < all.length; i++) {
    const item: Ref<Item> = all[i]!;
    if (item.kind === "declare" || copied(item) || std.has(item.key) || own.has(item.key)) continue;
    for (const name of references(item)) {
      const had = referrers.get(name);
      if (had === undefined) referrers.set(name, [i]);
      else {
        let list: usize[] = had;
        list.push(i);
        referrers.set(name, list);
      }
    }
  }
  let program = new Set<string>();
  let pending: string[] = [];
  for (const item of all) {
    if (!own.has(item.key) || program.has(item.key)) continue;
    program.add(item.key);
    pending.push(item.key);
  }
  while (pending.length > 0) {
    const name = pending.pop()!;
    const refer = referrers.get(name);
    if (refer === undefined) continue;
    for (const i of refer) {
      const k = all[i]!.key;
      if (program.has(k)) continue;
      program.add(k);
      pending.push(k);
    }
  }
  let reached = new Set<string>();
  let work: string[] = [];
  for (const item of all) if (item.kind === "define" && std.has(item.key)) work.push(item.key);
  while (work.length > 0) {
    const name = work.pop()!;
    const at = byName.get(name);
    if (reached.has(name) || at === undefined) continue;
    const item: Ref<Item> = all[at]!;
    if (item.kind === "declare" || copied(item) || program.has(name)) continue;
    reached.add(name);
    for (const r of references(item)) work.push(r);
  }
  let metadata = "";
  for (const line of ir.split("\n")) if (line.startsWith("!")) metadata += `${line}\n`;
  return { std: part(all, byName, reached, true), program: part(all, byName, reached, false) + metadata };
}

function keysOf(symbols: Ref<string[]>): Set<string> {
  let out = new Set<string>();
  for (const s of symbols) out.add(key(s.slice(1)));
  return out;
}

// Whether an item belongs to std's part, or else to the program's: std's is what its functions
// reach, and the program's every other definition.
function owns(item: Ref<Item>, reached: Ref<Set<string>>, std: boolean): boolean {
  return std ? reached.has(item.key) : item.kind !== "declare" && !copied(item) && !reached.has(item.key);
}

// One part's text: what it owns and what that refers to, the rest declared.
function part(all: Ref<Item[]>, byName: Ref<Map<string, usize>>, reached: Ref<Set<string>>, std: boolean): string {
  let used = new Set<string>();
  let pending: string[] = [];
  for (const item of all) if (owns(item, reached, std)) pending.push(item.key);
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (used.has(name)) continue;
    used.add(name);
    const at = byName.get(name);
    if (at === undefined) continue;
    const item: Ref<Item> = all[at]!;
    if (owns(item, reached, std) || copied(item)) for (const r of references(item)) pending.push(r);
  }
  let lines: string[] = [];
  for (const item of all) {
    if (!used.has(item.key)) continue;
    lines.push(copied(item) || item.kind === "declare" ? item.text : owns(item, reached, std) ? exposed(item) : declaration(item));
  }
  return `${lines.join("\n")}\n`;
}
