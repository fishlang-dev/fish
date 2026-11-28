// Did-you-mean suggestions for misspelled names.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError } from "../../src/diag.fsh";
import { analyze } from "../../src/main.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { didYouMean, suggestion } from "../../src/suggest.fsh";
import { same } from "./support.fsh";

function suggests(name: string, candidates: string[], want: string | undefined): void {
  const got = suggestion(name, candidates.clone());
  assert(got === want, `${name} among ${candidates.join(", ")}: expected ${want ?? "none"}, got ${got ?? "none"}`);
}

test("the closest candidate within tsc's limits", () => {
  suggests("cont", ["count", "total"], "count");
  suggests("lenght", ["length", "height"], "length");
  suggests("helpr", ["helper", "help"], "helper");
  suggests("abcdef", ["uvwxyz"], undefined);
  suggests("name", ["name"], undefined);
});

test("a change of case beats any other edit", () => {
  suggests("myvalue", ["myValues", "myValue"], "myValue");
  suggests("ID", ["id", "IDs"], "id");
});

test("short names and candidates", () => {
  suggests("x", ["X", "y"], undefined);
  suggests("ab", ["ac"], undefined);
  suggests("ab", ["AB"], "AB");
  suggests("abc", ["ab"], undefined);
});

test("the length difference is bounded", () => {
  suggests("abc", ["abcdef"], undefined);
  suggests("veryLongName", ["veryLongNameX"], "veryLongNameX");
});

test("the message suffix", () => {
  same(didYouMean("cont", ["count"]), "; did you mean 'count'?", "a near name");
  same(didYouMean("zzz", ["count"]), "", "no near name");
});

// A program of two files, `lib.fsh` exporting `greeting` and `farewell`, and `main.fsh`, checked
// to the message of the error it's refused with, or "" when it checks.
function analyzed(main: string): string {
  let dir = "";
  let message = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fishc-suggest-"));
    writeFileSync(join(dir, "lib.fsh"), "export function greeting(): i64 { return 1; }\nexport function farewell(): i64 { return 2; }\n");
    writeFileSync(join(dir, "main.fsh"), main);
    analyze(cachedSession(), main, join(dir, "main.fsh"));
  } catch (e) {
    if (e instanceof CompileError) message = e.message;
    else assert(false, e.message);
  }
  try {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
  return message;
}

test("an imported name is suggested as the file writes it", () => {
  same(analyzed('import { greeting as hello } from "./lib.fsh";\nfunction main() { helo(); }\n'), "unknown function 'helo'; did you mean 'hello'?", "the message");
});

test("another file's name this file doesn't import is never suggested", () => {
  same(analyzed('import { greeting } from "./lib.fsh";\nfunction main() { farewel(); }\n'), "unknown function 'farewel'", "the message");
});

test("a private member is never suggested outside its class", () => {
  same(analyzed("class Vault { private secret: i64 = 1; }\nfunction main() { const v = new Vault(); console.log(v.secrt); }\n"), "property 'secrt' does not exist on type 'Vault'", "the message");
});

test("a protected member is never suggested outside its class", () => {
  same(analyzed("class Vault { protected secret: i64 = 1; }\nfunction main() { const v = new Vault(); console.log(v.secrt); }\n"), "property 'secrt' does not exist on type 'Vault'", "the message");
});

test("a private static field is never suggested outside its class", () => {
  same(analyzed("class A { private static readonly counter: i64 = 1; static make(): i64 { return 1; } }\nfunction main() { console.log(A.countr()); }\n"), "property 'countr' does not exist on type 'typeof A'", "the message");
});

test("std's internal classes are never suggested", () => {
  const server = 'function f(r: Request): Response { return new Response("a"); }\nfunction main() { ';
  same(analyzed(`${server}const h = new Http3(); }\n`), "only a class can be constructed with 'new'", "Http3");
  same(analyzed(`${server}const h = new HttpHed(); }\n`), "only a class can be constructed with 'new'", "HttpHed");
  same(analyzed(`${server}const h: Htp1 = 1; }\n`), "cannot find type 'Htp1'", "Htp1");
});
