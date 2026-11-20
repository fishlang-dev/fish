// Ports tests/watch.test.ts: the watcher's parts in process, and `fishc watch` itself run as the
// native fishc in the background. A Fish child's output comes whole once it ends, so the watcher's
// stderr, which its program's output goes to as well, is written to a file and read as it grows.
// Each test kills what it started before it checks anything.
import type { Subprocess } from "bun";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changed, directories, snapshot, stop, watchedFiles } from "../../src/watch.fsh";
import { fishcPath, removed, same, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function remove(path: string): void {
  try {
    rmSync(path);
  } catch (e) {
    assert(false, `can't remove ${path}: ${e.message}`);
  }
}

// A directory `name` under `root` holding `files`.
function dir(root: string, name: string, files: Ref<[string, string][]>): string {
  const at = join(root, name);
  try {
    mkdirSync(at, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${at}: ${e.message}`);
  }
  for (const [path, contents] of files) write(join(at, path), contents);
  return at;
}

function readOr(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch (_e) {
    return "";
  }
}

test("the files watched are those loaded or looked for and the manifest, real, once each, missing ones kept", () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "files", [["a.fsh", ""], ["b.fsh", ""], ["fish.toml", ""]]);
  try {
    const all = watchedFiles([join(d, "b.fsh"), join(d, "a.fsh"), join(d, "b.fsh"), join(d, "gone.fsh")], join(d, "fish.toml"));
    assert(all === [join(d, "a.fsh"), join(d, "b.fsh"), join(d, "fish.toml"), join(d, "gone.fsh")], `the files: ${JSON.stringify(all)}`);
    const one = watchedFiles([join(d, "a.fsh")]);
    assert(one === [join(d, "a.fsh")], `the files: ${JSON.stringify(one)}`);
  } catch (e) {
    assert(false, e.message);
  }
  removed(root);
}, { timeout: 120_000 });

test("directories are watched with the names in each that matter", () => {
  const got = directories(["/p/a.fsh", "/p/lib/b.fsh", "/p/fish.toml"]);
  // Compared as entries sorted by directory, each with its names sorted, since neither a Map nor a
  // Set is compared by value.
  let entries: [string, string[]][] = [];
  for (const [k, v] of got) {
    let names = [...v];
    names.sort();
    entries.push([k, names]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  same(JSON.stringify(entries), JSON.stringify([["/p", ["a.fsh", "fish.toml"]], ["/p/lib", ["b.fsh"]]]), "the directories");
}, { timeout: 120_000 });

test("a change is a difference in contents, a file renamed into place or removed included", () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "changes", [["a.fsh", "one"], ["b.fsh", "two"]]);
  try {
    const before = snapshot([join(d, "a.fsh"), join(d, "b.fsh")]);
    write(join(d, "a.fsh"), "one");
    assert(changed(before) === undefined, "a file written with what it held changed");
    write(join(d, "tmp"), "three");
    renameSync(join(d, "tmp"), join(d, "b.fsh"));
    same(changed(before) ?? "nothing", join(d, "b.fsh"), "the file renamed into place");
    remove(join(d, "b.fsh"));
    const left = snapshot([join(d, "a.fsh")]);
    assert(changed(left) === undefined, "a.fsh changed");
    same(changed(before) ?? "nothing", join(d, "b.fsh"), "the file removed");
  } catch (e) {
    assert(false, e.message);
  }
  removed(root);
}, { timeout: 120_000 });

function spawned(cmd: string[], cwd: string = "."): Subprocess | null {
  try {
    return Bun.spawn(cmd.clone(), { cwd, stdout: "ignore", stderr: "ignore" });
  } catch (e) {
    assert(false, `can't run ${cmd[0]}: ${e.message}`);
    return null;
  }
}

test("stopping a program that ignores SIGTERM kills it after the grace period", async () => {
  const root = scratch("fish-watch-");
  const ready = join(root, "ready");
  // The program says it's ready in a file rather than on stdout, which a Fish child gives only once
  // it ends.
  const child = spawned(["sh", "-c", `trap '' TERM; echo ready > ${JSON.stringify(ready)}; sleep 30`])!;
  while (readOr(ready) === "") await sleep(10);
  const started = performance.now();
  await stop(child, 300);
  same(child.signalCode ?? "none", "SIGKILL", "how the program ended");
  const took = performance.now() - started;
  assert(took < 5000, `stopping it took ${took} ms`);
  const polite = spawned(["sleep", "30"])!;
  await stop(polite, 10000);
  same(polite.signalCode ?? "none", "SIGTERM", "how the polite program ended");
  await stop(polite);
  removed(root);
}, { timeout: 120_000 });

// A `fishc watch` running in the background, its stderr going to the file `err`.
type Watcher = { child: Subprocess; err: string; dir: string };

// Starts `fishc watch` with `args` in the package directory `d`.
function watcher(d: string, args: string[], name: string): Watcher {
  const err = join(d, `${name}.err`);
  write(err, "");
  const child = spawned(["sh", "-c", `exec "$0" watch "$@" 2> ${JSON.stringify(err)}`, fishcPath(), ...args], d)!;
  return { child, err, dir: d };
}

// Sends the watcher `signal` and gives its exit code, then kills anything left under its directory.
async function ended(w: Ref<Watcher>, signal: string): Promise<i64> {
  w.child.kill(signal);
  const code = await w.child.exited;
  spawnSync("pkill", ["-9", "-f", w.dir]);
  return code;
}

// Waits until the watcher's stderr from `from` on holds `needle`, giving why not if it never does.
// Each wait is short enough that it reports before the test's own limit.
async function until(w: Ref<Watcher>, needle: string, from: usize = 0): Promise<string> {
  const deadline = performance.now() + 8000;
  while (true) {
    const seen = readOr(w.err);
    if (seen.slice(from as i64).includes(needle)) return "";
    if (performance.now() > deadline) return `never saw '${needle}' in:\n${seen}`;
    await sleep(50);
  }
}

function seen(w: Ref<Watcher>): string {
  return readOr(w.err);
}

function manifest(name: string): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nentry = "main.fsh"\n`;
}

function sleepy(imports: string, shown: string): string {
  return `${imports}async function main() {\n  console.error(${shown});\n  await sleep(600000);\n}\n`;
}

function word(name: string, value: string): string {
  return `export function ${name}(): string { return ${value}; }\n`;
}

function running(binary: string): string {
  return text(spawnSync("pgrep", ["-f", binary]).stdout);
}

async function restarts(w: Ref<Watcher>, d: string): Promise<string> {
  let f = await until(w, "one\n");
  if (f !== "") return f;
  write(join(d, "word.fsh"), word("word", `"two"`));
  f = await until(w, "[fishc] restarting: word.fsh changed\n");
  if (f !== "") return f;
  f = await until(w, "two\n");
  if (f !== "") return f;
  const failed = seen(w).length;
  write(join(d, "word.fsh"), word("word", "1"));
  f = await until(w, "[fishc] waiting for changes\n", failed);
  if (f !== "") return f;
  if (!seen(w).slice(failed as i64).includes("error[E0101]:")) return `no error[E0101] after the bad save:\n${seen(w)}`;
  write(join(d, "word.fsh"), word("word", `"three"`));
  f = await until(w, "three\n");
  if (f !== "") return f;
  const words = seen(w).split("\n").filter((l) => /^[a-z]+$/.test(l));
  if (words !== ["one", "two", "three"]) return `the program's lines: ${JSON.stringify(words)}`;
  return "";
}

test("fishc watch restarts the program when a file it imports changes, and survives a build error", async () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "pkg", [["fish.toml", manifest("watched")], ["main.fsh", sleepy(`import { word } from "./word.fsh";\n`, "word()")], ["word.fsh", word("word", `"one"`)]]);
  const w = watcher(d, [], "watch");
  const failure = await restarts(w, d);
  const code = await ended(w, "SIGTERM");
  assert(failure === "", failure);
  assert(code === 143, `the watcher exited with ${code}`);
  same(running(join(d, "target", "debug", "watched")), "", "programs still running");
  removed(root);
}, { timeout: 120_000 });

