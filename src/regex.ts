// Regex literals: an ECMAScript pattern parsed while compiling into a tree, with JavaScript's
// early errors, including Annex B's leniencies for patterns without `u` or `v`. Without those
// flags a pattern is a sequence of UTF-16 code units, as JavaScript reads it; with them, of code
// points.

// Inclusive ranges of code units or code points, sorted and merged.
export type Ranges = [u32, u32][];

export type RegexNode =
  | { kind: "empty" }
  | { kind: "char"; c: u32; fold: boolean }
  | { kind: "dot"; dotAll: boolean }
  // A class: what it matches as ranges, or, under `v`, also strings; `fold` when it ignores case.
  | { kind: "set"; ranges: Ranges; negated: boolean; strings: string[]; fold: boolean }
  | { kind: "seq"; items: RegexNode[] }
  | { kind: "alt"; options: RegexNode[] }
  | { kind: "group"; index: usize | undefined; body: RegexNode }
  | { kind: "look"; behind: boolean; negated: boolean; body: RegexNode }
  | { kind: "assert"; which: "start" | "end" | "word" | "notWord"; multiline: boolean; fold: boolean }
  // A backreference to every group of a name, or to one by number.
  | { kind: "backref"; groups: u32[]; fold: boolean }
  // `captures` are the groups inside, which each pass resets.
  | { kind: "repeat"; min: usize; max: f64; greedy: boolean; body: RegexNode; captures: [usize, usize] };

export type Capture = { name: string | undefined; optional: boolean };

export type Pattern = { tree: RegexNode; captures: Capture[]; flags: string; unicode: boolean; backtracks: boolean };

export class RegexSyntaxError {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

const fail = (message: string): never => {
  throw new RegexSyntaxError(`invalid regular expression: ${message}`);
};

const SYNTAX = new Set([..."^$\\.*+?()[]{}|"].map((c) => c.charCodeAt(0)));
const at = (c: string) => c.charCodeAt(0);

export const DIGITS: Ranges = [[0x30, 0x39]];
export const WORD: Ranges = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];
export const SPACE: Ranges = [[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]];

