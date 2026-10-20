import { CompileError } from "./diag.ts";

export type Token = {
  // An `int` is an integer in any base; a `float` has a fraction or exponent; a `bigint` ends in `n`.
  // A template with substitutions arrives in pieces: a head ending in `${`, middles between
  // `}` and `${`, and a tail from `}` to the closing backtick.
  kind: "ident" | "int" | "float" | "bigint" | "string" | "template" | "templateHead" | "templateMiddle" | "templateTail" | "punct" | "eof";
  // Source text; for strings and templates, the decoded value. Keywords are idents, since most TS keywords are contextual.
  text: string;
  start: number;
  end: number;
  // Drives automatic semicolon insertion.
  newlineBefore: boolean;
};

// Matches punctuation and keywords, never a literal with the same text.
export const isToken = (t: Token, text: string) => (t.kind === "punct" || t.kind === "ident") && t.text === text;

// Longest first, so `===` wins over `==` over `=`. `>>` and `>=` are left to the
// parser to compose from single `>` tokens once generics arrive, as TS does.
const PUNCT = [
  "...", "===", "!==", "=>", "==", "!=", "<=", "&&", "||", "??", "?.", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "{", "}", "(", ")", "[", "]", ";", ",", ".",
  ":", "?", "=", "<", ">", "+", "-", "*", "/", "%", "!", "|", "&",
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

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let newlineBefore = false;
  // For each template substitution we are inside, how many `{` it has open, so the `}` that
  // closes the substitution can be told from one that closes a block or an object.
  const substitutions: number[] = [];
  const push = (kind: Token["kind"], text: string, start: number) => {
    tokens.push({ kind, text, start, end: i, newlineBefore });
    newlineBefore = false;
  };

  while (i < src.length) {
    const c = src[i]!;
    const start = i;
    if (c === "\n") {
      newlineBefore = true;
      i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) throw new CompileError("unterminated comment", i, i + 2);
      if (src.slice(i, close).includes("\n")) newlineBefore = true;
      i = close + 2;
    } else if (/[\p{ID_Start}_$]/u.test(c)) {
      while (i < src.length && /[\p{ID_Continue}$\u200c\u200d]/u.test(src[i]!)) i++;
      push("ident", src.slice(start, i), start);
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const [end, kind] = number(src, i);
      i = end;
      push(kind, src.slice(start, i), start);
    } else if (c === "`" || (c === "}" && substitutions.at(-1) === 0)) {
      const [value, end, more] = template(src, i + 1);
      i = end;
      if (c === "`") {
        if (more) substitutions.push(0);
        push(more ? "templateHead" : "template", value, start);
      } else {
        if (!more) substitutions.pop();
        push(more ? "templateMiddle" : "templateTail", value, start);
      }
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
      push("string", value, start);
    } else {
      const p = PUNCT.find((p) => src.startsWith(p, i));
      if (!p) throw new CompileError(`unexpected character '${c}'`, i);
      i += p.length;
      if (substitutions.length > 0 && (p === "{" || p === "}")) substitutions[substitutions.length - 1]! += p === "{" ? 1 : -1;
      push("punct", p, start);
    }
  }
  push("eof", "", i);
  return tokens;
}