async function newImport(w: Ref<Watcher>, d: string): Promise<string> {
  let f = await until(w, "one\n");
  if (f !== "") return f;
  let at = seen(w).length;
  write(join(d, "main.fsh"), sleepy(`import { extra } from "./extra.fsh";\n`, "extra()"));
  f = await until(w, "[fishc] waiting for changes\n", at);
  if (f !== "") return f;
  if (!seen(w).slice(at as i64).includes("can't find the file './extra.fsh'")) return `no missing import after the save:\n${seen(w)}`;
  at = seen(w).length;
  write(join(d, "extra.fsh"), word("extra", "1"));
  f = await until(w, "[fishc] waiting for changes\n", at);
  if (f !== "") return f;
  const after = seen(w).slice(at as i64);
  if (!after.includes("[fishc] restarting: extra.fsh changed")) return `no restart for extra.fsh:\n${seen(w)}`;
  if (!after.includes("error[E0101]:")) return `no error[E0101] in extra.fsh:\n${seen(w)}`;
  write(join(d, "extra.fsh"), word("extra", `"fixed"`));
  return await until(w, "fixed\n");
}

test("fishc watch sees a new import that didn't exist or didn't build when it is fixed", async () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "newimport", [["main.fsh", sleepy("", `"one"`)]]);
  const w = watcher(d, ["main.fsh"], "watch");
  const failure = await newImport(w, d);
  const _code = await ended(w, "SIGTERM");
  assert(failure === "", failure);
  removed(root);
}, { timeout: 120_000 });

async function recreated(w: Ref<Watcher>, d: string): Promise<string> {
  const f = await until(w, "one\n");
  if (f !== "") return f;
  const at = seen(w).length;
  remove(join(d, "word.fsh"));
  const g = await until(w, "[fishc] waiting for changes\n", at);
  if (g !== "") return g;
  await sleep(300);
  write(join(d, "word.fsh"), word("word", `"back"`));
  return await until(w, "back\n");
}

