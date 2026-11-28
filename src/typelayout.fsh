import { bodyOf, type Arenas, type InstanceId } from "./arenas.fsh";
import type { Checked } from "./check.fsh";
import { newCompilation } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
import { isConcrete } from "./generics.fsh";
import { layoutOf, llvmOf, structNames } from "./layout.fsh";
import { cachedSession } from "./mathlib.fsh";
import { checkedSource } from "./queries.fsh";
import { allWords, placedParts, sizeOf, words } from "./sizes.fsh";
import type { Type, Typing, UnionType } from "./typing.fsh";

// A part of a struct as `fishc layout` reports it, its types spelled.
export type Part = { name: string; type: string; llvm: string; offset: usize; size: usize; align: usize };

// A union's member: the tag that names it, its size and the payload words it fills.
export type Member = { tag: usize; type: string; llvm: string; size: usize; words: usize };

// How a type is laid out: its LLVM type by the name its definition has, and that definition; its
// size and alignment; and where its parts sit, or what its union holds.
export type Layout = { name: string; shown: string; llvm: string; body: string; size: usize; align: usize; parts: Part[]; union?: { words: usize; unknown: boolean; members: Member[] } };

// The layout of `t`, which the program names `name`.
export function layoutReport(typing: Ref<Typing>, name: string, t: Type): Layout {
  const [size, align] = sizeOf(typing, t);
  const body = layoutOf(typing, t);
  const r = typeof t === "string" ? undefined : typing.rec(t);
  let out: Layout = { name, shown: typing.show(t), llvm: llvmOf(typing, t), body, size, align, parts: [] };
  if (r?.kind === "union") {
    let members: Member[] = [];
    for (const m of r.members) {
      const [n] = sizeOf(typing, m);
      members.push({ tag: members.length, type: typing.show(m), llvm: llvmOf(typing, m), size: n, words: Math.ceil((n as f64) / 8) as usize });
    }
    out.union = { words: words(typing, t as UnionType), unknown: r.unknown === true, members };
  } else if (body.startsWith("{ ")) {
    for (const p of placedParts(typing, t)) out.parts.push({ name: p.name, type: typing.show(p.type), llvm: llvmOf(typing, p.type), offset: p.offset, size: p.size, align: p.align });
  }
  return out;
}

// The function `fishc layout` adds to the end of a file, whose return type holds the type asked
// for, resolved as an annotation in that file would resolve it.
const LAYOUT_PROBE = "fishcLayout$";
// It returns an array of the type, since a parameter of an object type would make it generic.
export const probing = (src: string, named: string): string => `${src}\nfunction ${LAYOUT_PROBE}(): (${named})[] {\n  return [];\n}\n`;

// The program in `src` checked, its unions measured and its structs named as codegen names them.
/** @throws {CompileError | Error | IoError} */
function laidOutCheck(file: string, src: string): Checked {
  let looked: string[] = [];
  let session = cachedSession();
  session.plain = true;
  let made = checkedSource(newCompilation(session), file, src, false, looked);
  let checked = made.checked;
  const measured = allWords(checked.tables.typing);
  checked.tables.typing.unionWords = measured;
  const named = structNames(checked.tables.typing);
  checked.tables.typing.structNames = named.names;
  checked.tables.typing.structColors = named.colors;
  checked.tables.typing.structSignatures = named.signatures;
  return checked;
}

// The type the probe's array holds, from its concrete instance: none when the type is an interface.
function probedType(checked: Ref<Checked>): Type | undefined {
  const arenas: Ref<Arenas> = checked.tables.arenas;
  for (let i: usize = 1; i <= arenas.instanceCount(); i++) {
    const inst = arenas.instanceOf(i as InstanceId);
    if (!inst.concrete || bodyOf(arenas, inst).name !== LAYOUT_PROBE) continue;
    const r = typeof inst.returns === "string" ? undefined : checked.tables.typing.rec(inst.returns);
    return r?.kind === "array" ? r.element : undefined;
  }
  return undefined;
}

