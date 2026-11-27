// Builds the playground's compiler: `src/playground.fsh` for wasm32-wasip1, written to
// `playground/public/fishc.wasm`, which the page's worker runs. Then serve the page with
// `fishc run playground/server.fsh`. The fishc given (default `build/fishc`) must know the wasm
// target, and the WASI sysroot must be installed as that target says.
//   fishc run scripts/playground.fsh -- [--fishc <path>]
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

function option(args: Ref<string[]>, flag: string): string | undefined {
  for (let i: usize = 0; i + 1 < args.length; i++) if (args[i]! === flag) return args[i + 1]!.clone();
  return undefined;
}

function main(): void throws IoError {
  const root = join(import.meta.dir, "..");
  const fishc = option(process.argv.slice(2), "--fishc") ?? join(root, "build", "fishc");
  const out = join(root, "playground", "public", "fishc.wasm");
  const started = performance.now();
  const r = spawnSync(fishc, ["build", "--target", "wasm32-wasip1", "--release", join(root, "src", "playground.fsh"), "-o", out], { cwd: root });
  if (r.status !== 0) {
    console.error(`${fishc} build --target wasm32-wasip1 exited with ${r.status ?? -1}:\n${new TextDecoder().decode(r.stderr)}`);
    process.exit(1);
  }
  console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KiB) in ${Math.round((performance.now() - started) / 1000)}s`);
}
