// Semantic versions and npm's ranges, meaning exactly what they mean in package.json.

export type Version = { major: u64; minor: u64; patch: u64; pre: (string | u64)[] };

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(text: string): Version | undefined {
  const m = VERSION.exec(text.trim());
  if (m === null) return undefined;
  const pre = identifiers(m[4]);
  if (pre === undefined) return undefined;
  return { major: whole(m[1]!), minor: whole(m[2]!), patch: whole(m[3]!), pre };
}

// A run of digits as a number; the patterns here only give it digits.
function whole(digits: string): u64 {
  return parseInt(digits)! as u64;
}

// A pre-release's identifiers, numbers as numbers; a number with a leading zero isn't one.
function identifiers(text: string | undefined): (string | u64)[] | undefined {
  if (text === undefined) return [];
  const parts = text.split(".");
  if (parts.some((p) => /^0\d/.test(p) || (/^\d+$/.test(p) && !Number.isSafeInteger(parseFloat(p)!)))) return undefined;
  return parts.map((p): string | u64 => (/^\d+$/.test(p) ? whole(p) : p));
}

export const formatVersion = (v: Version) => `${v.major}.${v.minor}.${v.patch}${v.pre.length > 0 ? `-${v.pre.join(".")}` : ""}`;

// Precedence as semver 2.0 orders it: a pre-release before its release, numeric identifiers
// below alphanumeric ones, a shorter list of identifiers first when the rest are equal.
export function compare(a: Ref<Version>, b: Ref<Version>): i64 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.pre.length === 0 || b.pre.length === 0) return (b.pre.length as i64) - (a.pre.length as i64);
  for (let i: usize = 0; i < a.pre.length || i < b.pre.length; i++) {
    if (i >= a.pre.length) return -1;
    if (i >= b.pre.length) return 1;
    const x = a.pre[i]!;
    const y = b.pre[i]!;
    if (x === y) continue;
    if (typeof x === "string" && typeof y === "string") return x < y ? -1 : 1;
    if (typeof x !== "string" && typeof y !== "string") return x < y ? -1 : 1;
    return typeof x === "string" ? 1 : -1;
  }
  return 0;
}

type Op = "<" | "<=" | ">" | ">=" | "=";
// `bound` marks an upper limit `^`, `~` and x-ranges add, which no pre-release of its own opts into.
type Comparator = { op: Op; version: Version; bound?: true };
// A range is any of its sets, each set every one of its comparators.
export type Range = Comparator[][];

const at = (major: u64, minor: u64 = 0, patch: u64 = 0, pre: (string | u64)[] = []): Version => ({ major, minor, patch, pre });

// A partial version, as `1`, `1.2`, `1.x` or `*` write one: the parts given, undefined past them.
type Partial = { major?: u64; minor?: u64; patch?: u64; pre: (string | u64)[] };
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-.]+)?$/;

function partial(text: string): Partial | undefined {
  if (text === "") return { pre: [] };
  const m = PARTIAL.exec(text);
  if (m === null) return undefined;
  const part = (p: string | undefined): u64 | undefined => (p === undefined || /^[xX*]$/.test(p) ? undefined : whole(p));
  const [major, minor, patch] = [part(m[1]), part(m[2]), part(m[3])];
  if ((major === undefined && minor !== undefined) || (minor === undefined && patch !== undefined)) return undefined;
  const pre = identifiers(m[4]);
  if (pre === undefined || (pre.length > 0 && patch === undefined)) return undefined;
  return { major, minor, patch, pre };
}

// The comparators one written comparator stands for, `^`, `~` and x-ranges spelled out.
function comparators(op: string, p: Partial): Comparator[] {
  const { major, minor, patch, pre } = p;
  const low = at(major ?? 0, minor ?? 0, patch ?? 0, pre);
  if (op === "^") {
    if (major === undefined) return [];
    const high = major > 0 || minor === undefined ? at(major + 1) : minor > 0 || patch === undefined ? at(0, minor + 1) : at(0, 0, patch + 1);
    return [{ op: ">=", version: low }, { op: "<", version: { ...high, pre: [0] }, bound: true }];
  }
  if (op === "~") {
    if (major === undefined) return [];
    const high = minor === undefined ? at(major + 1) : at(major, minor + 1);
    return [{ op: ">=", version: low }, { op: "<", version: { ...high, pre: [0] }, bound: true }];
  }
  if (major === undefined) return op === "<" || op === ">" ? [{ op: "<", version: at(0, 0, 0, [0]), bound: true }] : [];
  const exact = patch !== undefined;
  if (exact) {
    const written: Op = op === "<" ? "<" : op === "<=" ? "<=" : op === ">" ? ">" : op === ">=" ? ">=" : "=";
    return [{ op: written, version: low }];
  }
  // A partial version with `>`, `<=` or nothing reaches past the parts left out.
  const next = minor === undefined ? at(major + 1) : at(major, minor + 1);
  switch (op) {
    case ">":
      return [{ op: ">=", version: next }];
    case ">=":
      return [{ op: ">=", version: low }];
    case "<":
      return [{ op: "<", version: { ...low, pre: [0] }, bound: true }];
    case "<=":
      return [{ op: "<", version: { ...next, pre: [0] }, bound: true }];
    default:
      return [{ op: ">=", version: low }, { op: "<", version: { ...next, pre: [0] }, bound: true }];
  }
}

// An npm range: sets joined by `||`, each of comparators separated by spaces or a hyphen range.
export function parseRange(text: string): Range | undefined {
  let sets: Range = [];
  for (const raw of text.split("||")) {
    const set = raw.trim().replace(/(\^|~|>=?|<=?|=)\s+/g, "$1");
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen !== null) {
      const from = partial(hyphen[1]!);
      const to = partial(hyphen[2]!);
      if (from === undefined || to === undefined) return undefined;
      const low = comparators(">=", from);
      const high: Comparator[] = to.patch !== undefined ? [{ op: "<=" as Op, version: at(to.major!, to.minor!, to.patch, to.pre) }] : comparators("<=", to);
      sets.push([...low, ...high]);
      continue;
    }
    let parts: Comparator[] = [];
    for (const word of set === "" ? [""] : set.split(/\s+/)) {
      const m = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(word)!;
      const p = m[1] !== undefined && m[2] === "" ? undefined : partial(m[2]!);
      if (p === undefined) return undefined;
      parts = parts.concat(comparators(m[1] ?? "", p));
    }
    sets.push(parts);
  }
  return sets;
}

function holds(c: Ref<Comparator>, v: Ref<Version>): boolean {
  const order = compare(v, c.version);
  return c.op === "<" ? order < 0 : c.op === "<=" ? order <= 0 : c.op === ">" ? order > 0 : c.op === ">=" ? order >= 0 : order === 0;
}

// Whether `v` is in `range`. A pre-release counts only where a comparator of the same set names a
// pre-release of the same major, minor and patch, as npm keeps unstable versions opt-in.
export function satisfies(v: Ref<Version>, range: Ref<Range>): boolean {
  return range.some((set) => {
    if (!set.every((c) => holds(c, v))) return false;
    if (v.pre.length === 0) return true;
    return set.some((c) => c.bound !== true && c.version.pre.length > 0 && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch);
  });
}

// The highest of `versions` in `range`.
export function maxSatisfying(versions: Ref<Version[]>, range: Ref<Range>): Version | undefined {
  let matching = versions.filter((v) => satisfies(v, range));
  matching.sort(compare);
  return matching.at(-1);
}
