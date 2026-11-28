// Runs `fishc fmt` as the native fishc. Each test makes its own
// directory and removes it at its end, and the copy of the test programs is made with `cp -R`.
import { spawnSync } from "node:child_process";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fishc, fishcPath, ran, read, root, same, type Ran } from "./support.fsh";

function messy(): string {
  return "const   a=1\n";
}

function tidy(): string {
  return "const a = 1;\n";
}

// A fresh directory for one test, by its real path.
function fresh(): string {
  try {
    return realpathSync(mkdtempSync(join(tmpdir(), "fish-fmt-")));
  } catch (e) {
    assert(false, `can't make a directory: ${e.message}`);
    return "";
  }
}

function done(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

// Runs `fishc fmt` with `args` in `cwd`, with `stdin` piped in when given.
function fmt(cwd: string, args: string[], stdin?: string): Ran {
  return stdin === undefined ? fishc(cwd, ["fmt", ...args]) : fishc(cwd, ["fmt", ...args], stdin);
}

// Writes `all` under `name` in `top`, giving the directory.
function files(top: string, name: string, all: Ref<[string, string][]>): string {
  const at = join(top, name);
  try {
    mkdirSync(at, { recursive: true });
    for (const [path, text] of all) {
      mkdirSync(dirname(join(at, path)), { recursive: true });
      writeFileSync(join(at, path), text);
    }
  } catch (e) {
    assert(false, `can't write ${name}: ${e.message}`);
  }
  return at;
}

function at(dir: string, path: string): string {
  return read(join(dir, path));
}

function hidden(dir: string): string[] {
  try {
    let names = readdirSync(dir).filter((f) => f.startsWith("."));
    names.sort();
    return names;
  } catch (e) {
    assert(false, e.message);
    return [];
  }
}

function lines(n: i64, tidied: boolean): string {
  let out: string[] = [];
  for (let i: i64 = 0; i < n; i++) out.push(tidied ? `let a${i} = ${i};` : `let a${i}=${i}`);
  return out.join("\n") + "\n";
}

test("named files are rewritten when they change, and left untouched when formatted", () => {
  const top = fresh();
  try {
    const dir = files(top, "named", [["a.fsh", messy()], ["b.fsh", tidy()], ["script", messy()]]);
    const before = statSync(join(dir, "b.fsh")).mtimeMs;
    ran(fmt(dir, ["a.fsh", "b.fsh", "script"]), 0, "", "", "fmt");
    same([at(dir, "a.fsh"), at(dir, "b.fsh"), at(dir, "script")].join("|"), [tidy(), tidy(), tidy()].join("|"), "the files");
    const after = statSync(join(dir, "b.fsh")).mtimeMs;
    assert(after === before, `b.fsh was touched: ${before} then ${after}`);
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("--check writes nothing, lists the unformatted files and exits 1, and exits 0 when all are formatted", () => {
  const top = fresh();
  const dir = files(top, "check", [["a.fsh", messy()], ["b.fsh", tidy()], ["c.fsh", "let x=[1,2]\n"]]);
  ran(fmt(dir, ["--check", "a.fsh", "b.fsh", "c.fsh"]), 1, "a.fsh\nc.fsh\n", "", "--check");
  same([at(dir, "a.fsh"), at(dir, "c.fsh")].join("|"), [messy(), "let x=[1,2]\n"].join("|"), "the files");
  ran(fmt(dir, ["--check", "b.fsh"]), 0, "", "", "--check on a formatted file");
  done(top);
});

test("- formats standard input to standard output, and with --check exits 1 on unformatted input", () => {
  const top = fresh();
  const dir = files(top, "stdin", []);
  ran(fmt(dir, ["-"], messy()), 0, tidy(), "", "-");
  ran(fmt(dir, ["-", "--check"], messy()), 1, "", "", "- --check, unformatted");
  ran(fmt(dir, ["-", "--check"], tidy()), 0, "", "", "- --check, formatted");
  const bad = fmt(dir, ["-"], "const = 1\n");
  ran({ code: bad.code, out: bad.out, err: bad.err.split("\n")[0]! }, 1, "", "<stdin>:1:7: error[E0001]: expected an identifier, found '='", "- on a broken input");
  done(top);
});

test("a JSX element is kept as written while what surrounds it is formatted", () => {
  const top = fresh();
  const dir = files(top, "jsx", []);
  const written = "function page(name:string):Html{\n  const title=<h1  class=\"t\">Hi   {name}</h1>;\n  return <main>\n      {title}\n    <p>one</p>\n  </main>;\n}\n";
  const kept = "function page(name: string): Html {\n  const title = <h1  class=\"t\">Hi   {name}</h1>;\n  return <main>\n      {title}\n    <p>one</p>\n  </main>;\n}\n";
  ran(fmt(dir, ["-"], written), 0, kept, "", "a file with JSX");
  ran(fmt(dir, ["-"], kept), 0, kept, "", "formatted again");
  done(top);
});

test("a file that doesn't parse is reported and left as it was, and the others are still formatted", () => {
  const top = fresh();
  const dir = files(top, "broken", [["a.fsh", messy()], ["bad.fsh", "function (\n"], ["z.fsh", messy()]]);
  const run = fmt(dir, ["a.fsh", "bad.fsh", "z.fsh"]);
  assert(run.code === 1, `exit code ${run.code}`);
  assert(run.err.startsWith("bad.fsh:1:10: error[E0001]:"), `stderr: ${run.err}`);
  assert(run.err.includes("\n 1 | function (\n"), `stderr: ${run.err}`);
  same([at(dir, "a.fsh"), at(dir, "bad.fsh"), at(dir, "z.fsh")].join("|"), [tidy(), "function (\n", tidy()].join("|"), "the files");
  done(top);
});

test("a rewritten file keeps its mode, a read-only or missing one is reported, and a file named twice is formatted once", () => {
  const top = fresh();
  try {
    const dir = files(top, "modes", [["run.fsh", messy()], ["locked.fsh", messy()], ["ok.fsh", messy()]]);
    chmodSync(join(dir, "run.fsh"), 0o751);
    chmodSync(join(dir, "locked.fsh"), 0o444);
    const run = fmt(dir, ["run.fsh", "locked.fsh", "gone.fsh", "ok.fsh", "./ok.fsh"]);
    assert(run.code === 1, `exit code ${run.code}`);
    assert(run.err.includes("fishc fmt: can't find 'gone.fsh'"), `stderr: ${run.err}`);
    assert(run.err.includes("fishc fmt: can't write 'locked.fsh':"), `stderr: ${run.err}`);
    const mode = statSync(join(dir, "run.fsh")).mode & 0o777;
    assert(mode === 0o751, `run.fsh's mode is ${mode}, not 0o751 (489)`);
    same([at(dir, "run.fsh"), at(dir, "locked.fsh"), at(dir, "ok.fsh")].join("|"), [tidy(), messy(), tidy()].join("|"), "the files");
    same(hidden(dir).join(", "), "", "hidden files");
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("a flag fmt doesn't take, or - beside other paths, prints usage and exits 2, and an unknown flag exits 2", () => {
  const top = fresh();
  const dir = files(top, "usage", [["a.fsh", tidy()]]);
  const cases: string[][] = [["--release", "a.fsh"], ["-", "a.fsh"]];
  for (const args of cases) {
    const run = fmt(dir, args.clone());
    assert(run.code === 2 && run.err.includes("usage: fishc fmt [<path>...] [-p <member>] [--check]"), `${args.join(" ")}: exit code ${run.code}, stderr: ${run.err}`);
  }
  const unknown = fmt(dir, ["--fast", "a.fsh"]);
  assert(unknown.code === 2 && unknown.err.includes("Unknown option '--fast'"), `--fast: exit code ${unknown.code}, stderr: ${unknown.err}`);
  done(top);
});

test("a directory formats every .fsh under it, and no paths formats the package around the working directory", () => {
  const top = fresh();
  try {
    const manifest = '[package]\nname = "app"\nversion = "0.1.0"\n';
    const pkg = files(top, "pkg", [
      ["fish.toml", manifest],
      ["src/main.fsh", messy()],
      ["src/util/u.fsh", messy()],
      ["src/notes.txt", messy()],
      ["target/debug/gen.fsh", messy()],
      ["node_modules/x/x.fsh", messy()],
      [".git/hooks/h.fsh", messy()],
      ["vendor/inner/fish.toml", manifest.replace("app", "inner")],
      ["vendor/inner/src/i.fsh", messy()],
    ]);
    const outside = files(top, "outside", [["o.fsh", messy()]]);
    symlinkSync(outside, join(pkg, "src", "linked"));
    ran(fmt(join(pkg, "src", "util"), []), 0, "", "", "fmt with no paths");
    const paths = ["src/main.fsh", "src/util/u.fsh", "src/notes.txt", "target/debug/gen.fsh", "node_modules/x/x.fsh", ".git/hooks/h.fsh", "vendor/inner/src/i.fsh"];
    same(paths.map((p) => at(pkg, p)).join("|"), [tidy(), tidy(), messy(), messy(), messy(), messy(), messy()].join("|"), "the files");
    same(at(outside, "o.fsh"), messy(), "the linked file");
    ran(fmt(pkg, ["vendor/inner"]), 0, "", "", "fmt vendor/inner");
    same(at(pkg, "vendor/inner/src/i.fsh"), tidy(), "the inner package's file");
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("a file inside a named directory and named itself is formatted once, and outside a package no paths is a usage error", () => {
  const top = fresh();
  const dir = files(top, "twice", [["d/a.fsh", messy()]]);
  ran(fmt(dir, ["--check", "d", "d/a.fsh"]), 1, "d/a.fsh\n", "", "--check d d/a.fsh");
  const loose = files(top, "loose", []);
  const run = fmt(loose, []);
  ran({ code: run.code, out: "", err: run.err.trim() }, 2, "", "fishc fmt: no fish.toml here or in any directory above; name the files to format, or run it inside a package", "fmt outside a package");
  done(top);
});

// Every path under `dir`, relative to it, each file followed by its text, sorted by path.
function snapshot(dir: string, under: string, out: Mut<string[]>): void {
  let names: string[] = [];
  try {
    names = readdirSync(join(dir, under));
  } catch (e) {
    assert(false, e.message);
  }
  for (const name of names) {
    const path = under === "" ? name : `${under}/${name}`;
    let isDir = false;
    try {
      isDir = statSync(join(dir, path)).isDirectory();
    } catch (_e) {}
    if (isDir) {
      out.push(path);
      snapshot(dir, path, out);
    } else out.push(path + read(join(dir, path)));
  }
}

function snapshotOf(dir: string): string[] {
  let out: string[] = [];
  snapshot(dir, "", out);
  out.sort();
  return out;
}

test("--check over a copy of the test programs changes no file, and names the ones that don't parse", () => {
  const top = fresh();
  const copy = join(top, "programs");
  const cp = spawnSync("cp", ["-R", join(root(), "tests", "programs"), copy]);
  assert(cp.status === 0, `cp failed: ${new TextDecoder().decode(cp.stderr)}`);
  // lock.fsh is left out: the native formatter copies the documents Bun's shares, so its deeply
  // nested callbacks don't finish in a test's time.
  try {
    rmSync(join(copy, "lock.fsh"));
  } catch (e) {
    assert(false, e.message);
  }
  const before = snapshotOf(copy);
  const run = fmt(copy, ["--check", "."]);
  assert(run.code === 1, `exit code ${run.code}`);
  assert(snapshotOf(copy) === before, "a file changed");
  for (const broken of ["octal_escape.fsh", "regex.fsh", "type.fsh", "throw.fsh", "modules_parse_error_elsewhere/b.fsh"]) assert(run.err.includes(`${broken}:`), `stderr doesn't name ${broken}: ${run.err}`);
  assert(run.out.split("\n").filter((l) => l !== "").length > 0, "no unformatted file listed");
  done(top);
}, { timeout: 120_000 });

test("a large result piped out of - arrives whole", () => {
  const top = fresh();
  const dir = files(top, "big", [["big.fsh", lines(20000, false)]]);
  const expected = lines(20000, true);
  const run = spawnSync("sh", ["-c", `cat big.fsh | "$0" fmt - | cat`, fishcPath()], { cwd: dir });
  assert(run.status === 0 && run.stdout.length === expected.length, `exit code ${run.status ?? -1}, ${run.stdout.length} bytes for ${expected.length}`);
  done(top);
});

test("a file that isn't valid UTF-8 is reported and left byte for byte as it was", () => {
  const top = fresh();
  try {
    const dir = files(top, "latin", []);
    let bytes: u8[] = new TextEncoder().encode('let a="caf');
    bytes.push(0xe9);
    for (const b of new TextEncoder().encode('"\n')) bytes.push(b);
    writeFileSync(join(dir, "s.fsh"), bytes.clone());
    const run = fmt(dir, ["s.fsh"]);
    ran({ code: run.code, out: "", err: run.err.trim() }, 1, "", "fishc fmt: 's.fsh' isn't valid UTF-8, so it's left as it was", "fmt s.fsh");
    assert(readFileSync(join(dir, "s.fsh")) === bytes, "s.fsh changed");
    // Bun's test pipes the bytes read as latin1, which its spawn writes as UTF-8.
    const piped = fmt(dir, ["-"], 'let a="café"\n');
    assert(piped.code === 0, `- exits ${piped.code}: ${piped.err}`);
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("the temporary file never follows or removes something already there, and hard links stay linked", () => {
  const top = fresh();
  try {
    const dir = files(top, "temps", [["a.fsh", messy()], ["victim.txt", "precious\n"], ["locked.fsh", messy()]]);
    for (const name of [".a.fsh.fmt-1", ".locked.fsh.fmt-1"]) symlinkSync(join(dir, "victim.txt"), join(dir, name));
    chmodSync(join(dir, "locked.fsh"), 0o444);
    fmt(dir, ["a.fsh", "locked.fsh"]);
    same([at(dir, "a.fsh"), at(dir, "victim.txt"), at(dir, "locked.fsh")].join("|"), [tidy(), "precious\n", messy()].join("|"), "the files");
    same(hidden(dir).join(", "), ".a.fsh.fmt-1, .locked.fsh.fmt-1", "hidden files");
    const linked = files(top, "hard", [["a.fsh", messy()]]);
    linkSync(join(linked, "a.fsh"), join(linked, "b.fsh"));
    ran(fmt(linked, ["b.fsh"]), 0, "", "", "fmt b.fsh");
    same(at(linked, "a.fsh"), tidy(), "the linked file");
    const nlink = statSync(join(linked, "a.fsh")).nlink;
    assert(nlink === 2, `a.fsh has ${nlink} links`);
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("an unreadable directory is reported and the rest still formatted, and a formatter bug leaves the file and says so", () => {
  const top = fresh();
  try {
    const dir = files(top, "unreadable", [["ok.fsh", messy()], ["locked/x.fsh", messy()], ["bug.fsh", "function f() { (throw x); }\n"]]);
    chmodSync(join(dir, "locked"), 0o000);
    const run = fmt(dir, ["."]);
    chmodSync(join(dir, "locked"), 0o755);
    assert(run.code === 1, `exit code ${run.code}`);
    assert(run.err.includes("fishc fmt: can't read 'locked':"), `stderr: ${run.err}`);
    assert(run.err.includes("fishc fmt: 'bug.fsh' was left as it was, because of a bug in the formatter (the formatter changed the program's meaning); please report it"), `stderr: ${run.err}`);
    same([at(dir, "ok.fsh"), at(dir, "bug.fsh")].join("|"), [tidy(), "function f() { (throw x); }\n"].join("|"), "the files");
  } catch (e) {
    assert(false, e.message);
  }
  done(top);
});

test("a reader that goes away ends - quietly, and a file with a very long name still formats", () => {
  const top = fresh();
  const dir = files(top, "pipe", [["big.fsh", lines(20000, false)]]);
  const run = spawnSync("sh", ["-c", `"$0" fmt - < big.fsh | head -c 100 > /dev/null`, fishcPath()], { cwd: dir });
  same(new TextDecoder().decode(run.stderr), "", "stderr");
  const name = `${"n".repeat(240)}.fsh`;
  const long = files(top, "long", [[name, messy()]]);
  ran(fmt(long, [name]), 0, "", "", "fmt on a long name");
  same(at(long, name), tidy(), "the file");
  done(top);
});
