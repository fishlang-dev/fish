import { CompileError } from "./diag.ts";

export type Token = {
  // An `int` is an integer in any base; a `float` has a fraction or exponent; a `bigint` ends in `n`.
  // A template with substitutions arrives in pieces: a head ending in `${`, middles between
  // `}` and `${`, and a tail from `}` to the closing backtick.
  // A `private` token is a class's private name, `#` included, as in `#count`.
  kind: "ident" | "private" | "int" | "float" | "bigint" | "string" | "regex" | "template" | "templateHead" | "templateMiddle" | "templateTail" | "punct" | "eof";
  // Source text; for strings and templates, the decoded value. Keywords are idents, since most TS keywords are contextual.
  text: string;
  start: usize;
  end: usize;
  // Drives automatic semicolon insertion.
  newlineBefore: boolean;
  // On `/` and `/=`: the template substitutions open there, for rescanning it as a regex.
  substitutions?: usize[];
  // On a template piece: its text as written, escapes undecoded.
  raw?: string;
};

// Matches punctuation and keywords, never a literal with the same text.
export function isToken(t: Ref<Token>, text: string): boolean {
  return (t.kind === "punct" || t.kind === "ident") && t.text === text;
}

// Longest first, so `===` wins over `==` over `=`. `>>`, `>=` and `<<` are left to the
// parser to compose from single `<` and `>` tokens, since `A<B<C>>` closes two generics and
// `F<<T>() => T>` opens two, as TS does.
const PUNCT = [
  "**=", "&&=", "||=", "??=", "...", "===", "!==",
  "**", "=>", "|>", "==", "!=", "<=", "&&", "||", "??", "?.", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "{", "}", "(", ")", "[", "]", ";", ",", ".", ":", "?", "=", "<", ">",
  "+", "-", "*", "/", "%", "!", "|", "&", "^", "~", "@",
];

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9" && c.length === 1;
}

// The value of hex digit `c`, or -1.
function hexValue(c: string): i64 {
  if (isDigit(c)) return (c.charCodeAt(0) as i64) - 48;
  if (c.length === 1 && c >= "a" && c <= "f") return (c.charCodeAt(0) as i64) - 87;
  if (c.length === 1 && c >= "A" && c <= "F") return (c.charCodeAt(0) as i64) - 55;
  return -1;
}

// How many hex digits run from `at`, counting no more than `most`.
function hexRun(src: string, at: usize, most: usize): usize {
  let n: usize = 0;
  while (n < most && hexValue(src.charAt((at + n) as i64)) >= 0) n++;
  return n;
}

// Whether the UTF-16 unit `c` can start an identifier; the regexes are only needed past ASCII.
function identStart(c: string): boolean {
  if (c.length === 0) return false;
  if (c.charCodeAt(0) < 128) return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
  return /[\p{ID_Start}_$]/u.test(c);
}

function identPart(c: string): boolean {
  if (c.length === 0) return false;
  if (c.charCodeAt(0) < 128) return identStart(c) || isDigit(c);
  return /[\p{ID_Continue}$‌‍]/u.test(c);
}

// What `\c` stands for when `c` is one of the single-letter escapes.
function simpleEscape(c: string): string | undefined {
  switch (c) {
    case "n": return "\n";
    case "t": return "\t";
    case "r": return "\r";
    case "b": return "\b";
    case "f": return "\f";
    case "v": return "\v";
  }
  return undefined;
}

