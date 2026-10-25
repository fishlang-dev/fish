import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dependencies } from "../src/deps.ts";
import { formatRanking, rank, readPlan, stepsOf } from "../src/rank.ts";
import { compare, featuresOf, formatComparison, formatReport, grade, readReport, scanFiles, survey } from "../src/survey.ts";

const sample = join(import.meta.dir, "survey", "sample");
const fishc = (...args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), ...args]);

// A project in a fresh directory, from file paths to their text.
function project(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "survey-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readable(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

// What each rule counts in one snippet of TypeScript.
function counts(src: string): Record<string, number> {
  let found: Record<string, number> = {};
  project({ "main.ts": src }, (dir) => {
    const r = survey(dir);
    found = Object.fromEntries([...r.rules, ...r.waiting].filter((x) => x.count > 0).map((x) => [x.id, x.count]));
  });
  return found;
}

test("each rule counts what the sample shows", () => {
  const r = survey(sample);
  const got = Object.fromEntries([...r.rules, ...r.waiting].filter((x) => x.count > 0).map((x) => [x.id, x.count]));
  expect(got).toEqual({
    parse: 1, R1: 1, R2: 1, R3: 1, declarators: 1,
    numberKeys: 1, forIn: 1, decorators: 1,
    classForms: 1, fetch: 1, timers: 1,
    G1: 3, G4: 1, G5: 1, G6: 1, G7: 1, G8: 1, G10: 1, A1: 1, A2: 1, A3: 1, A4: 1, A8: 1, A9: 1,
  });
});

test("forms that look alike are told apart", () => {
  expect(counts("const a = JSON.parse(s) as User;\nconst b = JSON.stringify(a);\n")).toEqual({ A8: 1 });
  expect(counts("const a = JSON.parse(s);\nconst b = JSON.stringify(a, null, 2);\n")).toEqual({ json: 1 });
  expect(counts("const a = JSON.parse(s, revive) as User;\n")).toEqual({ A8: 1, json: 1 });
  expect(counts("import os from \"node:os\";\nimport { hostname } from \"os\";\nimport { cpus } from \"os\";\n")).toEqual({ nodeBuiltins: 1 });
  expect(counts("export { hostname } from \"node:os\";\nexport * from \"os\";\n")).toEqual({});
  expect(counts("export * as system from \"os\";\n")).toEqual({ nodeBuiltins: 1 });
  expect(counts("import path from \"path\";\nimport { sep } from \"path\";\nexport function f(x: string) {\n  return path.join(x, sep) + path.parse(x).base;\n}\n")).toEqual({ nodeBuiltins: 1 });
  expect(counts("function f() {\n  console.error(1);\n  console.warn(2);\n  console.info(3);\n  const t = Date.now() + performance.now();\n}\n")).toEqual({ console: 1 });
  expect(counts("function f() {\n  const a = process.argv[2];\n  const h = process.env.HOME;\n  process.exit(1);\n}\n")).toEqual({});
  expect(counts("function f() {\n  process.env.X = \"y\";\n  delete process.env.Y;\n  const p = process.pid;\n}\n")).toEqual({ process: 3, R3: 1 });
  expect(counts("function f() {\n  const { HOME } = process.env;\n  const k = Object.keys(process.env);\n  const h = process.env?.HOME;\n  process.env.N++;\n}\n")).toEqual({ process: 4 });
  expect(counts("type F = (x: number) => void;\nconst g = function () { return 1; };\n")).toEqual({ A9: 1 });
  expect(counts("declare const DEV: boolean;\nlet a = 1;\nexport let b = 2;\nfor (const x of [1]) {}\n")).toEqual({ A4: 2 });
  expect(counts("export function f(): i64 { return 1; }\nexport const x = 1;\nexport interface I {}\n")).toEqual({});
  expect(counts("\"use strict\";\nsetup();\n")).toEqual({ G7: 1 });
  expect(counts("for (const [k, v] of m) {}\nfor (const { x, y: z } of ps) {}\nfor (const [a = 1] of q) {}\n")).toEqual({ destructuring: 1 });
  expect(counts("function f() { enum E { A } class C {} }\n")).toEqual({});
  expect(counts("function f(n: number) { class C { m() { return n; } } class D { m(k: number) { return k; } } }\n")).toEqual({ localCaptures: 1 });
  expect(counts("const s = f.call(o, 1);\nconst p = Promise.all([]);\nconst q = Promise.any([]);\n")).toEqual({ G9: 1 });
  expect(counts("class A { #x = 1; get #g() { return 1; } m() { return this.#x; } }\n")).toEqual({ classForms: 3 });
  expect(counts("﻿var y = 2;\n")).toEqual({ A1: 1 });
  expect(counts("function f(a?: string) { return () => class {}; }\n")).toEqual({ A2: 1 });
  expect(counts("const a = Number.parseInt(s);\nconst f = Function(\"x\");\n")).toEqual({ R1: 1 });
  expect(counts("const r = Math.random();\nconst n = Math.floor(Math.sqrt(x) * Math.PI);\n")).toEqual({ math: 1 });
  expect(counts("const a = /x+/.test(s) && /(y)/.exec(s);\nconst b = new RegExp(\"z\", \"i\");\nconst c = new RegExp(`w`);\n")).toEqual({});
  expect(counts("const a = /x+/g.test(s);\nconst i = re.lastIndex;\n")).toEqual({ regexState: 2 });
  expect(counts("function f() { [a, b] = [b, a]; g([c] = [1]); }\n")).toEqual({ destructuringAssignment: 1 });
  expect(counts("const id = <T>(x: T) => x;\nconst g = f(<T>(x: T) => x);\ntype F = <T>(x: T) => T;\ninterface I { m<T>(x: T): T }\nclass C { m<T>(x: T): T { return x; } }\n")).toEqual({});
  expect(counts("class D { f: <T>(x: T) => T = id; }\nconst xs: (<T>(x: T) => T)[] = [];\nconst u: (<T>(x: T) => T) | number = 1;\n")).toEqual({ genericFunctionsHeld: 3 });
  expect(counts("const a = s.match(\"x\") && s.search(`y`);\nconst n = s.matchAll(/z/g).next();\nconst r = s.replaceAll(\"a\", \"b\") + s.replaceAll(/a/g, \"b\");\n")).toEqual({ regexStrings: 3 });
  expect(counts("const r = new RegExp(p);\nconst t = s.replace(/a/g, \"b\").split(/,/);\nconst u = s.replace(\"a\", \"b\");\n")).toEqual({ dynamicRegex: 1 });
  expect(counts("declare let d: number;\ndeclare global { var g: number; }\ndeclare module \"m\" { export const x: number; }\n")).toEqual({ namespaces: 2 });
  expect(counts("abstract class A { abstract x: number; }\n")).toEqual({ classForms: 2 });
  expect(counts("function main(): void {}\nmain();\nmain().catch(report);\n")).toEqual({});
});

test("each file names the planned features it waits on", () => {
  project({
    "a.ts": "const o = { ...base, port: 1 };\nconst xs = [...ys];\n",
    "b.ts": "let a, b;\n[a, b] = [1, 2];\nconst { x } = p;\n",
    "c.ts": "const = ;\n",
    "d.ts": "function main(): void {}\n",
  }, (dir) => {
    expect(Object.fromEntries(scanFiles(dir).map((f) => [f.file, featuresOf(f)]))).toEqual({
      "a.ts": [],
      "b.ts": [],
      "c.ts": ["parser gaps"],
      "d.ts": [],
    });
  });
});

test("a member call points at its method, and each rule keeps its first three examples", () => {
  project({ "main.ts": "const a = b.c.d.call(f).call(g).call(h).call(i);\n" }, (dir) => {
    const r = survey(dir).rules.find((x) => x.id === "G9")!;
    expect(r.count).toBe(4);
    expect(r.examples.map((e) => e.col)).toEqual([17, 25, 33]);
  });
});

test("discovery takes .ts, .tsx and .mts, and skips dependencies, hidden directories, declarations and links", () => {
  project({
    "a.ts": "var a = 1;\n", "b.mts": "var b = 1;\n", "c.tsx": "var c = 1;\n", "d.d.ts": "var d: number;\n", "e.d.mts": "var e: number;\n",
    "node_modules/dep/index.ts": "var f = 1;\n", ".cache/g.ts": "var g = 1;\n",
  }, (dir) => {
    symlinkSync(join(dir, "a.ts"), join(dir, "link.ts"));
    symlinkSync(dir, join(dir, "loop"));
    const r = survey(dir);
    expect(r.files).toBe(3);
    expect(r.rules.find((x) => x.id === "A1")!.count).toBe(3);
  });
});

test("a file that can't be read adds its own blocker, not its lines", () => {
  project({ "ok.ts": "delete o.k;\n", "bad.ts": "let x!: number;\nconst = ;\n", "view.tsx": "const v = <div/>;\n" }, (dir) => {
    const r = survey(dir);
    expect(r.lines).toBe(1);
    expect(r.unread).toEqual({ files: 2, lines: 3 });
    expect(r.waiting.find((x) => x.id === "parse")!.examples[0]!.note).toContain("expected");
    expect(r.waiting.find((x) => x.id === "jsx")!.count).toBe(1);
    // Graded per 1000 lines at least; with most lines unread, no grade at all.
    expect(r.score).toBe(13);
    expect(r.grade).toBeNull();
    expect(formatReport(r)).toContain("no grade: only 25% of the lines could be read");
  });
  project({ "a.tsx": "delete globalThis.x;\nconst v = <div/>;\n" }, (dir) => {
    expect(survey(dir).grade).toBeNull();
  });
  project({ "a.tsx": "let x!: number;\n" }, (dir) => {
    expect(survey(dir).waiting.find((x) => x.id === "parse")!.count).toBe(1);
  });
});

test("an unreadable file or directory is skipped, and a deeply nested file is unread", () => {
  project({ "a.ts": "var a = 1;\n", "secret/b.ts": "var b = 1;\n", "deep.ts": `const x = ${"(".repeat(20000)}1${")".repeat(20000)};\n` }, (dir) => {
    chmodSync(join(dir, "secret"), 0o000);
    try {
      const r = survey(dir);
      // As root a mode of 000 doesn't stop reading, so the directory is surveyed after all.
      expect(r.files).toBe(readable(join(dir, "secret")) ? 3 : 2);
      expect(r.unread.files).toBe(1);
      expect(r.waiting.find((x) => x.id === "parse")!.examples[0]!.note).toBe("too deeply nested to read");
    } finally {
      chmodSync(join(dir, "secret"), 0o755);
    }
  });
});

test("the grade counts rejected constructs and guided rewrites per 1000 lines", () => {
  expect([0, 5, 5.1, 15, 15.1, 40, 40.1, 100, 100.1].map(grade)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D", "F"]);
  const r = survey(sample);
  expect(r.score).toBe(Math.round(((10 * r.counts.reject + 3 * r.counts.guided) * 1000) / Math.max(r.lines, 1000) * 10) / 10);
  project({ "main.ts": "function main(): void {\n  const x: number = 1;\n  console.log(x.toString());\n}\n" }, (dir) => {
    expect(formatReport(survey(dir))).toContain("grade A (score 0 per 1000 lines)");
  });
});

test("the JSON lists every rule, with zero counts", () => {
  const run = fishc("survey", sample, "--json");
  const r = JSON.parse(run.stdout.toString());
  expect(r).toEqual(survey(sample));
  expect(r.rules.length + r.waiting.length).toBe(50);
});

test("fishc survey prints the grade, the rewrites and what Fish still needs, with locations", () => {
  const run = fishc("survey", sample);
  const out = run.stdout.toString();
  expect(run.exitCode).toBe(0);
  expect(out).toContain("fishc survey: 3 files");
  expect(out).toMatch(/grade [A-F] \(score [\d.]+ per 1000 lines, from \d+% of the lines\)/);
  expect(out).toContain("top rewrites");
  expect(out).toContain("waiting on Fish");
  expect(out).toMatch(/e\.g\. src\/broken\.ts:1:7 \(expected/);
});

test("fishc survey refuses a missing directory, a file, and a directory with no TypeScript", () => {
  expect(fishc("survey", join(sample, "missing")).stderr.toString()).toContain("doesn't exist");
  expect(fishc("survey", join(sample, "src", "app.ts")).exitCode).toBe(2);
  project({ "readme.md": "hi\n" }, (dir) => {
    const run = fishc("survey", dir);
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain("holds no TypeScript files");
  });
  expect(fishc("build", "x.fsh", "--json").exitCode).toBe(2);
});

// Several projects at once, each from file paths to their text.
function projects(repos: Record<string, string>[], run: (dirs: string[]) => void) {
  const dirs: string[] = [];
  const next = (i: number) => {
    if (i === repos.length) return run(dirs);
    project(repos[i]!, (dir) => {
      dirs.push(dir);
      next(i + 1);
    });
  };
  next(0);
}

const big = "const xs = setTimeout(f, 1);\n".repeat(10);

test("the curve picks the feature freeing the most lines first, and frees a file only once all it needs exist", () => {
  projects([{ "a.ts": big, "b.ts": "for (const k in o) {}\n", "c.ts": "abstract class A {}\nfor (const k in o) {}\n" }, { "d.ts": "function main(): void {}\n" }], (dirs) => {
    const r = rank(dirs);
    expect(r.curve.start).toEqual({ files: 1, lines: 1, share: 7.1 });
    expect(r.curve.steps.map((s) => [s.feature, s.gained.files, s.gained.lines, s.portable.share])).toEqual([
      ["setTimeout and setInterval", 1, 10, 78.5],
      ["for...in", 1, 1, 85.7],
      ["Abstract classes and #private fields", 1, 2, 100],
    ]);
    expect(r.curve.steps[1]!).toMatchObject({ rules: ["forIn"], files: 2, lines: 3 });
    expect(r.repos.map((x) => x.files)).toEqual([3, 1]);
  });
});

test("unread files are left out of the steps but not the shares, and the self curve stands alone", () => {
  projects([{ "a.ts": big, "bad.ts": "const = ;\n", "v.tsx": "const v = <div/>;\nconst w = 1;\n" }, { "s.ts": "for (const k in o) {}\n" }], ([repo, self]) => {
    const r = rank([repo!], self);
    expect(r.repos[0]!.unread).toEqual({ files: 2, lines: 3 });
    expect(r.curve.steps.map((s) => [s.feature, s.portable.share])).toEqual([["setTimeout and setInterval", 76.9]]);
    expect(r.curve.unread).toEqual([{ feature: "JSX for server-side HTML", files: 1, lines: 2 }, { feature: "parser gaps", files: 1, lines: 1 }]);
    expect(formatRanking(r)).toContain("also waiting, in files Fish couldn't read");
    expect(r.self!.curve.steps.map((s) => [s.feature, s.portable.share])).toEqual([["for...in", 100]]);
  });
});

test("imports wait on other files, npm packages or Node built-ins by how they are written", () => {
  project({ "a.ts": "import x from \"./x\";\n", "b.ts": "import { z } from \"zod\";\nimport y from \"@s/y\";\n", "c.ts": "import cp from \"node:child_process\";\nimport crypto = require(\"crypto\");\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([[], ["npm interop"], ["Hashing", "Process spawning"]]);
  });
  project({ "a.ts": "import w from \"ws\";\nimport { test } from \"bun:test\";\n", "b.ts": "import x from \"~/x\";\nimport y from \"@/y\";\nimport z from \"#z\";\n", "c.ts": "async function f() { return await import(\"pkg\"); }\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([["npm interop"], ["Path aliases"], ["npm interop"]]);
  });
});

test("ties go to the feature carrying most of what waits, then to the name, despite float noise", () => {
  // Ten 1-line files share their line among ten features, so A weighs ten tenths, which floats
  // add to just under 1; B and Z weigh exactly 1, tied with A, which comes first by name.
  const unit = (lines: number, waits: string[]) => ({ lines, waits: new Set(waits), rules: [] as [string, string][] });
  const units = [...Array.from({ length: 10 }, (_, i) => unit(1, ["A", ...Array.from({ length: 9 }, (_, k) => `F${i}-${k}`)])), unit(2, ["B", "Z"])];
  expect(stepsOf(units, 12).steps.slice(0, 2).map((s) => s.feature)).toEqual(["A", "B"]);
});

test("a plan names each feature's item and whether it is done", () => {
  project({ "a.ts": big + "for (const k in o) {}\nabstract class A {}\n", "plan.md": "## Plan\n\n- [ ] 7. **setTimeout and setInterval** - timers\n  - [x] 9b. **for...in** - keys\n" }, (dir) => {
    const r = rank([dir], undefined, readPlan(join(dir, "plan.md")));
    expect(Object.fromEntries(r.curve.steps.map((s) => [s.feature, s.plan]))).toEqual({
      "setTimeout and setInterval": { item: "7", done: false }, "for...in": { item: "9b", done: true }, "Abstract classes and #private fields": null,
    });
    expect(formatRanking(r)).toContain("(plan item 9b, done)");
  });
  project({ "plan.md": "- [ ] 1. **`for...in`** - keys\r\n- [x]  2.  **Regex**\r\n- [ ] 3. **Regex**\r\n" }, (dir) => {
    const plan = readPlan(join(dir, "plan.md"));
    expect([plan.get("for...in"), plan.get("regex")]).toEqual([{ item: "1", done: false }, { item: "2", done: true }]);
  });
  project({ "readme.md": "# Hello\n" }, (dir) => {
    expect(() => readPlan(join(dir, "readme.md"))).toThrow("no '- [ ] N. **Title**' items");
  });
});

test("fishc survey --rank prints and gives JSON, and refuses what it can't read", () => {
  projects([{ "a.ts": big }, { "s.ts": "const o = { ...p };\n" }], ([a, s]) => {
    const text = fishc("survey", "--rank", a!, "--self", s!).stdout.toString();
    expect(text).toContain("1. setTimeout and setInterval");
    expect(text).toContain(`self-hosting (${s})`);
    expect(JSON.parse(fishc("survey", "--rank", a!, "--json").stdout.toString())).toEqual(JSON.parse(JSON.stringify(rank([a!]))));
    expect(fishc("survey", "--rank", a!, "--plan", join(a!, "missing.md")).exitCode).toBe(2);
    expect(fishc("survey", "--rank", a!, join(a!, "nope")).exitCode).toBe(2);
    expect(fishc("survey", a!, s!).exitCode).toBe(2);
    expect(fishc("survey", a!, "--self", s!).exitCode).toBe(2);
    expect(fishc("survey", "--rank").exitCode).toBe(2);
    expect(fishc("survey", "--rank", a!, "--self", "").exitCode).toBe(2);
    expect(fishc("survey", "--rank", a!, "--self").stderr.toString()).toContain("fishc:");
    expect(fishc("survey", "--rank", a!, a!).stderr.toString()).toContain("already surveyed");
    expect(fishc("build", "x.fsh", "--rank").exitCode).toBe(2);
    expect(JSON.parse(fishc("survey", "--rank", a!, "--json").stdout.toString()).curve.steps[0]).not.toHaveProperty("plan");
  });
});

test("a comparison lists the rules that moved, the furthest first, a new rule from nothing", () => {
  project({ "a.ts": "var a = 1;\nvar b = 2;\nconst xs = setTimeout(f, 1);\n" }, (dir) => {
    const then = readReport(JSON.stringify(survey(dir)));
    writeFileSync(join(dir, "a.ts"), "const a = 1;\nconst xs = setTimeout(f, 1) && setTimeout(g, 2) && setInterval(h, 3);\ndelete o.k;\n");
    const c = compare(then, survey(dir));
    expect(c.rules.map((m) => [m.id, m.then, m.now, m.change])).toEqual([["A1", 2, 0, -2], ["timers", 1, 3, 2], ["G7", 0, 1, 1], ["R3", 0, 1, 1]]);
    expect(c.then.counts.reject).toBe(0);
    expect(c.now.counts.reject).toBe(1);
    const text = formatComparison(c);
    expect(text).toContain("rejected  0 -> 1 (+1)");
    expect(text).toContain("      +2  setTimeout and setInterval (1 -> 3)");
    expect(text.indexOf("rewrites that changed")).toBeLessThan(text.indexOf("waiting on Fish, changed"));
    expect(formatComparison(compare(then, then))).toContain("no rule's count changed");
  });
});

test("a baseline must be a saved survey report, and is scored again by today's rules", () => {
  const rule = (extra: object) => JSON.stringify({ files: 1, lines: 3, rules: [{ id: "A1", action: "auto", title: "var", count: 4, ...extra }] });
  expect(() => readReport("not json")).toThrow("isn't JSON");
  for (const text of ["null", "[]", "5", "{}", "{\"rules\": []}", rule({ count: 1e999 }), rule({ count: -2.5 }), rule({ count: "4" }), rule({ title: undefined }), rule({ action: "maybe" }),
    JSON.stringify({ files: 1, lines: 3, rules: [{ id: "A1", action: "auto", title: "var", count: 1 }, { id: "A1", action: "auto", title: "var", count: 2 }] }),
    JSON.stringify({ files: "1", lines: 3, rules: [] }), JSON.stringify({ files: 1, lines: 3, unread: 1, rules: [] })]) {
    expect(() => readReport(text)).toThrow("isn't a 'fishc survey --json' report");
  }
  // A report saved before `waiting` and `unread` existed, with a score made by older rules.
  const old = readReport(JSON.stringify({ files: 1, lines: 36, score: 1628.6, grade: "F", counts: {}, rules: [
    { id: "R3", action: "reject", title: "delete", count: 1 }, { id: "arrayMethods", action: "unsupported", title: "array methods", count: 3 },
  ] }));
  expect(old.unread).toEqual({ files: 0, lines: 0 });
  expect([old.score, old.grade, old.counts.unsupported, old.waiting.map((r) => r.id)]).toEqual([10, "B", 3, ["arrayMethods"]]);
  const text = formatComparison(compare(old, { ...old, rules: old.rules.map((r) => ({ ...r, count: r.count + 100000 })) }));
  expect(text).toContain("+100000  delete (1 -> 100001)");
});


test("fishc survey --compare shows what changed since a saved report, and refuses bad baselines", () => {
  project({ "app/a.ts": "var a = 1;\n", "old.json": "", "bad.json": "{}", "text.txt": "nope" }, (dir) => {
    const app = join(dir, "app");
    writeFileSync(join(dir, "old.json"), fishc("survey", app, "--json").stdout.toString());
    writeFileSync(join(app, "a.ts"), "var a = 1;\nvar b = 2;\n");
    const run = fishc("survey", app, "--compare", join(dir, "old.json"));
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain("      +1  var: const or let (1 -> 2)");
    const json = JSON.parse(fishc("survey", app, "--compare", join(dir, "old.json"), "--json").stdout.toString());
    expect(Object.keys(json)).toEqual(["then", "now", "rules"]);
    expect(json.rules).toEqual([{ id: "A1", action: "auto", title: "var: const or let", then: 1, now: 2, change: 1 }]);
    expect(fishc("survey", app, "--compare", join(dir, "bad.json")).stderr.toString()).toContain("isn't a 'fishc survey --json' report");
    expect(fishc("survey", app, "--compare", join(dir, "text.txt")).stderr.toString()).toContain("isn't JSON");
    expect(fishc("survey", app, "--compare", join(dir, "missing.json")).stderr.toString()).toContain("can't be compared: it doesn't exist");
    expect(fishc("survey", app, "--compare", dir).stderr.toString()).toContain("it isn't a file");
    expect(fishc("survey", "--rank", app, "--compare", join(dir, "old.json")).stderr.toString()).toContain("rankings can't be compared yet");
    expect(fishc("build", "x.fsh", "--compare", "old.json").exitCode).toBe(2);
  });
});

test("dependencies are sorted into std, planned, native, pure and not installed", () => {
  const pkg = (extra: object = {}) => JSON.stringify({ name: "p", version: "1.0.0", ...extra });
  project({
    "app/package.json": JSON.stringify({
      dependencies: { express: "^4", gyp: "1", flagged: "1", built: "1", prebuilt: "1", compiled: "1", plain: "1", "@scope/plain": "1", hoisted: "1", missing: "1" },
      devDependencies: { vitest: "^1" },
    }),
    "app/a.ts": "const x = 1;\n",
    "app/node_modules/express/package.json": pkg(),
    "app/node_modules/gyp/package.json": pkg(), "app/node_modules/gyp/binding.gyp": "{}",
    "app/node_modules/flagged/package.json": pkg({ gypfile: true }),
    "app/node_modules/built/package.json": pkg({ dependencies: { "node-gyp-build": "^4" } }),
    "app/node_modules/prebuilt/package.json": pkg({ optionalDependencies: { "prebuilt-darwin-arm64": "1" } }),
    "app/node_modules/compiled/package.json": pkg(), "app/node_modules/compiled/build/Release/c.node": "",
    "app/node_modules/plain/package.json": pkg(),
    "app/node_modules/@scope/plain/package.json": pkg(),
    "node_modules/hoisted/package.json": pkg(),
  }, (dir) => {
    const d = dependencies(join(dir, "app"))!;
    expect(Object.fromEntries(d.list.map((x) => [x.name, x.group]))).toEqual({
      express: "std", gyp: "native", flagged: "native", built: "native", prebuilt: "native", compiled: "native",
      plain: "pure", "@scope/plain": "pure", hoisted: "pure", missing: "unknown", vitest: "planned",
    });
    expect(d.counts).toEqual({ std: 1, planned: 1, native: 5, pure: 3, unknown: 1 });
    expect(d.list.find((x) => x.name === "vitest")).toMatchObject({ dev: true, kind: "unknown", equivalent: { name: "Test runner", planned: true } });
    const r = survey(join(dir, "app"));
    expect(r.dependencies).toEqual(d);
    const text = formatReport(r);
    expect(text).toContain("dependencies (11, 1 dev)");
    expect(text).toContain("express (serve and Router)");
    expect(text).toMatch(/native:\s+5  gyp, flagged, built, prebuilt, compiled/);
    const plain = JSON.parse(fishc("survey", join(dir, "app"), "--json").stdout.toString());
    expect(plain.dependencies.counts.native).toBe(5);
    expect(plain.grade).toBe(survey(join(dir, "app")).grade);
  });
});

test("a project without package.json has no dependency section, and a broken one is noted", () => {
  project({ "a.ts": "const x = 1;\n" }, (dir) => {
    expect(dependencies(dir)).toBeUndefined();
    expect(formatReport(survey(dir))).not.toContain("dependencies");
  });
  project({ "a.ts": "const x = 1;\n", "package.json": "[1, 2]" }, (dir) => {
    expect(formatReport(survey(dir))).toContain("package.json can't be read: it isn't an object");
  });
});

test("dependency classification ignores dev helpers, odd names and odd manifests", () => {
  const pkg = (extra: object = {}) => JSON.stringify({ name: "p", version: "1.0.0", ...extra });
  project({
    "package.json": "﻿" + JSON.stringify({
      dependencies: { constructor: "1", toString: "1", bench: "1", utils: "1", crypto: "1", shared: "1", "async-mutex": "1", bcryptjs: "1", odd: 1 },
      devDependencies: { shared: "1", "socket.io": "1" },
    }),
    "a.ts": "const x = 1;\n",
    "node_modules/bench/package.json": pkg({ devDependencies: { bindings: "1", nan: "1" } }),
    "node_modules/utils/package.json": pkg({ optionalDependencies: { "linux-utils": "1", "@capacitor/android": "1" } }),
    "node_modules/crypto/package.json": pkg({ optionalDependencies: { nan: "1" } }),
    "node_modules/shared/package.json": pkg(),
    "node_modules/socket.io/package.json": pkg(),
  }, (dir) => {
    const d = dependencies(dir)!;
    expect(Object.fromEntries(d.list.map((x) => [x.name, [x.group, x.equivalent?.name, x.dev]]))).toEqual({
      constructor: ["unknown", undefined, false], toString: ["unknown", undefined, false],
      bench: ["pure", undefined, false], utils: ["pure", undefined, false], crypto: ["native", undefined, false], shared: ["pure", undefined, false],
      "async-mutex": ["std", "Semaphore", false], bcryptjs: ["planned", "Auth primitives", false], "socket.io": ["pure", undefined, true],
    });
  });
  project({ "package.json": JSON.stringify({ dependencies: ["express"] }), "a.ts": "const x = 1;\n" }, (dir) => {
    expect(dependencies(dir)!.list).toEqual([]);
  });
  project({ "package.json": JSON.stringify({ dependencies: { lodash: "1" } }), ".pnp.cjs": "", "a.ts": "const x = 1;\n" }, (dir) => {
    expect(formatReport(survey(dir))).toContain("Yarn Plug'n'Play");
    expect(formatReport(survey(dir))).toContain("not installed:    1  lodash");
  });
});

test("each Node built-in waits on the feature that replaces it, and the ranking names those features", () => {
  project({
    "a.ts": "import { spawn } from \"node:child_process\";\nimport crypto from \"crypto\";\n",
    "b.ts": "import { setTimeout } from \"node:timers/promises\";\n",
    "c.ts": "import vm from \"vm\";\nimport cp = require(\"child_process\");\n",
    "plan.md": "- [ ] 1. **Process spawning**\n- [ ] 2. **Hashing**\n",
  }, (dir) => {
    // `timers/promises` is std's sleep, so b.ts waits on nothing.
    expect(scanFiles(dir).filter((f) => f.file.endsWith(".ts")).map(featuresOf)).toEqual([["Hashing", "Process spawning"], [], ["Node built-ins", "Process spawning"]]);
    const steps = rank([dir], undefined, readPlan(join(dir, "plan.md"))).curve.steps;
    expect(steps.map((s) => [s.feature, s.rules, s.plan])).toEqual([
      ["Process spawning", ["nodeBuiltins"], { item: "1", done: false }],
      // Each frees one 2-line file, so the tie goes by name.
      ["Hashing", ["nodeBuiltins"], { item: "2", done: false }],
      ["Node built-ins", ["nodeBuiltins"], null],
    ]);
    expect(survey(dir).waiting.find((r) => r.id === "nodeBuiltins")!.examples.map((e) => e.module)).toEqual(["child_process", "crypto", "timers/promises"]);
  });
  project({
    "a.ts": "export * from \"crypto\";\nexport { spawn } from \"node:child_process\";\n",
    "b.ts": "import { test } from \"node:test\";\nimport http from \"node:http\";\nimport { Console } from \"console\";\n",
    "c.ts": "class A { constructor() {} }\n",
  }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([["Hashing", "Process spawning"], ["HTTP client", "Test runner", "The rest of console"], []]);
    expect(scanFiles(dir)[2]!.findings).toEqual([]);
  });
});

test("the report lists each Node built-in with its files and what replaces it", () => {
  project({
    "a.ts": "import { spawn } from \"node:child_process\";\nimport crypto from \"crypto\";\n",
    "b.ts": "import cp from \"node:child_process\";\nimport http from \"node:http\";\n",
    "c.ts": "import vm from \"vm\";\nimport net from \"node:net\";\n",
  }, (dir) => {
    const r = survey(dir);
    expect(r.builtins).toEqual([
      { module: "child_process", files: 2, equivalent: { name: "Process spawning", planned: true } },
      { module: "crypto", files: 1, equivalent: { name: "Hashing", planned: true } },
      { module: "http", files: 1, equivalent: { name: "HTTP client", planned: true } },
      { module: "net", files: 1, equivalent: { name: "TcpListener and TcpStream", planned: false } },
      { module: "vm", files: 1 },
    ]);
    const text = formatReport(r);
    expect(text).toContain("  child_process       2 files  planned: Process spawning");
    expect(text).toContain("  http                1 file   planned: HTTP client");
    expect(text).toContain("  vm                  1 file   nothing planned");
    expect(text).toContain("  net                 1 file   in std: TcpListener and TcpStream");
    expect(JSON.parse(fishc("survey", dir, "--json").stdout.toString()).builtins).toHaveLength(5);
  });
  project({ "a.ts": "import x from \"./x\";\n" }, (dir) => {
    expect(survey(dir)).not.toHaveProperty("builtins");
    expect(formatReport(survey(dir))).not.toContain("Node built-ins");
  });
});

test("optional and trailing rest tuple elements are portable; a leading rest, or one beside optional elements, waits", () => {
  project({
    "a.ts": "const t: [number, string?] = [1];\nconst u: [string, ...number[]] = [\"a\", 1];\n",
    "b.ts": "const v: [...number[], string] = [\"a\"];\n",
    "c.ts": "const w: [number, string?, ...number[]] = [1];\n",
  }, (dir) => {
    expect(scanFiles(dir).map((f) => f.findings.map(([id]) => id))).toEqual([[], ["tuples"], ["tuples"]]);
  });
});

test("node:fs, fs/promises and util are std, and a util member std lacks waits on Node built-ins", () => {
  project({ "a.ts": "import { readFileSync } from \"node:fs\";\n", "b.ts": "import { readFile } from \"node:fs/promises\";\nreadFile(\"x\");\n", "c.ts": "import { parseArgs, format } from \"node:util\";\n", "d.ts": "import { promisify } from \"node:util\";\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([[], [], [], ["Node built-ins"]]);
  });
});

test("generic arrows not held by a const are portable", () => {
  project({ "a.ts": "const o = { run: <T>(x: T): T => x };\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([[]]);
  });
});

test("node:fs members the std module answers are portable; others are Node built-ins", () => {
  project({ "a.ts": "import { readFileSync, statSync, rmSync } from \"node:fs\";\n", "b.ts": "import { mkdirSync } from \"fs\";\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([[], ["Node built-ins"]]);
  });
});
