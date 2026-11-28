// Capabilities a dependency states and the program grants it, through `fishc check` run as the
// native fishc on packages written to a scratch directory of the test's own.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fishcPath, removed, scratch, text } from "./support.fsh";

// A check's exit code and the first line of its stderr.
type Got = { code: i64; err: string };

function check(dir: string): Got {
  const run = spawnSync(fishcPath(), ["check"], { cwd: dir });
  return { code: run.status ?? -1, err: text(run.stderr).split("\n")[0] };
}

function write(path: string, contents: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// A package named `name` under `root`, stating `capabilities`, with `deps` and its source.
function pkg(root: string, name: string, capabilities: string, deps: string, file: string, src: string): string {
  const dir = join(root, name);
  write(join(dir, "fish.toml"), `[package]\nname = "${name}"\nversion = "0.1.0"\n${capabilities}\n[dependencies]\n${deps}`);
  write(join(dir, "src", file), src);
  return dir;
}

const READS = `import { readFileSync } from "node:fs";\nexport function load(p: string): string throws IoError { return readFileSync(p, "utf8"); }\n`;
const MAIN = `import { load } from "files";\nfunction main(): void throws IoError { console.log(load("x")); }\n`;

function passes(got: Ref<Got>, what: string): void {
  assert(got.code === 0 && got.err === "", `${what}: exited with ${got.code}: ${got.err}`);
}

function refuses(got: Ref<Got>, part: string, what: string): void {
  assert(got.code !== 0 && got.err.includes(part), `${what}: expected an error containing\n${part}\n--- got (exit ${got.code})\n${got.err}`);
}

test("a dependency stating and granted what it uses is checked, and the program itself may use anything", () => {
  const root = scratch("fish-caps-");
  pkg(root, "files", `capabilities = ["fs"]`, "", "lib.fsh", READS);
  const app = pkg(root, "app", "", `files = { path = "../files", capabilities = ["fs"] }\n`, "main.fsh", `import { spawnSync } from "node:child_process";\nimport { load } from "files";\nfunction main(): void throws IoError {\n  const _r = spawnSync("true", []);\n  console.log(load("x"));\n}\n`);
  passes(check(app), "granted inline");
  write(join(app, "fish.toml"), `[package]\nname = "app"\nversion = "0.1.0"\n[dependencies.files]\npath = "../files"\ncapabilities = ["fs", "net"]\n`);
  passes(check(app), "granted under [dependencies.files], with more than it uses");
  removed(root);
}, { timeout: 60_000 });

test("a dependency using what its fish.toml doesn't state is refused at the use, naming the package", () => {
  const root = scratch("fish-caps-");
  pkg(root, "files", "", "", "lib.fsh", READS);
  const app = pkg(root, "app", "", `files = { path = "../files", capabilities = ["fs"] }\n`, "main.fsh", MAIN);
  refuses(check(app), `files/src/lib.fsh:1:1: error[E0910]: the package 'files' uses fs here, by importing 'node:fs', which its fish.toml doesn't state; a package lists what it uses under [package], as in capabilities = ["fs"]`, "an unstated fs");
  pkg(root, "files", `capabilities = ["fs"]`, "", "lib.fsh", `${READS}export function raw(): i64 { return unsafe { 1 }; }\n`);
  refuses(check(app), "error[E0910]: the package 'files' uses unsafe here, by an unsafe expression", "an unstated unsafe");
  pkg(root, "files", `capabilities = ["fs"]`, "", "lib.fsh", `${READS}declare function abs(n: i32): i32;\n`);
  refuses(check(app), "error[E0910]: the package 'files' uses ffi here, by a C function's declaration", "an unstated C function");
  pkg(root, "files", `capabilities = ["fs"]`, "", "lib.fsh", `${READS}export async function get(): Promise<string> { return await (await fetch("http://x")).text(); }\n`);
  refuses(check(app), "error[E0910]: the package 'files' uses net here, by 'fetch'", "an unstated fetch");
  removed(root);
}, { timeout: 60_000 });

test("a dependency the program doesn't grant what it uses is refused, and a use through its own dependency counts", () => {
  const root = scratch("fish-caps-");
  pkg(root, "files", `capabilities = ["fs"]`, "", "lib.fsh", READS);
  const app = pkg(root, "app", "", `files = { path = "../files" }\n`, "main.fsh", MAIN);
  refuses(check(app), `files/src/lib.fsh:1:1: error[E0910]: this program doesn't grant the dependency 'files' fs, which it uses here, by importing 'node:fs'; grant it in fish.toml with capabilities = ["fs"] under [dependencies.files]`, "no grant");
  pkg(root, "wrap", "", `files = { path = "../files" }\n`, "lib.fsh", `import { load } from "files";\nexport function wrapped(p: string): string throws IoError { return load(p); }\n`);
  const outer = pkg(root, "outer", "", `wrap = { path = "../wrap", capabilities = ["fs"] }\n`, "main.fsh", `import { wrapped } from "wrap";\nfunction main(): void throws IoError { console.log(wrapped("x")); }\n`);
  refuses(check(outer), "error[E0910]: the package 'wrap' uses fs here, through its dependency 'files', by importing 'node:fs', which its fish.toml doesn't state", "an inherited use not stated");
  pkg(root, "wrap", `capabilities = ["fs"]`, `files = { path = "../files" }\n`, "lib.fsh", `import { load } from "files";\nexport function wrapped(p: string): string throws IoError { return load(p); }\n`);
  passes(check(outer), "an inherited use stated and granted");
  write(join(outer, "fish.toml"), `[package]\nname = "outer"\nversion = "0.1.0"\n[dependencies]\nwrap = { path = "../wrap" }\n`);
  refuses(check(outer), "error[E0910]: this program doesn't grant the dependency 'wrap' fs, which it uses here, through its dependency 'files'", "an inherited use not granted");
  removed(root);
}, { timeout: 60_000 });