export function normalize(ranges: Ranges): Ranges {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  const out: Ranges = [];
  for (const [lo, hi] of sorted) {
    const last = out.at(-1);
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

export function complement(ranges: Ranges, top: u32): Ranges {
  const out: Ranges = [];
  let next = 0;
  for (const [lo, hi] of normalize(ranges)) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= top) out.push([next, top]);
  return out;
}

function intersect(a: Ranges, b: Ranges): Ranges {
  const out: Ranges = [];
  for (const [alo, ahi] of a) for (const [blo, bhi] of b) if (Math.max(alo, blo) <= Math.min(ahi, bhi)) out.push([Math.max(alo, blo), Math.min(ahi, bhi)]);
  return normalize(out);
}

// The properties of strings `v` allows, which match emoji sequences rather than characters.
const STRING_PROPERTIES = new Set(["Basic_Emoji", "Emoji_Keycap_Sequence", "RGI_Emoji", "RGI_Emoji_Flag_Sequence", "RGI_Emoji_Modifier_Sequence", "RGI_Emoji_Tag_Sequence", "RGI_Emoji_ZWJ_Sequence"]);

// What property escapes match and which characters fold together, worked out from the engine
// running the compiler, each by a scan of every character, so the caller keeps them between
// patterns. `folds` is keyed by 'u' for Unicode's case folding and '' for the other.
export type RegexTables = { properties: Map<string, Ranges>; folds: Map<string, u32[][]> };

// What a property escape matches, worked out from the engine running the compiler, which knows
// Unicode's tables.
function property(tables: RegexTables, body: string, sets: boolean): Ranges {
  if (sets && STRING_PROPERTIES.has(body)) return fail("properties of strings are not supported yet");
  let found = tables.properties.get(body);
  if (!found) {
    let test: RegExp;
    try {
      test = new RegExp(`^\\p{${body}}$`, "u");
    } catch {
      return fail("invalid property expression");
    }
    const ranges: Ranges = [];
    let start = -1;
    for (let c = 0; c <= 0x110000; c++) {
      const yes = c < 0x110000 && test.test(String.fromCodePoint(c));
      if (yes && start < 0) start = c;
      if (!yes && start >= 0) {
        ranges.push([start, c - 1]);
        start = -1;
      }
    }
    found = ranges;
    tables.properties.set(body, found);
  }
  return found;
}

export function parsePattern(source: string, flags: string, tables: RegexTables): Pattern {
  for (const [i, f] of [...flags].entries()) {
    if (!"dgimsuvy".includes(f) || flags.indexOf(f) !== i) fail(`invalid flags supplied to RegExp constructor '${flags}'`);
  }
  const sets = flags.includes("v");
  if (sets && flags.includes("u")) fail(`invalid flags supplied to RegExp constructor '${flags}'`);
  const unicode = sets || flags.includes("u");
  const top = unicode ? 0x10ffff : 0xffff;
  const text = unicode ? [...source].map((c) => c.codePointAt(0)!) : [...Array(source.length).keys()].map((i) => source.charCodeAt(i) as u32);
  let pos = 0;
  const captures: Capture[] = [];
  const names = new Map<string, u32[]>();
  const backrefs: { name?: string; index?: usize }[] = [];
  let backtracks = false;
  // Named groups make `\k` a backreference even without `u`, as Annex B says.
  const named = groupOpenings().some((i) => text[i + 1] === at("?") && text[i + 2] === at("<") && text[i + 3] !== at("=") && text[i + 3] !== at("!"));
  let fold = flags.includes("i");
  let multiline = flags.includes("m");
  let dotAll = flags.includes("s");
  // The names each alternative so far has used, so one name may repeat only in different ones.
  let alternativeNames: Set<string>[] = [new Set()];

  const peek = (k = 0) => text[pos + k];
  const eat = (c: string) => {
    if (peek() !== at(c)) return false;
    pos++;
    return true;
  };
  const isDigit = (c: u32 | undefined) => c !== undefined && c >= 0x30 && c <= 0x39;
  const hexValue = (c: u32 | undefined) => (c === undefined ? -1 : isDigit(c) ? c - 0x30 : (c | 0x20) >= 0x61 && (c | 0x20) <= 0x66 ? (c | 0x20) - 0x61 + 10 : -1);

  function disjunction(): RegexNode {
    const options = [alternative()];
    while (eat("|")) {
      alternativeNames = [...alternativeNames.slice(0, -1), new Set()];
      options.push(alternative());
    }
    return options.length === 1 ? options[0]! : { kind: "alt", options };
  }

  function alternative(): RegexNode {
    const items: RegexNode[] = [];
    while (pos < text.length && peek() !== at("|") && peek() !== at(")")) items.push(term());
    return items.length === 0 ? { kind: "empty" } : items.length === 1 ? items[0]! : { kind: "seq", items };
  }

  function term(): RegexNode {
    const first = captures.length;
    const [atom, quantifiable] = atomOrAssertion();
    const quantifier = quantifierHere();
    if (!quantifier) return atom;
    if (!quantifiable) fail(atom.kind === "look" && atom.behind ? "invalid quantifier" : "nothing to repeat");
    const [min, max, greedy] = quantifier;
    return { kind: "repeat", min, max, greedy, body: atom, captures: [first, captures.length] };
  }

  // A quantifier here, read and consumed, or none. Without `u`, a `{` that doesn't begin one is
  // an ordinary character.
  function quantifierHere(): [usize, f64, boolean] | undefined {
    const c = peek();
    let min: usize, max: f64;
    if (c === at("*")) [min, max] = [0, Infinity];
    else if (c === at("+")) [min, max] = [1, Infinity];
    else if (c === at("?")) [min, max] = [0, 1];
    else if (c === at("{")) {
      const braced = bracedQuantifier();
      if (!braced) return undefined;
      [min, max] = braced;
      if ((min as f64) > max) fail("numbers out of order in {} quantifier");
      return [min, max, !eat("?")];
    } else return undefined;
    pos++;
    return [min, max, !eat("?")];
  }

  function bracedQuantifier(): [usize, f64] | undefined {
    const start = pos;
    pos++;
    const number = () => {
      let n = -1;
      while (isDigit(peek())) n = (n < 0 ? 0 : n) * 10 + (text[pos++]! - 0x30);
      return n;
    };
    const min = number();
    let max = min;
    if (min >= 0 && eat(",")) {
      max = number();
      if (max < 0) max = Infinity;
    }
    if (min >= 0 && eat("}")) return [Math.min(min, 2 ** 31), max === Infinity ? Infinity : Math.min(max, 2 ** 31)];
    pos = start;
    if (unicode) fail("incomplete {} quantifier for Unicode pattern");
    return undefined;
  }

  function atomOrAssertion(): [RegexNode, boolean] {
    const c = peek()!;
    if (c === at("^")) {
      pos++;
      return [{ kind: "assert", which: "start", multiline, fold }, false];
    }
    if (c === at("$")) {
      pos++;
      return [{ kind: "assert", which: "end", multiline, fold }, false];
    }
    if (c === at("\\") && (peek(1) === at("b") || peek(1) === at("B"))) {
      pos += 2;
      return [{ kind: "assert", which: text[pos - 1] === at("b") ? "word" : "notWord", multiline, fold }, false];
    }
    if (c === at("(")) return group();
    if (c === at(".")) {
      pos++;
      return [{ kind: "dot", dotAll }, true];
    }
    if (c === at("[")) return [sets ? classSet() : classRanges(), true];
    if (c === at("\\")) return [atomEscape(), true];
    if (c === at("*") || c === at("+") || c === at("?")) fail("nothing to repeat");
    if (c === at("{")) {
      if (unicode) fail("incomplete {} quantifier for Unicode pattern");
      if (bracedQuantifier()) fail("nothing to repeat");
    }
    if (unicode && (c === at("}") || c === at("]"))) fail(c === at("}") ? "incomplete {} quantifier for Unicode pattern" : "unmatched ] in Unicode pattern");
    pos++;
    return [{ kind: "char", c, fold }, true];
  }

  function group(): [RegexNode, boolean] {
    pos++;
    if (eat("?")) {
      const behind = eat("<");
      if (peek() === at("=") || peek() === at("!")) {
        const negated = text[pos++] === at("!");
        backtracks = true;
        const body = disjunction();
        if (!eat(")")) fail("missing )");
        // Without `u`, a lookahead may be quantified, as Annex B allows.
        return [{ kind: "look", behind, negated, body }, !behind && !unicode];
      }
      if (behind) {
        const name = groupName();
        return capture(name);
      }
      if (eat(":")) return scoped(undefined);
      return modifiers();
    }
    return capture(undefined);
  }

  function capture(name: string | undefined): [RegexNode, boolean] {
    if (name !== undefined) {
      if (alternativeNames.some((s) => s.has(name))) fail("duplicate group specifier name");
      alternativeNames.at(-1)!.add(name);
      names.set(name, [...(names.get(name) ?? []), (captures.length + 1) as u32]);
    }
    captures.push({ name, optional: false });
    return scoped(captures.length);
  }

  // A group's body, its own scope for the names its alternatives use.
  function scoped(index: usize | undefined): [RegexNode, boolean] {
    const outer = alternativeNames;
    alternativeNames = [...outer, new Set()];
    const body = disjunction();
    // What the group's alternatives named is named in the alternative around it too.
    const inner = alternativeNames.slice(outer.length);
    alternativeNames = outer;
    for (const s of inner) for (const n of s) outer.at(-1)!.add(n);
    if (!eat(")")) fail("missing )");
    return [{ kind: "group", index, body }, true];
  }

  // `(?ims-ims:...)` turns flags on or off inside the group.
  function modifiers(): [RegexNode, boolean] {
    let on = "", off = "", minus = false;
    for (;;) {
      const c = peek();
      if (c === at("-") && !minus) {
        minus = true;
        pos++;
      } else if (c === at("i") || c === at("m") || c === at("s")) {
        const f = String.fromCharCode(c);
        if (on.includes(f) || off.includes(f)) fail("invalid regular expression modifier");
        if (minus) off += f;
        else on += f;
        pos++;
      } else break;
    }
    if (!eat(":") || (minus && on + off === "")) fail(peek() === undefined ? "missing )" : "invalid regular expression modifier");
    if (on + off === "" ) fail("invalid group");
    const saved = [fold, multiline, dotAll] as const;
    if (on.includes("i") || off.includes("i")) fold = on.includes("i");
    if (on.includes("m") || off.includes("m")) multiline = on.includes("m");
    if (on.includes("s") || off.includes("s")) dotAll = on.includes("s");
    const result = scoped(undefined);
    [fold, multiline, dotAll] = saved;
    return result;
  }

  function groupName(): string {
    let name = "";
    for (;;) {
      if (pos >= text.length) fail("invalid capture group name");
      if (eat(">")) break;
      let c = text[pos++]!;
      if (c === at("\\")) {
        if (!eat("u")) fail("invalid capture group name");
        c = unicodeEscape(true) ?? fail("invalid capture group name");
      } else if (!unicode && c >= 0xd800 && c <= 0xdbff && (peek() ?? 0) >= 0xdc00 && peek()! <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (text[pos++]! - 0xdc00);
      }
      const ch = String.fromCodePoint(c);
      if (!(name === "" ? /[\p{ID_Start}$_]/u : /[\p{ID_Continue}$‌‍]/u).test(ch)) fail("invalid capture group name");
      name += ch;
    }
    if (name === "") fail("invalid capture group name");
    return name;
  }

  // After `\u`: four hex digits, a surrogate pair of them under `u`, or `{...}` under `u` (or in
  // a group name, always); undefined when what follows isn't one.
  function unicodeEscape(braces: boolean): u32 | undefined {
    const start = pos;
    if ((unicode || braces) && eat("{")) {
      let v = 0, digits = 0;
      while (hexValue(peek()) >= 0) {
        v = v * 16 + hexValue(text[pos++]);
        digits++;
        if (v > 0x10ffff) fail("invalid Unicode {} escape");
      }
      if (digits === 0 || !eat("}")) {
        if (unicode) fail("invalid Unicode {} escape");
        pos = start;
        return undefined;
      }
      return v;
    }
    const four = () => {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const h = hexValue(peek(k));
        if (h < 0) return -1;
        v = v * 16 + h;
      }
      pos += 4;
      return v;
    };
    const v = four();
    if (v < 0) {
      if (unicode) fail("invalid Unicode \\u escape");
      return undefined;
    }
    if ((unicode || braces) && v >= 0xd800 && v <= 0xdbff && peek() === at("\\") && peek(1) === at("u")) {
      const back = pos;
      pos += 2;
      const low = four();
      if (low >= 0xdc00 && low <= 0xdfff) return 0x10000 + ((v - 0xd800) << 10) + (low - 0xdc00);
      pos = back;
    }
    return v;
  }

  function atomEscape(): RegexNode {
    pos++;
    const c = peek() ?? fail("\\ at end of pattern");
    if (isDigit(c) && c !== at("0")) {
      const start = pos;
      let n = 0;
      while (isDigit(peek())) n = n * 10 + (text[pos++]! - 0x30);
      backrefs.push({ index: n });
      // Without `u`, a number past the groups is an octal escape, or the digit itself.
      if (!unicode && n > countGroups()) {
        pos = start;
        if (c >= at("8")) {
          pos++;
          return { kind: "char", c, fold };
        }
        return { kind: "char", c: octal(), fold };
      }
      backtracks = true;
      return { kind: "backref", groups: [n], fold };
    }
    if (c === at("k") && (unicode || named)) {
      pos++;
      if (!eat("<")) fail("invalid \\k<> named backreference");
      const name = groupName();
      backrefs.push({ name });
      backtracks = true;
      return { kind: "backref", groups: [], fold, name } as RegexNode;
    }
    const set = classEscape();
    // Without \`v\`, a negated escape like \\P{Lu} is its complement before case folding, as
    // JavaScript reads it; under \`v\`, and in a negated class, folding comes first.
    if (set) return set.negated && !sets ? { ...set, ranges: complement(set.ranges, top), negated: false } : set;
    return { kind: "char", c: characterEscape(false), fold };
  }

  // Where each `(` outside a class and not escaped is, which a backreference may count before
  // its group is reached.
  function groupOpenings(): usize[] {
    const out: usize[] = [];
    let inClass = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === at("\\")) i++;
      else if (ch === at("[")) inClass = true;
      else if (ch === at("]")) inClass = false;
      else if (ch === at("(") && !inClass) out.push(i);
    }
    return out;
  }

  function countGroups(): usize {
    return groupOpenings().filter((i) => text[i + 1] !== at("?") || (text[i + 2] === at("<") && text[i + 3] !== at("=") && text[i + 3] !== at("!"))).length;
  }

  function octal(): u32 {
    let v = text[pos++]! - 0x30;
    if (peek() !== undefined && peek()! >= 0x30 && peek()! <= 0x37) {
      v = v * 8 + (text[pos++]! - 0x30);
      if (v < 32 && peek() !== undefined && peek()! >= 0x30 && peek()! <= 0x37) v = v * 8 + (text[pos++]! - 0x30);
    }
    return v;
  }

  // `\d`, `\w`, `\s`, their negations, and `\p{...}` under `u` or `v`, consumed; undefined for
  // anything else.
  function classEscape(): Extract<RegexNode, { kind: "set" }> | undefined {
    const c = peek()!;
    const upper = c >= at("A") && c <= at("Z");
    const base = c | 0x20;
    if (base === at("d") || base === at("s") || base === at("w")) {
      pos++;
      let ranges = base === at("d") ? DIGITS : base === at("s") ? SPACE : WORD;
      // Under `i` with `u` or `v`, ſ and the Kelvin sign fold into \w's letters.
      if (base === at("w") && fold && unicode) ranges = normalize([...ranges, [0x17f, 0x17f], [0x212a, 0x212a]]);
      return { kind: "set", ranges, negated: upper, strings: [], fold: false };
    }
    if (base === at("p") && unicode) {
      pos++;
      if (!eat("{")) fail("invalid property expression");
      let body = "";
      while (pos < text.length && peek() !== at("}")) body += String.fromCodePoint(text[pos++]!);
      if (!eat("}")) fail("invalid property expression");
      return { kind: "set", ranges: property(tables, body, sets), negated: upper, strings: [], fold };
    }
    return undefined;
  }

  // A character escape's value; `inClass` for the forms only a class allows.
  function characterEscape(inClass: boolean): u32 {
    const c = text[pos++]!;
    switch (c) {
      case at("f"): return 0x0c;
      case at("n"): return 0x0a;
      case at("r"): return 0x0d;
      case at("t"): return 0x09;
      case at("v"): return 0x0b;
      case at("c"): {
        const letter = peek();
        if (letter !== undefined && ((letter | 0x20) >= at("a") && (letter | 0x20) <= at("z"))) {
          pos++;
          return letter % 32;
        }
        // Annex B: in a class, `\c` takes a digit or `_` too; elsewhere a lone `\c` is a
        // backslash followed by `c`.
        if (!unicode && inClass && letter !== undefined && (isDigit(letter) || letter === at("_"))) {
          pos++;
          return letter % 32;
        }
        if (unicode) fail("invalid escaped character for Unicode pattern");
        pos--;
        return at("\\");
      }
      case at("0"):
        if (!isDigit(peek())) return 0;
        if (unicode) fail("invalid decimal escape for Unicode pattern");
        pos--;
        return octal();
      case at("x"): {
        const [h1, h2] = [hexValue(peek()), hexValue(peek(1))];
        if (h1 >= 0 && h2 >= 0) {
          pos += 2;
          return h1 * 16 + h2;
        }
        if (unicode) fail("invalid escaped character for Unicode pattern");
        return c;
      }
      case at("u"): {
        const v = unicodeEscape(false);
        return v ?? c;
      }
    }
    if (!unicode) {
      if (inClass && isDigit(c)) {
        pos--;
        return c >= at("8") ? text[pos++]! : octal();
      }
      if (c === at("k") && named) fail("invalid \\k<> named backreference");
      return c;
    }
    if (SYNTAX.has(c) || c === at("/") || (inClass && c === at("-"))) return c;
    return fail("invalid escaped character for Unicode pattern");
  }

  // A class without `v`: atoms and ranges of them.
  function classRanges(): RegexNode {
    pos++;
    const negated = eat("^");
    const ranges: Ranges = [];
    for (;;) {
      if (pos >= text.length) fail("missing terminating ] for character class");
      if (eat("]")) break;
      const lo = classAtom();
      if (peek() === at("-") && peek(1) !== undefined && peek(1) !== at("]")) {
        pos++;
        const hi = classAtom();
        if (typeof lo !== "number" || typeof hi !== "number") {
          if (unicode) fail("invalid range in character class for Unicode pattern");
          // Annex B: a class escape at either end makes the dash an ordinary character.
          for (const end of [lo, hi]) typeof end === "number" ? ranges.push([end, end]) : ranges.push(...setRanges(end));
          ranges.push([at("-"), at("-")]);
          continue;
        }
        if (lo > hi) fail("range out of order in character class");
        ranges.push([lo, hi]);
        continue;
      }
      if (typeof lo === "number") ranges.push([lo, lo]);
      else ranges.push(...setRanges(lo));
    }
    return { kind: "set", ranges: normalize(ranges), negated, strings: [], fold };
  }

  function setRanges(s: Extract<RegexNode, { kind: "set" }>): Ranges {
    return s.negated ? complement(s.ranges, top) : s.ranges;
  }

  function classAtom(): u32 | Extract<RegexNode, { kind: "set" }> {
    const c = text[pos]!;
    if (c !== at("\\")) {
      pos++;
      return c;
    }
    pos++;
    if (pos >= text.length) fail("\\ at end of pattern");
    if (eat("b")) return 0x08;
    if (unicode && eat("-")) return at("-");
    const set = classEscape();
    if (set) return set;
    return characterEscape(true);
  }

  // A class under `v`: unions, intersections with `&&`, differences with `--`, nested classes
  // and `\q{...}` strings.
  function classSet(): Extract<RegexNode, { kind: "set" }> {
    pos++;
    const negated = eat("^");
    const operand = (): { ranges: Ranges; strings: string[] } => {
      if (peek() === at("[")) {
        const inner = classSet();
        return { ranges: inner.negated ? complement(inner.ranges, top) : inner.ranges, strings: inner.strings };
      }
      if (peek() === at("\\")) {
        pos++;
        if (pos >= text.length) fail("\\ at end of pattern");
        if (peek() === at("q") && peek(1) === at("{")) {
          pos += 2;
          const strings: string[] = [];
          const ranges: Ranges = [];
          let current: u32[] = [];
          const finish = () => {
            if (current.length === 1) ranges.push([current[0]!, current[0]!]);
            else strings.push(String.fromCodePoint(...current));
            current = [];
          };
          for (;;) {
            if (pos >= text.length) fail("missing terminating } for \\q");
            if (eat("}")) break;
            if (eat("|")) {
              finish();
              continue;
            }
            if (eat("\\")) current.push(eat("b") ? 0x08 : characterEscape(true));
            else current.push(text[pos++]!);
          }
          finish();
          return { ranges: normalize(ranges), strings };
        }
        if (eat("b")) return { ranges: [[8, 8]], strings: [] };
        const set = classEscape();
        if (set) return { ranges: set.negated ? complement(set.ranges, top) : set.ranges, strings: set.strings };
        const c = peek()!;
        // Under `v`, class punctuation may be escaped.
        if ("&-!#%,:;<=>@`~".includes(String.fromCodePoint(c))) {
          pos++;
          return { ranges: [[c, c]], strings: [] };
        }
        const v = characterEscape(true);
        return { ranges: [[v, v]], strings: [] };
      }
      if (pos >= text.length) fail("missing terminating ] for character class");
      const c = text[pos]!;
      const ch = String.fromCodePoint(c);
      if ("()[]{}/-|".includes(ch) || (c === peek(1) && "&!#$%*+,.:;<=>?@^`~".includes(ch))) fail("invalid class set character");
      pos++;
      return { ranges: [[c, c]], strings: [] };
    };
    const single = (): { ranges: Ranges; strings: string[]; character?: u32 } => {
      const start = pos;
      const first = operand();
      // A lone character may start a range.
      const lone = first.strings.length === 0 && first.ranges.length === 1 && first.ranges[0]![0] === first.ranges[0]![1] && text[start] !== at("[") && !(text[start] === at("\\") && "dDsSwWpPq".includes(String.fromCodePoint(text[start + 1] ?? 0)));
      if (lone && peek() === at("-") && peek(1) !== at("-")) {
        pos++;
        const hiStart = pos;
        const hi = operand();
        const hiLone = hi.strings.length === 0 && hi.ranges.length === 1 && hi.ranges[0]![0] === hi.ranges[0]![1] && text[hiStart] !== at("[");
        if (!hiLone) fail("invalid class set character");
        const [lo, h] = [first.ranges[0]![0], hi.ranges[0]![0]];
        if (lo > h) fail("range out of order in character class");
        return { ranges: [[lo, h]], strings: [] };
      }
      return first;
    };
    let result: { ranges: Ranges; strings: string[] } = { ranges: [], strings: [] };
    let op: "union" | "and" | "minus" | undefined;
    let count = 0;
    for (;;) {
      if (pos >= text.length) fail("missing terminating ] for character class");
      if (eat("]")) break;
      const next = peek() === at("&") && peek(1) === at("&") ? "and" : peek() === at("-") && peek(1) === at("-") ? "minus" : "union";
      if (next !== "union") {
        if (count === 0 || (op !== undefined && op !== next)) fail("invalid operation in class set");
        pos += 2;
        if (peek() === at("&") || peek() === at("]")) fail("invalid operation in class set");
        op = next;
        const rhs = single();
        result = next === "and"
          ? { ranges: intersect(result.ranges, rhs.ranges), strings: result.strings.filter((s) => rhs.strings.includes(s)) }
          : { ranges: intersect(result.ranges, complement(rhs.ranges, top)), strings: result.strings.filter((s) => !rhs.strings.includes(s)) };
        count++;
        continue;
      }
      if (op === "and" || op === "minus") fail("invalid operation in class set");
      if (count > 0) op = "union";
      const part = single();
      result = { ranges: normalize([...result.ranges, ...part.ranges]), strings: [...new Set([...result.strings, ...part.strings])] };
      count++;
    }
    if (negated && result.strings.length > 0) fail("negated class set may contain strings");
    return { kind: "set", ranges: result.ranges, negated, strings: result.strings, fold };
  }

  const tree = disjunction();
  if (pos < text.length) fail(peek() === at(")") ? "unmatched parentheses" : "unexpected character");
  for (const ref of backrefs) {
    if (ref.name !== undefined && !names.has(ref.name)) fail("invalid \\k<> named backreference");
    if (ref.index !== undefined && unicode && ref.index > captures.length) fail("invalid backreference for Unicode pattern");
  }
  resolveNames(tree, names);
  markOptional(tree, captures, true);
  return { tree, captures, flags, unicode, backtracks };
}

