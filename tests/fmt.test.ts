import { afterAll, expect, test } from "bun:test";
import { chmodSync, cpSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "fish-fmt-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Runs `fishc fmt` with `args` in `cwd`, with `stdin` piped in when given.
function fmt(cwd: string, args: string[], stdin?: string) {
  const run = Bun.spawnSync([process.execPath, MAIN, "fmt", ...args], { cwd, stdin: stdin === undefined ? "ignore" : Buffer.from(stdin) });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

// Writes `all` under `name` in the test's root, giving the directory.
function files(name: string, all: Record<string, string>): string {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(at, path, ".."), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  return at;
}

const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");
const messy = "const   a=1\n";
const tidy = "const a = 1;\n";

test("named files are rewritten when they change, and left untouched when formatted", () => {
  const dir = files("named", { "a.fsh": messy, "b.fsh": tidy, "script": messy });
  const before = statSync(join(dir, "b.fsh")).mtimeMs;
  expect(fmt(dir, ["a.fsh", "b.fsh", "script"])).toEqual({ code: 0, out: "", err: "" });
  expect([read(dir, "a.fsh"), read(dir, "b.fsh"), read(dir, "script")]).toEqual([tidy, tidy, tidy]);
  expect(statSync(join(dir, "b.fsh")).mtimeMs).toBe(before);
});

test("--check writes nothing, lists the unformatted files and exits 1, and exits 0 when all are formatted", () => {
  const dir = files("check", { "a.fsh": messy, "b.fsh": tidy, "c.fsh": "let x=[1,2]\n" });
  expect(fmt(dir, ["--check", "a.fsh", "b.fsh", "c.fsh"])).toEqual({ code: 1, out: "a.fsh\nc.fsh\n", err: "" });
  expect([read(dir, "a.fsh"), read(dir, "c.fsh")]).toEqual([messy, "let x=[1,2]\n"]);
  expect(fmt(dir, ["--check", "b.fsh"])).toEqual({ code: 0, out: "", err: "" });
});

test("- formats standard input to standard output, and with --check exits 1 on unformatted input", () => {
  const dir = files("stdin", {});
  expect(fmt(dir, ["-"], messy)).toEqual({ code: 0, out: tidy, err: "" });
  expect(fmt(dir, ["-", "--check"], messy)).toEqual({ code: 1, out: "", err: "" });
  expect(fmt(dir, ["-", "--check"], tidy)).toEqual({ code: 0, out: "", err: "" });
  const bad = fmt(dir, ["-"], "const = 1\n");
  expect([bad.code, bad.out, bad.err.split("\n")[0]]).toEqual([1, "", "<stdin>:1:7: error: expected an identifier, found '='"]);
});

test("a file that doesn't parse is reported and left as it was, and the others are still formatted", () => {
  const dir = files("broken", { "a.fsh": messy, "bad.fsh": "function (\n", "z.fsh": messy });
  const run = fmt(dir, ["a.fsh", "bad.fsh", "z.fsh"]);
  expect(run.code).toBe(1);
  expect(run.err).toStartWith("bad.fsh:1:10: error:");
  expect(run.err).toContain("\n 1 | function (\n");
  expect([read(dir, "a.fsh"), read(dir, "bad.fsh"), read(dir, "z.fsh")]).toEqual([tidy, "function (\n", tidy]);
});

test("a rewritten file keeps its mode, a read-only or missing one is reported, and a file named twice is formatted once", () => {
  const dir = files("modes", { "run.fsh": messy, "locked.fsh": messy, "ok.fsh": messy });
  chmodSync(join(dir, "run.fsh"), 0o751);
  chmodSync(join(dir, "locked.fsh"), 0o444);
  const run = fmt(dir, ["run.fsh", "locked.fsh", "gone.fsh", "ok.fsh", "./ok.fsh"]);
  expect(run.code).toBe(1);
  expect(run.err).toContain("fishc fmt: can't find 'gone.fsh'");
  expect(run.err).toContain("fishc fmt: can't write 'locked.fsh':");
  expect(statSync(join(dir, "run.fsh")).mode & 0o777).toBe(0o751);
  expect([read(dir, "run.fsh"), read(dir, "locked.fsh"), read(dir, "ok.fsh")]).toEqual([tidy, messy, tidy]);
  expect(readdirSync(dir).filter((f) => f.startsWith("."))).toEqual([]);
});

test("a flag fmt doesn't take, or - beside other paths, prints usage and exits 2, and an unknown flag exits 2", () => {
  const dir = files("usage", { "a.fsh": tidy });
  for (const args of [["--release", "a.fsh"], ["-", "a.fsh"]]) {
    const run = fmt(dir, args);
    expect([run.code, run.err.includes("usage: fishc fmt [<path>...] [--check]")]).toEqual([2, true]);
  }
  const unknown = fmt(dir, ["--fast", "a.fsh"]);
  expect([unknown.code, unknown.err.includes("Unknown option '--fast'")]).toEqual([2, true]);
});

test("a directory formats every .fsh under it, and no paths formats the package around the working directory", () => {
  const manifest = '[package]\nname = "app"\nversion = "0.1.0"\n';
  const pkg = files("pkg", {
    "fish.toml": manifest,
    "src/main.fsh": messy,
    "src/util/u.fsh": messy,
    "src/notes.txt": messy,
    "target/debug/gen.fsh": messy,
    "node_modules/x/x.fsh": messy,
    ".git/hooks/h.fsh": messy,
    "vendor/inner/fish.toml": manifest.replace("app", "inner"),
    "vendor/inner/src/i.fsh": messy,
  });
  const outside = files("outside", { "o.fsh": messy });
  symlinkSync(outside, join(pkg, "src", "linked"));
  expect(fmt(join(pkg, "src", "util"), [])).toEqual({ code: 0, out: "", err: "" });
  const after = ["src/main.fsh", "src/util/u.fsh", "src/notes.txt", "target/debug/gen.fsh", "node_modules/x/x.fsh", ".git/hooks/h.fsh", "vendor/inner/src/i.fsh"].map((p) => read(pkg, p));
  expect(after).toEqual([tidy, tidy, messy, messy, messy, messy, messy]);
  expect(read(outside, "o.fsh")).toBe(messy);
  expect(fmt(pkg, ["vendor/inner"])).toEqual({ code: 0, out: "", err: "" });
  expect(read(pkg, "vendor/inner/src/i.fsh")).toBe(tidy);
});

test("a file inside a named directory and named itself is formatted once, and outside a package no paths is a usage error", () => {
  const dir = files("twice", { "d/a.fsh": messy });
  expect(fmt(dir, ["--check", "d", "d/a.fsh"])).toEqual({ code: 1, out: "d/a.fsh\n", err: "" });
  const loose = files("loose", {});
  const run = fmt(loose, []);
  expect([run.code, run.err.trim()]).toEqual([2, "fishc fmt: no fish.toml here or in any directory above; name the files to format, or run it inside a package"]);
});

test("--check over a copy of the test programs changes no file, and names the ones that don't parse", () => {
  const copy = join(root, "programs");
  cpSync(join(import.meta.dir, "programs"), copy, { recursive: true });
  const snapshot = () => readdirSync(copy, { recursive: true }).map(String).sort().map((p) => { try { return p + readFileSync(join(copy, p), "utf8"); } catch { return p; } });
  const before = snapshot();
  const run = fmt(copy, ["--check", "."]);
  expect(run.code).toBe(1);
  expect(snapshot()).toEqual(before);
  for (const broken of ["octal_escape.fsh", "regex.fsh", "type.fsh", "throw.fsh", "modules_parse_error_elsewhere/b.fsh"]) expect(run.err).toContain(`${broken}:`);
  expect(run.out.split("\n").filter(Boolean).length).toBeGreaterThan(0);
}, 120_000);

test("a large result piped out of - arrives whole", () => {
  const dir = files("big", { "big.fsh": Array.from({ length: 20000 }, (_, i) => `let a${i}=${i}`).join("\n") + "\n" });
  const expected = Array.from({ length: 20000 }, (_, i) => `let a${i} = ${i};`).join("\n") + "\n";
  const run = Bun.spawnSync(["sh", "-c", `cat big.fsh | "${process.execPath}" "${MAIN}" fmt - | cat`], { cwd: dir });
  expect([run.exitCode, run.stdout.length]).toEqual([0, Buffer.byteLength(expected)]);
});

test("a file that isn't valid UTF-8 is reported and left byte for byte as it was", () => {
  const dir = files("latin", {});
  const bytes = Buffer.from([...Buffer.from('let a="caf'), 0xe9, ...Buffer.from('"\n')]);
  writeFileSync(join(dir, "s.fsh"), bytes);
  const run = fmt(dir, ["s.fsh"]);
  expect([run.code, run.err.trim()]).toEqual([1, "fishc fmt: 's.fsh' isn't valid UTF-8, so it's left as it was"]);
  expect(readFileSync(join(dir, "s.fsh")).equals(bytes)).toBe(true);
  expect(fmt(dir, ["-"], bytes.toString("latin1")).code).toBe(0);
});

test("the temporary file never follows or removes something already there, and hard links stay linked", () => {
  const dir = files("temps", { "a.fsh": messy, "victim.txt": "precious\n", "locked.fsh": messy });
  for (const name of [".a.fsh.fmt-1", ".locked.fsh.fmt-1"]) symlinkSync(join(dir, "victim.txt"), join(dir, name));
  chmodSync(join(dir, "locked.fsh"), 0o444);
  fmt(dir, ["a.fsh", "locked.fsh"]);
  expect([read(dir, "a.fsh"), read(dir, "victim.txt"), read(dir, "locked.fsh")]).toEqual([tidy, "precious\n", messy]);
  expect(readdirSync(dir).filter((f) => f.startsWith(".")).sort()).toEqual([".a.fsh.fmt-1", ".locked.fsh.fmt-1"]);
  const linked = files("hard", { "a.fsh": messy });
  linkSync(join(linked, "a.fsh"), join(linked, "b.fsh"));
  expect(fmt(linked, ["b.fsh"])).toEqual({ code: 0, out: "", err: "" });
  expect([read(linked, "a.fsh"), statSync(join(linked, "a.fsh")).nlink]).toEqual([tidy, 2]);
});

test("an unreadable directory is reported and the rest still formatted, and a formatter bug leaves the file and says so", () => {
  const dir = files("unreadable", { "ok.fsh": messy, "locked/x.fsh": messy, "bug.fsh": "function f() { (throw x); }\n" });
  chmodSync(join(dir, "locked"), 0o000);
  const run = fmt(dir, ["."]);
  chmodSync(join(dir, "locked"), 0o755);
  expect(run.code).toBe(1);
  expect(run.err).toContain("fishc fmt: can't read 'locked':");
  expect(run.err).toContain("fishc fmt: 'bug.fsh' was left as it was, because of a bug in the formatter (the formatter changed the program's meaning); please report it");
  expect([read(dir, "ok.fsh"), read(dir, "bug.fsh")]).toEqual([tidy, "function f() { (throw x); }\n"]);
});


test("a reader that goes away ends - quietly, and a file with a very long name still formats", () => {
  const dir = files("pipe", { "big.fsh": Array.from({ length: 20000 }, (_, i) => `let a${i}=${i}`).join("\n") + "\n" });
  const run = Bun.spawnSync(["sh", "-c", `"${process.execPath}" "${MAIN}" fmt - < big.fsh | head -c 100 > /dev/null`], { cwd: dir, stderr: "pipe" });
  expect(run.stderr.toString()).toBe("");
  const name = `${"n".repeat(240)}.fsh`;
  const long = files("long", { [name]: messy });
  expect(fmt(long, [name])).toEqual({ code: 0, out: "", err: "" });
  expect(read(long, name)).toBe(tidy);
});
