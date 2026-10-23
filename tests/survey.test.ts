import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatRanking, rank, readPlan, stepsOf } from "../src/rank.ts";
import { featuresOf, formatReport, grade, scanFiles, survey } from "../src/survey.ts";

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
    parse: 1, R1: 1, R2: 1, R3: 1, modules: 2, destructuring: 1, defaults: 1, declarators: 1, tuples: 1,
    spread: 1, arrayMethods: 3, collections: 1, regex: 1, forIn: 1, decorators: 1, genericMethods: 1,
    classForms: 1, math: 1, process: 1, fetch: 1, timers: 1, stderr: 1, json: 1, nestedFunctions: 1,
    G1: 3, G4: 1, G5: 1, G6: 1, G7: 1, G8: 1, G10: 1, A1: 1, A2: 1, A3: 1, A4: 1, A8: 1, A9: 1,
  });
});

test("forms that look alike are told apart", () => {
  expect(counts("type F = (x: number) => void;\nconst g = function () { return 1; };\n")).toEqual({ A9: 1 });
  expect(counts("declare const DEV: boolean;\nlet a = 1;\nexport let b = 2;\nfor (const x of [1]) {}\n")).toEqual({ A4: 2, modules: 1 });
  expect(counts("export function f(): i64 { return 1; }\nexport const x = 1;\nexport interface I {}\n")).toEqual({ modules: 2 });
  expect(counts("\"use strict\";\nsetup();\n")).toEqual({ G7: 1 });
  expect(counts("function f() { enum E { A } class C {} }\n")).toEqual({ localDeclarations: 2 });
  expect(counts("const s = f.call(o, 1);\nconst p = Promise.all([]);\n")).toEqual({ G9: 1, promiseAll: 1 });
  expect(counts("class A { #x = 1; get #g() { return 1; } m() { return this.#x; } }\n")).toEqual({ classForms: 3 });
  expect(counts("﻿var y = 2;\n")).toEqual({ A1: 1 });
  expect(counts("function f(a?: string) { return () => class {}; }\n")).toEqual({ A2: 1 });
  expect(counts("const a = Number.parseInt(s);\nconst f = Function(\"x\");\n")).toEqual({ math: 1, R1: 1 });
  expect(counts("declare let d: number;\ndeclare global { var g: number; }\ndeclare module \"m\" { export const x: number; }\n")).toEqual({ namespaces: 2 });
  expect(counts("abstract class A { abstract x: number; }\n")).toEqual({ classForms: 2 });
  expect(counts("function main(): void {}\nmain();\nmain().catch(report);\n")).toEqual({});
});

test("each file names the planned features it waits on", () => {
  project({
    "a.ts": "const o = { ...base, port: 1 };\nconst xs = [...ys].map(f);\n",
    "b.ts": "let a, b;\n[a, b] = [1, 2];\nconst { x } = p;\n",
    "c.ts": "const = ;\n",
    "d.ts": "function main(): void {}\n",
  }, (dir) => {
    expect(Object.fromEntries(scanFiles(dir).map((f) => [f.file, featuresOf(f)]))).toEqual({
      "a.ts": ["Array methods", "Object spread", "Rest parameters and array spread"],
      "b.ts": ["Destructuring", "Destructuring assignment", "Several declarators and deferred initialization"],
      "c.ts": ["parser gaps"],
      "d.ts": [],
    });
  });
});

