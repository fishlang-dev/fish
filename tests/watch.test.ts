import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, directories, snapshot, stop, watchedFiles } from "../src/watch.ts";

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
