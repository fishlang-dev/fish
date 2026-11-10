// Compiles the checker natively as far as codegen goes: mirrors src as .fsh, builds a driver that
// parses and checks the file it is given, and goes on past each function codegen fails on. Prints every
// failure and where the IR's size goes, and writes the IR for scripts/irsplit.ts. A directory may
// be named; otherwise it is `fish-native` in the system's temporary directory.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/main.ts";
import { cachedSession } from "../src/stdcache.ts";
import { mirrored } from "./selfhost.ts";

export const DRIVER = `import { readFileSync } from "node:fs";
import { parse } from "./parser.fsh";
import { check } from "./check.fsh";
import { newCompilation, newSession } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
function main() {
  let compilation = newCompilation(newSession());
  try {
    const stmts = parse(readFileSync(process.argv[2]!, "utf8"), compilation.ids);
    check(compilation, stmts);
    console.log("accepted");
  } catch (e) {
    if (e instanceof CompileError) console.log(\`rejected \${e.code} \${e.start} \${e.message}\`);
    else console.log(\`unreadable \${e.message}\`);
  }
}
`;

// Writes the compiler's source as .fsh into `dir` with the driver beside it; gives the driver.
export function mirrorChecker(dir: string): string {
  const src = join(import.meta.dir, "..", "src");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(src)) if (f.endsWith(".ts") && !f.endsWith(".d.ts")) mirrored(join(src, f), dir);
  const file = join(dir, "checkdriver.fsh");
  writeFileSync(file, DRIVER);
  return file;
}

const mb = (n: number) => `${(n / 1e6).toFixed(1).padStart(7)} MB`;

if (import.meta.main) {
  const dir = process.argv[2] ?? join(tmpdir(), "fish-native");
  const file = mirrorChecker(dir);

  const failed: string[] = [];
  const session = cachedSession();
  session.failed = failed;
  const started = performance.now();
  const ir = compile(session, DRIVER, file);
  console.log(`compiled in ${((performance.now() - started) / 1000).toFixed(0)}s, IR ${mb(ir.length)}`);
  writeFileSync(join(dir, "checker.ll"), ir);
  console.log(`wrote ${join(dir, "checker.ll")}`);

  console.log(`\n${failed.length} function(s) failed in codegen`);
  const byMessage = new Map<string, string[]>();
  for (const f of failed) {
    const at = f.indexOf(": ");
    const message = f.slice(at + 2).split("\n")[0]!.slice(0, 200);
    byMessage.set(message, [...(byMessage.get(message) ?? []), f.slice(0, at)]);
  }
  for (const [message, symbols] of [...byMessage].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(symbols.length).padStart(5)}x ${message}\n       in ${symbols.slice(0, 3).join(" | ").slice(0, 300)}`);
  }

  // Functions by family: the symbol with its type arguments and instance numbers left out.
  const families = new Map<string, { bytes: number; count: number }>();
  let functions = 0;
  for (const part of ir.split("\ndefine ").slice(1)) {
    const end = part.indexOf("\n}\n");
    const bytes = end < 0 ? part.length : end;
    functions += bytes;
    const name = (/@"?([^"(]+)"?\(/.exec(part.slice(0, 2000))?.[1] ?? "?").replace(/<.*>/g, "<>").replace(/#\w+|~\d+/g, "");
    const family = families.get(name) ?? { bytes: 0, count: 0 };
    family.bytes += bytes;
    family.count++;
    families.set(name, family);
  }
  console.log(`\nfunctions ${mb(functions)}, everything else ${mb(ir.length - functions)}; largest families:`);
  for (const [name, f] of [...families].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 25)) {
    console.log(`${mb(f.bytes)} ${String(f.count).padStart(5)}x ${name.slice(0, 120)}`);
  }
}
