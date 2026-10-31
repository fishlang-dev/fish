import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, directories, snapshot, stop, watchedFiles } from "../src/watch.ts";

// The end-to-end test builds a program several times.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-watch-")));
// Watchers a failed test left running, and their programs, all under `root`, are killed at the end.
const watchers: Subprocess[] = [];
afterAll(() => {
  for (const w of watchers) w.kill("SIGKILL");
  Bun.spawnSync(["pkill", "-9", "-f", root]);
  rmSync(root, { recursive: true, force: true });
});

function dir(name: string, files: Record<string, string>): string {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(at, path), text);
  return at;
}

test("the files watched are those loaded or looked for and the manifest, real, once each, missing ones kept", () => {
  const d = dir("files", { "a.fsh": "", "b.fsh": "", "fish.toml": "" });
  expect(watchedFiles([join(d, "b.fsh"), join(d, "a.fsh"), join(d, "b.fsh"), join(d, "gone.fsh")], join(d, "fish.toml"))).toEqual([join(d, "a.fsh"), join(d, "b.fsh"), join(d, "fish.toml"), join(d, "gone.fsh")]);
  expect(watchedFiles([join(d, "a.fsh")])).toEqual([join(d, "a.fsh")]);
});

test("directories are watched with the names in each that matter", () => {
  expect(directories(["/p/a.fsh", "/p/lib/b.fsh", "/p/fish.toml"])).toEqual(new Map([["/p", new Set(["a.fsh", "fish.toml"])], ["/p/lib", new Set(["b.fsh"])]]));
});

test("a change is a difference in contents, a file renamed into place or removed included", () => {
  const d = dir("changes", { "a.fsh": "one", "b.fsh": "two" });
  const files = [join(d, "a.fsh"), join(d, "b.fsh")];
  const before = snapshot(files);
  writeFileSync(join(d, "a.fsh"), "one");
  expect(changed(before)).toBeUndefined();
  writeFileSync(join(d, "tmp"), "three");
  renameSync(join(d, "tmp"), join(d, "b.fsh"));
  expect(changed(before)).toBe(join(d, "b.fsh"));
  rmSync(join(d, "b.fsh"));
  expect(changed(snapshot([join(d, "a.fsh")]))).toBeUndefined();
  expect(changed(before)).toBe(join(d, "b.fsh"));
});

test("stopping a program that ignores SIGTERM kills it after the grace period", async () => {
  const child = Bun.spawn(["sh", "-c", "trap '' TERM; echo ready; sleep 30"], { stdout: "pipe" });
  await child.stdout.getReader().read();
  const started = performance.now();
  await stop(child, 300);
  expect(child.signalCode).toBe("SIGKILL");
  expect(performance.now() - started).toBeLessThan(5000);
  const polite = Bun.spawn(["sleep", "30"]);
  await stop(polite, 10_000);
  expect(polite.signalCode).toBe("SIGTERM");
  await stop(polite);
});

// Reads `stream` into `seen.text` as it arrives.
function collect(stream: ReadableStream<Uint8Array>): { text: string } {
  const seen = { text: "" };
  void (async () => {
    for await (const chunk of stream) seen.text += new TextDecoder().decode(chunk);
  })();
  return seen;
}

// Each wait is short enough that every test's waits together end within its timeout.
async function until(seen: { text: string }, needle: string, from = 0) {
  const deadline = performance.now() + 15_000;
  while (!seen.text.slice(from).includes(needle)) {
    if (performance.now() > deadline) throw new Error(`never saw '${needle}' in:\n${seen.text}`);
    await Bun.sleep(50);
  }
}

const MANIFEST = (name: string) => `[package]\nname = "${name}"\nversion = "0.1.0"\nentry = "main.fsh"\n`;
const sleepy = (imports: string, shown: string) => `${imports}async function main() {\n  console.error(${shown});\n  await sleep(600000);\n}\n`;
const word = (name: string, value: string) => `export function ${name}(): string { return ${value}; }\n`;

// Runs `fishc watch` in the package `name` holding `files` while `body` runs, then sends it
// SIGTERM. The program's output is read from stderr, since its stdout is a pipe here, and so isn't
// flushed until it exits. Gives the watcher's exit code.
async function watching(d: string, args: string[], body: (err: { text: string }) => Promise<void>): Promise<number | null> {
  const watcher = Bun.spawn(["bun", MAIN, "watch", ...args], { cwd: d, stdout: "ignore", stderr: "pipe" });
  watchers.push(watcher);
  try {
    await body(collect(watcher.stderr));
  } finally {
    watcher.kill("SIGTERM");
    await watcher.exited;
  }
  return watcher.exitCode;
}

