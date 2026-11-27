import assert from "node:assert";
import { atNamesIn, firstNameIn, typeNamesIn } from "./layout.fsh";
// A dev build's IR, or a large release build's, split into modules: std's part, whose text is
// the same whatever the program's own code says, a part per group of the program's functions
// (one per source file, or several for a very large one), and the program's part holding the rest. Each part's text changes only
// when what it holds does, so its object can be cached by that text.
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
// `refs` is what it refers to, and `copied` whether it is a private constant each part holds its
// own copy of, both read once.
type Item = { kind: "define" | "declare" | "global"; name: string; key: string; text: string; refs: string[]; copied: boolean };

const key = (name: string) => name.replace(/^"(.*)"$/, "$1");


// The IR's items, its named structs' definitions by name, and its debug metadata, read from its
// pieces, whose text joined by newlines is the module's. A piece holding one function whole, as
// codegen gives most, is that function's text as it is; any other is read a line at a time, a
// function running on to the line closing it.
function items(pieces: Ref<string[]>): { found: Item[]; types: Map<string, string>; metadata: string } {
  let found: Item[] = [];
  let types = new Map<string, string>();
  let metadata = "";
  let open: string[] = [];
  for (const piece of pieces) {
    if (open.length === 0 && whole(piece)) {
      found.push(defined(piece));
      continue;
    }
    for (const line of piece.split("\n")) {
      if (open.length > 0) {
        open.push(line);
        if (line !== "}") continue;
        found.push(defined(open.join("\n")));
        open = [];
        continue;
      }
      if (line === "") continue;
      if (line.startsWith("!")) metadata += `${line}\n`;
      else if (line.startsWith('%"<')) types.set(line.slice(0, line.indexOf(" = type ")), line);
      else if (line.startsWith("define ")) open.push(line);
      else if (line.startsWith("declare ")) found.push(item("declare", line, false));
      else if (line.startsWith("@")) found.push(item("global", line, / = private unnamed_addr constant /.test(line)));
      else assert(false, `can't split the IR at '${line}'`);
    }
  }
  assert(open.length === 0, "the IR ends inside a function");
  return { found, types, metadata };
}

// Whether a piece is one function, from its `define` line to the line closing it and no further.
const whole = (piece: string) => piece.startsWith("define ") && piece.endsWith("\n}") && piece.indexOf("\n}\n") < 0;

const defined = (text: string) => item("define", text, false);

function item(kind: "define" | "declare" | "global", text: string, copied: boolean): Item {
  const name = firstNameIn(text) ?? "";
  return { kind, name, key: key(name), text, refs: references(text), copied };
}

// The names an item refers to, its own included. String constants' bytes are left out, since an
// `@` in them names nothing.
function references(text: string): string[] {
  let out: string[] = [];
  for (const name of atNamesIn(text)) out.push(key(name));
  return out;
}

const copied = (item: Ref<Item>) => item.copied;

