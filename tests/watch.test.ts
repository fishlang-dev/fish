import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, directories, snapshot, stop, watchedFiles } from "../src/watch.ts";

// The end-to-end test builds a program several times.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-watch-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function dir(name: string, files: Record<string, string>): string {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(at, path), text);
  return at;
}

test("the files watched are those loaded and the manifest, real, once each, existing", () => {
  const d = dir("files", { "a.fsh": "", "b.fsh": "", "fish.toml": "" });
  expect(watchedFiles([join(d, "b.fsh"), join(d, "a.fsh"), join(d, "b.fsh"), join(d, "gone.fsh")], join(d, "fish.toml"))).toEqual([join(d, "a.fsh"), join(d, "b.fsh"), join(d, "fish.toml")]);
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

async function until(seen: { text: string }, needle: string, from = 0) {
  const deadline = performance.now() + 60_000;
  while (!seen.text.slice(from).includes(needle)) {
    if (performance.now() > deadline) throw new Error(`never saw '${needle}' in:\n${seen.text}`);
    await Bun.sleep(50);
  }
}

test("fishc watch restarts the program when a file it imports changes, and survives a build error", async () => {
  const program = (word: string) => `export function word(): string { return ${word}; }\n`;
  const d = dir("pkg", {
    "fish.toml": `[package]\nname = "watched"\nversion = "0.1.0"\nentry = "main.fsh"\n`,
    "main.fsh": `import { word } from "./word.fsh";\nasync function main() {\n  console.error(word());\n  await sleep(600000);\n}\n`,
    "word.fsh": program(`"one"`),
  });
  const watcher = Bun.spawn(["bun", MAIN, "watch"], { cwd: d, stdout: "ignore", stderr: "pipe" });
  const err = collect(watcher.stderr);
  try {
    // stderr, since the program's stdout is a pipe here, and so isn't flushed until it exits.
    await until(err, "one\n");
    writeFileSync(join(d, "word.fsh"), program(`"two"`));
    await until(err, "[fishc] restarting: word.fsh changed\n");
    await until(err, "two\n");
    const failed = err.text.length;
    writeFileSync(join(d, "word.fsh"), program(`1`));
    await until(err, "error:", failed);
    await until(err, "[fishc] waiting for changes\n", failed);
    writeFileSync(join(d, "word.fsh"), program(`"three"`));
    await until(err, "three\n");
    expect(err.text.split("\n").filter((l) => !l.startsWith("[fishc]") && /^[a-z]+$/.test(l))).toEqual(["one", "two", "three"]);
  } finally {
    watcher.kill("SIGTERM");
    await watcher.exited;
  }
  expect(watcher.exitCode).toBe(143);
  const left = Bun.spawnSync(["pgrep", "-f", join(d, "target", "debug", "watched")]);
  expect(left.stdout.toString()).toBe("");
});
