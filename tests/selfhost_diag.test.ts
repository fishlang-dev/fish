import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession } from "../src/compilation.ts";
import { build } from "../src/main.ts";
import { mirrored } from "../scripts/selfhost.ts";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "..");

// tests/selfhost/diag.ts renders errors through src/diag.ts. Run by Bun and built by fishc from
// the same source, the two must print the same bytes.
test("diagnostics built with fishc render errors exactly as the Bun build does", () => {
  const dir = mkdtempSync(join(tmpdir(), "fish-selfhost-diag-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "tests", "selfhost"), { recursive: true });
    for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))) mirrored(join(ROOT, "src", f), join(dir, "src"));
    const driver = mirrored(join(ROOT, "tests", "selfhost", "diag.ts"), join(dir, "tests", "selfhost"));
    build(newSession(), driver, join(dir, "diag"));
    const native = Bun.spawnSync([join(dir, "diag")]);
    const bun = Bun.spawnSync(["bun", "-e", 'import { main } from "./tests/selfhost/diag.ts"; main()'], { cwd: ROOT });
    expect(native.exitCode).toBe(0);
    expect(bun.exitCode).toBe(0);
    expect(native.stdout.toString()).toBe(bun.stdout.toString());
    expect(bun.stdout.toString()).toContain("note: moved here");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
