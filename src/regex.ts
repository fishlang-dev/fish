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
  | { kind: "backref"; groups: u32[]; fold: boolean; name?: string }
  // `captures` are the groups inside, which each pass resets.
  | { kind: "repeat"; id: u32; min: usize; max: usize | undefined; greedy: boolean; body: RegexNode; captures: [usize, usize] };

export type Capture = { name: string | undefined; optional: boolean };

export type RegexPattern = { tree: RegexNode; captures: Capture[]; flags: string; unicode: boolean; backtracks: boolean };

export class RegexSyntaxError {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/** @throws {RegexSyntaxError} */
const fail = (message: string): never => {
  throw new RegexSyntaxError(`invalid regular expression: ${message}`);
};

function syntaxCodes(): Set<u32> {
  let codes = new Set<u32>();
  const chars = "^$\\.*+?()[]{}|";
  for (let i = 0; i < chars.length; i++) codes.add(chars.charCodeAt(i) as u32);
  return codes;
}
const SYNTAX = syntaxCodes();
const at = (c: string): u32 => c.charCodeAt(0) as u32;

export const DIGITS: Ranges = [[0x30, 0x39]];
export const WORD: Ranges = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];
export const SPACE: Ranges = [[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]];

export function normalize(ranges: Ref<Ranges>): Ranges {
  const sorted = ranges.toSorted((a, b) => (a[0] as i64) - (b[0] as i64));
  let out: Ranges = [];
  for (const [lo, hi] of sorted) {
    if (out.length > 0 && lo <= out[out.length - 1]![1] + 1) {
      const prev = out[out.length - 1]!;
      out[out.length - 1] = [prev[0], Math.max(prev[1], hi)];
    } else out.push([lo, hi]);
  }
  return out;
}

export function complement(ranges: Ref<Ranges>, top: u32): Ranges {
  let out: Ranges = [];
  let next: u32 = 0;
  for (const [lo, hi] of normalize(ranges)) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= top) out.push([next, top]);
  return out;
}

