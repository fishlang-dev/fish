// Parses every .fsh file in the compiler's tree and fails on any ERROR or MISSING node.
//   fishc run editors/tree-sitter-fsh/script/corpus.fsh
// A test file's cases are parsed one at a time, and a case expecting a compile error is left out,
// since some of those are syntax errors on purpose. KEEP set keeps the parsed copies.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

function expectsError(text: string): boolean {
  return text.startsWith("// error:") || text.includes("\n// error:");
}

// The .fsh files under dir. A program spanning a directory states its expected error in
// main.fsh, and the error may be in any of its files, so such a directory is left out.
function files(dir: string, out: Mut<string[]>): void throws IoError {
  let names = readdirSync(dir);
  names.sort();
  for (const name of names) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const main = join(full, "main.fsh");
      if (existsSync(main) && expectsError(readFileSync(main, "utf8"))) continue;
      files(full, out);
    } else if (name.endsWith(".fsh")) out.push(full);
  }
}

// A file's cases, each starting at a "// case: " line, those expecting an error left out.
// tree-sitter's lexer reads a NUL byte as the end of input, so a file holding one gives none.
function cases(text: string): string[] {
  if (text.includes("\0")) return [];
  let parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("// case: ") && current !== "") {
      parts.push(current);
      current = "";
    }
    current += line + "\n";
  }
  parts.push(current.slice(0, (current.length as i64) - 1));
  return parts.filter((part) => !expectsError(part));
}

function main(): void throws IoError {
  const root = resolve(import.meta.dir, "../../..");
  const out = mkdtempSync(join(tmpdir(), "fsh-corpus-"));
  let paths: string[] = [];
  for (const dir of ["src", "scripts", "tests"]) {
    let found: string[] = [];
    files(join(root, dir), found);
    for (const file of found) {
      const rel = relative(root, file).replaceAll("/", "__");
      let i = 0;
      for (const text of cases(readFileSync(file, "utf8"))) {
        const target = join(out, `${rel}.${i}.fsh`);
        writeFileSync(target, text);
        paths.push(target);
        i++;
      }
    }
  }
  const list = join(out, "paths.txt");
  writeFileSync(list, paths.join("\n"));
  const parsed = spawnSync("tree-sitter", ["parse", "--quiet", "--stat", "--paths", list]);
  process.stdout.write(new TextDecoder().decode(parsed.stdout));
  process.stderr.write(new TextDecoder().decode(parsed.stderr));
  if (process.env.KEEP === undefined) rmSync(out, { recursive: true });
  if (parsed.error !== null) {
    console.error("corpus: tree-sitter couldn't be run; is it on PATH?");
    process.exit(1);
  }
  process.exit(parsed.status === 0 ? 0 : 1);
}