const running = (binary: string) => Bun.spawnSync(["pgrep", "-f", binary]).stdout.toString();

test("fishc watch restarts the program when a file it imports changes, and survives a build error", async () => {
  const d = dir("pkg", { "fish.toml": MANIFEST("watched"), "main.fsh": sleepy(`import { word } from "./word.fsh";\n`, "word()"), "word.fsh": word("word", `"one"`) });
  const code = await watching(d, [], async (err) => {
    await until(err, "one\n");
    writeFileSync(join(d, "word.fsh"), word("word", `"two"`));
    await until(err, "[fishc] restarting: word.fsh changed\n");
    await until(err, "two\n");
    const failed = err.text.length;
    writeFileSync(join(d, "word.fsh"), word("word", `1`));
    await until(err, "[fishc] waiting for changes\n", failed);
    expect(err.text.slice(failed)).toContain("error:");
    writeFileSync(join(d, "word.fsh"), word("word", `"three"`));
    await until(err, "three\n");
    expect(err.text.split("\n").filter((l) => /^[a-z]+$/.test(l))).toEqual(["one", "two", "three"]);
  });
  expect(code).toBe(143);
  expect(running(join(d, "target", "debug", "watched"))).toBe("");
});

test("fishc watch sees a new import that didn't exist or didn't build when it is fixed", async () => {
  const d = dir("newimport", { "main.fsh": sleepy("", `"one"`) });
  await watching(d, ["main.fsh"], async (err) => {
    await until(err, "one\n");
    let at = err.text.length;
    writeFileSync(join(d, "main.fsh"), sleepy(`import { extra } from "./extra.fsh";\n`, "extra()"));
    await until(err, "[fishc] waiting for changes\n", at);
    expect(err.text.slice(at)).toContain("can't find the file './extra.fsh'");
    at = err.text.length;
    writeFileSync(join(d, "extra.fsh"), word("extra", "1"));
    await until(err, "[fishc] waiting for changes\n", at);
    expect(err.text.slice(at)).toContain("[fishc] restarting: extra.fsh changed");
    expect(err.text.slice(at)).toContain("error:");
    writeFileSync(join(d, "extra.fsh"), word("extra", `"fixed"`));
    await until(err, "fixed\n");
  });
});

test("fishc watch sees a file deleted and recreated, and an entry that is missing at first", async () => {
  const d = dir("recreate", { "main.fsh": sleepy(`import { word } from "./word.fsh";\n`, "word()"), "word.fsh": word("word", `"one"`) });
  await watching(d, ["main.fsh"], async (err) => {
    await until(err, "one\n");
    const at = err.text.length;
    rmSync(join(d, "word.fsh"));
    await until(err, "[fishc] waiting for changes\n", at);
    await Bun.sleep(300);
    writeFileSync(join(d, "word.fsh"), word("word", `"back"`));
    await until(err, "back\n");
  });
  await watching(d, ["later.fsh"], async (err) => {
    await until(err, "[fishc] waiting for changes\n");
    expect(err.text).toStartWith("fishc: ");
    writeFileSync(join(d, "later.fsh"), sleepy("", `"later"`));
    await until(err, "later\n");
  });
});

test("a program that ignores SIGTERM is killed when the watcher quits during its restart", async () => {
  const stubborn = (shown: string) => `declare function signal(sig: i32, handler: i64): i64;\nasync function main() {\n  unsafe { signal(15, 1); }\n  console.error("${shown}");\n  await sleep(600000);\n}\n`;
  const d = dir("stubborn", { "fish.toml": MANIFEST("stubborn"), "main.fsh": stubborn("one") });
  const binary = join(d, "target", "debug", "stubborn");
  const code = await watching(d, [], async (err) => {
    await until(err, "one\n");
    expect(running(binary)).not.toBe("");
    writeFileSync(join(d, "main.fsh"), stubborn("two"));
    await until(err, "[fishc] restarting:");
    await Bun.sleep(300);
  });
  expect(code).toBe(143);
  expect(running(binary)).toBe("");
});
