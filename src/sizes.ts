import { isLock, INTEGERS, isInteger, type Type, type UnionType, type Typing } from "./typing.ts";

// A type's size in bytes as it is laid out.
export const byteSize = (typing: Typing, t: Type): usize => size(typing, t)[0];

// How many 64-bit words a union's payload takes: enough for its largest member.
export function words(typing: Typing, t: UnionType): usize {
  return Math.ceil(Math.max(...typing.rec(t).members.map((m) => size(typing, m)[0])) / 8);
}

// A type's size and alignment in bytes, as LLVM lays out its IR type on the 64-bit targets
// Fish supports.
function size(typing: Typing, t: Type): [usize, usize] {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  if (r?.kind === "brand") return size(typing, r.base);
  if (r?.kind === "array") return [24, 8];
  if (r?.kind === "fixed") {
    const [bytes, align] = size(typing, r.element);
    return [Math.ceil(bytes / align) * align * r.size, align];
  }
  if (r?.kind === "dyn") return [16, 8];
  if (isInteger(t)) return [INTEGERS[t].bits / 8, INTEGERS[t].bits / 8];
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
  const parts = r.kind === "interior" ? [[4, 4] as [usize, usize], size(typing, r.of)] : [...(r.kind === "class" && r.base ? [r.base] : []), ...(r.kind === "generator" || r.kind === "future" ? r.frame : r.kind === "param" ? (r.bound ? typing.rec(r.bound).fields : []) : r.fields).map((f) => f.type)].map((p) => size(typing, p));
  const align = Math.max(1, ...parts.map(([, a]) => a));
  let bytes = 0;
  for (const [n, a] of parts) bytes = Math.ceil(bytes / a) * a + n;
  return [Math.ceil(bytes / align) * align, align];
}
