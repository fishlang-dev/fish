import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatReport, grade, survey } from "../src/survey.ts";

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
  expect(r.rules.length + r.waiting.length).toBe(44);
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