// A definition as the other part declares it.
function declaration(item: Ref<Item>): string {
  if (item.kind === "global") {
    if (item.text.includes(" = external ")) return item.text;
    // A thread-local global stays one in every part, or another part reaches it as an ordinary one.
    const found = / = (?:\w+ )*?(thread_local )?(global|constant) (.*)$/.exec(item.text)!;
    return `@${item.name} = external ${found[1] ?? ""}${found[2]!} ${typeAt(found[3]!)}`;
  }
  const header = item.text.slice(0, item.text.indexOf("\n"));
  const at = header.indexOf(`@${item.name}(`);
  const open = (at as usize) + item.name.length + 1;
  const params = header.slice(open as i64, (closing(header, open) + 1) as i64).replace(/ %("[^"<][^"]*"|[\w.$-]+)/g, "");
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

// A function's symbol without what tells its instances apart: each instance's hash, and a generic
// class's type arguments.
function written(symbol: string): string {
  let out = "";
  let depth = 0;
  for (let i: usize = 0; i < symbol.length; i++) {
    const c = symbol[i]!;
    if (c === "<") depth++;
    else if (c === ">" && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out.replace(/#[0-9a-z]+/g, "");
}

// The items without the program's functions that are another instance of their function with the
// same text, its own name aside: type arguments that give a body the same layout and the same
// calls lower to the same text. The instance with the smallest symbol is kept and every reference
// to the others names it, so each is compiled once. A round that merges two callees can make
// their callers the same, so rounds go on until one merges nothing. Std's functions stay as they
// are: std's part reads the same whatever the program is.
// ponytail: instances that call each other in a cycle never merge, since each round compares text
// as it stands; start from the coarsest grouping and refine if a program shows many.
function shared(found: Item[], own: Ref<Set<string>>): Item[] {
  let all = found;
  let groups = new Map<string, usize[]>();
  for (let i: usize = 0; i < all.length; i++) {
    const item: Ref<Item> = all[i]!;
    if (item.kind !== "define" || !own.has(item.key) || !item.key.includes("#")) continue;
    const name = written(item.key);
    const had = groups.get(name);
    if (had === undefined) groups.set(name, [i]);
    else {
      let list: usize[] = had;
      list.push(i);
      groups.set(name, list);
    }
  }
  let several: usize[][] = [];
  let candidates = new Set<string>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let sorted: [string, usize][] = [];
    for (const i of members) sorted.push([all[i]!.key, i]);
    sorted.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let ordered: usize[] = [];
    for (const [k, i] of sorted) {
      ordered.push(i);
      candidates.add(k);
    }
    several.push(ordered);
  }
  if (several.length === 0) return all;
  // Who refers to each function that may go, by place in `all`.
  let referrers = new Map<string, usize[]>();
  for (let i: usize = 0; i < all.length; i++) {
    const item: Ref<Item> = all[i]!;
    for (const r of item.refs) {
      if (r === item.key || !candidates.has(r)) continue;
      const had = referrers.get(r);
      if (had === undefined) referrers.set(r, [i]);
      else if (had[had.length - 1]! !== i) {
        let list: usize[] = had;
        list.push(i);
        referrers.set(r, list);
      }
    }
  }
  // Each candidate's text with its own name left out, read again only once the text changed.
  let masked = new Map<usize, string>();
  let gone = new Set<usize>();
  for (;;) {
    let pairs: [usize, usize][] = [];
    for (const members of several) {
      let byText = new Map<string, usize>();
      for (const i of members) {
        if (gone.has(i)) continue;
        let text = masked.get(i);
        if (text === undefined) {
          const item: Ref<Item> = all[i]!;
          text = item.text.replaceAll(`@${item.name}`, "@");
          masked.set(i, text);
        }
        const kept = byText.get(text);
        if (kept === undefined) byText.set(text, i);
        else pairs.push([i, kept]);
      }
    }
    if (pairs.length === 0) break;
    for (const [dropped, kept] of pairs) {
      gone.add(dropped);
      masked.delete(dropped);
      const from = all[dropped]!.key;
      const to = all[kept]!.key;
      const [spelled, respelled] = [`@${all[dropped]!.name}`, `@${all[kept]!.name}`];
      const refer = referrers.get(from);
      if (refer === undefined) continue;
      const already = referrers.get(to);
      let moved: usize[] = [];
      if (already !== undefined) for (const r of already) moved.push(r);
      for (const r of refer) {
        if (gone.has(r)) continue;
        const item: Ref<Item> = all[r]!;
        const text = item.text.replaceAll(spelled, respelled);
        let refs: string[] = [];
        for (const k of item.refs) refs.push(k === from ? to : k);
        all[r] = { kind: item.kind, name: item.name, key: item.key, text, refs, copied: item.copied };
        masked.delete(r);
        if (r !== kept) moved.push(r);
      }
      referrers.set(to, moved);
    }
  }
  let left: Item[] = [];
  for (let i: usize = 0; i < all.length; i++) if (!gone.has(i)) left.push(all[i]!.clone());
  return left;
}

// The IR split into std's part, a part for each of `groups`, and the program's. `stdSymbols` names
// std's functions and `ownSymbols` the program's, as the IR spells them; `groups` names parts of
// the program's functions, which leave the program's part for one of their own.
// A group whose functions' text is longer than `limit`, when one is given, is divided in the IR's
// order into parts of at most that much, the first under the group's name and the rest under
// `<group>#2` and on, so no one file's part is the longest thing clang is given; std's part is
// divided the same way, its parts in `std` in order, and so is the program's, whose first part,
// holding its globals and debug metadata, is `program` and the rest `rest`. A `-g` build's
// functions all refer to that metadata, so it is split with no limit.
// `times` is how long its reading, reaching and writing took, for `--timings`.
export function split(ir: Ref<string[]>, stdSymbols: string[], ownSymbols: string[], groups: Ref<Map<string, string[]>>, limit: usize = 0): { std: string[]; groups: Map<string, string>; program: string; rest: string[]; times: [string, f64][] } {
  const began = performance.now();
  const std = keysOf(stdSymbols);
  const own = keysOf(ownSymbols);
  // Each named struct's definition, by its name, for the parts that use it.
  let { found, types, metadata } = items(ir);
  const all = shared(found, own);
  const read = performance.now();
  // Where each key's item sits in `all`; of two items with one key, the later.
  let byName = new Map<string, usize>();
  for (let i: usize = 0; i < all.length; i++) byName.set(all[i]!.key, i);
  // The entry glue referring to each name, by its place in `all`.
  let referrers = new Map<string, usize[]>();
  for (let i: usize = 0; i < all.length; i++) {
    const item: Ref<Item> = all[i]!;
    if (item.kind === "declare" || copied(item) || std.has(item.key) || own.has(item.key)) continue;
    for (const name of item.refs) {
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
    for (const r of item.refs) work.push(r);
  }
  // Which part defines each name: STD for std's, a group's name for its functions, and none for the
  // program's.
  let where = new Map<string, string>();
  for (const name of reached) where.set(name, STD);
  for (const [group, symbols] of groups) for (const k of keysOf(symbols)) if (!reached.has(k)) where.set(k, group);
  let divided = new Map<string, i64>();
  if (limit > 0) {
    let filled = new Map<string, usize>();
    for (const item of all) {
      if (item.kind !== "define") continue;
      const group = where.get(item.key) ?? "";
      if (group !== "" && group !== STD && !groups.has(group)) continue;
      let n = divided.get(group) ?? 1;
      let size = filled.get(group) ?? 0;
      if (size > 0 && size + item.text.length > limit) {
        n++;
        size = 0;
        divided.set(group, n);
      }
      filled.set(group, size + item.text.length);
      if (n > 1) where.set(item.key, `${group}#${n}`);
    }
  }
  const reachedAt = performance.now();
  let out = new Map<string, string>();
  for (const group of groups.keys()) {
    out.set(group, typed(types, part(all, byName, where, group)));
    const n = divided.get(group) ?? 1;
    for (let more: i64 = 2; more <= n; more++) out.set(`${group}#${more}`, typed(types, part(all, byName, where, `${group}#${more}`)));
  }
  let stdParts = [typed(types, part(all, byName, where, STD))];
  for (let more: i64 = 2; more <= (divided.get(STD) ?? 1); more++) stdParts.push(typed(types, part(all, byName, where, `${STD}#${more}`)));
  const programPart = typed(types, part(all, byName, where, "")) + metadata;
  let rest: string[] = [];
  for (let more: i64 = 2; more <= (divided.get("") ?? 1); more++) rest.push(typed(types, part(all, byName, where, `#${more}`)));
  const done = performance.now();
  return { std: stdParts, groups: out, program: programPart, rest, times: [["split items", read - began], ["split reach", reachedAt - read], ["split parts", done - reachedAt]] };
}

// Std's part's name in `where`, which no group of the program's can have, since groups are named
// by files.
const STD = "\u0000std";

function keysOf(symbols: Ref<string[]>): Set<string> {
  let out = new Set<string>();
  for (const s of symbols) out.add(key(s.slice(1)));
  return out;
}

// Whether an item belongs to the part named `at`: std's is what its functions reach, a group's
// its functions, and the program's every other definition.
function owns(item: Ref<Item>, where: Ref<Map<string, string>>, at: string): boolean {
  if (item.kind === "declare" || copied(item)) return false;
  return (where.get(item.key) ?? "") === at;
}

// A part's text after the definitions of the named structs it uses, and those theirs use: a type
// can't be declared across modules, and std's part must read the same whatever the program's
// types are.
function typed(types: Ref<Map<string, string>>, text: string): string {
  let used = new Set<string>();
  let pending = typeNamesIn(text);
  while (pending.length > 0) {
    const n = pending.pop()!;
    if (used.has(n)) continue;
    used.add(n);
    const line = types.get(n);
    if (line !== undefined) for (const m of typeNamesIn(line.slice(n.length as i64))) pending.push(m);
  }
  let lines: string[] = [];
  for (const n of [...used].toSorted()) {
    const line = types.get(n);
    if (line !== undefined) lines.push(line);
  }
  return lines.length === 0 ? text : `${lines.join("\n")}\n${text}`;
}

// One part's text: what it owns and what that refers to, the rest declared.
function part(all: Ref<Item[]>, byName: Ref<Map<string, usize>>, where: Ref<Map<string, string>>, label: string): string {
  let used = new Set<string>();
  let pending: string[] = [];
  for (const item of all) if (owns(item, where, label)) pending.push(item.key);
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (used.has(name)) continue;
    used.add(name);
    const at = byName.get(name);
    if (at === undefined) continue;
    const item: Ref<Item> = all[at]!;
    if (owns(item, where, label) || copied(item)) for (const r of item.refs) pending.push(r);
  }
  let lines: string[] = [];
  for (const item of all) {
    if (!used.has(item.key)) continue;
    lines.push(copied(item) || item.kind === "declare" ? item.text : owns(item, where, label) ? exposed(item) : declaration(item));
  }
  return `${lines.join("\n")}\n`;
}