// A named backreference points at every group of its name.
function resolveNames(n: RegexNode, names: Map<string, u32[]>) {
  const named = n as RegexNode & { name?: string };
  if (n.kind === "backref" && named.name !== undefined) {
    n.groups = names.get(named.name)!;
    delete named.name;
  }
  for (const child of children(n)) resolveNames(child, names);
}

export function children(n: RegexNode): RegexNode[] {
  switch (n.kind) {
    case "seq": return n.items;
    case "alt": return n.options;
    case "group": case "look": case "repeat": return [n.body];
    default: return [];
  }
}

// A capture that some match can leave out is optional: inside one of several alternatives, a
// repeat that may run no times, or a negative lookaround.
function markOptional(n: RegexNode, captures: Capture[], sure: boolean) {
  if (n.kind === "group" && n.index !== undefined && !sure) captures[n.index - 1]!.optional = true;
  const inner = n.kind === "alt" ? false : n.kind === "repeat" ? sure && n.min > 0 : n.kind === "look" ? sure && !n.negated : sure;
  for (const child of children(n)) markOptional(child, captures, inner);
}

// The compiled program the runtime's matchers run: a header of the group count, the
// registers repeat checks use, flags (1 unicode, 2 sticky, 4 backtracking, 8 a fold table, 16 a
// table of group names, 32 global) and
// where the instructions end, then instructions of 32-bit words. Positions are UTF-16 code units; with `u` or `v` a character is a code point, and a
// surrogate pair one step. The layout is shared with `native.ts`.
export const OP = {
  match: 0, char: 1, any: 2, anyAll: 3, set: 4, split: 5, jump: 6, save: 7, assert: 8, reset: 9, mark: 10, check: 11,
  backref: 12, look: 13, lookEnd: 14,
} as const;
// A matching instruction run backwards, inside a lookbehind, has this bit set.
export const BACKWARD = 32;
export const HEADER = 4;
export const PROGRAM_LIMIT = 1 << 20;

