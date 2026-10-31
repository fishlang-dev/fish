import { expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { JS_NATIVE } from "../src/js_native.ts";
import { compile, ENGINE, ENGINE_SOURCES } from "../src/main.ts";
import { NATIVE } from "../src/native.ts";
import { mathObjects } from "../src/mathlib.ts";
import type { Session } from "../src/compilation.ts";

// Builds the program at `file` with the runtime, the engine and the program all under
// AddressSanitizer, and runs it reporting leaks. ASan instruments only IR functions marked for
// it, and crashes on the empty struct accesses the IR makes, nested ones too, which touch nothing.
// It is built within `session`.
export function sanitized(session: Session, file: string, src: string) {
  writeFileSync(file, src);
  const ir = compile(session, src, file)
    .replaceAll(" uwtable ", " uwtable sanitize_address ")
    .replace(/^( *%[^ ]+) = load (\{[{} ,]*\}), ptr .*$/gm, "$1 = select i1 true, $2 zeroinitializer, $2 zeroinitializer")
    .replace(/^ *store \{[{} ,]*\} .*$/gm, "");
  const [ll, c, out] = [`${file}.ll`, `${file}.c`, `${file}.out`];
  writeFileSync(ll, ir);
  writeFileSync(c, `${NATIVE}\n${JS_NATIVE}`);
  const built = Bun.spawnSync(["clang", "-w", "-g", "-funwind-tables", "-fsanitize=address", "-x", "ir", ll, "-x", "c", c, "-I", ENGINE, ...ENGINE_SOURCES, "-x", "none", ...mathObjects(session), "-o", out, "-lm", "-pthread"]);
  expect(built.stderr.toString()).toBe("");
  const run = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  return { stdout: run.stdout.toString(), stderr: run.stderr.toString(), exitCode: run.exitCode };
}