async function later(w: Ref<Watcher>, d: string): Promise<string> {
  const f = await until(w, "[fishc] waiting for changes\n");
  if (f !== "") return f;
  if (!seen(w).startsWith("fishc: ")) return `the watcher's stderr doesn't start with 'fishc: ':\n${seen(w)}`;
  write(join(d, "later.fsh"), sleepy("", `"later"`));
  return await until(w, "later\n");
}

test("fishc watch sees a file deleted and recreated, and an entry that is missing at first", async () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "recreate", [["main.fsh", sleepy(`import { word } from "./word.fsh";\n`, "word()")], ["word.fsh", word("word", `"one"`)]]);
  const first = watcher(d, ["main.fsh"], "first");
  const failure = await recreated(first, d);
  const _first = await ended(first, "SIGTERM");
  assert(failure === "", failure);
  const second = watcher(d, ["later.fsh"], "second");
  const missing = await later(second, d);
  const _second = await ended(second, "SIGTERM");
  assert(missing === "", missing);
  removed(root);
}, { timeout: 120_000 });

function stubborn(shown: string): string {
  return `declare function signal(sig: i32, handler: i64): i64;\nasync function main() {\n  unsafe { signal(15, 1); }\n  console.error("${shown}");\n  await sleep(600000);\n}\n`;
}

async function restartingStubborn(w: Ref<Watcher>, d: string, binary: string): Promise<string> {
  const f = await until(w, "one\n");
  if (f !== "") return f;
  if (running(binary) === "") return "the program isn't running";
  write(join(d, "main.fsh"), stubborn("two"));
  const g = await until(w, "[fishc] restarting:");
  if (g !== "") return g;
  await sleep(300);
  return "";
}

test("a program that ignores SIGTERM is killed when the watcher quits during its restart", async () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "stubborn", [["fish.toml", manifest("stubborn")], ["main.fsh", stubborn("one")]]);
  const binary = join(d, "target", "debug", "stubborn");
  const w = watcher(d, [], "watch");
  const failure = await restartingStubborn(w, d, binary);
  w.child.kill("SIGTERM");
  const code = await w.child.exited;
  const left = running(binary);
  spawnSync("pkill", ["-9", "-f", d]);
  assert(failure === "", failure);
  assert(code === 143, `the watcher exited with ${code}`);
  same(left, "", "programs still running");
  removed(root);
}, { timeout: 120_000 });

function exiting(shown: string): string {
  return `function main() {\n  console.error("${shown}");\n  process.exit(3);\n}\n`;
}

async function burst(w: Ref<Watcher>, d: string): Promise<string> {
  const f = await until(w, "[fishc] main.fsh exited with code 3; waiting for changes\n");
  if (f !== "") return f;
  const at = seen(w).length;
  write(join(d, "main.fsh"), exiting("two"));
  write(join(d, "main.fsh"), exiting("three"));
  const g = await until(w, "[fishc] main.fsh exited with code 3; waiting for changes\n", at);
  if (g !== "") return g;
  await sleep(500);
  const after = seen(w).slice(at as i64);
  const restarts = after.split("\n").filter((l) => l.startsWith("[fishc] restarting:"));
  if (restarts !== ["[fishc] restarting: main.fsh changed"]) return `the restarts: ${JSON.stringify(restarts)}`;
  if (!after.includes("three\n")) return `no 'three' after the saves:\n${after}`;
  if (after.includes("two\n")) return `'two' ran after the saves:\n${after}`;
  return "";
}

test("fishc watch notes a program's exit, rebuilds a burst of saves once, and exits 130 on SIGINT", async () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "burst", [["main.fsh", exiting("one")]]);
  const w = watcher(d, ["main.fsh"], "watch");
  const failure = await burst(w, d);
  const code = await ended(w, "SIGINT");
  assert(failure === "", failure);
  assert(code === 130, `the watcher exited with ${code}`);
  removed(root);
}, { timeout: 120_000 });

async function interrupted(w: Ref<Watcher>, binary: string): Promise<string> {
  const f = await until(w, "one\n");
  if (f !== "") return f;
  if (running(binary) === "") return "the program isn't running";
  return "";
}

test("a second signal kills a program the watcher is still giving its grace period", async () => {
  const root = scratch("fish-watch-");
  const d = dir(root, "second", [["fish.toml", manifest("second")], ["main.fsh", stubborn("one")]]);
  const binary = join(d, "target", "debug", "second");
  const w = watcher(d, [], "watch");
  const failure = await interrupted(w, binary);
  const quitting = performance.now();
  w.child.kill("SIGINT");
  await sleep(300);
  w.child.kill("SIGTERM");
  const code = await w.child.exited;
  const took = performance.now() - quitting;
  const left = running(binary);
  spawnSync("pkill", ["-9", "-f", d]);
  assert(failure === "", failure);
  assert(took < 1500, `quitting took ${took} ms`);
  assert(code === 130, `the watcher exited with ${code}`);
  same(left, "", "programs still running");
  removed(root);
}, { timeout: 120_000 });
