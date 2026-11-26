import type { Builder } from "./arithmetic.fsh";
import assert from "node:assert";
import { category, ofKind, typeofTest, type Kind, type Verdict } from "./narrow.fsh";
import type { Expr } from "./parser.fsh";
import { rustClassOf } from "./rust.fsh";
import { byteSize, placedParts, sizeOf, words } from "./sizes.fsh";
import type { Tables } from "./compilation.fsh";
import { idOf, integerInfo, isInteger, isLock, isNumeric, literalText, TypeMap, type ArrayType, type ClassType, type Field, type LiteralType, type ObjectType, type Type, type UnionType, type Typing } from "./typing.fsh";

// How each type is laid out in LLVM IR, and how a value moves between two types that hold it
// differently.

function primitive(t: string): string {
  if (t === "i8" || t === "u8") return "i8";
  if (t === "i16" || t === "u16") return "i16";
  if (t === "i32" || t === "u32") return "i32";
  if (t === "i64" || t === "u64" || t === "isize" || t === "usize") return "i64";
  if (t === "i128" || t === "u128") return "i128";
  if (t === "f32") return "float";
  if (t === "f64") return "double";
  if (t === "boolean") return "i1";
  if (t === "void") return "void";
  if (t === "null" || t === "never") return "{}";
  return "ptr";
}

// A type with a brand or a settled type parameter read through, without making any new type.
function settled(typing: Ref<Typing>, t: Type): Type {
  if (typeof t === "string") return t;
  const r = typing.rec(t);
  if (r.kind === "brand") return r.base;
  if (r.kind === "param" && r.concrete !== undefined && r.within !== true) return settled(typing, r.concrete);
  return t;
}

// A type's own part of its color, apart from the types inside it, and those types in order.
type Shape = { text: string; inner: Type[] };

function shapeOf(typing: Ref<Typing>, t: Type): Shape {
  if (typeof t === "string") return { text: t, inner: [] };
  const r = typing.rec(t);
  if (r.kind === "class") return r.generic !== undefined ? { text: `class ${r.generic.name}<>`, inner: [...r.generic.args] } : { text: `class ${r.name}`, inner: [] };
  if (r.kind === "object") return { text: `{${r.fields.map((f) => f.name).join(",")}}${r.tuple === true ? "t" : ""}`, inner: r.fields.map((f) => f.type) };
  if (r.kind === "union") return { text: "|", inner: [...r.members] };
  if (r.kind === "array") return { text: "[]", inner: [r.element] };
  if (r.kind === "fixed") return { text: `[${r.size}]`, inner: [r.element] };
  if (r.kind === "literal") return { text: typeof r.value === "string" ? JSON.stringify(r.value) : typeof r.value === "boolean" ? `${r.value}` : `${literalText(r.value)}n`, inner: [] };
  if (r.kind === "interior") return { text: `${r.which}<>`, inner: [r.of] };
  // Any other type is laid out as what it holds, as `layoutOf` reads it, so it is colored by that.
  const held: Ref<Field[]> = r.kind === "generator" || r.kind === "future" ? r.frame : r.fields;
  return { text: `${r.kind}(${held.map((f) => f.name).join(",")})`, inner: held.map((f) => f.type) };
}

// The color of every type `roots` reach, from only what each holds, so a type is colored the same
// whatever else the program has or the order its types were made in, which a name spelled from
// wherever a self-referring type was first met isn't. A type that reaches no cycle is hashed from
// its shape and its inner types' colors, however deep they go. The types of one cycle, each of
// which reaches every other, are refined together: first their shapes, then each round their inner
// types' colors from the round before, until a round splits them no further, which tells apart
// any two of them that differ. A color is two hashes, each scrambled and combined modulo a prime
// below 2^31, so the arithmetic stays exact in an i64 and in a double.
// `known` holds the colors of types already colored, and `signatures` the color of each cycle's
// type by what it holds, which a type made later and holding the same is colored as; the
// signatures this coloring finds are added to `found`.
function colored(typing: Ref<Typing>, roots: Ref<Type[]>, known: Ref<TypeMap<Type, [i64, i64]>>, signatures: Ref<Map<string, [i64, i64]>>, found: Mut<Map<string, [i64, i64]>>): TypeMap<Type, [i64, i64]> {
  let index = new TypeMap<Type, usize>();
  let types: Type[] = [];
  let shapes: Shape[] = [];
  let queue: Type[] = [];
  for (const t of roots) queue.push(unbranded(typing, t));
  while (queue.length > 0) {
    const t = queue.pop()!;
    if (typeof t === "string" || index.has(t)) continue;
    index.set(t, types.length);
    types.push(t);
    // A type colored already keeps its color, and nothing it reaches needs coloring again: it
    // can't reach a type made after it.
    if (known.has(t)) {
      shapes.push({ text: "", inner: [] });
      continue;
    }
    let shape = shapeOf(typing, t);
    // A brand is laid out as its base and held as one, so it is colored as its base.
    shape.inner = shape.inner.map((c) => unbranded(typing, c));
    for (const c of shape.inner) if (typeof c !== "string" && !index.has(c)) queue.push(c);
    shapes.push(shape);
  }
  // Each type's shape hashed once, and each inner type as its index, or as a primitive's place
  // among the primitives, below 0.
  let shapeA: i64[] = [];
  let shapeB: i64[] = [];
  let inner: i64[][] = [];
  let primitives: string[] = [];
  for (const x of shapes) {
    shapeA.push(hashed(x.text, 131, PRIME_A));
    shapeB.push(hashed(x.text, 137, PRIME_B));
    let edges: i64[] = [];
    for (const c of x.inner) edges.push(typeof c === "string" ? -1 - (primitiveAt(primitives, c) as i64) : (index.get(c)! as i64));
    inner.push(edges);
  }
  // A primitive's hash in each lane, worked out once.
  let primitiveA: i64[] = [];
  let primitiveB: i64[] = [];
  for (const p of primitives) {
    primitiveA.push(hashed(p, 131, PRIME_A));
    primitiveB.push(hashed(p, 137, PRIME_B));
  }
  let colorA: i64[] = [...shapeA];
  let colorB: i64[] = [...shapeB];
  for (let i: usize = 0; i < types.length; i++) {
    const was = known.get(types[i]!);
    if (was !== undefined) {
      colorA[i] = was![0];
      colorB[i] = was![1];
    }
  }
  // Types that are told apart by nothing they hold are one type to color, as codegen holds them
  // alike: a record with optional fields and its copy with them required, the one inside a cycle
  // and the other only reaching it, would otherwise be colored by two different methods.
  let groups = cyclesOf(inner);
  let kept: boolean[] = [];
  for (const t of types) kept.push(known.has(t));
  let reaches: boolean[] = [];
  for (let i: usize = 0; i < types.length; i++) reaches.push(false);
  for (const group of groups) {
    const cyclic = group.length > 1 || inner[group[0]!]!.includes(group[0]! as i64);
    let r = cyclic;
    for (const i of group) for (const c of inner[i]!) if (c >= 0 && reaches[c as usize]!) r = true;
    for (const i of group) reaches[i] = r && !kept[i]!;
  }
  // Types reaching no cycle are colored exactly first, from what they hold.
  for (const group of groups) {
    const i = group[0]!;
    if (group.length > 1 || reaches[i]! || kept[i]!) continue;
    const [x, y] = combined(shapeA[i]!, shapeB[i]!, inner[i]!, colorA, colorB, primitiveA, primitiveB, undefined, 1);
    const key = signatureOf(shapeA[i]!, shapeB[i]!, inner[i]!, colorA, colorB, primitiveA, primitiveB);
    const same = signatures.get(key);
    colorA[i] = same !== undefined ? same![0] : x;
    colorB[i] = same !== undefined ? same![1] : y;
  }
  // The rest are partitioned by what they hold until the partition splits no further.
  let cls: i64[] = [];
  let count: usize = 0;
  {
    let ids = new Map<string, i64>();
    for (let i: usize = 0; i < types.length; i++) {
      if (!reaches[i]!) {
        cls.push(-1);
        continue;
      }
      const key = `${shapeA[i]!}.${shapeB[i]!}.${inner[i]!.length}`;
      if (!ids.has(key)) ids.set(key, ids.size as i64);
      cls.push(ids.get(key)!);
    }
    count = ids.size;
  }
  for (;;) {
    let ids = new Map<string, i64>();
    let next: i64[] = [];
    for (let i: usize = 0; i < types.length; i++) {
      if (!reaches[i]!) {
        next.push(-1);
        continue;
      }
      let key = `${cls[i]!}`;
      for (const c of inner[i]!) key += c < 0 ? `,p${-1 - c}` : reaches[c as usize]! ? `,c${cls[c as usize]!}` : `,x${colorA[c as usize]!}.${colorB[c as usize]!}`;
      if (!ids.has(key)) ids.set(key, ids.size as i64);
      next.push(ids.get(key)!);
    }
    cls = next;
    if (ids.size === count) break;
    count = ids.size;
  }
  // Each class is colored through one of its types, the first met, which every edge then leads to.
  let first = new Map<i64, usize>();
  for (let i: usize = 0; i < types.length; i++) if (reaches[i]! && !first.has(cls[i]!)) first.set(cls[i]!, i);
  let merged: i64[][] = [];
  for (let i: usize = 0; i < types.length; i++) {
    let edges: i64[] = [];
    for (const c of inner[i]!) edges.push(c >= 0 && reaches[c as usize]! ? (first.get(cls[c as usize]!)! as i64) : c);
    merged.push(edges);
  }
  for (const group of cyclesOf(merged)) {
    const lead = group[0]!;
    if (!reaches[lead]!) continue;
    if (group.length === 1 && first.get(cls[lead]!) !== lead) continue;
    let member = new Set<i64>();
    for (const i of group) member.add(i as i64);
    const cyclic = group.length > 1 || merged[group[0]!]!.includes(group[0]! as i64);
    // Refinement stops a round after it splits the cycle's members no further, which its own
    // structure decides, whatever else the program holds.
    let classes: usize = 0;
    let settled = false;
    // ponytail: at most ROUNDS rounds, so two members of one cycle differing only deeper than that
    // would share a color, which `typeDefinitions` refuses; raise it if that ever happens.
    const rounds = cyclic ? (group.length + 1 < ROUNDS ? group.length + 1 : ROUNDS) : 1;
    for (let round: usize = 0; round < rounds && !settled; round++) {
      let nextA: i64[] = [];
      let nextB: i64[] = [];
      for (const i of group) {
        const [x, y] = combined(shapeA[i]!, shapeB[i]!, merged[i]!, colorA, colorB, primitiveA, primitiveB, cyclic ? member : undefined, cyclic ? 5 : 1);
        nextA.push(x);
        nextB.push(y);
      }
      for (let k: usize = 0; k < group.length; k++) {
        colorA[group[k]!] = nextA[k]!;
        colorB[group[k]!] = nextB[k]!;
      }
      if (cyclic) {
        let seen = new Set<string>();
        for (let k: usize = 0; k < group.length; k++) seen.add(`${nextA[k]!}.${nextB[k]!}`);
        if (seen.size === classes) settled = true;
        classes = seen.size;
      }
    }
  }
  for (let i: usize = 0; i < types.length; i++) {
    if (!reaches[i]!) continue;
    const lead = first.get(cls[i]!)!;
    colorA[i] = colorA[lead]!;
    colorB[i] = colorB[lead]!;
    // A type made later holding what this one holds is this one, colored the same.
    if (lead === i) found.set(signatureOf(shapeA[i]!, shapeB[i]!, merged[i]!, colorA, colorB, primitiveA, primitiveB), [colorA[i]!, colorB[i]!]);
  }
  let out = new TypeMap<Type, [i64, i64]>();
  for (let i: usize = 0; i < types.length; i++) {
    const pair: [i64, i64] = [colorA[i]!, colorB[i]!];
    out.set(types[i]!, pair);
  }
  for (const t of roots) {
    const base = unbranded(typing, t);
    if (typeof t !== "string" && base !== t && typeof base !== "string") {
      const c = out.get(base);
      if (c !== undefined) {
        const pair: [i64, i64] = [c![0], c![1]];
        out.set(t, pair);
      }
    }
  }
  return out;
}

