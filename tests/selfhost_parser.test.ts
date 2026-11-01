import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedSession } from "../src/stdcache.ts";
import { build } from "../src/main.ts";
import { mirrored } from "../scripts/selfhost.ts";
import { DUMP, dumperSource } from "../scripts/dumpgen.ts";

setDefaultTimeout(240_000);

const ROOT = join(import.meta.dir, "..");

// Every test program and the compiler's own source, relative to the root both runs start in.
function corpus(): string[] {
  const programs = readdirSync(join(ROOT, "tests", "programs"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".fsh")).map((f) => join("tests", "programs", f));
  const sources = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts")).map((f) => join("src", f));
  return [...programs, ...sources].sort();
}

// The printer the driver uses is generated from the parser's AST types, so a type the printer
// leaves out would make the trees agree without being compared.
test("the tree printer is generated from the parser's current AST types; run 'bun scripts/dumpgen.ts' when it isn't", () => {
  expect(readFileSync(DUMP, "utf8")).toBe(dumperSource(readFileSync(join(ROOT, "src", "parser.ts"), "utf8")));
});

// tests/selfhost/parser.ts parses files through src/parser.ts and prints each tree in full. Run by
// Bun and built by fishc from the same source, the two must print the same trees for every file.
test("the parser built with fishc parses the corpus into exactly the trees the Bun build does", () => {
  const dir = mkdtempSync(join(tmpdir(), "fish-selfhost-parser-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "tests", "selfhost"), { recursive: true });
    for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))) mirrored(join(ROOT, "src", f), join(dir, "src"));
    mirrored(join(ROOT, "tests", "selfhost", "dump.ts"), join(dir, "tests", "selfhost"));
    const driver = mirrored(join(ROOT, "tests", "selfhost", "parser.ts"), join(dir, "tests", "selfhost"));
    // A dev build gives every temporary its own stack slot, so the parser's recursive functions
    // take up to 100 KiB a frame and deeply nested files overflow the main stack; optimized, they
    // fit. The trees must match either way.
    build(cachedSession(), driver, join(dir, "parser"), true);
    const files = corpus();
    const native = Bun.spawnSync([join(dir, "parser"), ...files], { cwd: ROOT, maxBuffer: 1 << 30 });
    // `parser` stands in for the program's path, which Fish gives as argv[1] the way Node does.
    const bun = Bun.spawnSync(["bun", "-e", 'import { main } from "./tests/selfhost/parser.ts"; main()', "parser", ...files], { cwd: ROOT, maxBuffer: 1 << 30 });
    expect(native.exitCode).toBe(0);
    expect(bun.exitCode).toBe(0);
    const out = bun.stdout.toString();
    // The whole output is compared, but a mismatch is shown as its first differing line.
    const [ours, theirs] = [native.stdout.toString().split("\n"), out.split("\n")];
    const at = ours.findIndex((line, i) => line !== theirs[i]);
    expect(at < 0 ? undefined : { line: at + 1, native: ours[at], bun: theirs[at] }).toBeUndefined();
    expect(ours.length).toBe(theirs.length);
    expect(out.match(/^file /gm)?.length).toBe(files.length);
    expect(out).toContain("\nerror ");
    expect(out).toContain("\n- class\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