// Each instance of the generic class `family` the program has, by its name, in name order.
function familyLayouts(checked: Ref<Checked>, family: string): Layout[] {
  const typing: Ref<Typing> = checked.tables.typing;
  let out: Layout[] = [];
  for (const t of typing.typeIds()) {
    const r = typing.rec(t as Exclude<Type, string>);
    if (r.kind === "class" && r.generic?.name === family && isConcrete(typing, t)) out.push(layoutReport(typing, typing.show(t), t));
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

// How the type `named` stands for in the .fsh file `file`, whose text is `src`, is laid out, or each
// instance of the generic class it names. Throws the compile error naming it gives.
/** @throws {CompileError | Error | IoError} */
export function layoutsOf(file: string, src: string, named: string): Layout[] {
  const probe = probing(src, named);
  try {
    const checked = laidOutCheck(file, probe);
    const t = probedType(checked);
    if (t === undefined) throw new Error(`'${named}' is an interface, which has no layout of its own; name a class that satisfies it, or Dyn<${named}>`);
    return [layoutReport(checked.tables.typing, named, t!)];
  } catch (e) {
    // A generic class named without type arguments stands for each of its instances.
    if (e instanceof CompileError && /^[A-Za-z_$][\w$]*$/.test(named)) {
      const family = familyLayouts(laidOutCheck(file, src), named);
      if (family.length > 0) return family;
    }
    throw e;
  }
}

// A type's text cut to fit a table's last column; the JSON form keeps it whole.
const cut = (s: string): string => (s.length > 100 ? `${s.slice(0, 97)}...` : s);

const plural = (n: usize, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

// The tables `fishc layout` prints for each layout.
export function formatLayouts(layouts: Ref<Layout[]>): string {
  return layouts.map((l) => formatLayout(l)).join("\n");
}

function formatLayout(l: Ref<Layout>): string {
  let out = l.shown === l.name ? `${l.name}\n` : `${l.name} = ${cut(l.shown)}\n`;
  out += `  llvm   ${l.llvm === l.body ? l.body : `${l.llvm} = type ${l.body}`}\n`;
  out += `  size   ${plural(l.size, "byte")}, align ${l.align}\n`;
  if (l.union !== undefined) {
    const u: Ref<{ words: usize; unknown: boolean; members: Member[] }> = l.union!;
    out += `  union  ${u.unknown ? "unknown, " : ""}an i32 tag at offset 0, then ${plural(u.words, "i64 word")} at offset 8, for ${plural(u.members.length, "member")}\n\n`;
    out += `${"tag".padStart(8)}${"size".padStart(8)}${"words".padStart(7)}  llvm, member\n`;
    for (const m of u.members) out += `${`${m.tag}`.padStart(8)}${`${m.size}`.padStart(8)}${`${m.words}`.padStart(7)}  ${m.llvm}  ${cut(m.type)}\n`;
    return out;
  }
  if (l.parts.length === 0) return out;
  let padding: usize = 0;
  let rows = "";
  let at: usize = 0;
  // Each part in turn, then the end of the struct, with the bytes before each that nothing fills.
  for (let i: usize = 0; i <= l.parts.length; i++) {
    const to = i < l.parts.length ? l.parts[i]!.offset : l.size;
    if (to > at) rows += `${`${at}`.padStart(8)}${`${to - at}`.padStart(8)}${"".padStart(7)}  (padding)\n`;
    padding += to - at;
    if (i === l.parts.length) break;
    const p: Ref<Part> = l.parts[i]!;
    rows += `${`${p.offset}`.padStart(8)}${`${p.size}`.padStart(8)}${`${p.align}`.padStart(7)}  ${p.name}  ${p.llvm}  ${cut(p.type)}\n`;
    at = p.offset + p.size;
  }
  out += `  parts  ${plural(l.parts.length, "part")}, ${plural(padding, "byte")} of padding\n\n`;
  return out + `${"offset".padStart(8)}${"size".padStart(8)}${"align".padStart(7)}  name, llvm, type\n` + rows;
}

export function layoutsJson(layouts: Ref<Layout[]>): string {
  const one = (l: Ref<Layout>): string => {
    let out = `  {\n    "name": ${JSON.stringify(l.name)},\n    "type": ${JSON.stringify(l.shown)},\n    "llvm": ${JSON.stringify(l.llvm)},\n    "definition": ${JSON.stringify(l.body)},\n    "size": ${l.size},\n    "align": ${l.align}`;
    if (l.union !== undefined) {
      const ms = l.union.members.map((m) => `      { "tag": ${m.tag}, "type": ${JSON.stringify(m.type)}, "llvm": ${JSON.stringify(m.llvm)}, "size": ${m.size}, "words": ${m.words} }`).join(",\n");
      out += `,\n    "union": { "words": ${l.union.words}, "unknown": ${l.union.unknown}, "members": [\n${ms}\n    ] }`;
    } else if (l.parts.length > 0) {
      const ps = l.parts.map((p) => `      { "name": ${JSON.stringify(p.name)}, "type": ${JSON.stringify(p.type)}, "llvm": ${JSON.stringify(p.llvm)}, "offset": ${p.offset}, "size": ${p.size}, "align": ${p.align} }`).join(",\n");
      out += `,\n    "parts": [\n${ps}\n    ]`;
    }
    return `${out}\n  }`;
  };
  return `[\n${layouts.map((l) => one(l)).join(",\n")}\n]\n`;
}
