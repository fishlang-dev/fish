// Semantic versions and npm's ranges, meaning exactly what they mean in package.json.

export type Version = { major: number; minor: number; patch: number; pre: (string | number)[] };

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(text: string): Version | undefined {
  const m = VERSION.exec(text.trim());
  if (!m) return undefined;
  const pre = identifiers(m[4]);
  return pre && { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

// A pre-release's identifiers, numbers as numbers; a number with a leading zero isn't one.
function identifiers(text: string | undefined): (string | number)[] | undefined {
  if (text === undefined) return [];
  const parts = text.split(".");
  if (parts.some((p) => /^0\d/.test(p) || (/^\d+$/.test(p) && !Number.isSafeInteger(Number(p))))) return undefined;
  return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

export const formatVersion = (v: Version) => `${v.major}.${v.minor}.${v.patch}${v.pre.length ? `-${v.pre.join(".")}` : ""}`;

// Precedence as semver 2.0 orders it: a pre-release before its release, numeric identifiers
// below alphanumeric ones, a shorter list of identifiers first when the rest are equal.
export function compare(a: Version, b: Version): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const [x, y] = [a.pre[i], b.pre[i]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x !== typeof y) return typeof x === "number" ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

type Op = "<" | "<=" | ">" | ">=" | "=";
// `bound` marks an upper limit `^`, `~` and x-ranges add, which no pre-release of its own opts into.
type Comparator = { op: Op; version: Version; bound?: true };
// A range is any of its sets, each set every one of its comparators.
export type Range = Comparator[][];

const at = (major: number, minor = 0, patch = 0, pre: (string | number)[] = []): Version => ({ major, minor, patch, pre });

// A partial version, as `1`, `1.2`, `1.x` or `*` write one: the parts given, undefined past them.
type Partial = { major?: number; minor?: number; patch?: number; pre: (string | number)[] };
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-.]+)?$/;

function partial(text: string): Partial | undefined {
  if (text === "") return { pre: [] };
  const m = PARTIAL.exec(text);
  if (!m) return undefined;
  const part = (p: string | undefined) => (p === undefined || /^[xX*]$/.test(p) ? undefined : Number(p));
  const [major, minor, patch] = [part(m[1]), part(m[2]), part(m[3])];
  if ((major === undefined && minor !== undefined) || (minor === undefined && patch !== undefined)) return undefined;
  const pre = identifiers(m[4]);
  if (!pre || (pre.length > 0 && patch === undefined)) return undefined;
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
  if (exact) return [{ op: (op || "=") as Op, version: low }];
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
  const sets: Range = [];
  for (const raw of text.split("||")) {
    const set = raw.trim().replace(/(\^|~|>=?|<=?|=)\s+/g, "$1");
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) {
      const [from, to] = [partial(hyphen[1]!), partial(hyphen[2]!)];
      if (!from || !to) return undefined;
      const low = comparators(">=", from);
      const high = to.patch !== undefined ? [{ op: "<=" as Op, version: at(to.major!, to.minor!, to.patch, to.pre) }] : comparators("<=", to);
      sets.push([...low, ...high]);
      continue;
    }
    const parts: Comparator[] = [];
    for (const word of set === "" ? [""] : set.split(/\s+/)) {
      const m = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(word)!;
      const p = m[1] && m[2] === "" ? undefined : partial(m[2]!);
      if (!p) return undefined;
      parts.push(...comparators(m[1] ?? "", p));
    }
    sets.push(parts);
  }
  return sets;
}

function holds(c: Comparator, v: Version): boolean {
  const order = compare(v, c.version);
  return c.op === "<" ? order < 0 : c.op === "<=" ? order <= 0 : c.op === ">" ? order > 0 : c.op === ">=" ? order >= 0 : order === 0;
}

// Whether `v` is in `range`. A pre-release counts only where a comparator of the same set names a
// pre-release of the same major, minor and patch, as npm keeps unstable versions opt-in.
export function satisfies(v: Version, range: Range): boolean {
  return range.some((set) => {
    if (!set.every((c) => holds(c, v))) return false;
    if (v.pre.length === 0) return true;
    return set.some((c) => !c.bound && c.version.pre.length > 0 && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch);
  });
}

// The highest of `versions` in `range`.
export function maxSatisfying(versions: Version[], range: Range): Version | undefined {
  return versions.filter((v) => satisfies(v, range)).sort(compare).at(-1);
}