// A type's color from its shape's hashes and its inner types' colors, in each lane; `member`
// marks the inner types of the same cycle, told from those outside it, and `end` closes the hash.
function combined(shapeA: i64, shapeB: i64, edges: Ref<i64[]>, colorA: Ref<i64[]>, colorB: Ref<i64[]>, primitiveA: Ref<i64[]>, primitiveB: Ref<i64[]>, member: Ref<Set<i64>> | undefined, end: i64): [i64, i64] {
  let x = shapeA;
  let y = shapeB;
  for (const c of edges) {
    const ca = c < 0 ? primitiveA[(-1 - c) as usize]! : colorA[c as usize]!;
    const cb = c < 0 ? primitiveB[(-1 - c) as usize]! : colorB[c as usize]!;
    const mark: i64 = c >= 0 && member !== undefined && member!.has(c) ? 3 : 7;
    x = (mixed(x, PRIME_A) * 131 + ca + mark) % PRIME_A;
    y = (mixed(y, PRIME_B) * 137 + cb + mark) % PRIME_B;
  }
  return [mixed((x * 131 + end) % PRIME_A, PRIME_A), mixed((y * 137 + end) % PRIME_B, PRIME_B)];
}

// What a type holds, by its shape and its inner types' colors, as a key.
function signatureOf(shapeA: i64, shapeB: i64, edges: Ref<i64[]>, colorA: Ref<i64[]>, colorB: Ref<i64[]>, primitiveA: Ref<i64[]>, primitiveB: Ref<i64[]>): string {
  let key = `${shapeA}.${shapeB}`;
  for (const c of edges) key += c < 0 ? `,${primitiveA[(-1 - c) as usize]!}` : `,${colorA[c as usize]!}.${colorB[c as usize]!}`;
  return key;
}

// A type with its brands taken off.
function unbranded(typing: Ref<Typing>, given: Type): Type {
  let t = given;
  for (;;) {
    if (typeof t === "string") return t;
    const r = typing.rec(t);
    if (r.kind !== "brand") return t;
    t = r.base;
  }
}

// The groups of nodes that reach one another, each a cycle or a node alone, those a group reaches
// first: Tarjan's algorithm, with its stack kept by hand rather than by recursion. A node's edges
// are its entries in `edges` at or above 0.
function cyclesOf(edges: Ref<i64[][]>): usize[][] {
  const n = edges.length;
  let order: i64[] = [];
  let low: usize[] = [];
  for (let i: usize = 0; i < n; i++) {
    order.push(-1);
    low.push(0);
  }
  let onStack: boolean[] = [];
  for (let i: usize = 0; i < n; i++) onStack.push(false);
  let stack: usize[] = [];
  let groups: usize[][] = [];
  let counter: usize = 0;
  for (let root: usize = 0; root < n; root++) {
    if (order[root]! >= 0) continue;
    // Each frame is a node and the next of its edges to follow.
    let frames: [usize, usize][] = [[root, 0]];
    order[root] = counter as i64;
    low[root] = counter;
    counter++;
    stack.push(root);
    onStack[root] = true;
    while (frames.length > 0) {
      const [v, next] = frames[frames.length - 1]!;
      const out: Ref<i64[]> = edges[v]!;
      if (next < out.length) {
        frames[frames.length - 1] = [v, next + 1];
        const e = out[next]!;
        if (e < 0) continue;
        const w = e as usize;
        if (order[w]! < 0) {
          order[w] = counter as i64;
          low[w] = counter;
          counter++;
          stack.push(w);
          onStack[w] = true;
          frames.push([w, 0]);
        } else if (onStack[w]! && (order[w]! as usize) < low[v]!) low[v] = order[w]! as usize;
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const [u, _n] = frames[frames.length - 1]!;
        if (low[v]! < low[u]!) low[u] = low[v]!;
      }
      if (low[v]! === (order[v]! as usize)) {
        let group: usize[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack[w] = false;
          group.push(w);
          if (w === v) break;
        }
        group.sort((a, b) => (a as i64) - (b as i64));
        groups.push(group);
      }
    }
  }
  return groups;
}

const ROUNDS: usize = 64;

// Where `name` is in `primitives`, added at the end when it isn't yet.
function primitiveAt(primitives: Mut<string[]>, name: string): usize {
  const at = primitives.indexOf(name);
  if (at >= 0) return at as usize;
  primitives.push(name);
  return primitives.length - 1;
}

const PRIME_A: i64 = 2147483647;
const PRIME_B: i64 = 2147483629;

// `x` below 2^31 scrambled, so that hashes combined from it don't cancel the way sums of powers
// do: two inner types swapped across levels would otherwise give the same color. Every step stays
// below 2^53, exact in a double, and the xors below 2^31, exact in JavaScript's 32-bit ones.
function mixed(x: i64, prime: i64): i64 {
  const y = ((x ^ (x >> 15)) * 1000003) % prime;
  return ((y ^ (y >> 13)) * 999983) % prime;
}

// A number below 2^31 in base 36, six digits wide.
function base36(n: i64): string {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  let rest = n;
  for (let i: usize = 0; i < 6; i++) {
    out = digits.charAt(rest % 36) + out;
    rest = (rest - (rest % 36)) / 36;
  }
  return out;
}

// A text's polynomial hash modulo `prime`, by its UTF-16 units.
function hashed(text: string, base: i64, prime: i64): i64 {
  let h: i64 = 0;
  for (let i: usize = 0; i < text.length; i++) h = (h * base + (text.charCodeAt(i) as i64) + 1) % prime;
  return h;
}

// The name of the named struct a value of `t` is held as, for a class, object or union, from the
// colors of the types it reaches; undefined for a type written out where it is used. A class is
// named by its name and type arguments, an object or union by its color.
function nameFrom(typing: Ref<Typing>, t: Type, colors: Ref<TypeMap<Type, [i64, i64]>>): string | undefined {
  if (typeof t === "string") return undefined;
  const r = typing.rec(t);
  const nameable = (r.kind === "class" && (r.base !== undefined || r.fields.length > 0) && rustClassOf(typing, t) === undefined) || (r.kind === "object" && r.fields.length > 0) || r.kind === "union";
  if (!nameable) return undefined;
  const color = colorText(colors, t);
  if (r.kind !== "class") return `%"<${r.kind === "union" ? "u" : "o"}.${color}>"`;
  // A type argument is shown by its name when it has one a reader knows, else by its color.
  const shown = (a: Type): string => {
    if (typeof a === "string") return a;
    const x = typing.rec(a);
    return x.kind === "class" && x.generic === undefined ? x.name : `#${colorText(colors, a)}`;
  };
  const text = r.generic !== undefined ? `${r.generic.name}<${r.generic.args.map((a) => shown(a)).join(",")}>` : r.name;
  // A class name holding a quote or a backslash would need escaping in the IR, so it takes its color.
  return /^[\w$.<>,:|\[\]{}=+#-]+$/.test(text) ? `%"<${text}>"` : `%"<c.${color}>"`;
}

// A color as a name writes it.
function colorText(colors: Ref<TypeMap<Type, [i64, i64]>>, t: Type): string {
  const c = colors.get(t);
  return c !== undefined ? `${base36(c![0])}${base36(c![1])}` : "";
}

// The name of the named struct a value of `t` is held as, for a type made after `structNames`,
// colored from the colors it kept.
export function typeName(typing: Ref<Typing>, t: Type): string | undefined {
  let found = new Map<string, [i64, i64]>();
  const colors = colored(typing, [t], typing.structColors, typing.structSignatures, found);
  return nameFrom(typing, t, colors);
}

// Every type's named struct, and the colors the names come from, made once for codegen to read.
export function structNames(typing: Ref<Typing>): { names: TypeMap<Type, string>; colors: TypeMap<Type, [i64, i64]>; signatures: Map<string, [i64, i64]> } {
  const ids = typing.typeIds();
  let signatures = new Map<string, [i64, i64]>();
  const colors = colored(typing, ids, new TypeMap<Type, [i64, i64]>(), new Map<string, [i64, i64]>(), signatures);
  let names = new TypeMap<Type, string>();
  for (const t of ids) {
    const n = nameFrom(typing, t, colors);
    if (n !== undefined) names.set(t, n);
  }
  return { names, colors, signatures };
}

// The definitions of the named structs `text` uses, each once and in name order, with those their
// own layouts use. A name two types with different layouts share would hold one of them where the
// other was meant, so it is an internal error.
// Each named struct type IR text uses, as `%"<...>"`, once, in the order first used: what
// `/%"<[^"]*>"/g` matches, found without the regex engine, which a module's size makes slow.
export function typeNamesIn(text: string): string[] {
  let out: string[] = [];
  let seen = new Set<string>();
  let at: i64 = 0;
  for (;;) {
    const start = text.indexOf('%"<', at);
    if (start < 0) break;
    const close = text.indexOf('"', start + 3);
    if (close < 0) break;
    if (text.charCodeAt((close - 1) as usize) === 62) {
      const name = text.slice(start, close + 1);
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
      at = close + 1;
    } else at = start + 1;
  }
  return out;
}

// Whether a code unit is one an unquoted IR name holds: a letter, a digit, `_`, `.`, `$` or `-`.
function nameUnit(c: u16): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 36 || c === 45;
}

