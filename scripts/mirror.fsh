// Writes the compiler's source as Fish into tests/compiler, for the Fish unit tests to import until
// src itself is Fish: each src/*.ts, or its .fsh twin where one exists, with its `.ts` imports
// renamed `.fsh`. The runtime's C sources and vendor are linked where a build from the mirror
// looks for them, beside it and one level up.
//   fishc run scripts/mirror.fsh
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function linked(target: string, path: string): void throws IoError {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) symlinkSync(target, path);
}

function main(): void throws IoError {
  const root = join(import.meta.dir, "..");
  const src = join(root, "src");
  const out = join(root, "tests", "compiler");
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
    const twin = join(src, f.slice(0, (f.length as i64) - 3) + ".fsh");
    const text = readFileSync(existsSync(twin) ? twin : join(src, f), "utf8");
    writeFileSync(join(out, f.slice(0, (f.length as i64) - 3) + ".fsh"), text.replace(/(["'])(\.{1,2}\/[^"']+)\.ts\1/g, "$1$2.fsh$1"));
    n++;
  }
  linked(join(src, "runtime"), join(out, "runtime"));
  linked(join(root, "vendor"), join(root, "tests", "vendor"));
  console.log(`mirrored ${n} files into ${out}`);
}