function intersect(a: Ref<Ranges>, b: Ref<Ranges>): Ranges {
  let out: Ranges = [];
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
/** @throws {RegexSyntaxError} */
function property(tables: Mut<RegexTables>, body: string, sets: boolean): Ranges {
  if (sets && STRING_PROPERTIES.has(body)) return fail("properties of strings are not supported yet");
  let found = tables.properties.get(body);
  if (found === undefined) {
    let test: RegExp;
    switch (body) {
      case "L":
      case "Letter":
        test = /^\p{L}$/u;
        break;
      case "Lu":
      case "Uppercase_Letter":
        test = /^\p{Lu}$/u;
        break;
      case "ID_Start":
        test = /^\p{ID_Start}$/u;
        break;
      case "ID_Continue":
        test = /^\p{ID_Continue}$/u;
        break;
      case "Script=Greek":
        test = /^\p{Script=Greek}$/u;
        break;
      default:
        return fail("invalid property expression");
    }
    let ranges: Ranges = [];
    let start: i64 = -1;
    for (let c: u32 = 0; c <= 0x110000; c++) {
      const yes = c < 0x110000 && test.test(String.fromCodePoint(c));
      if (yes && start < 0) start = c as i64;
      if (!yes && start >= 0) {
        ranges.push([start as u32, c - 1]);
        start = -1;
      }
    }
    tables.properties.set(body, ranges);
  }
  return tables.properties.get(body)!;
}

const isDigit = (c: u32 | undefined): boolean => c !== undefined && c >= 0x30 && c <= 0x39;
const hexValue = (c: u32 | undefined): i32 => (c === undefined ? -1 : isDigit(c) ? ((c - 0x30) as i32) : (c | 0x20) >= 0x61 && (c | 0x20) <= 0x66 ? (((c | 0x20) - 0x61 + 10) as i32) : -1);

class Parser {
  sets: boolean;
  unicode: boolean;
  top: u32;
  text: u32[];
  pos: usize = 0;
  repeats: u32 = 0;
  captures: Capture[] = [];
  names: Map<string, u32[]> = new Map<string, u32[]>();
  backrefs: { name?: string; index?: usize }[] = [];
  backtracks: boolean = false;
  named: boolean = false;
  fold: boolean;
  multiline: boolean;
  dotAll: boolean;
  alternativeNames: Set<string>[] = [new Set()];

  constructor(source: string, flags: string) {
    const sets = flags.includes("v");
    const unicode = sets || flags.includes("u");
    this.sets = sets;
    this.unicode = unicode;
    this.top = unicode ? 0x10ffff : 0xffff;
    this.text = unicode ? [...source].map((c) => c.codePointAt(0)!) : Array.from({ length: source.length }, (_, i) => source.charCodeAt(i as usize) as u32);
    this.fold = flags.includes("i");
    this.multiline = flags.includes("m");
    this.dotAll = flags.includes("s");
    // Named groups make `\k` a backreference even without `u`, as Annex B says.
    this.named = this.groupOpenings().some((i) => i + 3 < this.text.length && this.text[i + 1] === at("?") && this.text[i + 2] === at("<") && this.text[i + 3] !== at("=") && this.text[i + 3] !== at("!"));
  }

  peek(this: Ref<this>, k: usize = 0): u32 | undefined {
    return this.pos + k < this.text.length ? this.text[this.pos + k] : undefined;
  }

  eat(this: Mut<this>, c: string): boolean {
    if (this.peek() !== at(c)) return false;
    this.pos++;
    return true;
  }

  /** @throws {RegexSyntaxError} */
  disjunction(this: Mut<this>, tables: Mut<RegexTables>): RegexNode {
    let options = [this.alternative(tables)];
    while (this.eat("|")) {
      this.alternativeNames = [...this.alternativeNames.slice(0, -1), new Set()];
      options.push(this.alternative(tables));
    }
    return options.length === 1 ? options.pop()! : { kind: "alt", options };
  }

  /** @throws {RegexSyntaxError} */
  alternative(this: Mut<this>, tables: Mut<RegexTables>): RegexNode {
    let items: RegexNode[] = [];
    while (this.pos < this.text.length && this.peek() !== at("|") && this.peek() !== at(")")) items.push(this.term(tables));
    return items.length === 0 ? { kind: "empty" } : items.length === 1 ? items.pop()! : { kind: "seq", items };
  }

  /** @throws {RegexSyntaxError} */
  term(this: Mut<this>, tables: Mut<RegexTables>): RegexNode {
    const first = this.captures.length;
    const [atom, quantifiable] = this.atomOrAssertion(tables);
    const quantifier = this.quantifierHere();
    if (quantifier === undefined) return atom;
    if (!quantifiable) fail(atom.kind === "look" && atom.behind ? "invalid quantifier" : "nothing to repeat");
    const [min, max, greedy] = quantifier;
    return { kind: "repeat", id: this.repeats++, min, max, greedy, body: atom, captures: [first, this.captures.length] };
  }

  // A quantifier here, read and consumed, or none. Without `u`, a `{` that doesn't begin one is
  // an ordinary character.
  /** @throws {RegexSyntaxError} */
  quantifierHere(this: Mut<this>): [usize, usize | undefined, boolean] | undefined {
    const c = this.peek();
    let min: usize, max: usize | undefined;
    if (c === at("*")) [min, max] = [0, undefined];
    else if (c === at("+")) [min, max] = [1, undefined];
    else if (c === at("?")) [min, max] = [0, 1];
    else if (c === at("{")) {
      const braced = this.bracedQuantifier();
      if (braced === undefined) return undefined;
      [min, max] = braced;
      if (max !== undefined && min > max) fail("numbers out of order in {} quantifier");
      return [min, max, !this.eat("?")];
    } else return undefined;
    this.pos++;
    return [min, max, !this.eat("?")];
  }

  /** @throws {RegexSyntaxError} */
  bracedQuantifier(this: Mut<this>): [usize, usize | undefined] | undefined {
    const start = this.pos;
    this.pos++;
    let min: f64 = -1;
    while (isDigit(this.peek())) min = (min < 0 ? 0 : min) * 10 + ((this.text[this.pos++]! - 0x30) as f64);
    let max: f64 | undefined = min;
    if (min >= 0 && this.eat(",")) {
      let m: f64 = -1;
      while (isDigit(this.peek())) m = (m < 0 ? 0 : m) * 10 + ((this.text[this.pos++]! - 0x30) as f64);
      max = m < 0 ? undefined : m;
    }
    if (min >= 0 && this.eat("}")) return [Math.min(min, 2 ** 31) as usize, max === undefined ? undefined : (Math.min(max, 2 ** 31) as usize)];
    this.pos = start;
    if (this.unicode) fail("incomplete {} quantifier for Unicode pattern");
    return undefined;
  }

  /** @throws {RegexSyntaxError} */
  atomOrAssertion(this: Mut<this>, tables: Mut<RegexTables>): [RegexNode, boolean] {
    const c = this.peek()!;
    if (c === at("^")) {
      this.pos++;
      return [{ kind: "assert", which: "start", multiline: this.multiline, fold: this.fold }, false];
    }
    if (c === at("$")) {
      this.pos++;
      return [{ kind: "assert", which: "end", multiline: this.multiline, fold: this.fold }, false];
    }
    if (c === at("\\") && (this.peek(1) === at("b") || this.peek(1) === at("B"))) {
      this.pos += 2;
      const which: "word" | "notWord" = this.text[this.pos - 1] === at("b") ? "word" : "notWord";
      return [{ kind: "assert", which, multiline: this.multiline, fold: this.fold }, false];
    }
    if (c === at("(")) return this.group(tables);
    if (c === at(".")) {
      this.pos++;
      return [{ kind: "dot", dotAll: this.dotAll }, true];
    }
    if (c === at("[")) return [this.sets ? this.classSet(tables) : this.classRanges(tables), true];
    if (c === at("\\")) return [this.atomEscape(tables), true];
    if (c === at("*") || c === at("+") || c === at("?")) fail("nothing to repeat");
    if (c === at("{")) {
      if (this.unicode) fail("incomplete {} quantifier for Unicode pattern");
      if (this.bracedQuantifier() !== undefined) fail("nothing to repeat");
    }
    if (this.unicode && (c === at("}") || c === at("]"))) fail(c === at("}") ? "incomplete {} quantifier for Unicode pattern" : "unmatched ] in Unicode pattern");
    this.pos++;
    return [{ kind: "char", c, fold: this.fold }, true];
  }

  /** @throws {RegexSyntaxError} */
  group(this: Mut<this>, tables: Mut<RegexTables>): [RegexNode, boolean] {
    this.pos++;
    if (this.eat("?")) {
      const behind = this.eat("<");
      if (this.peek() === at("=") || this.peek() === at("!")) {
        const negated = this.text[this.pos++] === at("!");
        this.backtracks = true;
        const body = this.disjunction(tables);
        if (!this.eat(")")) fail("missing )");
        // Without `u`, a lookahead may be quantified, as Annex B allows.
        return [{ kind: "look", behind, negated, body }, !behind && !this.unicode];
      }
      if (behind) {
        const name = this.groupName();
        return this.capture(name, tables);
      }
      if (this.eat(":")) return this.scoped(undefined, tables);
      return this.modifiers(tables);
    }
    return this.capture(undefined, tables);
  }

  /** @throws {RegexSyntaxError} */
  capture(this: Mut<this>, name: string | undefined, tables: Mut<RegexTables>): [RegexNode, boolean] {
    if (name !== undefined) {
      if (this.alternativeNames.some((s) => s.has(name))) fail("duplicate group specifier name");
      this.alternativeNames[this.alternativeNames.length - 1]!.add(name);
      const prev = this.names.get(name);
      const nextIndex = (this.captures.length + 1) as u32;
      if (prev !== undefined) this.names.set(name, [...prev, nextIndex]);
      else this.names.set(name, [nextIndex]);
    }
    this.captures.push({ name, optional: false });
    return this.scoped(this.captures.length, tables);
  }

  // A group's body, its own scope for the names its alternatives use.
  /** @throws {RegexSyntaxError} */
  scoped(this: Mut<this>, index: usize | undefined, tables: Mut<RegexTables>): [RegexNode, boolean] {
    const outerLen = this.alternativeNames.length;
    this.alternativeNames.push(new Set());
    const body = this.disjunction(tables);
    // What the group's alternatives named is named in the alternative around it too.
    const inner = this.alternativeNames.splice(outerLen as i64);
    for (const s of inner) for (const n of s) this.alternativeNames[this.alternativeNames.length - 1]!.add(n);
    if (!this.eat(")")) fail("missing )");
    return [{ kind: "group", index, body }, true];
  }

  // `(?ims-ims:...)` turns flags on or off inside the group.
  /** @throws {RegexSyntaxError} */
  modifiers(this: Mut<this>, tables: Mut<RegexTables>): [RegexNode, boolean] {
    let on = "", off = "", minus = false;
    for (;;) {
      const c = this.peek();
      if (c === at("-") && !minus) {
        minus = true;
        this.pos++;
      } else if (c === at("i") || c === at("m") || c === at("s")) {
        const f = String.fromCharCode(c! as u16);
        if (on.includes(f) || off.includes(f)) fail("invalid regular expression modifier");
        if (minus) off += f;
        else on += f;
        this.pos++;
      } else break;
    }
    if (!this.eat(":") || (minus && on + off === "")) fail(this.peek() === undefined ? "missing )" : "invalid regular expression modifier");
    if (on + off === "") fail("invalid group");
    const saved = [this.fold, this.multiline, this.dotAll] as const;
    if (on.includes("i") || off.includes("i")) this.fold = on.includes("i");
    if (on.includes("m") || off.includes("m")) this.multiline = on.includes("m");
    if (on.includes("s") || off.includes("s")) this.dotAll = on.includes("s");
    const result = this.scoped(undefined, tables);
    [this.fold, this.multiline, this.dotAll] = saved;
    return result;
  }

  /** @throws {RegexSyntaxError} */
  groupName(this: Mut<this>): string {
    let name = "";
    for (;;) {
      if (this.pos >= this.text.length) fail("invalid capture group name");
      if (this.eat(">")) break;
      let c = this.text[this.pos++]!;
      if (c === at("\\")) {
        if (!this.eat("u")) fail("invalid capture group name");
        c = this.unicodeEscape(true) ?? fail("invalid capture group name");
      } else if (!this.unicode && c >= 0xd800 && c <= 0xdbff && (this.peek() ?? 0) >= 0xdc00 && this.peek()! <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (this.text[this.pos++]! - 0xdc00);
      }
      const ch = String.fromCodePoint(c);
      if (!(name === "" ? /[\p{ID_Start}$_]/u : /[\p{ID_Continue}$‌‍]/u).test(ch)) fail("invalid capture group name");
      name += ch;
    }
    if (name === "") fail("invalid capture group name");
    return name;
  }

  fourAt(this: Ref<this>, atPos: usize): i32 {
    let v: i32 = 0;
    for (let k: usize = 0; k < 4; k++) {
      const h = hexValue(atPos + k < this.text.length ? this.text[atPos + k] : undefined);
      if (h < 0) return -1;
      v = v * 16 + h;
    }
    return v;
  }

  // After `\u`: four hex digits, a surrogate pair of them under `u`, or `{...}` under `u` (or in
  // a group name, always); undefined when what follows isn't one.
  /** @throws {RegexSyntaxError} */
  unicodeEscape(this: Mut<this>, braces: boolean): u32 | undefined {
    const start = this.pos;
    if ((this.unicode || braces) && this.eat("{")) {
      let v: u32 = 0, digits = 0;
      while (hexValue(this.peek()) >= 0) {
        v = v * 16 + (hexValue(this.text[this.pos++]) as u32);
        digits++;
        if (v > 0x10ffff) fail("invalid Unicode {} escape");
      }
      if (digits === 0 || !this.eat("}")) {
        if (this.unicode) fail("invalid Unicode {} escape");
        this.pos = start;
        return undefined;
      }
      return v;
    }
    const v = this.fourAt(this.pos);
    if (v < 0) {
      if (this.unicode) fail("invalid Unicode \\u escape");
      return undefined;
    }
    this.pos += 4;
    if ((this.unicode || braces) && v >= 0xd800 && v <= 0xdbff && this.peek() === at("\\") && this.peek(1) === at("u")) {
      const low = this.fourAt(this.pos + 2);
      if (low >= 0xdc00 && low <= 0xdfff) {
        this.pos += 6;
        return (0x10000 + ((v - 0xd800) << 10) + (low - 0xdc00)) as u32;
      }
    }
    return v as u32;
  }

  /** @throws {RegexSyntaxError} */
  atomEscape(this: Mut<this>, tables: Mut<RegexTables>): RegexNode {
    this.pos++;
    const c = this.peek() ?? fail("\\ at end of pattern");
    if (isDigit(c) && c !== at("0")) {
      const start = this.pos;
      let n: usize = 0;
      while (isDigit(this.peek())) n = n * 10 + ((this.text[this.pos++]! - 0x30) as usize);
      this.backrefs.push({ index: n });
      // Without `u`, a number past the groups is an octal escape, or the digit itself.
      if (!this.unicode && n > this.countGroups()) {
        this.pos = start;
        if (c >= at("8")) {
          this.pos++;
          return { kind: "char", c, fold: this.fold };
        }
        return { kind: "char", c: this.octal(), fold: this.fold };
      }
      this.backtracks = true;
      return { kind: "backref", groups: [n as u32], fold: this.fold };
    }
    if (c === at("k") && (this.unicode || this.named)) {
      this.pos++;
      if (!this.eat("<")) fail("invalid \\k<> named backreference");
      const name = this.groupName();
      this.backrefs.push({ name });
      this.backtracks = true;
      return { kind: "backref", groups: [], fold: this.fold, name };
    }
    const set = this.classEscape(tables);
    // Without `v`, a negated escape like \P{Lu} is its complement before case folding, as
    // JavaScript reads it; under `v`, and in a negated class, folding comes first.
    if (set !== undefined) return set.negated && !this.sets ? { ...set, ranges: complement(set.ranges, this.top), negated: false } : set;
    return { kind: "char", c: this.characterEscape(false), fold: this.fold };
  }

  // Where each `(` outside a class and not escaped is, which a backreference may count before
  // its group is reached.
  groupOpenings(this: Ref<this>): usize[] {
    let out: usize[] = [];
    let inClass = false;
    for (let i: usize = 0; i < this.text.length; i++) {
      const ch = this.text[i];
      if (ch === at("\\")) i++;
      else if (ch === at("[")) inClass = true;
      else if (ch === at("]")) inClass = false;
      else if (ch === at("(") && !inClass) out.push(i);
    }
    return out;
  }

  countGroups(this: Ref<this>): usize {
    return this.groupOpenings().filter((i) => this.text[i + 1] !== at("?") || (this.text[i + 2] === at("<") && this.text[i + 3] !== at("=") && this.text[i + 3] !== at("!"))).length;
  }

  octal(this: Mut<this>): u32 {
    let v = this.text[this.pos++]! - 0x30;
    if (this.peek() !== undefined && this.peek()! >= 0x30 && this.peek()! <= 0x37) {
      v = v * 8 + (this.text[this.pos++]! - 0x30);
      if (v < 32 && this.peek() !== undefined && this.peek()! >= 0x30 && this.peek()! <= 0x37) v = v * 8 + (this.text[this.pos++]! - 0x30);
    }
    return v;
  }

  // `\d`, `\w`, `\s`, their negations, and `\p{...}` under `u` or `v`, consumed; undefined for
  // anything else.
  /** @throws {RegexSyntaxError} */
  classEscape(this: Mut<this>, tables: Mut<RegexTables>): Extract<RegexNode, { kind: "set" }> | undefined {
    const c = this.peek()!;
    const upper = c >= at("A") && c <= at("Z");
    const base = c | 0x20;
    if (base === at("d") || base === at("s") || base === at("w")) {
      this.pos++;
      let ranges: Ranges = [...(base === at("d") ? DIGITS : base === at("s") ? SPACE : WORD)];
      // Under `i` with `u` or `v`, ſ and the Kelvin sign fold into \w's letters.
      if (base === at("w") && this.fold && this.unicode) ranges = normalize([...ranges, [0x17f, 0x17f], [0x212a, 0x212a]]);
      return { kind: "set", ranges, negated: upper, strings: [], fold: false };
    }
    if (base === at("p") && this.unicode) {
      this.pos++;
      if (!this.eat("{")) fail("invalid property expression");
      let body = "";
      while (this.pos < this.text.length && this.peek() !== at("}")) body += String.fromCodePoint(this.text[this.pos++]!);
      if (!this.eat("}")) fail("invalid property expression");
      return { kind: "set", ranges: [...property(tables, body, this.sets)], negated: upper, strings: [], fold: this.fold };
    }
    return undefined;
  }

  // A character escape's value; `inClass` for the forms only a class allows.
  /** @throws {RegexSyntaxError} */
  characterEscape(this: Mut<this>, inClass: boolean): u32 {
    const c = this.text[this.pos++]!;
    switch (c) {
      case at("f"): return 0x0c;
      case at("n"): return 0x0a;
      case at("r"): return 0x0d;
      case at("t"): return 0x09;
      case at("v"): return 0x0b;
      case at("c"): {
        const letter = this.peek();
        if (letter !== undefined && ((letter | 0x20) >= at("a") && (letter | 0x20) <= at("z"))) {
          this.pos++;
          return letter % 32;
        }
        // Annex B: in a class, `\c` takes a digit or `_` too; elsewhere a lone `\c` is a
        // backslash followed by `c`.
        if (!this.unicode && inClass && letter !== undefined && (isDigit(letter) || letter === at("_"))) {
          this.pos++;
          return letter % 32;
        }
        if (this.unicode) fail("invalid escaped character for Unicode pattern");
        this.pos--;
        return at("\\");
      }
      case at("0"):
        if (!isDigit(this.peek())) return 0;
        if (this.unicode) fail("invalid decimal escape for Unicode pattern");
        this.pos--;
        return this.octal();
      case at("x"): {
        const [h1, h2] = [hexValue(this.peek()), hexValue(this.peek(1))];
        if (h1 >= 0 && h2 >= 0) {
          this.pos += 2;
          return (h1 * 16 + h2) as u32;
        }
        if (this.unicode) fail("invalid escaped character for Unicode pattern");
        return c;
      }
      case at("u"): {
        const v = this.unicodeEscape(false);
        return v ?? c;
      }
    }
    if (!this.unicode) {
      if (inClass && isDigit(c)) {
        this.pos--;
        return c >= at("8") ? this.text[this.pos++]! : this.octal();
      }
      if (c === at("k") && this.named) fail("invalid \\k<> named backreference");
      return c;
    }
    if (SYNTAX.has(c) || c === at("/") || (inClass && c === at("-"))) return c;
    return fail("invalid escaped character for Unicode pattern");
  }

  // A class without `v`: atoms and ranges of them.
  /** @throws {RegexSyntaxError} */
  classRanges(this: Mut<this>, tables: Mut<RegexTables>): RegexNode {
    this.pos++;
    const negated = this.eat("^");
    let ranges: Ranges = [];
    for (;;) {
      if (this.pos >= this.text.length) fail("missing terminating ] for character class");
      if (this.eat("]")) break;
      const lo = this.classAtom(tables);
      if (this.peek() === at("-") && this.peek(1) !== undefined && this.peek(1) !== at("]")) {
        this.pos++;
        const hi = this.classAtom(tables);
        if (typeof lo !== "number" || typeof hi !== "number") {
          if (this.unicode) fail("invalid range in character class for Unicode pattern");
          // Annex B: a class escape at either end makes the dash an ordinary character.
          for (const end of [lo, hi]) {
            if (typeof end === "number") ranges.push([end, end]);
            else for (const r of this.setRanges(end)) ranges.push(r);
          }
          ranges.push([at("-"), at("-")]);
          continue;
        }
        if (lo > hi) fail("range out of order in character class");
        ranges.push([lo, hi]);
        continue;
      }
      if (typeof lo === "number") ranges.push([lo, lo]);
      else for (const r of this.setRanges(lo)) ranges.push(r);
    }
    return { kind: "set", ranges: normalize(ranges), negated, strings: [], fold: this.fold };
  }

  setRanges(this: Ref<this>, s: Ref<Extract<RegexNode, { kind: "set" }>>): Ranges {
    return s.negated ? complement(s.ranges, this.top) : [...s.ranges];
  }

  /** @throws {RegexSyntaxError} */
  classAtom(this: Mut<this>, tables: Mut<RegexTables>): u32 | Extract<RegexNode, { kind: "set" }> {
    const c = this.text[this.pos]!;
    if (c !== at("\\")) {
      this.pos++;
      return c;
    }
    this.pos++;
    if (this.pos >= this.text.length) fail("\\ at end of pattern");
    if (this.eat("b")) return 0x08;
    if (this.unicode && this.eat("-")) return at("-");
    const set = this.classEscape(tables);
    if (set !== undefined) return set;
    return this.characterEscape(true);
  }

  // A class under `v`: unions, intersections with `&&`, differences with `--`, nested classes
  // and `\q{...}` strings.
  /** @throws {RegexSyntaxError} */
  classSetOperand(this: Mut<this>, tables: Mut<RegexTables>): { ranges: Ranges; strings: string[] } {
    if (this.peek() === at("[")) {
      const inner = this.classSet(tables);
      return { ranges: inner.negated ? complement(inner.ranges, this.top) : inner.ranges, strings: inner.strings };
    }
    if (this.peek() === at("\\")) {
      this.pos++;
      if (this.pos >= this.text.length) fail("\\ at end of pattern");
      if (this.peek() === at("q") && this.peek(1) === at("{")) {
        this.pos += 2;
        let strings: string[] = [];
        let ranges: Ranges = [];
        let current = "";
        let count: usize = 0;
        let firstCode: u32 = 0;
        for (;;) {
          if (this.pos >= this.text.length) fail("missing terminating } for \\q");
          if (this.eat("}")) break;
          if (this.eat("|")) {
            if (count === 1) ranges.push([firstCode, firstCode]);
            else strings.push(current);
            current = "";
            count = 0;
            continue;
          }
          const cp = this.eat("\\") ? (this.eat("b") ? 0x08 : this.characterEscape(true)) : this.text[this.pos++]!;
          if (count === 0) firstCode = cp;
          current += String.fromCodePoint(cp);
          count++;
        }
        if (count === 1) ranges.push([firstCode, firstCode]);
        else strings.push(current);
        return { ranges: normalize(ranges), strings };
      }
      if (this.eat("b")) return { ranges: [[8, 8]], strings: [] };
      const set = this.classEscape(tables);
      if (set !== undefined) return { ranges: set.negated ? complement(set.ranges, this.top) : set.ranges, strings: set.strings };
      const c = this.peek()!;
      // Under `v`, class punctuation may be escaped.
      if ("&-!#%,:;<=>@`~".includes(String.fromCodePoint(c))) {
        this.pos++;
        return { ranges: [[c, c]], strings: [] };
      }
      const v = this.characterEscape(true);
      return { ranges: [[v, v]], strings: [] };
    }
    if (this.pos >= this.text.length) fail("missing terminating ] for character class");
    const c = this.text[this.pos]!;
    const ch = String.fromCodePoint(c);
    if ("()[]{}/-|".includes(ch) || (c === this.peek(1) && "&!#$%*+,.:;<=>?@^`~".includes(ch))) fail("invalid class set character");
    this.pos++;
    return { ranges: [[c, c]], strings: [] };
  }

  /** @throws {RegexSyntaxError} */
  classSetSingle(this: Mut<this>, tables: Mut<RegexTables>): { ranges: Ranges; strings: string[] } {
    const start = this.pos;
    const first = this.classSetOperand(tables);
    // A lone character may start a range.
    const nextCode = start + 1 < this.text.length ? this.text[start + 1]! : 0;
    const lone = first.strings.length === 0 && first.ranges.length === 1 && first.ranges[0]![0] === first.ranges[0]![1] && this.text[start] !== at("[") && !(this.text[start] === at("\\") && "dDsSwWpPq".includes(String.fromCodePoint(nextCode)));
    if (lone && this.peek() === at("-") && this.peek(1) !== at("-")) {
      this.pos++;
      const hiStart = this.pos;
      const hi = this.classSetOperand(tables);
      const hiLone = hi.strings.length === 0 && hi.ranges.length === 1 && hi.ranges[0]![0] === hi.ranges[0]![1] && this.text[hiStart] !== at("[");
      if (!hiLone) fail("invalid class set character");
      const [lo, h] = [first.ranges[0]![0], hi.ranges[0]![0]];
      if (lo > h) fail("range out of order in character class");
      return { ranges: [[lo, h]], strings: [] };
    }
    return first;
  }

  /** @throws {RegexSyntaxError} */
  classSet(this: Mut<this>, tables: Mut<RegexTables>): Extract<RegexNode, { kind: "set" }> {
    this.pos++;
    const negated = this.eat("^");
    let result: { ranges: Ranges; strings: string[] } = { ranges: [], strings: [] };
    let op: "union" | "and" | "minus" | undefined = undefined;
    let count = 0;
    for (;;) {
      if (this.pos >= this.text.length) fail("missing terminating ] for character class");
      if (this.eat("]")) break;
      const next: "union" | "and" | "minus" = this.peek() === at("&") && this.peek(1) === at("&") ? "and" : this.peek() === at("-") && this.peek(1) === at("-") ? "minus" : "union";
      if (next !== "union") {
        if (count === 0 || (op !== undefined && op !== next)) fail("invalid operation in class set");
        this.pos += 2;
        if (this.peek() === at("&") || this.peek() === at("]")) fail("invalid operation in class set");
        op = next;
        const rhs = this.classSetSingle(tables);
        result = next === "and"
          ? { ranges: intersect(result.ranges, rhs.ranges), strings: result.strings.filter((s) => rhs.strings.includes(s)) }
          : { ranges: intersect(result.ranges, complement(rhs.ranges, this.top)), strings: result.strings.filter((s) => !rhs.strings.includes(s)) };
        count++;
        continue;
      }
      if (op === "and" || op === "minus") fail("invalid operation in class set");
      if (count > 0) op = "union";
      const part = this.classSetSingle(tables);
      result = { ranges: normalize([...result.ranges, ...part.ranges]), strings: [...new Set([...result.strings, ...part.strings])] };
      count++;
    }
    if (negated && result.strings.length > 0) fail("negated class set may contain strings");
    return { kind: "set", ranges: result.ranges, negated, strings: result.strings, fold: this.fold };
  }
}

/** @throws {RegexSyntaxError} */
export function parsePattern(source: string, flags: string, tables: Mut<RegexTables>): RegexPattern {
  const flagChars = [...flags];
  for (const [i, f] of flagChars.entries()) {
    if (!"dgimsuvy".includes(f) || flags.indexOf(f) !== (i as i64)) fail(`invalid flags supplied to RegExp constructor '${flags}'`);
  }
  if (flags.includes("v") && flags.includes("u")) fail(`invalid flags supplied to RegExp constructor '${flags}'`);
  let p = new Parser(source, flags);
  let tree = p.disjunction(tables);
  if (p.pos < p.text.length) fail(p.peek() === at(")") ? "unmatched parentheses" : "unexpected character");
  for (const ref of p.backrefs) {
    if (ref.name !== undefined && !p.names.has(ref.name)) fail("invalid \\k<> named backreference");
    if (ref.index !== undefined && p.unicode && ref.index > p.captures.length) fail("invalid backreference for Unicode pattern");
  }
  tree = resolveNames(tree, p.names);
  markOptional(tree, p.captures, true);
  return { tree, captures: p.captures, flags, unicode: p.unicode, backtracks: p.backtracks };
}

// A named backreference points at every group of its name.
function resolveNames(n: RegexNode, names: Ref<Map<string, u32[]>>): RegexNode {
  let m = n;
  if (m.kind === "backref" && m.name !== undefined) {
    m.groups = [...names.get(m.name)!];
    m.name = undefined;
  }
  switch (m.kind) {
    case "seq":
      for (let i = m.items.splice(0); i.length > 0; ) m.items.push(resolveNames(i.shift()!, names));
      break;
    case "alt":
      for (let i = m.options.splice(0); i.length > 0; ) m.options.push(resolveNames(i.shift()!, names));
      break;
    case "group":
      m.body = resolveNames(m.body, names);
      break;
    case "look":
      m.body = resolveNames(m.body, names);
      break;
    case "repeat":
      m.body = resolveNames(m.body, names);
      break;
  }
  return m;
}

// A capture that some match can leave out is optional: inside one of several alternatives, a
// repeat that may run no times, or a negative lookaround.
function markOptional(n: Ref<RegexNode>, captures: Mut<Capture[]>, sure: boolean): void {
  if (n.kind === "group" && n.index !== undefined && !sure) captures[n.index - 1]!.optional = true;
  const inner = n.kind === "alt" ? false : n.kind === "repeat" ? sure && n.min > 0 : n.kind === "look" ? sure && !n.negated : sure;
  switch (n.kind) {
    case "seq":
      for (const child of n.items) markOptional(child, captures, inner);
      break;
    case "alt":
      for (const child of n.options) markOptional(child, captures, inner);
      break;
    case "group":
      markOptional(n.body, captures, inner);
      break;
    case "look":
      markOptional(n.body, captures, inner);
      break;
    case "repeat":
      markOptional(n.body, captures, inner);
      break;
  }
}

// The compiled program the runtime's matchers run: a header of the group count, the
// registers repeat checks use, flags (1 unicode, 2 sticky, 4 backtracking, 8 a fold table, 16 a
// table of group names, 32 global) and
// where the instructions end, then instructions of 32-bit words. Positions are UTF-16 code units; with `u` or `v` a character is a code point, and a
// surrogate pair one step. The layout is shared with `native.ts`.
export const OP: {
  match: u32; char: u32; any: u32; anyAll: u32; set: u32; split: u32; jump: u32; save: u32; assert: u32; reset: u32; mark: u32; check: u32;
  backref: u32; look: u32; lookEnd: u32;
} = {
  match: 0, char: 1, any: 2, anyAll: 3, set: 4, split: 5, jump: 6, save: 7, assert: 8, reset: 9, mark: 10, check: 11,
  backref: 12, look: 13, lookEnd: 14,
};
// A matching instruction run backwards, inside a lookbehind, has this bit set.
export const BACKWARD: u32 = 32;
export const HEADER: usize = 4;
export const PROGRAM_LIMIT: usize = 1 << 20;

class Compiler {
  code: u32[] = [];
  registers: u32 = 0;
  registerOf: Map<u32, u32> = new Map<u32, u32>();
  folds: boolean = false;
  unicode: boolean;
  top: u32;

  constructor(unicode: boolean) {
    this.unicode = unicode;
    this.top = unicode ? 0x10ffff : 0xffff;
  }

  /** @throws {RegexSyntaxError} */
  emit(this: Mut<this>, words: u32[]): usize {
    for (const w of words) this.code.push(w);
    if (this.code.length > PROGRAM_LIMIT) fail("regular expression too large");
    return this.code.length - words.length;
  }

  /** @throws {RegexSyntaxError} */
  set(this: Mut<this>, ranges: Ranges, _negated: boolean, dir: u32): void {
    let words: u32[] = [OP.set | dir, ranges.length as u32];
    for (const [lo, hi] of ranges) {
      words.push(lo);
      words.push(hi);
    }
    this.emit(words);
  }

  /** @throws {RegexSyntaxError} */
  node(this: Mut<this>, n: Ref<RegexNode>, back: boolean, tables: Mut<RegexTables>): void {
    const dir = back ? BACKWARD : 0;
    switch (n.kind) {
      case "empty":
        return;
      case "char": {
        const one: Ranges = [[n.c, n.c]];
        const ranges: Ranges = n.fold ? foldRanges(tables, one, this.unicode) : one;
        if (ranges.length === 1 && ranges[0]![0] === ranges[0]![1]) this.emit([OP.char | dir, n.c]);
        else this.set(ranges, false, dir);
        return;
      }
      case "dot":
        this.emit([(n.dotAll ? OP.anyAll : OP.any) | dir]);
        return;
      case "set": {
        let ranges: Ranges = n.fold ? foldRanges(tables, [...n.ranges], this.unicode) : [...n.ranges];
        if (n.negated) ranges = complement(ranges, this.top);
        // A class under `v` holding strings tries the longest string first, as JavaScript does.
        if (n.strings.length > 0) {
          let options: RegexNode[] = n.strings.toSorted((a, b) => ([...b].length as i64) - ([...a].length as i64)).map((s): RegexNode => ({ kind: "seq", items: [...s].map((c): RegexNode => ({ kind: "char", c: c.codePointAt(0)!, fold: n.fold })) }));
          options.push({ kind: "set", ranges, negated: false, strings: [], fold: false });
          this.node({ kind: "alt", options }, back, tables);
          return;
        }
        this.set(ranges, false, dir);
        return;
      }
      case "seq":
        for (const item of back ? n.items.toReversed() : n.items) this.node(item, back, tables);
        return;
      case "alt": {
        let jumps: usize[] = [];
        for (let i: usize = 0; i < n.options.length; i++) {
          if (i < n.options.length - 1) {
            const split = this.emit([OP.split, 0, 0]);
            this.code[split + 1] = this.code.length as u32;
            this.node(n.options[i]!, back, tables);
            jumps.push(this.emit([OP.jump, 0]));
            this.code[split + 2] = this.code.length as u32;
          } else this.node(n.options[i]!, back, tables);
        }
        for (const j of jumps) this.code[j + 1] = this.code.length as u32;
        return;
      }
      case "group":
        if (n.index === undefined) {
          this.node(n.body, back, tables);
          return;
        }
        this.emit([OP.save, (n.index * 2 + (back ? 1 : 0)) as u32]);
        this.node(n.body, back, tables);
        this.emit([OP.save, (n.index * 2 + (back ? 0 : 1)) as u32]);
        return;
      case "assert":
        this.emit([OP.assert, ["start", "end", "word", "notWord"].indexOf(n.which) as u32, n.multiline ? 1 : 0, n.fold && this.unicode ? 1 : 0]);
        return;
      case "backref":
        this.folds ||= n.fold;
        this.emit([OP.backref | dir, n.fold ? 1 : 0, n.groups.length as u32, ...n.groups]);
        return;
      case "look": {
        const look = this.emit([OP.look, n.negated ? 1 : 0, 0]);
        this.node(n.body, n.behind, tables);
        this.emit([OP.lookEnd]);
        this.code[look + 2] = this.code.length as u32;
        return;
      }
      case "repeat": {
        const [from, to] = n.captures;
        if (n.min > 0 && n.max === 1 && n.min === 1) {
          if (to > from) this.emit([OP.reset, (from + 1) as u32, (to + 1) as u32]);
          this.node(n.body, back, tables);
          return;
        }
        for (let i: usize = 0; i < n.min; i++) {
          if (to > from) this.emit([OP.reset, (from + 1) as u32, (to + 1) as u32]);
          this.node(n.body, back, tables);
        }
        if (n.max === n.min) return;
        // Each repeat has its own register, used again by every copy a bounded repeat makes of it.
        const existing = this.registerOf.get(n.id);
        let register: u32 = 0;
        if (existing === undefined) {
          register = this.registers++;
          this.registerOf.set(n.id, register);
        } else {
          register = existing;
        }
        if (n.max === undefined) {
          const loop = this.code.length;
          const split = this.emit([OP.split, 0, 0]);
          const into = this.code.length;
          this.emit([OP.mark, register]);
          if (to > from) this.emit([OP.reset, (from + 1) as u32, (to + 1) as u32]);
          this.node(n.body, back, tables);
          this.emit([OP.check, register]);
          this.emit([OP.jump, loop as u32]);
          const out = this.code.length;
          this.code[split + 1] = (n.greedy ? into : out) as u32;
          this.code[split + 2] = (n.greedy ? out : into) as u32;
          return;
        }
        // A bounded repeat's optional passes nest, so a later one runs only after an earlier one;
        // each that is skipped skips the rest, to the end.
        let splits: [usize, usize][] = [];
        for (let left = n.max - n.min; left > 0; left--) {
          const split = this.emit([OP.split, 0, 0]);
          splits.push([split, this.code.length]);
          this.emit([OP.mark, register]);
          if (to > from) this.emit([OP.reset, (from + 1) as u32, (to + 1) as u32]);
          this.node(n.body, back, tables);
          this.emit([OP.check, register]);
        }
        const out = this.code.length;
        for (const [split, into] of splits) {
          this.code[split + 1] = (n.greedy ? into : out) as u32;
          this.code[split + 2] = (n.greedy ? out : into) as u32;
        }
        return;
      }
    }
  }
}

/** @throws {RegexSyntaxError} */
export function compile(p: Ref<RegexPattern>, tables: Mut<RegexTables>): u32[] {
  let c = new Compiler(p.unicode);
  c.emit([(p.captures.length + 1) as u32, 0, flagsOf(p), 0]);
  c.emit([OP.save, 0]);
  c.node(p.tree, false, tables);
  c.emit([OP.save, 1]);
  c.emit([OP.match]);
  c.code[1] = c.registers;
  c.code[3] = c.code.length as u32;
  // A backreference that ignores case compares characters by what they fold to, from a table
  // after the instructions.
  if (c.folds) {
    const table = foldTable(tables, p.unicode);
    c.code.push((table.length / 2) as u32);
    for (const w of table) c.code.push(w);
    c.code[2] = c.code[2]! | 8;
  }
  // The groups' names, as UTF-8 bytes, for a replacement's $<name>.
  let named: [usize, string][] = [];
  for (let i: usize = 0; i < p.captures.length; i++) {
    const name = p.captures[i]!.name;
    if (name !== undefined) named.push([i + 1, name]);
  }
  if (named.length > 0) {
    c.code.push(named.length as u32);
    for (const [group, name] of named) {
      c.code.push(group as u32);
      const lenPos = c.code.length;
      c.code.push(0);
      for (let i: usize = 0; i < name.length; i++) {
        let cp = name.charCodeAt(i) as u32;
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < name.length) {
          const low = name.charCodeAt(i + 1) as u32;
          if (low >= 0xdc00 && low <= 0xdfff) {
            cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
            i++;
          }
        }
        if (cp < 0x80) c.code.push(cp);
        else if (cp < 0x800) {
          c.code.push(0xc0 | (cp >> 6));
          c.code.push(0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
          c.code.push(0xe0 | (cp >> 12));
          c.code.push(0x80 | ((cp >> 6) & 0x3f));
          c.code.push(0x80 | (cp & 0x3f));
        } else {
          c.code.push(0xf0 | (cp >> 18));
          c.code.push(0x80 | ((cp >> 12) & 0x3f));
          c.code.push(0x80 | ((cp >> 6) & 0x3f));
          c.code.push(0x80 | (cp & 0x3f));
        }
      }
      c.code[lenPos] = (c.code.length - lenPos - 1) as u32;
    }
    c.code[2] = c.code[2]! | 16;
  }
  return c.code;
}

function flagsOf(p: Ref<RegexPattern>): u32 {
  return ((p.unicode ? 1 : 0) | (p.flags.includes("y") ? 2 : 0) | (p.backtracks ? 4 : 0) | (p.flags.includes("g") ? 32 : 0)) as u32;
}

function rootOf(parent: Mut<u32[]>, c: u32): u32 {
  let cur = c;
  while (parent[cur as usize] !== cur) {
    const p = parent[cur as usize]!;
    const gp = parent[p as usize]!;
    parent[cur as usize] = gp;
    cur = gp;
  }
  return cur;
}

function joinIn(parent: Mut<u32[]>, a: u32, b: u32): void {
  const x = rootOf(parent, a);
  const y = rootOf(parent, b);
  if (x !== y) parent[Math.max(x, y) as usize] = Math.min(x, y);
}

// The characters case-insensitive matching treats as one, as a key per character: the
// smallest of its class. Without `u` or `v` a character folds to its upper case when that is
// one code unit and doesn't take a non-ASCII character to ASCII; with them, by Unicode's
// simple case folding.
function classesOf(tables: Mut<RegexTables>, unicode: boolean): u32[][] {
  let found = tables.folds.get(unicode ? "u" : "");
  if (found !== undefined) return found;
  const top: u32 = unicode ? 0x10ffff : 0xffff;
  let parent = Array.from({ length: (top + 1) as usize }, (_, i) => i as u32);
  const single = (s: string): i32 => (unicode ? ([...s].length === 1 ? (s.codePointAt(0)! as i32) : -1) : s.length === 1 ? (s.charCodeAt(0) as i32) : -1);
  let longUppers = new Map<string, u32>();
  for (let c: u32 = 0; c <= top; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCodePoint(c);
    if (!unicode) {
      const up = single(ch.toUpperCase());
      if (up >= 0 && !(c >= 128 && up < 128)) joinIn(parent, c, up as u32);
      continue;
    }
    // Turkish dotless i (U+0131) upper-cases to ASCII I (U+0049), which Unicode simple case
    // folding does not equate with it; every other single-character case mapping agrees with
    // simple case folding.
    if (c === 0x131) continue;
    for (const other of [single(ch.toUpperCase()), single(ch.toLowerCase())]) if (other >= 0) joinIn(parent, c, other as u32);
    // Characters whose upper case is several, like ΐ and ΰ, fold together only when their upper
    // cases match.
    const upper = ch.toUpperCase();
    if (single(upper) < 0) {
      const first = longUppers.get(upper);
      if (first === undefined) longUppers.set(upper, c);
      else joinIn(parent, c, first);
    }
  }
  let groups = new Map<u32, u32[]>();
  for (let c: u32 = 0; c <= top; c++) {
    const r = rootOf(parent, c);
    const group = groups.get(r);
    if (group !== undefined) groups.set(r, [...group, c]);
    else groups.set(r, [c]);
  }
  let out: u32[][] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    if (!unicode) {
      // Two characters are one when their upper cases are.
      let byKey = new Map<u32, u32[]>();
      for (const m of members) {
        const up = single(String.fromCharCode(m as u16).toUpperCase());
        const key = up >= 0 && !(m >= 128 && up < 128) ? (up as u32) : m;
        const prev = byKey.get(key);
        if (prev !== undefined) byKey.set(key, [...prev, m]);
        else byKey.set(key, [m]);
      }
      for (const g of byKey.values()) if (g.length > 1) out.push([...g]);
      continue;
    }
    out.push([...members]);
  }
  tables.folds.set(unicode ? "u" : "", out);
  return tables.folds.get(unicode ? "u" : "")!;
}