// Every `@` name IR text uses, quoted names with their quotes, leaving out what string constants'
// bytes hold: what `/@("[^"]*"|[\w.$-]+)/g` matches over the text with each `x i8] c"..."` taken
// out, found without the regex engine.
export function atNamesIn(text: string): string[] {
  let out: string[] = [];
  let at: i64 = 0;
  let constant = text.indexOf('x i8] c"', 0);
  for (;;) {
    const sign = text.indexOf("@", at);
    if (sign < 0) break;
    if (constant >= 0 && constant < sign) {
      const close = text.indexOf('"', constant + 8);
      if (close < 0) break;
      if (close >= sign) {
        at = close + 1;
        constant = text.indexOf('x i8] c"', at);
        continue;
      }
      constant = text.indexOf('x i8] c"', close + 1);
      continue;
    }
    const name = nameAt(text, sign);
    if (name !== undefined) out.push(name);
    at = sign + 1 + (name !== undefined ? (name.length as i64) : 0);
  }
  return out;
}

// The name after the `@` at `sign`, quotes and all, if one is there.
export function nameAt(text: string, sign: i64): string | undefined {
  if (sign + 1 < (text.length as i64) && text.charCodeAt((sign + 1) as usize) === 34) {
    const close = text.indexOf('"', sign + 2);
    return close < 0 ? undefined : text.slice(sign + 1, close + 1);
  }
  let end = sign + 1;
  while (end < (text.length as i64) && nameUnit(text.charCodeAt(end as usize))) end++;
  return end > sign + 1 ? text.slice(sign + 1, end) : undefined;
}

// The first name after an `@` in `text`, as `/@("[^"]*"|[\w.$-]+)/` finds it.
export function firstNameIn(text: string): string | undefined {
  for (let sign = text.indexOf("@"); sign >= 0; sign = text.indexOf("@", sign + 1)) {
    const name = nameAt(text, sign);
    if (name !== undefined) return name;
  }
  return undefined;
}

export function typeDefinitions(typing: Ref<Typing>, texts: Ref<string[]>): string[] {
  const used = (s: string): string[] => typeNamesIn(s);
  // The first type given each name, and every later one, which must be laid out as the first is.
  let byName = new Map<string, Type>();
  let again: [string, Type][] = [];
  for (const t of typing.typeIds()) {
    const n = typing.structNames.get(t) ?? typeName(typing, t);
    if (n === undefined) continue;
    if (byName.has(n)) again.push([n, t]);
    else byName.set(n, t);
  }
  let wanted: string[] = [];
  for (const text of texts) for (const n of used(text)) wanted.push(n);
  let defs = new Map<string, string>();
  while (wanted.length > 0) {
    const n = wanted.pop()!;
    if (defs.has(n)) continue;
    const first = byName.get(n);
    assert(first !== undefined, `internal error: no type is named ${n}`);
    const body = layoutOf(typing, first!);
    defs.set(n, `${n} = type ${body}`);
    for (const m of used(body)) wanted.push(m);
  }
  // Each later type given a name the IR defines is checked once against the first's layout.
  for (const [m, t] of again) {
    if (!defs.has(m)) continue;
    const first = byName.get(m)!;
    const body = layoutOf(typing, first);
    assert(layoutOf(typing, t) === body, `internal error: types laid out differently share the name ${m}: '${typing.show(first)}' as ${body} and '${typing.show(t)}' as ${layoutOf(typing, t)}`);
  }
  return [...defs.keys()].toSorted().map((n) => defs.get(n)!);
}

// The LLVM type a value of `t` is held as: a class, object or union by the name its definition
// has, `typeName`, and anything else as it is laid out.
export function llvmOf(typing: Ref<Typing>, t: Type): string {
  if (typeof t === "string") return primitive(t);
  // Spelling a type walks all of it, so the names are made once, before codegen; a type codegen
  // makes is spelled when it is first asked for.
  const named = typing.structNames.get(t) ?? typeName(typing, t);
  if (named !== undefined) return named;
  return layoutOf(typing, t);
}

// How a value of `t` is laid out, as a named struct's definition writes it. An object is a struct
// of its fields, in their sorted order. An instance is a struct of the base it embeds, if any,
// then its own fields in declaration order. A union is its member's index, then enough 64-bit
// words for its largest member.
export function layoutOf(typing: Ref<Typing>, t: Type): string {
  if (typeof t === "string") return primitive(t);
  const r = typing.rec(t);
  if (r.kind === "brand") return llvmOf(typing, r.base);
  // A Rust type's handle is the pointer to its boxed value, the one field its class has.
  if (r.kind === "ref" || r.kind === "pointer" || r.kind === "handle" || r.kind === "shared" || r.kind === "block" || r.kind === "map" || r.kind === "regex" || r.kind === "recursive" || rustClassOf(typing, t) !== undefined) return "ptr";
  if (r.kind === "array") return ARRAY;
  if (r.kind === "fixed") return `[${r.size} x ${llvmOf(typing, r.element)}]`;
  if (r.kind === "dyn") return DYN;
  if (r.kind === "union") return `{ i32, [${words(typing, t as UnionType)} x i64] }`;
  // Atomic instructions need whole bytes, so an atomic boolean is a byte.
  if (r.kind === "interior") return isLock(r) ? `{ i32, ${llvmOf(typing, r.of)} }` : r.which === "Atomic" && settled(typing, r.of) === "boolean" ? "i8" : llvmOf(typing, r.of);
  let parts: string[] = [];
  if (r.kind === "class" && r.base !== undefined) parts.push(llvmOf(typing, r.base));
  const held: Ref<Field[]> = r.kind === "generator" || r.kind === "future" ? r.frame : r.fields;
  for (const f of held) parts.push(llvmOf(typing, f.type));
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}

// An array is its elements' buffer, its length and its capacity, in elements.
export const ARRAY = "{ ptr, i64, i64 }";
// A Dyn is a pointer to its value's block, then to its vtable.
export const DYN = "{ ptr, ptr }";

// What converting needs besides emitting: a slot in the function's entry block.
// `text` gives a pointer to a literal's string block, which lives for the whole program.
// `deep` compares two values of one type holding objects, arrays or instances, part by part.
// `inspect` gives the string `console.log` prints for a value laid out as Node lays one out.
// `tables` holds what checking recorded, the program's types among it. `operandOf` gives the value of an operand of a test,
// and `valueType` its type.
export interface Slots extends Builder {
  tables: Tables;
  // Each union member's scalar parts as `leavesOf` found them, asked for at every use.
  leaves: TypeMap<Type, Leaf[]>;
  // The block code is emitted into.
  block: string;
  text(this: Mut<this>, value: string): string;
  deep(this: Mut<this>, a: string, b: string, type: Type): string;
  inspect(this: Mut<this>, v: string, type: Type): string;
  operandOf(this: Mut<this>, x: Ref<Expr>, test: Ref<Expr>, guarded: boolean): string;
  valueType(this: Mut<this>, e: Ref<Expr>): Type;
}

// A scalar part of a value: the indices that reach it, for `extractvalue` and `insertvalue`, its
// LLVM type and its byte offset. A type whose parts can't each sit inside one 64-bit word, such as
// an i128, has the one leaf `UNSPLIT`.
export type Leaf = { path: string; ll: string; at: usize };
const UNSPLIT: Leaf = { path: "", ll: "", at: 0 };
const SCALARS = ["i1", "i8", "i16", "i32", "i64", "float", "double", "ptr"];

function scalarBytes(ll: string): usize {
  if (ll === "i1" || ll === "i8") return 1;
  if (ll === "i16") return 2;
  if (ll === "i32" || ll === "float") return 4;
  return 8;
}

function deeper(path: string, i: usize): string {
  return path === "" ? `${i}` : `${path}, ${i}`;
}