test("a member call points at its method, and each rule keeps its first three examples", () => {
  project({ "main.ts": "const a = b.c.d.map(f).filter(g).map(h).map(i);\n" }, (dir) => {
    const r = survey(dir).waiting.find((x) => x.id === "arrayMethods")!;
    expect(r.count).toBe(4);
    expect(r.examples.map((e) => e.col)).toEqual([17, 24, 34]);
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
  expect(r.rules.length + r.waiting.length).toBe(48);
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

const big = "const xs = ys.map(f);\n".repeat(10);

test("the curve picks the feature freeing the most lines first, and frees a file only once all it needs exist", () => {
  projects([{ "a.ts": big, "b.ts": "const o = { ...p };\n", "c.ts": "const t: [number, number] = [1, 2];\nconst o = { ...p };\n" }, { "d.ts": "function main(): void {}\n" }], (dirs) => {
    const r = rank(dirs);
    expect(r.curve.start).toEqual({ files: 1, lines: 1, share: 7.1 });
    expect(r.curve.steps.map((s) => [s.feature, s.gained.files, s.gained.lines, s.portable.share])).toEqual([
      ["Array methods", 1, 10, 78.5],
      ["Object spread", 1, 1, 85.7],
      ["Tuples", 1, 2, 100],
    ]);
    expect(r.curve.steps[1]!).toMatchObject({ rules: ["objectSpread"], files: 2, lines: 3 });
    expect(r.repos.map((x) => x.files)).toEqual([3, 1]);
  });
});

test("unread files are left out of the steps but not the shares, and the self curve stands alone", () => {
  projects([{ "a.ts": big, "bad.ts": "const = ;\n", "v.tsx": "const v = <div/>;\nconst w = 1;\n" }, { "s.ts": "for (const k in o) {}\n" }], ([repo, self]) => {
    const r = rank([repo!], self);
    expect(r.repos[0]!.unread).toEqual({ files: 2, lines: 3 });
    expect(r.curve.steps.map((s) => [s.feature, s.portable.share])).toEqual([["Array methods", 76.9]]);
    expect(r.curve.unread).toEqual([{ feature: "JSX for server-side HTML", files: 1, lines: 2 }, { feature: "parser gaps", files: 1, lines: 1 }]);
    expect(formatRanking(r)).toContain("also waiting, in files Fish couldn't read");
    expect(r.self!.curve.steps.map((s) => [s.feature, s.portable.share])).toEqual([["for...in", 100]]);
  });
});

test("imports wait on other files, npm packages or Node built-ins by how they are written", () => {
  project({ "a.ts": "import x from \"./x\";\n", "b.ts": "import { z } from \"zod\";\nimport y from \"@s/y\";\n", "c.ts": "import fs from \"node:fs\";\nimport path = require(\"path\");\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([["Multi-file programs"], ["npm interop"], ["Node built-ins"]]);
  });
  project({ "a.ts": "import w from \"ws\";\nimport { test } from \"bun:test\";\n", "b.ts": "import x from \"~/x\";\nimport y from \"@/y\";\nimport z from \"#z\";\n", "c.ts": "async function f() { return await import(\"pkg\"); }\n" }, (dir) => {
    expect(scanFiles(dir).map(featuresOf)).toEqual([["npm interop"], ["Multi-file programs"], ["npm interop"]]);
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
  project({ "a.ts": big + "const o = { ...p };\nfor (const k in o) {}\n", "plan.md": "## Plan\n\n- [ ] 7. **Array methods** - map\n  - [x] 9b. **object spread** - copies\n" }, (dir) => {
    const r = rank([dir], undefined, readPlan(join(dir, "plan.md")));
    expect(Object.fromEntries(r.curve.steps.map((s) => [s.feature, s.plan]))).toEqual({
      "Array methods": { item: "7", done: false }, "Object spread": { item: "9b", done: true }, "for...in": null,
    });
    expect(formatRanking(r)).toContain("(plan item 9b, done)");
  });
  project({ "plan.md": "- [ ] 1. **`for...in`** - keys\r\n- [x]  2.  **Array methods**\r\n- [ ] 3. **Array methods**\r\n" }, (dir) => {
    const plan = readPlan(join(dir, "plan.md"));
    expect([plan.get("for...in"), plan.get("array methods")]).toEqual([{ item: "1", done: false }, { item: "2", done: true }]);
  });
  project({ "readme.md": "# Hello\n" }, (dir) => {
    expect(() => readPlan(join(dir, "readme.md"))).toThrow("no '- [ ] N. **Title**' items");
  });
});

test("fishc survey --rank prints and gives JSON, and refuses what it can't read", () => {
  projects([{ "a.ts": big }, { "s.ts": "const o = { ...p };\n" }], ([a, s]) => {
    const text = fishc("survey", "--rank", a!, "--self", s!).stdout.toString();
    expect(text).toContain("1. Array methods");
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