// A set closed under case folding: with every character that folds like one in it.
export function foldRanges(tables: Mut<RegexTables>, ranges: Ref<Ranges>, unicode: boolean): Ranges {
  const has = (c: u32) => {
    let lo: i64 = 0;
    let hi: i64 = (ranges.length as i64) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [a, b] = ranges[mid as usize]!;
      if (c < a) hi = mid - 1;
      else if (c > b) lo = mid + 1;
      else return true;
    }
    return false;
  };
  let extra: Ranges = [];
  for (const members of classesOf(tables, unicode)) if (members.some((c) => has(c))) for (const m of members) extra.push([m, m]);
  return extra.length === 0 ? [...ranges] : normalize([...ranges, ...extra]);
}

// The pairs of characters and the key each folds to, for backreferences that ignore case, which
// compare at run time.
export function foldTable(tables: Mut<RegexTables>, unicode: boolean): u32[] {
  let pairs: [u32, u32][] = [];
  for (const members of classesOf(tables, unicode)) {
    const key = members.reduce((a, b) => (a < b ? a : b));
    for (const m of members) if (m !== key) pairs.push([m, key]);
  }
  let out: u32[] = [];
  for (const [a, b] of pairs.toSorted((x, y) => (x[0] as i64) - (y[0] as i64))) {
    out.push(a);
    out.push(b);
  }
  return out;
}
