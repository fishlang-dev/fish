import { CompileError } from "./diag.ts";

export type Token = {
  kind: "ident" | "int" | "string" | "punct" | "eof";
  // Source text; for strings, the decoded value. Keywords are idents, since most TS keywords are contextual.
  text: string;
  start: number;
  end: number;
  // Drives automatic semicolon insertion.
  newlineBefore: boolean;
};

// Longest first, so `===` wins over `==` over `=`. `>>` and `>=` are left to the
// parser to compose from single `>` tokens once generics arrive, as TS does.
const PUNCT = [
  "===", "!==", "=>", "==", "!=", "<=", "&&", "||", "??", "?.", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "{", "}", "(", ")", "[", "]", ";", ",", ".",
  ":", "?", "=", "<", ">", "+", "-", "*", "/", "%", "!",
];

const ESCAPES: Record<string, string> = {
  n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "'": "'", '"': '"',
};

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let newlineBefore = false;
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
    } else if (/[A-Za-z_$]/.test(c)) {
      while (i < src.length && /[\w$]/.test(src[i]!)) i++;
      push("ident", src.slice(start, i), start);
    } else if (/[0-9]/.test(c)) {
      while (i < src.length && /[\d_]/.test(src[i]!)) i++;
      push("int", src.slice(start, i), start);
    } else if (c === '"' || c === "'") {
      let value = "";
      i++;
      while (src[i] !== c) {
        if (i >= src.length || src[i] === "\n") throw new CompileError("unterminated string literal", start, i);
        if (src[i] === "\\") {
          const escaped = ESCAPES[src[i + 1] ?? ""];
          if (escaped === undefined) throw new CompileError(`unsupported escape '\\${src[i + 1]}'`, i, i + 2);
          value += escaped;
          i += 2;
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
      push("punct", p, start);
    }
  }
  push("eof", "", i);
  return tokens;
}
