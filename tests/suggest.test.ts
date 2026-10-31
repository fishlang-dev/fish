import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompileError } from "../src/diag.ts";
import { analyze } from "../src/main.ts";
import { newSession } from "../src/compilation.ts";
import { didYouMean, suggestion } from "../src/suggest.ts";

test("the closest candidate within tsc's limits", () => {
  expect(suggestion("cont", ["count", "total"])).toBe("count");
  expect(suggestion("lenght", ["length", "height"])).toBe("length");
  expect(suggestion("helpr", ["helper", "help"])).toBe("helper");
  expect(suggestion("abcdef", ["uvwxyz"])).toBeUndefined();
  expect(suggestion("name", ["name"])).toBeUndefined();
});

test("a change of case beats any other edit", () => {
  expect(suggestion("myvalue", ["myValues", "myValue"])).toBe("myValue");
  expect(suggestion("ID", ["id", "IDs"])).toBe("id");
});

test("short names and candidates", () => {
  expect(suggestion("x", ["X", "y"])).toBeUndefined();
  expect(suggestion("ab", ["ac"])).toBeUndefined();
  expect(suggestion("ab", ["AB"])).toBe("AB");
  expect(suggestion("abc", ["ab"])).toBeUndefined();
});

test("the length difference is bounded", () => {
  expect(suggestion("abc", ["abcdef"])).toBeUndefined();
  expect(suggestion("veryLongName", ["veryLongNameX"])).toBe("veryLongNameX");
});

test("the message suffix", () => {
  expect(didYouMean("cont", ["count"])).toBe("; did you mean 'count'?");
  expect(didYouMean("zzz", ["count"])).toBe("");
});

// A program of two files, `lib.fsh` exporting `greeting` and `farewell`, and `main.fsh`.
function analyzed(main: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fishc-suggest-"));
  writeFileSync(join(dir, "lib.fsh"), "export function greeting(): i64 { return 1; }\nexport function farewell(): i64 { return 2; }\n");
  writeFileSync(join(dir, "main.fsh"), main);
  try {
    analyze(newSession(), main, join(dir, "main.fsh"));
    return "";
  } catch (e) {
    return (e as CompileError).message;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an imported name is suggested as the file writes it", () => {
  expect(analyzed('import { greeting as hello } from "./lib.fsh";\nfunction main() { helo(); }\n')).toBe("unknown function 'helo'; did you mean 'hello'?");
});

test("another file's name this file doesn't import is never suggested", () => {
  expect(analyzed('import { greeting } from "./lib.fsh";\nfunction main() { farewel(); }\n')).toBe("unknown function 'farewel'");
});

test("a private member is never suggested outside its class", () => {
  expect(analyzed("class Vault { private secret: i64 = 1; }\nfunction main() { const v = new Vault(); console.log(v.secrt); }\n")).toBe("property 'secrt' does not exist on type 'Vault'");
});

test("a protected member is never suggested outside its class", () => {
  expect(analyzed("class Vault { protected secret: i64 = 1; }\nfunction main() { const v = new Vault(); console.log(v.secrt); }\n")).toBe("property 'secrt' does not exist on type 'Vault'");
});

test("a private static field is never suggested outside its class", () => {
  expect(analyzed("class A { private static readonly counter: i64 = 1; static make(): i64 { return 1; } }\nfunction main() { console.log(A.countr()); }\n")).toBe("property 'countr' does not exist on type 'typeof A'");
});

test("std's internal classes are never suggested", () => {
  const server = 'function f(r: Request): Response { return new Response("a"); }\nfunction main() { ';
  expect(analyzed(`${server}const h = new Http2(); }\n`)).toBe("only a class can be constructed with 'new'");
  expect(analyzed(`${server}const h = new HttpHed(); }\n`)).toBe("only a class can be constructed with 'new'");
  expect(analyzed(`${server}const h: Htp1 = 1; }\n`)).toBe("cannot find type 'Htp1'");
});
