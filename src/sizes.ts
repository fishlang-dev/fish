import { isLock, integerInfo, isInteger, type Field, type Type, type UnionType, type Typing } from "./typing.ts";

// A type's size in bytes as it is laid out.
export const byteSize = (typing: Ref<Typing>, t: Type): usize => size(typing, t)[0];

// How many 64-bit words a union's payload takes: enough for its largest member.
export function words(typing: Ref<Typing>, t: UnionType): usize {
  let max: usize = 0;
  const members = typing.rec(t).members;
  for (const m of members) max = Math.max(max as f64, size(typing, m)[0] as f64) as usize;
  return Math.ceil((max as f64) / 8) as usize;
}

// A type's size and alignment in bytes, as LLVM lays out its IR type on the 64-bit targets
// Fish supports.
function size(typing: Ref<Typing>, t: Type): [usize, usize] {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  if (r?.kind === "brand") return size(typing, r.base);
  if (r?.kind === "array") return [24, 8];
  if (r?.kind === "fixed") {
    const [bytes, align] = size(typing, r.element);
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
  if (r.kind === "union") return [8 + 8 * words(typing, t as UnionType), 8];
  if (r.kind === "interior" && !isLock(r)) return size(typing, r.of);
  const lockSize: [usize, usize] = [4, 4];
  const baseTypes: Type[] = r.kind === "class" && r.base !== undefined ? [r.base] : [];
  const fields: Field[] = r.kind === "interior" ? [] : r.kind === "generator" || r.kind === "future" ? r.frame : r.kind === "param" ? (r.bound !== undefined ? typing.rec(r.bound).fields : []) : r.fields;
  const parts: [usize, usize][] = r.kind === "interior" ? [lockSize, size(typing, r.of)] : [...baseTypes, ...fields.map((f) => f.type)].map((p) => size(typing, p));
  let align: usize = 1;
  for (const [, a] of parts) align = Math.max(align as f64, a as f64) as usize;
  let bytes: usize = 0;
  for (const [n, a] of parts) bytes = (Math.ceil((bytes as f64) / (a as f64)) as usize) * a + n;
  return [(Math.ceil((bytes as f64) / (align as f64)) as usize) * align, align];
}