export function compile(p: Pattern, tables: RegexTables): u32[] {
  const code: u32[] = [];
  const emit = (...words: u32[]) => {
    code.push(...words);
    if (code.length > PROGRAM_LIMIT) fail("regular expression too large");
    return code.length - words.length;
  };
  let registers = 0;
  const registerOf = new Map<RegexNode, u32>();
  let folds = false;
  const top = p.unicode ? 0x10ffff : 0xffff;

  function node(n: RegexNode, back: boolean) {
    const dir = back ? BACKWARD : 0;
    switch (n.kind) {
      case "empty":
        return;
      case "char": {
        const ranges = n.fold ? foldRanges(tables, [[n.c, n.c]], p.unicode) : [[n.c, n.c] as [u32, u32]];
        if (ranges.length === 1 && ranges[0]![0] === ranges[0]![1]) emit(OP.char | dir, n.c);
        else set(ranges, false, dir);
        return;
      }
      case "dot":
        emit((n.dotAll ? OP.anyAll : OP.any) | dir);
        return;
      case "set": {
        let ranges = n.fold ? foldRanges(tables, n.ranges, p.unicode) : n.ranges;
        if (n.negated) ranges = complement(ranges, top);
        // A class under `v` holding strings tries the longest string first, as JavaScript does.
        if (n.strings.length > 0) {
          const options: RegexNode[] = n.strings.toSorted((a, b) => [...b].length - [...a].length).map((s) => ({ kind: "seq", items: [...s].map((c) => ({ kind: "char", c: c.codePointAt(0)!, fold: n.fold })) }));
          options.push({ kind: "set", ranges, negated: false, strings: [], fold: false });
          return node({ kind: "alt", options }, back);
        }
        set(ranges, false, dir);
        return;
      }
      case "seq":
        for (const item of back ? n.items.toReversed() : n.items) node(item, back);
        return;
      case "alt": {
        const jumps: usize[] = [];
        n.options.forEach((option, i) => {
          if (i < n.options.length - 1) {
            const split = emit(OP.split, 0, 0);
            code[split + 1] = code.length as u32;
            node(option, back);
            jumps.push(emit(OP.jump, 0));
            code[split + 2] = code.length as u32;
          } else node(option, back);
        });
        for (const j of jumps) code[j + 1] = code.length as u32;
        return;
      }
      case "group":
        if (n.index === undefined) return node(n.body, back);
        emit(OP.save, (n.index * 2 + (back ? 1 : 0)) as u32);
        node(n.body, back);
        emit(OP.save, (n.index * 2 + (back ? 0 : 1)) as u32);
        return;
      case "assert":
        emit(OP.assert, ["start", "end", "word", "notWord"].indexOf(n.which) as u32, n.multiline ? 1 : 0, n.fold && p.unicode ? 1 : 0);
        return;
      case "backref":
        folds ||= n.fold;
        emit(OP.backref | dir, n.fold ? 1 : 0, n.groups.length as u32, ...n.groups);
        return;
      case "look": {
        const look = emit(OP.look, n.negated ? 1 : 0, 0);
        node(n.body, n.behind);
        emit(OP.lookEnd);
        code[look + 2] = code.length as u32;
        return;
      }
      case "repeat":
        return repeat(n, back);
    }
  }

  function set(ranges: Ranges, negated: boolean, dir: u32) {
    emit(OP.set | dir, ranges.length as u32, ...ranges.flat());
  }

  // `{min,max}`: the body min times, then, for an unbounded repeat, a loop; each pass resets the
  // captures inside and, as the spec requires, a pass past the minimum that matched nothing fails.
  function repeat(n: Extract<RegexNode, { kind: "repeat" }>, back: boolean) {
    const [from, to] = n.captures;
    const pass = () => {
      if (to > from) emit(OP.reset, (from + 1) as u32, (to + 1) as u32);
      node(n.body, back);
    };
    if (n.min > 0 && n.max === 1 && n.min === 1) return pass();
    for (let i = 0; i < n.min; i++) pass();
    if (n.max === (n.min as f64)) return;
    // Each repeat has its own register, used again by every copy a bounded repeat makes of it.
    let register = registerOf.get(n);
    if (register === undefined) registerOf.set(n, register = registers++);
    if (n.max === Infinity) {
      const loop = code.length;
      const split = emit(OP.split, 0, 0);
      const into = code.length;
      emit(OP.mark, register);
      pass();
      emit(OP.check, register);
      emit(OP.jump, loop as u32);
      const out = code.length;
      code[split + 1] = (n.greedy ? into : out) as u32;
      code[split + 2] = (n.greedy ? out : into) as u32;
      return;
    }
    // A bounded repeat's optional passes nest, so a later one runs only after an earlier one;
    // each that is skipped skips the rest, to the end.
    const splits: [usize, usize][] = [];
    for (let left = n.max - (n.min as f64); left > 0; left--) {
      const split = emit(OP.split, 0, 0);
      splits.push([split, code.length]);
      emit(OP.mark, register!);
      pass();
      emit(OP.check, register!);
    }
    const out = code.length;
    for (const [split, into] of splits) {
      code[split + 1] = (n.greedy ? into : out) as u32;
      code[split + 2] = (n.greedy ? out : into) as u32;
    }
  }

  emit((p.captures.length + 1) as u32, 0, flagsOf(p), 0);
  emit(OP.save, 0);
  node(p.tree, false);
  emit(OP.save, 1);
  emit(OP.match);
  code[1] = registers;
  code[3] = code.length as u32;
  // A backreference that ignores case compares characters by what they fold to, from a table
  // after the instructions.
  if (folds) {
    const table = foldTable(tables, p.unicode);
    code.push((table.length / 2) as u32, ...table);
    code[2] = code[2]! | 8;
  }
  // The groups' names, as UTF-8 bytes, for a replacement's $<name>.
  const named = p.captures.flatMap((c, i) => (c.name === undefined ? [] : [[i + 1, c.name] as const]));
  if (named.length > 0) {
    code.push(named.length as u32);
    for (const [group, name] of named) {
      const bytes = new TextEncoder().encode(name);
      code.push(group as u32, bytes.length as u32, ...bytes);
    }
    code[2] = code[2]! | 16;
  }
  return code;
}