// Decodes the escape whose backslash is at `i`, returning its value and where it ends.
// Any other character escapes to itself, as in JavaScript; octal escapes are errors in
// strict mode, which every module is.
/** @throws {CompileError} */
function escape(src: string, i: usize): [string, usize] {
  const c = src.charAt((i + 1) as i64);
  const simple = simpleEscape(c);
  if (simple !== undefined) return [simple, i + 2];
  if (c === "\r" && src.charAt((i + 2) as i64) === "\n") return ["", i + 3];
  if (c === "\n" || c === "\r" || c === " " || c === " ") return ["", i + 2];
  if (c === "0" && !isDigit(src.charAt((i + 2) as i64))) return ["\0", i + 2];
  if (isDigit(c)) throw new CompileError("E0002", "octal escapes are not allowed; use '\\x' or '\\u'", i, i + 2);
  if (c !== "x" && c !== "u") return [c, i + 2];
  // The digits run from `from` to `to`; a `\u{...}` escape ends past its `}`.
  const braced = c === "u" && hexRun(src, i + 2, 4) < 4 && src.charAt((i + 2) as i64) === "{";
  const from = braced ? i + 3 : i + 2;
  const n = hexRun(src, from, braced ? src.length : c === "x" ? 2 : 4);
  const valid = braced ? n > 0 && src.charAt((from + n) as i64) === "}" : n === (c === "x" ? 2 : 4);
  if (!valid) throw new CompileError("E0002", `invalid escape '\\${c}'`, i, i + 2);
  const end = braced ? from + n + 1 : from + n;
  // Past 0x10ffff the exact value doesn't matter, so it stops growing there.
  let code: i64 = 0;
  for (let k = from; k < from + n; k++) if (code <= 0x10ffff) code = code * 16 + hexValue(src.charAt(k as i64));
  if (code > 0x10ffff) throw new CompileError("E0002", "unicode escape is out of range", i, end);
  return [String.fromCodePoint(code as u32), end];
}

// The decoded text of a template piece starting at `from`, where it ends, and whether a
// substitution follows.
/** @throws {CompileError} */
function template(src: string, from: usize): [string, usize, boolean] {
  let value = "";
  let i = from;
  // Where the text not yet added to `value` starts, so plain runs are added in one piece.
  let run = i;
  for (;;) {
    if (i >= src.length) throw new CompileError("E0002", "unterminated template literal", i);
    const c = src.charAt(i as i64);
    if (c === "`") return [value + src.slice(run as i64, i as i64), i + 1, false];
    if (c === "$" && src.charAt((i + 1) as i64) === "{") return [value + src.slice(run as i64, i as i64), i + 2, true];
    if (c === "\\") {
      const [escaped, end] = escape(src, i);
      value += src.slice(run as i64, i as i64) + escaped;
      i = end;
      run = i;
    } else if (c === "\r") {
      // JavaScript reads a template's CR and CRLF as LF.
      value += src.slice(run as i64, i as i64) + "\n";
      i += src.charAt((i + 1) as i64) === "\n" ? 2 : 1;
      run = i;
    } else {
      i++;
    }
  }
}

// The end of the digits and underscores running from `from` in the given base.
function digits(src: string, from: usize, base: i64): usize {
  let end = from;
  for (; end < src.length; end++) {
    const c = src.charAt(end as i64);
    const v = hexValue(c);
    if (c !== "_" && (v < 0 || v >= base)) break;
  }
  return end;
}

// The end of the number starting at `i`, and which kind of number it is.
function number(src: string, i: usize): [usize, "int" | "float" | "bigint"] {
  const prefix = src.charAt(i as i64) === "0" ? src.charAt((i + 1) as i64).toLowerCase() : "";
  const base: i64 = prefix === "x" ? 16 : prefix === "o" ? 8 : prefix === "b" ? 2 : 10;
  let end = digits(src, base === 10 ? i : i + 2, base);
  let kind: "int" | "float" | "bigint" = "int";
  if (base === 10 && src.charAt(end as i64) === "." && src.charAt((end + 1) as i64) !== ".") {
    kind = "float";
    end = digits(src, end + 1, 10);
  }
  const e = src.charAt(end as i64);
  const sign = src.charAt((end + 1) as i64);
  if (base === 10 && (e === "e" || e === "E") && (isDigit(sign) || isDigit(src.charAt((end + 2) as i64)))) {
    kind = "float";
    end = digits(src, end + (sign === "+" || sign === "-" ? 2 : 1), 10);
  }
  if (kind === "int" && src.charAt(end as i64) === "n") return [end + 1, "bigint"];
  return [end, kind];
}

