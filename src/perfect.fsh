// A hash of a string's first UTF-16 units, FNV-1a in 32 bits, as `fsh_rt_str_hash` in the runtime
// computes it, and the seed making it tell a set of strings apart. A many-armed string `switch` or
// `match` is dispatched on it: one pass over the subject, a switch on the hash, and one comparison.

// The fewest distinct strings dispatched by hash. Measured in release builds over 20 million
// lookups: hashing wins from 4 short strings, but with 60-character strings it is behind at 4 and
// even at 6, and ahead from 8.
export const HASHED_ARMS: usize = 8;

const BASIS = 2166136261;
const PRIME = 16777619;
// Each seed tried changes the hash's start; two strings sharing every seed's hash are compared in order.
const SEEDS = 16;
// The units hashed: a long subject costs no more than a short one. Strings alike in all of them
// share every hash, and are compared in order.
export const HASHED_UNITS: usize = 16;

// The hash of `s`'s first units from `seed`, an unsigned 32-bit value.
export function stringHash(s: string, seed: i64): i64 {
  let h = (BASIS ^ seed) & 0xFFFFFFFF;
  for (let i = 0; i < s.length && i < HASHED_UNITS; i++) h = ((h ^ (s.charCodeAt(i) as i64)) * PRIME) & 0xFFFFFFFF;
  return h;
}

// The first seed whose hash is different for every string, or undefined when none is.
export function perfectSeed(texts: Ref<string[]>): i64 | undefined {
  for (let seed = 0; seed < SEEDS; seed++) {
    let seen = new Set<i64>();
    for (const t of texts) seen.add(stringHash(t, seed));
    if (seen.size === texts.length) return seed;
  }
  return undefined;
}

// A hash as LLVM writes an `i32` constant, which is signed.
export function i32Text(h: i64): string {
  return `${h >= 0x80000000 ? h - 0x100000000 : h}`;
}

// A dispatch: the seed, and for each distinct string, its hash and the first test making it.
export type Dispatch = { seed: i64; keys: { hash: i64; at: usize }[] };

// The dispatch for strings tested in order, each with where it is tested, when at least `least`
// are distinct and a seed tells them apart.
export function dispatchOf(tests: Ref<{ text: string; at: usize }[]>, least: usize): Dispatch | undefined {
  let firsts = new Map<string, usize>();
  for (const t of tests) if (!firsts.has(t.text)) firsts.set(t.text, t.at);
  if (firsts.size < least) return undefined;
  const distinct = [...firsts.keys()];
  const seed = perfectSeed(distinct);
  if (seed === undefined) return undefined;
  let keys: { hash: i64; at: usize }[] = [];
  for (const t of distinct) keys.push({ hash: stringHash(t, seed), at: firsts.get(t)! });
  return { seed, keys };
}