// Pushes the scalar parts of a `t` laid out at byte `at` onto `out`, giving false when one of them
// spans two words or isn't a scalar this splits.
function leavesInto(typing: Ref<Typing>, t: Type, at: usize, path: string, out: Mut<Leaf[]>): boolean {
  const ll = llvmOf(typing, t);
  if (SCALARS.includes(ll)) {
    if ((at % 8) + scalarBytes(ll) > 8) return false;
    out.push({ path, ll, at });
    return true;
  }
  if (ll === "{}") return true;
  if (ll === ARRAY) {
    out.push({ path: deeper(path, 0), ll: "ptr", at });
    out.push({ path: deeper(path, 1), ll: "i64", at: at + 8 });
    out.push({ path: deeper(path, 2), ll: "i64", at: at + 16 });
    return true;
  }
  if (ll === DYN) {
    out.push({ path: deeper(path, 0), ll: "ptr", at });
    out.push({ path: deeper(path, 1), ll: "ptr", at: at + 8 });
    return true;
  }
  if (typeof t === "string") return false;
  const r = typing.rec(t);
  if (r.kind === "brand") return leavesInto(typing, r.base, at, path, out);
  if (r.kind === "union") {
    if (at % 8 !== 0) return false;
    out.push({ path: deeper(path, 0), ll: "i32", at });
    const n = words(typing, t as UnionType);
    for (let k: usize = 0; k < n; k++) out.push({ path: `${deeper(path, 1)}, ${k}`, ll: "i64", at: at + 8 + 8 * k });
    return true;
  }
  if (r.kind === "fixed") {
    const [bytes, align] = sizeOf(typing, r.element);
    const stride = (Math.ceil((bytes as f64) / (align as f64)) as usize) * align;
    for (let i: usize = 0; i < r.size; i++) if (!leavesInto(typing, r.element, at + i * stride, deeper(path, i), out)) return false;
    return true;
  }
  if (r.kind === "interior" && !isLock(r)) return leavesInto(typing, r.of, at, path, out);
  if (!ll.startsWith("%") && !ll.startsWith("{")) return false;
  const parts = placedParts(typing, t);
  for (let i: usize = 0; i < parts.length; i++) if (!leavesInto(typing, parts[i]!.type, at + parts[i]!.offset, deeper(path, i), out)) return false;
  return true;
}

// The scalar parts of a `t`, or `[UNSPLIT]`.
export function leavesOf(typing: Ref<Typing>, t: Type): Leaf[] {
  let out: Leaf[] = [];
  return leavesInto(typing, t, 0, "", out) ? out : [UNSPLIT.clone()];
}

// Up to how many scalar parts a member is moved into and out of a union word by word, with no
// slot; a larger one goes through a slot, which takes fewer lines.
function splitLimit(): usize {
  return (parseInt(process.env.FISH_SPLIT_LIMIT ?? "4") ?? 4) as usize;
}

// Whether values of a type compare part by part rather than as one word.
export const compound = (typing: Ref<Typing>, t: Type): boolean => typeof t !== "string" && ["object", "class", "array", "fixed", "recursive", "variant"].includes(typing.kindOf(t));

// Which members of a union a test asks for: those of a kind (`instanceof Map`), of a `typeof`
// category, having the key a narrowing test named, holding a value, or giving a type.
export type Wanted =
  | { by: "kind"; kind: Kind }
  | { by: "category"; name: string }
  | { by: "key"; test: usize }
  | { by: "present" }
  | { by: "gives"; type: Type; unknown: boolean };

// A branch per member of a union, each giving its result to the `phi` where the branches join:
// `incoming` holds each value with the block it comes from, the switch's own block first, for
// a tag no case takes.
export type Branch = { incoming: string[]; cases: string[]; end: string; members: Type[] };

// The operand a kind test looks at.
function testedOf(e: Ref<Expr>): Ref<Expr> {
  if (e.kind === "call") return e.args[0]!;
  if (e.kind === "binary") return e.left;
  return e;
}

export const textOf = (e: Ref<Expr>): string => (e.kind === "string" ? e.value : "");

// A literal type's value as text, or undefined for any other type.
function literalOf(typing: Ref<Typing>, t: Type): string | undefined {
  if (typeof t === "string") return undefined;
  const r = typing.rec(t);
  return r.kind === "literal" ? literalText(r.value) : undefined;
}

// A literal type's base type, or the type itself.
function baseOf(typing: Ref<Typing>, t: Type): Type {
  if (literalOf(typing, t) === undefined) return t;
  return typing.baseOf(t as LiteralType);
}

export class Conversions<H extends Slots> {
  host: Mut<H>;

  constructor(host: Mut<H>) {
    this.host = host;
  }

  ll(t: Type): string {
    return llvmOf(this.host.tables.typing, t);
  }

  // A union's members, or none for any other type.
  membersOf(t: Type): Type[] {
    let out: Type[] = [];
    if (typeof t === "string") return out;
    const r = this.host.tables.typing.rec(t);
    if (r.kind === "union") for (const m of r.members) out.push(m);
    return out;
  }

  isUnion(t: Type): boolean {
    return typeof t !== "string" && this.host.tables.typing.kindOf(t) === "union";
  }

  // What a reference points to or a recursive type's block holds, or undefined.
  heldIn(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "ref" ? r.to : r.kind === "recursive" ? r.of : undefined;
  }

  // What a recursive type's block holds, or undefined.
  blockOf(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "recursive" ? r.of : undefined;
  }

  // What a reference points to, or undefined.
  refTo(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "ref" ? r.to : undefined;
  }

  verdict(test: usize, m: Type): Verdict {
    return this.host.tables.keyTests.getById(test)!.get(m)!;
  }

  wants(this: Mut<this>, w: Ref<Wanted>, m: Type): boolean {
    if (w.by === "kind") return ofKind(this.host.tables.typing, m, w.kind);
    if (w.by === "category") return category(this.host.tables.typing, m) === w.name;
    if (w.by === "key") return this.verdict(w.test, m) === "yes";
    if (w.by === "present") return m !== "null";
    return w.unknown ? this.host.tables.typing.unknownGives(m, w.type) : this.host.tables.typing.fits(m, w.type);
  }

  // Lowers `typeof x === "name"`, `x instanceof Map` and `Array.isArray(x)`, or `x === v` with
  // x a union, to a check of x's tag, and of its payload when v isn't a literal. Undefined for
  // any other comparison. `guarded` says the test's left operand is kept from its right one.
  test(this: Mut<this>, e: Ref<Expr>, guarded: boolean): string | undefined {
    const instance = this.host.tables.kindTests.get(e);
    if (instance !== undefined) {
      const tested = testedOf(e);
      const type = this.host.valueType(tested);
      const v = this.host.operandOf(tested, e, guarded);
      return this.holdsWhere(v, type, { by: "kind", kind: instance });
    }
    if (e.kind !== "binary") return undefined;
    if (this.host.tables.keyTests.has(e)) {
      const v = this.host.operandOf(e.right, e, guarded);
      const type = this.host.valueType(e.right);
      return this.hasKey(v, type, e.id, textOf(e.left));
    }
    if (e.op === "instanceof") {
      const type = this.host.valueType(e.left);
      const c = this.host.valueType(e.right);
      const v = this.host.operandOf(e.left, e, guarded);
      if (!this.isUnion(type)) return String(this.host.tables.typing.isSubclass(type, c));
      let sub: Type[] = [];
      for (const m of this.membersOf(type)) if (this.host.tables.typing.isSubclass(m, c)) sub.push(m);
      return this.holds(v, type as UnionType, sub);
    }
    if (e.op !== "===" && e.op !== "!==") return undefined;
    const kind = typeofTest(e);
    let result: string;
    if (kind !== undefined) {
      const v = this.host.operandOf(kind.operand, e, guarded);
      const type = this.host.valueType(kind.operand);
      const name = textOf(kind.name);
      const to = this.refTo(type);
      const through = to !== undefined && this.host.tables.typing.isPlainJs(to);
      if (this.host.tables.typing.isPlainJs(type) || through) {
        const box = through ? this.host.temp() : v;
        const found = this.host.temp();
        if (through) this.host.emit(`${box} = load ptr, ptr ${v}`);
        const text = this.host.text(name);
        this.host.emit(`${found} = call i32 @fsh_rt_js_typeof(ptr ${box}, ptr ${text})`);
        result = this.host.temp();
        this.host.emit(`${result} = icmp ne i32 ${found}, 0`);
      } else result = this.holdsWhere(v, type, { by: "category", name });
    } else {
      const left = this.host.valueType(e.left);
      const right = this.host.valueType(e.right);
      if (!this.isUnion(left) && !this.isUnion(right)) return undefined;
      const u = this.host.operandOf(e.left, e, guarded);
      const o = this.host.operandOf(e.right, e, guarded);
      result = this.equals(u, left, o, right);
    }
    if (e.op === "===") return result;
    const negated = this.host.temp();
    this.host.emit(`${negated} = xor i1 ${result}, true`);
    return negated;
  }