// A comment as written, markers included, kept for the formatter and doc comments.
export type Comment = { kind: "line" | "block" | "shebang"; text: string; start: usize; end: usize };

// Tokens are produced on demand, because only the parser knows whether a `/` divides or
// starts a regular expression, and lexing past an unrecognised regex could fail.
export class Lexer {
  src: string;
  i: usize;
  newlineBefore: boolean;
  // For each template substitution we are inside, how many `{` it has open, so the `}` that
  // closes the substitution can be told from one that closes a block or an object.
  substitutions: usize[];
  // Every comment scanned so far, in source order.
  comments: Comment[];

  constructor(src: string, from: usize) {
    this.src = src;
    this.i = from;
    this.newlineBefore = false;
    this.substitutions = [];
    this.comments = [];
  }

  /** @throws {CompileError} */
  next(this: Mut<this>): Token {
    for (;;) {
      const t = this.scan();
      if (t !== undefined) return t;
    }
  }

  // Scans again from `slash`, a `/` or `/=` token, reading a regular expression instead.
  /** @throws {CompileError} */
  regex(this: Mut<this>, slash: Ref<Token>): Token {
    // What was scanned past the slash is read again, and a `//` there may be part of the regex.
    while (this.comments.length > 0 && this.comments[this.comments.length - 1]!.start > slash.start) this.comments.pop();
    const src = this.src;
    this.newlineBefore = slash.newlineBefore;
    this.substitutions = [];
    if (slash.substitutions !== undefined) this.substitutions = [...slash.substitutions!];
    let i = slash.start + 1;
    let inClass = false;
    for (; src.charAt(i as i64) !== "/" || inClass; i++) {
      const c = src.charAt(i as i64);
      if (c === "" || c === "\n" || c === "\r") {
        this.i = i;
        throw new CompileError("E0002", "unterminated regular expression", slash.start, i);
      }
      if (c === "\\") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
    }
    i++;
    for (let c = src.charAt(i as i64); identPart(c); c = src.charAt(i as i64)) i++;
    this.i = i;
    return this.token("regex", src.slice(slash.start as i64, i as i64), slash.start);
  }

  token(this: Mut<this>, kind: Token["kind"], text: string, start: usize): Token {
    const t: Token = { kind, text, start, end: this.i, newlineBefore: this.newlineBefore };
    this.newlineBefore = false;
    return t;
  }

  comment(this: Mut<this>, kind: Comment["kind"], start: usize): void {
    this.comments.push({ kind, text: this.src.slice(start as i64, this.i as i64), start, end: this.i });
  }

  // Where the line `i` is on ends, before its newline.
  lineEnd(): usize {
    const newline = this.src.indexOf("\n", this.i as i64);
    return newline < 0 ? this.src.length : newline as usize;
  }

  identEnd(from: usize): usize {
    let i = from;
    while (identPart(this.src.charAt(i as i64))) i++;
    return i;
  }

