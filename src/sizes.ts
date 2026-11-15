import { isLock, integerInfo, isInteger, TypeMap, type Field, type Type, type UnionType, type Typing } from "./typing.ts";

type Sizes = TypeMap<Type, [usize, usize]>;

// A type's size in bytes as it is laid out.
export const byteSize = (typing: Ref<Typing>, t: Type): usize => size(typing, t, new TypeMap<Type, [usize, usize]>())[0];

// How many 64-bit words a union's payload takes: enough for its largest member.
export function words(typing: Ref<Typing>, t: UnionType): usize {
  const known = typing.unionWords.get(t);
  if (known !== undefined) return known;
  return wordsOf(typing, t, new TypeMap<Type, [usize, usize]>());
}

// Every union's payload words, for codegen, which asks for them over and over: a union's size
// walks every member's layout, and nested unions walk theirs again.
export function allWords(typing: Ref<Typing>): TypeMap<UnionType, usize> {
  let memo = new TypeMap<Type, [usize, usize]>();
  let out = new TypeMap<UnionType, usize>();
  for (const t of typing.unionTypes()) out.set(t, wordsOf(typing, t, memo));
  return out;
}

function wordsOf(typing: Ref<Typing>, t: UnionType, memo: Mut<Sizes>): usize {
  let max: usize = 0;
  const members = typing.rec(t).members;
  for (const m of members) max = Math.max(max as f64, size(typing, m, memo)[0] as f64) as usize;
  return Math.ceil((max as f64) / 8) as usize;
}

// A type's size and alignment in bytes, as LLVM lays out its IR type on the 64-bit targets
// Fish supports.
function size(typing: Ref<Typing>, t: Type, memo: Mut<Sizes>): [usize, usize] {
  const known = memo.get(t);
  if (known !== undefined) return known;
  const found = measured(typing, t, memo);
  memo.set(t, found);
  return found;
}

function measured(typing: Ref<Typing>, t: Type, memo: Mut<Sizes>): [usize, usize] {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  if (r?.kind === "brand") return size(typing, r.base, memo);
  if (r?.kind === "array") return [24, 8];
  if (r?.kind === "fixed") {
    const [bytes, align] = size(typing, r.element, memo);
    return [(Math.ceil((bytes as f64) / (align as f64)) as usize) * align * r.size, align];
  }
  if (r?.kind === "dyn") return [16, 8];
  if (isInteger(t)) {
    const b = integerInfo(t).bits / 8;
    return [b, b];
  }
  if (t === "f32") return [4, 4];
  if (t === "f64") return [8, 8];
  if (t === "boolean") return [1, 1];
  if (t === "null" || t === "never") return [0, 1];
  if (t === "string" || t === "bigint") return [8, 8];
  if (r === undefined) return [0, 1];
  if (r.kind === "ref" || r.kind === "pointer" || r.kind === "handle" || r.kind === "shared" || r.kind === "block" || r.kind === "map" || r.kind === "regex" || r.kind === "recursive") return [8, 8];
  // The tag is padded to the 8-byte alignment of the payload words, even when there are none.
  if (r.kind === "union") return [8 + 8 * wordsOf(typing, t as UnionType, memo), 8];
  if (r.kind === "interior" && !isLock(r)) return size(typing, r.of, memo);
  const lockSize: [usize, usize] = [4, 4];
  const baseTypes: Type[] = r.kind === "class" && r.base !== undefined ? [r.base] : [];
  const fields: Field[] = r.kind === "interior" ? [] : r.kind === "generator" || r.kind === "future" ? r.frame : r.kind === "param" ? (r.bound !== undefined ? typing.rec(r.bound).fields : []) : r.fields;
  const parts: [usize, usize][] = r.kind === "interior" ? [lockSize, size(typing, r.of, memo)] : [...baseTypes, ...fields.map((f) => f.type)].map((p) => size(typing, p, memo));
  let align: usize = 1;
  for (const [, a] of parts) align = Math.max(align as f64, a as f64) as usize;
  let bytes: usize = 0;
  for (const [n, a] of parts) bytes = (Math.ceil((bytes as f64) / (a as f64)) as usize) * a + n;
  return [(Math.ceil((bytes as f64) / (align as f64)) as usize) * align, align];
}
