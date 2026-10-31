import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession } from "../src/compilation.ts";
import { build } from "../src/main.ts";
import { mirrored } from "../scripts/selfhost.ts";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "..");

// Every test program and the compiler's own source, relative to the root both runs start in.
function corpus(): string[] {
  const programs = readdirSync(join(ROOT, "tests", "programs"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".fsh")).map((f) => join("tests", "programs", f));
  const sources = ["src", join("tests", "selfhost")].flatMap((dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f)));
  return [...programs, ...sources].sort();
}

// tests/selfhost/lexer.ts tokenizes files through src/lexer.ts. Run by Bun and built by fishc from
// the same source, the two must print the same tokens and comments for every file.
test("the lexer built with fishc tokenizes the corpus exactly as the Bun build does", () => {
  const dir = mkdtempSync(join(tmpdir(), "fish-selfhost-lexer-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "tests", "selfhost"), { recursive: true });
    for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))) mirrored(join(ROOT, "src", f), join(dir, "src"));
    const driver = mirrored(join(ROOT, "tests", "selfhost", "lexer.ts"), join(dir, "tests", "selfhost"));
    build(newSession(), driver, join(dir, "lexer"));
    const files = corpus();
    const native = Bun.spawnSync([join(dir, "lexer"), ...files], { cwd: ROOT });
    // `lexer` stands in for the program's path, which Fish gives as argv[1] the way Node does.
    const bun = Bun.spawnSync(["bun", "-e", 'import { main } from "./tests/selfhost/lexer.ts"; main()', "lexer", ...files], { cwd: ROOT });
    expect(native.exitCode).toBe(0);
    expect(bun.exitCode).toBe(0);
    const out = bun.stdout.toString();
    // The whole output is compared, but a mismatch is shown as its first differing line.
    const [ours, theirs] = [native.stdout.toString().split("\n"), out.split("\n")];
    const at = ours.findIndex((line, i) => line !== theirs[i]);
    expect(at < 0 ? undefined : { line: at + 1, native: ours[at], bun: theirs[at] }).toBeUndefined();
    expect(ours.length).toBe(theirs.length);
    expect(out.match(/^file /gm)?.length).toBe(files.length);
    expect(out).toContain("\nregex ");
    expect(out).toContain("\ntemplateHead ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