  // The next token, or undefined after skipping whitespace or a comment.
  /** @throws {CompileError} */
  scan(this: Mut<this>): Token | undefined {
    const src = this.src;
    const start = this.i;
    if (start >= src.length) return this.token("eof", "", start);
    const c = src.charAt(start as i64);
    const after = src.charAt((start + 1) as i64);
    if (c === "\n") {
      this.newlineBefore = true;
      this.i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      this.i++;
    } else if (c === "/" && after === "/") {
      this.i = this.lineEnd();
      this.comment("line", start);
    } else if (c === "/" && after === "*") {
      const close = src.indexOf("*/", (start + 2) as i64);
      if (close < 0) throw new CompileError("E0002", "unterminated comment", start, start + 2);
      if (src.slice(start as i64, close).includes("\n")) this.newlineBefore = true;
      this.i = (close as usize) + 2;
      this.comment("block", start);
    } else if (start === 0 && c === "#" && after === "!") {
      // A shebang line, allowed only at the very start of a file.
      this.i = this.lineEnd();
      this.comment("shebang", start);
    } else if (c === "#" && identStart(after)) {
      this.i = this.identEnd(start + 1);
      return this.token("private", src.slice(start as i64, this.i as i64), start);
    } else if (identStart(c)) {
      this.i = this.identEnd(start);
      return this.token("ident", src.slice(start as i64, this.i as i64), start);
    } else if (isDigit(c) || (c === "." && isDigit(after))) {
      const [end, kind] = number(src, start);
      this.i = end;
      return this.token(kind, src.slice(start as i64, end as i64), start);
    } else if (c === "`" || (c === "}" && this.substitutions.length > 0 && this.substitutions[this.substitutions.length - 1]! === 0)) {
      return this.templatePiece(c === "`");
    } else if (c === '"' || c === "'") {
      return this.string(c);
    } else {
      return this.punct();
    }
    return undefined;
  }

  // A template, or its piece after a substitution's closing `}`.
  /** @throws {CompileError} */
  templatePiece(this: Mut<this>, opens: boolean): Token {
    const start = this.i;
    const [value, end, more] = template(this.src, start + 1);
    this.i = end;
    // The raw text, too, has its line endings read as LF, as JavaScript reads them.
    const raw = this.src.slice((start + 1) as i64, (end - (more ? 2 : 1)) as i64).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    let kind: Token["kind"] = "templateTail";
    if (opens && more) kind = "templateHead";
    else if (opens) kind = "template";
    else if (more) kind = "templateMiddle";
    if (opens && more) this.substitutions.push(0);
    if (!opens && !more) this.substitutions.pop();
    return { ...this.token(kind, value, start), raw };
  }

  /** @throws {CompileError} */
  string(this: Mut<this>, quote: string): Token {
    const src = this.src;
    const start = this.i;
    let value = "";
    // Where the text not yet added to `value` starts, so plain runs are added in one piece.
    let run = start + 1;
    // `this.i` keeps up with the scan, so an error leaves it where the scan stopped.
    for (this.i = run; src.charAt(this.i as i64) !== quote;) {
      const c = src.charAt(this.i as i64);
      if (c === "" || c === "\n") throw new CompileError("E0002", "unterminated string literal", start, this.i);
      if (c === "\\") {
        const [escaped, end] = escape(src, this.i);
        value += src.slice(run as i64, this.i as i64) + escaped;
        this.i = end;
        run = end;
      } else {
        this.i++;
      }
    }
    value += src.slice(run as i64, this.i as i64);
    this.i++;
    return this.token("string", value, start);
  }

  /** @throws {CompileError} */
  punct(this: Mut<this>): Token {
    const src = this.src;
    const start = this.i;
    let p = "";
    for (const q of PUNCT) {
      // `a?.5:1` is a conditional, so `?.` before a digit is `?` then a number.
      if (src.startsWith(q, start as i64) && !(q === "?." && isDigit(src.charAt((start + 2) as i64)))) {
        p = q;
        break;
      }
    }
    if (p === "") throw new CompileError("E0002", `unexpected character '${src.charAt(start as i64)}'`, start);
    this.i += p.length;
    const open = this.substitutions.length;
    if (open > 0 && p === "{") this.substitutions[open - 1] = this.substitutions[open - 1]! + 1;
    if (open > 0 && p === "}") this.substitutions[open - 1] = this.substitutions[open - 1]! - 1;
    let t = this.token("punct", p, start);
    if (p === "/" || p === "/=") t.substitutions = [...this.substitutions];
    return t;
  }
}

// Scanning starts at `from`, so tokens read from inside a comment keep their offsets in the file.
export function lexer(src: string, from: usize = 0): Lexer {
  return new Lexer(src, from);
}
