import { CompileError } from "./diag.ts";

export type Token = {
  // An `int` is an integer in any base; a `float` has a fraction or exponent; a `bigint` ends in `n`.
  // A template with substitutions arrives in pieces: a head ending in `${`, middles between
  // `}` and `${`, and a tail from `}` to the closing backtick.
  // A `private` token is a class's private name, `#` included, as in `#count`.
  kind: "ident" | "private" | "int" | "float" | "bigint" | "string" | "regex" | "template" | "templateHead" | "templateMiddle" | "templateTail" | "punct" | "eof";
  // Source text; for strings and templates, the decoded value. Keywords are idents, since most TS keywords are contextual.
  text: string;
  start: number;
  end: number;
  // Drives automatic semicolon insertion.
  newlineBefore: boolean;
  // On `/` and `/=`: the template substitutions open there, for rescanning it as a regex.
  substitutions?: number[];
  // On a template piece: its text as written, escapes undecoded.
  raw?: string;
};

// Matches punctuation and keywords, never a literal with the same text.
export const isToken = (t: Token, text: string) => (t.kind === "punct" || t.kind === "ident") && t.text === text;

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

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v" };

// Decodes the escape whose backslash is at `i`, returning its value and where it ends.
// Any other character escapes to itself, as in JavaScript; octal escapes are errors in
// strict mode, which every module is.
function escape(src: string, i: number): [string, number] {
  const c = src[i + 1] ?? "";
  const simple = ESCAPES[c];
  if (simple !== undefined) return [simple, i + 2];
  if (c === "\r" && src[i + 2] === "\n") return ["", i + 3];
  if (c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029") return ["", i + 2];
  if (c === "0" && !/[0-9]/.test(src[i + 2] ?? "")) return ["\0", i + 2];
  if (/[0-9]/.test(c)) throw new CompileError("octal escapes are not allowed; use '\\x' or '\\u'", i, i + 2);
  const hex = c === "x" ? /^[0-9a-fA-F]{2}/.exec(src.slice(i + 2))
    : c === "u" ? /^(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/.exec(src.slice(i + 2))
    : undefined;
  if (hex === null) throw new CompileError(`invalid escape '\\${c}'`, i, i + 2);
  if (hex) {
    const code = parseInt(hex[0].replace(/[{}]/g, ""), 16);
    if (code > 0x10ffff) throw new CompileError("unicode escape is out of range", i, i + 2 + hex[0].length);
    return [String.fromCodePoint(code), i + 2 + hex[0].length];
  }
  return [c, i + 2];
}

// The decoded text of a template piece starting at `i`, where it ends, and whether a
// substitution follows.
function template(src: string, i: number): [string, number, boolean] {
  let value = "";
  for (;;) {
    if (i >= src.length) throw new CompileError("unterminated template literal", i);
    if (src[i] === "`") return [value, i + 1, false];
    if (src.startsWith("${", i)) return [value, i + 2, true];
    if (src[i] === "\\") {
      const [escaped, end] = escape(src, i);
      value += escaped;
      i = end;
    } else if (src.startsWith("\r\n", i)) {
      value += "\n";
      i += 2;
    } else {
      value += src[i++];
    }
  }
}

// The end of the number starting at `i`, and which kind of number it is.
function number(src: string, i: number): [number, "int" | "float" | "bigint"] {
  const radix = { x: /[0-9a-fA-F_]/, o: /[0-7_]/, b: /[01_]/ }[src[i] === "0" ? (src[i + 1] ?? "").toLowerCase() : ""];
  let end = i + (radix ? 2 : 0);
  let kind: "int" | "float" | "bigint" = "int";
  const digits = (pattern: RegExp) => {
    while (end < src.length && pattern.test(src[end]!)) end++;
  };
  if (radix) {
    digits(radix);
  } else {
    digits(/[0-9_]/);
    if (src[end] === "." && src[end + 1] !== ".") {
      kind = "float";
      end++;
      digits(/[0-9_]/);
    }
    if (/[eE]/.test(src[end] ?? "") && /[0-9]|[+-][0-9]/.test(src.slice(end + 1, end + 3))) {
      kind = "float";
      end += /[+-]/.test(src[end + 1]!) ? 2 : 1;
      digits(/[0-9_]/);
    }
  }
  if (kind === "int" && src[end] === "n") return [end + 1, "bigint"];
  return [end, kind];
}

// A comment as written, markers included, kept for the formatter and doc comments.
export type Comment = { kind: "line" | "block" | "shebang"; text: string; start: number; end: number };

export type Lexer = {
  next(): Token;
  // Every comment scanned so far, in source order.
  comments: Comment[];
  // Scans again from `slash`, a `/` or `/=` token, reading a regular expression instead.
  regex(slash: Token): Token;
};

// Tokens are produced on demand, because only the parser knows whether a `/` divides or
// starts a regular expression, and lexing past an unrecognised regex could fail.
export function lexer(src: string): Lexer {
  let i = 0;
  let newlineBefore = false;
  // For each template substitution we are inside, how many `{` it has open, so the `}` that
  // closes the substitution can be told from one that closes a block or an object.
  let substitutions: number[] = [];
  const comments: Comment[] = [];
  const comment = (kind: Comment["kind"], start: number) => comments.push({ kind, text: src.slice(start, i), start, end: i });
  const token = (kind: Token["kind"], text: string, start: number): Token => {
    const t: Token = { kind, text, start, end: i, newlineBefore };
    newlineBefore = false;
    return t;
  };

  return {
    comments,
    next() {
      for (;;) {
        const t = scan();
        if (t) return t;
      }
    },
    regex(slash) {
      // What was scanned past the slash is read again, and a `//` there may be part of the regex.
      while (comments.length > 0 && comments.at(-1)!.start > slash.start) comments.pop();
      i = slash.start;
      newlineBefore = slash.newlineBefore;
      substitutions = [...slash.substitutions!];
      let inClass = false;
      for (i++; src[i] !== "/" || inClass; i++) {
        const c = src[i];
        if (c === undefined || c === "\n" || c === "\r") throw new CompileError("unterminated regular expression", slash.start, i);
        if (c === "\\") i++;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
      }
      i++;
      while (i < src.length && /[\p{ID_Continue}$]/u.test(src[i]!)) i++;
      return token("regex", src.slice(slash.start, i), slash.start);
    },
  };

  // The next token, or undefined after skipping whitespace or a comment.
  function scan(): Token | undefined {
    const start = i;
    const c = src[i];
    if (c === undefined) return token("eof", "", start);
    if (c === "\n") {
      newlineBefore = true;
      i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
      comment("line", start);
    } else if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) throw new CompileError("unterminated comment", i, i + 2);
      if (src.slice(i, close).includes("\n")) newlineBefore = true;
      i = close + 2;
      comment("block", start);
    } else if (start === 0 && src.startsWith("#!")) {
      // A shebang line, allowed only at the very start of a file.
      while (i < src.length && src[i] !== "\n") i++;
      comment("shebang", start);
    } else if (c === "#" && /[\p{ID_Start}_$]/u.test(src[i + 1] ?? "")) {
      i++;
      while (i < src.length && /[\p{ID_Continue}$\u200c\u200d]/u.test(src[i]!)) i++;
      return token("private", src.slice(start, i), start);
    } else if (/[\p{ID_Start}_$]/u.test(c)) {
      while (i < src.length && /[\p{ID_Continue}$\u200c\u200d]/u.test(src[i]!)) i++;
      return token("ident", src.slice(start, i), start);
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const [end, kind] = number(src, i);
      i = end;
      return token(kind, src.slice(start, i), start);
    } else if (c === "`" || (c === "}" && substitutions.at(-1) === 0)) {
      const [value, end, more] = template(src, i + 1);
      i = end;
      const raw = src.slice(start + 1, end - (more ? 2 : 1));
      if (c === "`") {
        if (more) substitutions.push(0);
        return { ...token(more ? "templateHead" : "template", value, start), raw };
      }
      if (!more) substitutions.pop();
      return { ...token(more ? "templateMiddle" : "templateTail", value, start), raw };
    } else if (c === '"' || c === "'") {
      let value = "";
      i++;
      while (src[i] !== c) {
        if (i >= src.length || src[i] === "\n") throw new CompileError("unterminated string literal", start, i);
        if (src[i] === "\\") {
          const [escaped, end] = escape(src, i);
          value += escaped;
          i = end;
        } else {
          value += src[i++];
        }
      }
      i++;
      return token("string", value, start);
    } else {
      // `a?.5:1` is a conditional, so `?.` before a digit is `?` then a number.
      const p = PUNCT.find((p) => src.startsWith(p, i) && !(p === "?." && /[0-9]/.test(src[i + 2] ?? "")));
      if (!p) throw new CompileError(`unexpected character '${c}'`, i);
      i += p.length;
      if (substitutions.length > 0 && (p === "{" || p === "}")) substitutions[substitutions.length - 1]! += p === "{" ? 1 : -1;
      const t = token("punct", p, start);
      if (p === "/" || p === "/=") t.substitutions = [...substitutions];
      return t;
    }
    return undefined;
  }
}
