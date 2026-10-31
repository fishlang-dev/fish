import { readFileSync } from "node:fs";
import { CompileError } from "../../src/diag.ts";
import { lexer } from "../../src/lexer.ts";

// Tokenizes each file named on the command line through src/lexer.ts and prints every token and
// comment. Run by Bun and built by fishc, the two outputs must match.

// Keywords after which an expression starts, so a `/` there starts a regex.
const OPERATOR_WORDS = ["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"];

// Whether a `/` after the token `kind` `text` starts a regex rather than dividing: after nothing,
// after punctuation that can't end an expression, and after the keywords above. The parser decides
// this from the grammar; this is close enough to read the corpus the same way in both builds.
function regexAfter(kind: string, text: string): boolean {
  if (kind === "") return true;
  if (kind === "punct") return text !== ")" && text !== "]" && text !== "}" && text !== "++" && text !== "--";
  return kind === "ident" && OPERATOR_WORDS.includes(text);
}

function tokenize(src: string): void {
  let lex = lexer(src);
  let kind = "";
  let text = "";
  try {
    for (;;) {
      let t = lex.next();
      if (t.kind === "punct" && (t.text === "/" || t.text === "/=") && regexAfter(kind, text)) t = lex.regex(t);
      const raw = t.raw === undefined ? "" : ` raw ${JSON.stringify(t.raw!)}`;
      console.log(`${t.kind} ${t.start} ${t.end}${t.newlineBefore ? " nl" : ""} ${JSON.stringify(t.text)}${raw}`);
      if (t.kind === "eof") break;
      kind = t.kind;
      text = t.text;
    }
  } catch (e) {
    const error = e as CompileError;
    console.log(`error ${error.start} ${error.end} ${error.message}`);
  }
  for (const c of lex.comments) console.log(`comment ${c.kind} ${c.start} ${c.end} ${JSON.stringify(c.text)}`);
}

// As in Node, the arguments start at argv[2], after the runtime and the program.
/** @throws {IoError} */
export function main(): void {
  for (const file of process.argv.slice(2)) {
    console.log(`file ${file}`);
    tokenize(readFileSync(file, "utf8"));
  }
}