  // Whether `v` has `key`, by the member it holds; a member whose `key` is optional has it when
  // the field holds a value, as Fish can't tell one left out from one set empty. `test` is the
  // narrowing test whose verdicts on each member the checker recorded.
  hasKey(this: Mut<this>, v: string, type: Type, test: usize, key: string): string {
    const inner = this.heldIn(type);
    if (inner !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(inner)}, ptr ${v}`);
      return this.hasKey(loaded, inner, test, key);
    }
    if (this.isUnion(type)) {
      let both = false;
      for (const m of this.membersOf(type)) if (this.verdict(test, m) === "both") both = true;
      if (!both) return this.holdsWhere(v, type, { by: "key", test });
      let b = this.branch(v, type as UnionType, "boolean");
      for (let i: usize = 0; i < b.members.length; i++) {
        const part = this.arm(b, i, v, type as UnionType);
        const made = this.hasKey(part, b.members[i]!, test, key);
        this.armDone(b, "boolean", made);
      }
      return this.joined(b, "boolean");
    }
    const verdict = this.verdict(test, type);
    if (verdict !== "both") return String(verdict === "yes");
    const holder = type as ObjectType | ClassType;
    const field = this.host.tables.typing.field(holder, key)!.type;
    const read = this.host.temp();
    const path = this.host.tables.typing.fieldPath(holder, key).join(", ");
    this.host.emit(`${read} = extractvalue ${this.ll(type)} ${v}, ${path}`);
    return this.holdsWhere(read, field, { by: "present" });
  }

  // Whether two values are equal, as JavaScript's `===` would find them. A union is compared
  // by the member it holds, so only that member's payload is read; literals compare by value,
  // so two enum members that share a value are equal.
  equals(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string {
    // A member that holds itself is compared as what its block holds, unless both sides are it.
    const aBlock = this.blockOf(aType);
    if (aBlock !== undefined && aType !== bType) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(aBlock)}, ptr ${a}`);
      return this.equals(loaded, aBlock, b, bType);
    }
    if (this.blockOf(bType) !== undefined && aType !== bType) return this.equals(b, bType, a, aType);
    const bBase = baseOf(this.host.tables.typing, bType);
    if (this.isUnion(aType)) {
      // An unknown holds JavaScript's numbers, which are equal across the kinds Fish has.
      const unknown = this.host.tables.typing.rec(aType as UnionType).unknown === true;
      const other = literalOf(this.host.tables.typing, bType) ?? b;
      // Two values of one union are equal when they hold the same member, equal as that member.
      if (!unknown && aType === bType && this.apart(aType as UnionType)) return this.sameMember(a, b, aType as UnionType);
      const byTag = unknown ? undefined : this.tagsEqual(aType as UnionType, bType);
      if (byTag !== undefined) {
        if (byTag.length === 0) return "false";
        const tag = this.host.temp();
        this.host.emit(`${tag} = extractvalue ${this.ll(aType)} ${a}, 0`);
        let result = "";
        for (const i of byTag) {
          const same = this.host.temp();
          this.host.emit(`${same} = icmp eq i32 ${tag}, ${i}`);
          if (result === "") result = same;
          else {
            const either = this.host.temp();
            this.host.emit(`${either} = or i1 ${result}, ${same}`);
            result = either;
          }
        }
        return result;
      }
      let u = this.branch(a, aType as UnionType, "boolean");
      for (let i: usize = 0; i < u.members.length; i++) {
        const m = u.members[i]!;
        const part = this.arm(u, i, a, aType as UnionType);
        const numbers = unknown && isNumeric(m) && isNumeric(bBase) && m !== bBase;
        const made = numbers ? this.sameNumber(part, m, other, bBase) : this.equals(part, m, b, bType);
        this.armDone(u, "boolean", made);
      }
      return this.joined(u, "boolean");
    }
    if (this.isUnion(bType)) return this.equals(b, bType, a, aType);
    // A reference held in a value is compared through, as a reference on its own is.
    const aTo = this.refTo(aType);
    if (aTo !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(aTo)}, ptr ${a}`);
      return this.equals(loaded, aTo, b, bType);
    }
    if (this.refTo(bType) !== undefined) return this.equals(b, bType, a, aType);
    const aLiteral = literalOf(this.host.tables.typing, aType);
    const bLiteral = literalOf(this.host.tables.typing, bType);
    if (aLiteral !== undefined && bLiteral !== undefined) return String(this.sameLiteral(aType, bType));
    const aBase = baseOf(this.host.tables.typing, aType);
    if (aBase === bBase && compound(this.host.tables.typing, aType)) return this.host.deep(a, b, aType);
    if (aBase !== bBase || typeof aBase !== "string") return "false";
    if (aBase === "null") return "true";
    if (aBase === "bigint") {
      const same = this.host.temp();
      this.host.emit(`${same} = call i1 @fsh_rt_big_equal(ptr ${a}, ptr ${b})`);
      return same;
    }
    if (aBase === "string") {
      const order = this.host.temp();
      const left = this.convert(a, aType, "string");
      const right = this.convert(b, bType, "string");
      this.host.emit(`${order} = call i32 @fsh_rt_str_compare(ptr ${left}, ptr ${right})`);
      const same = this.host.temp();
      this.host.emit(`${same} = icmp eq i32 ${order}, 0`);
      return same;
    }
    const result = this.host.temp();
    const float = aBase === "f32" || aBase === "f64";
    this.host.emit(`${result} = ${float ? "fcmp oeq" : "icmp eq"} ${this.ll(aBase)} ${aLiteral ?? a}, ${bLiteral ?? b}`);
    return result;
  }

  // Whether no value of one member of `union` can equal a value of another: no two literals hold
  // one value, and no literal's base type is a member too.
  apart(u: UnionType): boolean {
    const members = this.membersOf(u);
    let seen: string[] = [];
    for (const m of members) {
      const text = literalOf(this.host.tables.typing, m);
      if (text === undefined) continue;
      if (seen.includes(text) || members.includes(baseOf(this.host.tables.typing, m))) return false;
      seen.push(text);
    }
    return true;
  }

  // Whether two values of `union` hold the same member and are equal as it. The payloads are read
  // only once the tags agree, as a member's payload words mean nothing as another member's.
  sameMember(this: Mut<this>, a: string, b: string, union: UnionType): string {
    const [ta, tb, same] = [this.host.temp(), this.host.temp(), this.host.temp()];
    this.host.emit(`${ta} = extractvalue ${this.ll(union)} ${a}, 0`);
    this.host.emit(`${tb} = extractvalue ${this.ll(union)} ${b}, 0`);
    this.host.emit(`${same} = icmp eq i32 ${ta}, ${tb}`);
    const [parts, differ, end] = [this.host.label(), this.host.label(), this.host.label()];
    this.host.emit(`br i1 ${same}, label %${parts}, label %${differ}`);
    this.host.startBlock(parts);
    let u = this.branch(a, union, "boolean");
    for (let i: usize = 0; i < u.members.length; i++) {
      const m = u.members[i]!;
      this.host.startBlock(u.cases[i]!);
      if (this.kindOf(m) === "literal" || this.ll(m) === "{}") {
        this.armDone(u, "boolean", "true");
        continue;
      }
      const pa = this.payload(a, union, m);
      const pb = this.payload(b, union, m);
      const made = this.equals(pa, m, pb, m);
      this.armDone(u, "boolean", made);
    }
    const found = this.joined(u, "boolean");
    const foundIn = this.host.block;
    this.host.emit(`br label %${end}`);
    this.host.startBlock(differ);
    this.host.emit(`br label %${end}`);
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = phi i1 [ ${found}, %${foundIn} ], [ false, %${differ} ]`);
    return out;
  }

  // When a union's members are all literals or null, compared with a literal `b`: the indices of
  // the members equal to it, so the tag alone decides. Undefined otherwise.
  tagsEqual(u: UnionType, b: Type): usize[] | undefined {
    const empty = b === "null";
    if (!empty && literalOf(this.host.tables.typing, b) === undefined) return undefined;
    let out: usize[] = [];
    const members = this.membersOf(u);
    for (let i: usize = 0; i < members.length; i++) {
      const m = members[i]!;
      if (m === "null") {
        if (empty) out.push(i);
        continue;
      }
      // Compared with null, a value of any of these kinds is never equal.
      if (empty && (typeof m === "string" || ["object", "class", "array", "literal", "fixed", "map", "dyn"].includes(this.kindOf(m)))) continue;
      if (empty || literalOf(this.host.tables.typing, m) === undefined) return undefined;
      if (this.sameLiteral(m, b)) out.push(i);
    }
    return out;
  }

  // Whether two literal types hold one value.
  sameLiteral(a: Type, b: Type): boolean {
    const x = this.host.tables.typing.rec(a as LiteralType);
    const y = this.host.tables.typing.rec(b as LiteralType);
    return x.value === y.value;
  }

  // A field every member of the union has, read from whichever member it holds.
  unionField(this: Mut<this>, v: string, union: UnionType, name: string, to: Type): string {
    let b = this.branch(v, union, to);
    for (let i: usize = 0; i < b.members.length; i++) {
      const member = b.members[i]!;
      if (this.blockOf(member) === undefined) {
        this.host.startBlock(b.cases[i]!);
        const read = this.fieldInPayload(v, union, member, name);
        if (read !== undefined) {
          const made = this.convert(read, this.host.tables.typing.field(member as ObjectType | ClassType, name)!.type, to);
          this.armDone(b, to, made);
          continue;
        }
        const part = this.payload(v, union, member);
        const made = this.memberField(part, member, name, to);
        this.armDone(b, to, made);
        continue;
      }
      const part = this.arm(b, i, v, union);
      const made = this.memberField(part, member, name, to);
      this.armDone(b, to, made);
    }
    return this.joined(b, to);
  }

  // A field of the object or instance a union holds, read from the payload words it sits in
  // without the rest of the member, or undefined when its parts can't be read word by word.
  fieldInPayload(this: Mut<this>, v: string, union: UnionType, member: Type, name: string): string | undefined {
    const holder = member as ObjectType | ClassType;
    const type = this.host.tables.typing.field(holder, name)!.type;
    if (this.kindOf(type) === "literal" || this.ll(type) === "{}") return "zeroinitializer";
    let at: usize = 0;
    let within: Type = member;
    for (const i of this.host.tables.typing.fieldPath(holder, name)) {
      const parts = placedParts(this.host.tables.typing, within);
      at += parts[i as usize]!.offset;
      within = parts[i as usize]!.type;
    }
    const leaves = this.leaves(type);
    if (!this.split(leaves)) return undefined;
    for (const leaf of leaves) if (((leaf.at + at) % 8) + scalarBytes(leaf.ll) > 8) return undefined;
    return this.readWords(v, union, type, leaves, at);
  }

  memberField(this: Mut<this>, part: string, member: Type, name: string, to: Type): string {
    // A member holding the union again keeps its value in a block.
    const of = this.blockOf(member);
    if (of !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(of)}, ptr ${part}`);
      if (this.isUnion(of)) return this.unionField(loaded, of as UnionType, name, to);
      part = loaded;
      member = of;
    }
    // The checker found the field on every member, so each is an object or an instance.
    const holder = member as ObjectType | ClassType;
    const value = this.host.temp();
    const path = this.host.tables.typing.fieldPath(holder, name).join(", ");
    this.host.emit(`${value} = extractvalue ${this.ll(member)} ${part}, ${path}`);
    const type = this.host.tables.typing.field(holder, name)!.type;
    return this.convert(value, type, to);
  }

  // Starts a value of `to` made from whichever member the union holds, branching on its tag.
  // The caller makes each member's value between `arm` and `armDone`, then reads it with
  // `joined`. This also reads an enum, a union of integer literals, as an i64.
  branch(this: Mut<this>, v: string, union: UnionType, _to: Type): Branch {
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(union)} ${v}, 0`);
    const members = this.membersOf(union);
    let cases: string[] = [];
    for (let i: usize = 0; i < members.length; i++) cases.push(this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${cases.map((c, i) => `i32 ${i}, label %${c}`).join(" ")} ]`);
    return { incoming: [`[ undef, %${this.host.block} ]`], cases, end, members };
  }

  // Enters the branch for member `i`, giving that member's payload.
  arm(this: Mut<this>, b: Ref<Branch>, i: usize, v: string, union: UnionType): string {
    this.host.startBlock(b.cases[i]!);
    return this.payload(v, union, b.members[i]!);
  }

  armDone(this: Mut<this>, b: Mut<Branch>, _to: Type, value: string): void {
    b.incoming.push(`[ ${value}, %${this.host.block} ]`);
    this.host.emit(`br label %${b.end}`);
  }

  joined(this: Mut<this>, b: Ref<Branch>, to: Type): string {
    this.host.startBlock(b.end);
    const out = this.host.temp();
    this.host.emit(`${out} = phi ${this.ll(to)} ${b.incoming.join(", ")}`);
    return out;
  }

  // A value of `to` read from an unknown that narrowing has shown holds a member giving one. A
  // number read as JavaScript's `number` is converted to an f64.
  fromUnknown(this: Mut<this>, v: string, from: UnionType, to: Type): string {
    const members = this.membersOf(from);
    let held: Type[] = [];
    for (const m of members) if (this.host.tables.typing.unknownGives(m, to)) held.push(m);
    if (held.length === 1 && held[0] === to) return this.payload(v, from, to);
    const result = this.host.alloca(this.ll(to));
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(from)} ${v}, 0`);
    let cases: string[] = [];
    for (let i: usize = 0; i < held.length; i++) cases.push(this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i as usize]}`).join(" ")} ]`);
    for (let i: usize = 0; i < held.length; i++) {
      const member = held[i]!;
      this.host.startBlock(cases[i]!);
      const part = this.payload(v, from, member);
      const kept = this.isUnion(to) && this.host.tables.typing.membersFor(member, to as UnionType).length > 0;
      const number = isNumeric(member) && member !== "f64" && !kept;
      let made: string;
      if (number) {
        const double = this.asDouble(part, member);
        made = this.convert(double, "f64", to);
      } else made = this.convert(part, member, to);
      this.host.emit(`store ${this.ll(to)} ${made}, ptr ${result}`);
      this.host.emit(`br label %${end}`);
    }
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = load ${this.ll(to)}, ptr ${result}`);
    return out;
  }

  // Two numbers of different kinds, equal by value: integers exactly, as i128, and through f64
  // only when one is a float, as codegen's mixed comparisons do.
  // ponytail: a u128 beside a signed type compares as i128, wrong past i128's range.
  sameNumber(this: Mut<this>, a: string, aType: Type, b: string, bType: Type): string {
    const result = this.host.temp();
    if (isInteger(aType) && isInteger(bType)) {
      const left = this.wide(a, aType);
      const right = this.wide(b, bType);
      this.host.emit(`${result} = icmp eq i128 ${left}, ${right}`);
    } else {
      const left = this.asDouble(a, aType);
      const right = this.asDouble(b, bType);
      this.host.emit(`${result} = fcmp oeq double ${left}, ${right}`);
    }
    return result;
  }

  wide(this: Mut<this>, v: string, from: Type): string {
    if (from === "i128" || from === "u128") return v;
    const result = this.host.temp();
    const signed = isInteger(from) && integerInfo(from).signed;
    this.host.emit(`${result} = ${signed ? "sext" : "zext"} ${this.ll(from)} ${v} to i128`);
    return result;
  }

  asDouble(this: Mut<this>, v: string, from: Type): string {
    if (from === "f64") return v;
    const result = this.host.temp();
    if (from === "f32") this.host.emit(`${result} = fpext float ${v} to double`);
    else {
      const signed = isInteger(from) && integerInfo(from).signed;
      this.host.emit(`${result} = ${signed ? "sitofp" : "uitofp"} ${this.ll(from)} ${v} to double`);
    }
    return result;
  }

  // Whether a member holds itself with members `w` answers differently for, so its block has
  // to be looked into.
  mixed(this: Mut<this>, m: Type, w: Ref<Wanted>): boolean {
    const inner = this.host.tables.typing.unfold(m);
    if (inner === m || !this.isUnion(inner)) return false;
    let yes = false;
    let no = false;
    for (const x of this.membersOf(inner)) {
      if (this.wants(w, x)) yes = true;
      else no = true;
    }
    return yes && no;
  }

  // Whether `v` holds a member `wanted` says yes to, looking into the block of a member that
  // holds itself, whose own members may answer differently.
  holdsWhere(this: Mut<this>, v: string, type: Type, wanted: Ref<Wanted>): string {
    const block = this.blockOf(type);
    if (block !== undefined) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(block)}, ptr ${v}`);
      return this.holdsWhere(loaded, block, wanted);
    }
    if (!this.isUnion(type)) return String(this.wants(wanted, type));
    const members = this.membersOf(type);
    let nested: Type[] = [];
    let plain: Type[] = [];
    for (const m of members) {
      if (this.mixed(m, wanted)) nested.push(m);
      else if (this.wants(wanted, m)) plain.push(m);
    }
    const direct = this.holds(v, type as UnionType, plain);
    if (nested.length === 0) return direct;
    const result = this.host.alloca("i1");
    this.host.emit(`store i1 ${direct}, ptr ${result}`);
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(type)} ${v}, 0`);
    const done = this.host.label();
    for (const m of nested) {
      const is = this.host.temp();
      const inside = this.host.label();
      const next = this.host.label();
      this.host.emit(`${is} = icmp eq i32 ${tag}, ${members.indexOf(m)}`);
      this.host.emit(`br i1 ${is}, label %${inside}, label %${next}`);
      this.host.startBlock(inside);
      const part = this.payload(v, type as UnionType, m);
      const held = this.holdsWhere(part, m, wanted);
      this.host.emit(`store i1 ${held}, ptr ${result}`);
      this.host.emit(`br label %${done}`);
      this.host.startBlock(next);
    }
    this.host.emit(`br label %${done}`);
    this.host.startBlock(done);
    const answer = this.host.temp();
    this.host.emit(`${answer} = load i1, ptr ${result}`);
    return answer;
  }

  // Whether a union holds one of these members.
  holds(this: Mut<this>, v: string, union: UnionType, members: Ref<Type[]>): string {
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(union)} ${v}, 0`);
    let result = "false";
    const all = this.membersOf(union);
    for (const m of members) {
      const is = this.host.temp();
      const next = this.host.temp();
      this.host.emit(`${is} = icmp eq i32 ${tag}, ${all.indexOf(m)}`);
      this.host.emit(`${next} = or i1 ${result}, ${is}`);
      result = next;
    }
    return result;
  }

  // Whether a union holds `t` as one of its members.
  within(t: Type, u: Type): boolean {
    return this.membersOf(u).includes(t);
  }

  isJsValue(t: Type): boolean {
    if (typeof t === "string") return false;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "block" && r.which === "JsValue";
  }

  kindOf(t: Type): string {
    return typeof t === "string" ? "" : this.host.tables.typing.kindOf(t);
  }

  // A member of another kind than the narrowed type, an empty one or a scalar where an
  // aggregate is wanted, is one narrowing has left out, so it isn't there.
  // So is a string or boolean literal where the narrowed type is of another kind.
  absent(member: Type, to: Type): boolean {
    if (typeof member !== "string") {
      const lit = this.host.tables.typing.rec(member);
      if (lit.kind === "literal") return (typeof lit.value === "string" && to !== "string") || (typeof lit.value === "boolean" && to !== "boolean");
      return false;
    }
    return member !== to && (member === "null" || member === "never" || typeof to !== "string" || (member === "string") !== (to === "string") || (member === "boolean") !== (to === "boolean"));
  }

  // `v`, a value of `from`, as a value of `to`: copied down to fewer fields, built into a class,
  // put into a union, taken out of one, or moved between unions. The checker has made sure
  // `from` fits `to`, through exactly one member when `to` is a union.
  convert(this: Mut<this>, v: string, from: Type, to: Type): string {
    // Types that lower to the same one, as a field's type written with `?` and the type read from
    // it do, are laid out the same.
    if (from === to) return v;
    const lowFrom = this.host.tables.typing.lower(from);
    const lowTo = this.host.tables.typing.lower(to);
    if (lowFrom === lowTo) return v;
    // A recursive type's value lives in its block: read where another type is wanted, it is
    // loaded, and a value meeting one moves into a new block.
    // A union holding the block itself takes it, or gives it, as is.
    const fromBlock = this.blockOf(from);
    if (fromBlock !== undefined && !this.within(from, to)) {
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(fromBlock)}, ptr ${v}`);
      return this.convert(loaded, fromBlock, to);
    }
    const toBlock = this.blockOf(to);
    if (toBlock !== undefined && !this.within(to, from)) {
      const block = this.host.temp();
      this.host.emit(`${block} = call ptr @fsh_rt_alloc(i64 ${byteSize(this.host.tables.typing, toBlock)})`);
      const inner = this.convert(v, from, toBlock);
      this.host.emit(`store ${this.ll(toBlock)} ${inner}, ptr ${block}`);
      return block;
    }
    const fk = this.kindOf(from);
    const tk = this.kindOf(to);
    // Raw pointers are addresses, whatever they point at or may write.
    if (fk === "pointer" && tk === "pointer") return v;
    // Every regex is a pointer to its program.
    if (fk === "regex" && tk === "regex") return v;
    // Stored callables taking and giving the same types share a layout and a vtable shape.
    if (fk === "dyn" && tk === "dyn") return v;
    // A string literal's type takes no space; as a string, it is its static block.
    const literal = literalOf(this.host.tables.typing, from);
    if (to === "string" && literal !== undefined) return this.host.text(literal);
    // Code holding a `never` value never runs.
    if (from === "never") return "undef";
    // A JS value is the same box whichever declared shape it meets.
    if (this.isJsValue(from) && this.isJsValue(to)) return v;
    // An empty array literal holds no element to convert, and an array of JS values holds the
    // same boxes whichever shape each is declared to have.
    if (fk === "array" && tk === "array") {
      const fromElement = this.host.tables.typing.rec(from as ArrayType).element;
      const toElement = this.host.tables.typing.rec(to as ArrayType).element;
      if (fromElement === "never" || (this.isJsValue(fromElement) && this.isJsValue(toElement))) return v;
    }
    // A reference read where its value is wanted loads it; a mutable one lent as shared is the
    // same pointer.
    // A reference going into a `Ref<T> | null` is its pointer, as the payload.
    const fromTo = this.refTo(from);
    if (fromTo !== undefined && this.host.tables.typing.optionRef(to) === undefined) {
      const toTo = this.refTo(to);
      if (toTo !== undefined) return this.lend(v, fromTo, toTo);
      const loaded = this.host.temp();
      this.host.emit(`${loaded} = load ${this.ll(fromTo)}, ptr ${v}`);
      return this.convert(loaded, fromTo, to);
    }
    // A literal's value is known, so leaving one makes a constant, and entering one keeps nothing.
    if (literal !== undefined && tk !== "union") return literal;
    if (tk === "literal") return "zeroinitializer";
    if (fk === "union" && this.host.tables.typing.rec(from as UnionType).unknown === true) return this.fromUnknown(v, from as UnionType, to);
    if (tk === "union") {
      return fk === "union" ? this.retag(v, from as UnionType, to as UnionType) : this.inject(v, from, to as UnionType);
    }
    if (fk === "union") {
      if (this.within(to, from)) return this.payload(v, from as UnionType, to);
      let b = this.branch(v, from as UnionType, to);
      for (let i: usize = 0; i < b.members.length; i++) {
        const member = b.members[i]!;
        // A member narrowing left out needs nothing of its payload.
        if (this.absent(member, to)) {
          this.host.startBlock(b.cases[i]!);
          const gone = "undef";
          this.armDone(b, to, gone);
          continue;
        }
        const part = this.arm(b, i, v, from as UnionType);
        const made = this.convert(part, member, to);
        this.armDone(b, to, made);
      }
      return this.joined(b, to);
    }
    if (typeof from === "string" || typeof to === "string") return v;
    if (fk === "closure" || tk === "closure") return v;
    assert(fk !== "interface" && tk !== "interface" && fk !== "param" && tk !== "param" && fk !== "function" && tk !== "function", "internal error: an interface or a type parameter reached codegen");
    // A class built from a literal starts with its embedded base, built the same way.
    const target = to as ObjectType | ClassType;
    const embeds = this.baseClass(to);
    let result = "undef";
    if (embeds !== undefined) {
      const base = this.convert(v, from, embeds);
      result = this.inserted(result, to, base, embeds, 0);
    }
    const fields = this.fieldsOf(target);
    for (let i: usize = 0; i < fields.length; i++) {
      const name = fields[i]![0];
      const type = fields[i]![1];
      const at = i + (embeds !== undefined ? 1 : 0);
      // An optional field the value leaves out is empty.
      const given = this.host.tables.typing.field(from, name);
      if (given === undefined) {
        const empty = this.convert("zeroinitializer", "null", type);
        result = this.inserted(result, to, empty, type, at);
        continue;
      }
      const givenType = given.type;
      const part = this.host.temp();
      const path = this.host.tables.typing.fieldPath(from as ObjectType | ClassType, name).join(", ");
      this.host.emit(`${part} = extractvalue ${this.ll(from)} ${v}, ${path}`);
      const made = this.convert(part, givenType, type);
      result = this.inserted(result, to, made, type, at);
    }
    return result;
  }

  // The class a class embeds as its base, or undefined.
  baseClass(t: Type): Type | undefined {
    if (typeof t === "string") return undefined;
    const r = this.host.tables.typing.rec(t);
    return r.kind === "class" ? r.base : undefined;
  }

  // An object's or instance's own fields, each as its name and type.
  fieldsOf(t: ObjectType | ClassType): [string, Type][] {
    let out: [string, Type][] = [];
    const r = this.host.tables.typing.rec(t);
    for (const f of r.fields) out.push([f.name, f.type]);
    return out;
  }

  // `result` with `part`, a value of `type`, put in at field `i`.
  inserted(this: Mut<this>, result: string, to: Type, part: string, type: Type, i: usize): string {
    const next = this.host.temp();
    this.host.emit(`${next} = insertvalue ${this.ll(to)} ${result}, ${this.ll(type)} ${part}, ${i}`);
    return next;
  }

  // A pointer to a `from` lent as one to a `to`: the same pointer, its payload when `to` is
  // one member of the union `from`, or else a slot holding a copy converted to `to`.
  lend(this: Mut<this>, v: string, from: Type, to: Type): string {
    if (from === to) return v;
    // A reference to a place holding a recursive type's block lends the block itself.
    const of = this.blockOf(from);
    if (of !== undefined && to !== from) {
      const block = this.host.temp();
      this.host.emit(`${block} = load ptr, ptr ${v}`);
      return this.lend(block, of, to);
    }
    // An unknown narrowed to a number may hold another kind of number, converted on its way out.
    if (this.isUnion(from) && this.lendsPayload(from as UnionType, to)) {
      const at = this.host.temp();
      this.host.emit(`${at} = getelementptr ${this.ll(from)}, ptr ${v}, i32 0, i32 1`);
      return at;
    }
    const loaded = this.host.temp();
    this.host.emit(`${loaded} = load ${this.ll(from)}, ptr ${v}`);
    const slot = this.host.alloca(this.ll(to));
    const made = this.convert(loaded, from, to);
    this.host.emit(`store ${this.ll(to)} ${made}, ptr ${slot}`);
    return slot;
  }

  // Whether a union's payload is already a `to`: it holds `to`, or an object laid out alike,
  // and isn't an unknown holding another member that gives one.
  lendsPayload(this: Mut<this>, from: UnionType, to: Type): boolean {
    const members = this.membersOf(from);
    let holds = false;
    for (const m of members) {
      if (m === to || (this.kindOf(m) === "object" && this.alike(m, to, new Map<string, boolean>()))) {
        holds = true;
        break;
      }
    }
    if (!holds) return false;
    if (this.host.tables.typing.rec(from).unknown !== true) return true;
    for (const m of members) if (m !== to && this.host.tables.typing.unknownGives(m, to)) return false;
    return true;
  }

  // Whether two types are laid out alike: a union holding itself keeps its own records for
  // codegen, while a type narrowed to one of its members was lowered to fresh ones of the same
  // shape. A pair met again inside itself is taken as alike, and each pair is decided once.
  alike(a: Type, b: Type, seen: Mut<Map<string, boolean>>): boolean {
    if (a === b) return true;
    if (typeof a === "string" || typeof b === "string") return false;
    const ak = this.kindOf(a);
    if (ak !== this.kindOf(b)) return false;
    const pair = `${idOf(a)},${idOf(b)}`;
    const known = seen.get(pair);
    if (known !== undefined) return known;
    seen.set(pair, true);
    let same = false;
    if (ak === "recursive") same = this.alike(this.blockOf(a)!, this.blockOf(b)!, seen);
    else if (ak === "array") same = this.alike(this.host.tables.typing.rec(a as ArrayType).element, this.host.tables.typing.rec(b as ArrayType).element, seen);
    else if (ak === "union") {
      const xs = this.membersOf(a);
      const ys = this.membersOf(b);
      same = xs.length === ys.length;
      for (let i: usize = 0; same && i < xs.length; i++) same = this.alike(xs[i]!, ys[i]!, seen);
    } else if (ak === "object" && this.host.tables.typing.rec(a as ObjectType).tuple === this.host.tables.typing.rec(b as ObjectType).tuple) {
      const xs = this.fieldsOf(a as ObjectType);
      const ys = this.fieldsOf(b as ObjectType);
      same = xs.length === ys.length;
      for (let i: usize = 0; same && i < xs.length; i++) same = xs[i]![0] === ys[i]![0] && this.alike(xs[i]![1], ys[i]![1], seen);
    }
    seen.set(pair, same);
    return same;
  }

  // Sets the tag of the member `from` goes into, and stores its value as the payload.
  inject(this: Mut<this>, v: string, from: Type, to: UnionType): string {
    const found = this.host.tables.typing.membersFor(from, to);
    assert(found.length > 0, `internal error: '${this.host.tables.typing.show(from)}' has no member in '${this.host.tables.typing.show(to)}' to go into`);
    const member = found[0]!;
    const tag = this.membersOf(to).indexOf(member);
    const value = this.convert(v, from, member);
    // A member with no payload is a constant: its tag, then zero words.
    let result = `{ i32 ${tag}, [${words(this.host.tables.typing, to)} x i64] zeroinitializer }`;
    if (this.kindOf(member) === "literal" || this.ll(member) === "{}") return result;
    const leaves = this.leaves(member);
    if (this.split(leaves)) {
      // Each payload word is the parts that sit in it, shifted to their offsets and joined.
      let i: usize = 0;
      while (i < leaves.length) {
        const word = leaves[i]!.at / 8;
        let joined = "";
        for (; i < leaves.length && leaves[i]!.at / 8 === word; i++) {
          const leaf = leaves[i]!.clone();
          let part = value.clone();
          if (leaf.path !== "") {
            part = this.host.temp();
            this.host.emit(`${part} = extractvalue ${this.ll(member)} ${value}, ${leaf.path}`);
          }
          let bits = this.toWord(part, leaf.ll);
          if (leaf.at % 8 !== 0) {
            const shifted = this.host.temp();
            this.host.emit(`${shifted} = shl i64 ${bits}, ${(leaf.at % 8) * 8}`);
            bits = shifted;
          }
          if (joined === "") joined = bits;
          else {
            const both = this.host.temp();
            this.host.emit(`${both} = or i64 ${joined}, ${bits}`);
            joined = both;
          }
        }
        const next = this.host.temp();
        this.host.emit(`${next} = insertvalue ${this.ll(to)} ${result}, i64 ${joined}, 1, ${word}`);
        result = next;
      }
      return result;
    }
    const slot = this.host.alloca(this.ll(to));
    this.host.emit(`store i32 ${tag}, ptr ${slot}`);
    const at = this.host.temp();
    this.host.emit(`${at} = getelementptr ${this.ll(to)}, ptr ${slot}, i32 0, i32 1`);
    // The payload is i64 words, aligned to 8 however wide a member is.
    this.host.emit(`store ${this.ll(member)} ${value}, ptr ${at}, align 8`);
    const loaded = this.host.temp();
    this.host.emit(`${loaded} = load ${this.ll(to)}, ptr ${slot}`);
    return loaded;
  }

  // The payload of a union known to hold a member of type `to`, or a union of some members.
  payload(this: Mut<this>, v: string, from: UnionType, to: Type): string {
    if (this.kindOf(to) === "literal" || this.ll(to) === "{}") return "zeroinitializer";
    const leaves = this.leaves(to);
    if (this.split(leaves)) return this.readWords(v, from, to, leaves, 0);
    const slot = this.host.alloca(this.ll(from));
    this.host.emit(`store ${this.ll(from)} ${v}, ptr ${slot}`);
    const at = this.host.temp();
    this.host.emit(`${at} = getelementptr ${this.ll(from)}, ptr ${slot}, i32 0, i32 1`);
    const result = this.host.temp();
    this.host.emit(`${result} = load ${this.ll(to)}, ptr ${at}, align 8`);
    return result;
  }

  // A `to` whose parts `leaves` sit `at` bytes into the payload of `v`, each read from the word
  // it sits in, as the payload's memory would give it.
  readWords(this: Mut<this>, v: string, from: UnionType, to: Type, leaves: Ref<Leaf[]>, at: usize): string {
    let result = "undef";
    for (const leaf of leaves) {
      const offset = leaf.at + at;
      let bits = this.host.temp();
      this.host.emit(`${bits} = extractvalue ${this.ll(from)} ${v}, 1, ${offset / 8}`);
      if (offset % 8 !== 0) {
        const shifted = this.host.temp();
        this.host.emit(`${shifted} = lshr i64 ${bits}, ${(offset % 8) * 8}`);
        bits = shifted;
      }
      const part = this.fromWord(bits, leaf.ll);
      if (leaf.path === "") return part;
      const next = this.host.temp();
      this.host.emit(`${next} = insertvalue ${this.ll(to)} ${result}, ${leaf.ll} ${part}, ${leaf.path}`);
      result = next;
    }
    return result;
  }

  // A type's scalar parts, found once per type.
  leaves(this: Mut<this>, t: Type): Leaf[] {
    const known = this.host.leaves.get(t);
    if (known !== undefined) return known.clone();
    const found = leavesOf(this.host.tables.typing, t);
    this.host.leaves.set(t, found.clone());
    return found;
  }

  // Whether parts go into and out of a union word by word: few enough of them, each a scalar.
  split(leaves: Ref<Leaf[]>): boolean {
    return leaves.length > 0 && leaves.length <= splitLimit() && leaves[0]!.ll !== "";
  }

  // A scalar as the bits of a payload word, in its low bits.
  toWord(this: Mut<this>, x: string, ll: string): string {
    if (ll === "i64") return x;
    const out = this.host.temp();
    if (ll === "ptr") this.host.emit(`${out} = ptrtoint ptr ${x} to i64`);
    else if (ll === "double") this.host.emit(`${out} = bitcast double ${x} to i64`);
    else if (ll === "float") {
      const raw = this.host.temp();
      this.host.emit(`${raw} = bitcast float ${x} to i32`);
      this.host.emit(`${out} = zext i32 ${raw} to i64`);
    } else this.host.emit(`${out} = zext ${ll} ${x} to i64`);
    return out;
  }

  // A scalar read from the low bits of a payload word.
  fromWord(this: Mut<this>, w: string, ll: string): string {
    if (ll === "i64") return w;
    const out = this.host.temp();
    if (ll === "ptr") this.host.emit(`${out} = inttoptr i64 ${w} to ptr`);
    else if (ll === "double") this.host.emit(`${out} = bitcast i64 ${w} to double`);
    else if (ll === "float") {
      const raw = this.host.temp();
      this.host.emit(`${raw} = trunc i64 ${w} to i32`);
      this.host.emit(`${out} = bitcast i32 ${raw} to float`);
    } else this.host.emit(`${out} = trunc i64 ${w} to ${ll}`);
    return out;
  }

  // Whether a member that holds itself, which narrowing opened up, gives a member `to` holds
  // through what its block holds.
  opened(this: Mut<this>, m: Type, to: UnionType): boolean {
    const of = this.blockOf(m);
    if (of === undefined || !this.isUnion(of)) return false;
    if (this.host.tables.typing.membersFor(m, to).length > 0) return false;
    for (const x of this.membersOf(of)) if (this.host.tables.typing.membersFor(x, to).length > 0) return true;
    return false;
  }

  // Moves a value between unions: each member the source may hold goes into the target's
  // member for it, which may sit at another index. Narrowing to fewer members leaves some
  // that can't be held here, and those get no case.
  retag(this: Mut<this>, v: string, from: UnionType, to: UnionType): string {
    const tag = this.host.temp();
    this.host.emit(`${tag} = extractvalue ${this.ll(from)} ${v}, 0`);
    const members = this.membersOf(from);
    const targets = this.membersOf(to);
    let held: Type[] = [];
    let open: boolean[] = [];
    // A member that goes into the target as itself keeps its payload words: only its tag changes.
    let same: boolean[] = [];
    for (const m of members) {
      const into = this.host.tables.typing.membersFor(m, to);
      const direct = into.length > 0;
      const through = !direct && this.opened(m, to);
      if (!direct && !through) continue;
      held.push(m);
      open.push(through);
      same.push(direct && into[0]! === m);
    }
    if (held.length > 0 && same.every((x) => x)) {
      let kept = true;
      for (const m of held) if (targets.indexOf(m) !== members.indexOf(m)) kept = false;
      let moved = tag;
      if (!kept) {
        let cases: string[] = [];
        for (let i: usize = 0; i < held.length; i++) cases.push(this.host.label());
        const end = this.host.label();
        this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i as usize]}`).join(" ")} ]`);
        let incoming = [`[ undef, %${this.host.block} ]`];
        for (let i: usize = 0; i < held.length; i++) {
          this.host.startBlock(cases[i]!);
          incoming.push(`[ ${targets.indexOf(held[i]!)}, %${this.host.block} ]`);
          this.host.emit(`br label %${end}`);
        }
        this.host.startBlock(end);
        moved = this.host.temp();
        this.host.emit(`${moved} = phi i32 ${incoming.join(", ")}`);
      }
      return this.reworded(v, from, to, moved);
    }
    let cases: string[] = [];
    for (let i: usize = 0; i < held.length; i++) cases.push(this.host.label());
    const end = this.host.label();
    this.host.emit(`switch i32 ${tag}, label %${end} [ ${held.map((m, i) => `i32 ${members.indexOf(m)}, label %${cases[i as usize]}`).join(" ")} ]`);
    let incoming = [`[ undef, %${this.host.block} ]`];
    for (let i: usize = 0; i < held.length; i++) {
      const member = held[i]!;
      this.host.startBlock(cases[i]!);
      let made = "";
      if (same[i]!) made = this.reworded(v, from, to, `${targets.indexOf(member)}`);
      else {
        const part = this.payload(v, from, member);
        made = open[i]! ? this.convert(part, member, to) : this.inject(part, member, to);
      }
      incoming.push(`[ ${made}, %${this.host.block} ]`);
      this.host.emit(`br label %${end}`);
    }
    this.host.startBlock(end);
    const out = this.host.temp();
    this.host.emit(`${out} = phi ${this.ll(to)} ${incoming.join(", ")}`);
    return out;
  }

  // A `to` holding the payload words of `v` under the tag `tag`: all of them when the two unions
  // have as many, else as many as the smaller has, the rest zero.
  reworded(this: Mut<this>, v: string, from: UnionType, to: UnionType, tag: string): string {
    const n = words(this.host.tables.typing, from);
    const m = words(this.host.tables.typing, to);
    let result = `{ i32 0, [${m} x i64] zeroinitializer }`;
    if (n === m && n > 0) {
      const all = this.host.temp();
      this.host.emit(`${all} = extractvalue ${this.ll(from)} ${v}, 1`);
      const next = this.host.temp();
      this.host.emit(`${next} = insertvalue ${this.ll(to)} ${result}, [${n} x i64] ${all}, 1`);
      result = next;
    } else {
      for (let k: usize = 0; k < (n < m ? n : m); k++) {
        const word = this.host.temp();
        this.host.emit(`${word} = extractvalue ${this.ll(from)} ${v}, 1, ${k}`);
        const next = this.host.temp();
        this.host.emit(`${next} = insertvalue ${this.ll(to)} ${result}, i64 ${word}, 1, ${k}`);
        result = next;
      }
    }
    const out = this.host.temp();
    this.host.emit(`${out} = insertvalue ${this.ll(to)} ${result}, i32 ${tag}, 0`);
    return out;
  }
}
