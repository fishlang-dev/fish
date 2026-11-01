// Near-miss names for "cannot find" errors, chosen as TypeScript's `getSpellingSuggestion`
// chooses them, so a typo gets the same suggestion `tsc` would give.

// The candidate closest to `name`, if any is close enough: within a length difference of a
// third of the name, and an edit distance under 0.4 of it, where a change of case costs 0.1.
// A candidate shorter than 3 is taken only when it differs by case alone, and one no source can
// write, a name the compiler made up, never.
export function suggestion(name: string, candidates: Iterable<string>): string | undefined {
  if (name.length < 2) return undefined;
  const lengthSlack = Math.max(2, Math.floor(name.length * 0.34));
  let best = Math.floor(name.length * 0.4) + 1;
  let found: string | undefined;
  for (const candidate of candidates) {
    if (candidate === name || !WRITABLE.test(candidate) || Math.abs(candidate.length - name.length) > lengthSlack) continue;
    if (candidate.length < 3 && candidate.toLowerCase() !== name.toLowerCase()) continue;
    const distance = distanceWithin(name, candidate, best - 0.1);
    if (distance === undefined) continue;
    best = distance;
    found = candidate;
  }
  return found;
}

const WRITABLE = /^#?[A-Za-z_$][\w$]*$/;

// The text an error message ends with to suggest a name: "; did you mean 'x'?", or nothing.
export function didYouMean(name: string, candidates: Iterable<string>): string {
  const found = suggestion(name, candidates);
  return found === undefined ? "" : `; did you mean '${found}'?`;
}

// Levenshtein distance with substitutions costing 2, or 0.1 for a change of case, given up
// once it must exceed `max`.
function distanceWithin(a: string, b: string, max: f64): f64 | undefined {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Array<f64>(b.length + 1).fill(0);
  const big = max + 0.01;
  for (let i = 1; i <= a.length; i++) {
    const lowA = a[i - 1]!.toLowerCase();
    const minJ = Math.ceil(i > max ? i - max : 1);
    const maxJ = Math.floor(b.length > max + i ? max + i : b.length);
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j < minJ; j++) current[j] = big;
    for (let j = minJ; j <= maxJ; j++) {
      const substitute = previous[j - 1]! + (lowA === b[j - 1]!.toLowerCase() ? 0.1 : 2);
      const d = a[i - 1] === b[j - 1] ? previous[j - 1]! : Math.min(previous[j]! + 1, current[j - 1]! + 1, substitute);
      current[j] = d;
      rowMin = Math.min(rowMin, d);
    }
    for (let j = maxJ + 1; j <= b.length; j++) current[j] = big;
    if (rowMin > max) return undefined;
    [previous, current] = [current, previous];
  }
  const d = previous[b.length]!;
  return d > max ? undefined : d;
}