function flagsOf(p: Pattern): u32 {
  return (p.unicode ? 1 : 0) | (p.flags.includes("y") ? 2 : 0) | (p.backtracks ? 4 : 0) | (p.flags.includes("g") ? 32 : 0);
}

// The characters case-insensitive matching treats as one, as a key per character: the
// smallest of its class. Without `u` or `v` a character folds to its upper case when that is
// one code unit and doesn't take a non-ASCII character to ASCII; with them, by Unicode's
// simple case folding, checked here against the engine running the compiler.
function classesOf(tables: RegexTables, unicode: boolean): u32[][] {
  let found = tables.folds.get(unicode ? "u" : "");
  if (found) return found;
  const top = unicode ? 0x10ffff : 0xffff;
  const parent = new Int32Array(top + 1).map((_, i) => i);
  const root = (c: u32): u32 => {
    while (parent[c] !== c) c = parent[c] = parent[parent[c]!]!;
    return c;
  };
  const join = (a: u32, b: u32) => {
    const [x, y] = [root(a), root(b)];
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  };
  const single = (s: string) => (unicode ? ([...s].length === 1 ? s.codePointAt(0)! : -1) : s.length === 1 ? s.charCodeAt(0) : -1);
  const longUppers = new Map<string, u32>();
  for (let c = 0; c <= top; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCodePoint(c);
    if (!unicode) {
      const up = single(ch.toUpperCase());
      if (up >= 0 && !(c >= 128 && up < 128)) join(c, up);
      continue;
    }
    for (const other of [single(ch.toUpperCase()), single(ch.toLowerCase())]) if (other >= 0) join(c, other);
    // Characters whose upper case is several, like ΐ and ΐ, may still fold together; the check
    // below keeps only those that do.
    const upper = ch.toUpperCase();
    if (single(upper) < 0) {
      const first = longUppers.get(upper);
      if (first === undefined) longUppers.set(upper, c);
      else join(c, first);
    }
  }
  const groups = new Map<u32, u32[]>();
  for (let c = 0; c <= top; c++) {
    const r = root(c);
    const group = groups.get(r);
    if (group) group.push(c);
    else groups.set(r, [c]);
  }
  found = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    if (!unicode) {
      // Two characters are one when their upper cases are.
      const byKey = new Map<u32, u32[]>();
      for (const m of members) {
        const up = single(String.fromCharCode(m).toUpperCase());
        const key = up >= 0 && !(m >= 128 && up < 128) ? up : m;
        byKey.set(key, [...(byKey.get(key) ?? []), m]);
      }
      for (const g of byKey.values()) if (g.length > 1) found.push(g);
      continue;
    }
    // Upper and lower case join more than simple case folding does, so each class is split
    // by what the engine itself matches.
    const left = [...members];
    while (left.length > 1) {
      const first = left.shift()!;
      const test = new RegExp(`^\\u{${first.toString(16)}}$`, "iu");
      const same = [first, ...left.filter((m) => test.test(String.fromCodePoint(m)))];
      for (const m of same.slice(1)) left.splice(left.indexOf(m), 1);
      if (same.length > 1) found.push(same);
    }
  }
  tables.folds.set(unicode ? "u" : "", found);
  return found;
}

// A set closed under case folding: with every character that folds like one in it.
export function foldRanges(tables: RegexTables, ranges: Ranges, unicode: boolean): Ranges {
  const has = (c: u32) => {
    let [lo, hi] = [0, ranges.length - 1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [a, b] = ranges[mid]!;
      if (c < a) hi = mid - 1;
      else if (c > b) lo = mid + 1;
      else return true;
    }
    return false;
  };
  const extra: Ranges = [];
  for (const members of classesOf(tables, unicode)) if (members.some(has)) for (const m of members) extra.push([m, m]);
  return extra.length === 0 ? ranges : normalize([...ranges, ...extra]);
}

// The pairs of characters and the key each folds to, for backreferences that ignore case, which
// compare at run time.
export function foldTable(tables: RegexTables, unicode: boolean): u32[] {
  const pairs: [u32, u32][] = [];
  for (const members of classesOf(tables, unicode)) {
    const key = Math.min(...members);
    for (const m of members) if (m !== key) pairs.push([m, key]);
  }
  return pairs.sort((a, b) => a[0] - b[0]).flat();
}
