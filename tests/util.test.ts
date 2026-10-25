import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The std `util` module against node's: the same calls, output compared. The node program is the
// Fish one with its type annotations taken out.
const tmp = mkdtempSync(join(tmpdir(), "fish-util-"));

function compare(name: string, imports: string, declarations: string, body: string) {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `${imports}\n${declarations}\nfunction main() {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  const untyped = (s: string) => s.replace(/: (i64|f64|string|boolean)(\[\])?( \| (i64|f64|string|null))*/g, "");
  const script = `${imports.replaceAll(/import (.*) from "(.*)";/g, (_, what: string, from: string) => `const ${what.startsWith("* as ") ? what.slice(5) : what} = require("${from}");`)}\n${untyped(declarations)}\n${untyped(body)}`;
  const node = Bun.spawnSync(["node", "-e", script]);
  expect(fish.stderr.toString()).toBe(node.stderr.toString());
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
}

const IMPORTS = `import { format } from "node:util";\nimport * as util from "util";`;
const P = `class P { x: i64 = 1; y: i64[] = [1, 2]; }`;

// Every specifier over each kind of value, the format given as `fmt`.
const CASES = `
  console.log(format(fmt, "a", 1, 2, 3, "s", "t", "css", 9));
  console.log(format(fmt, { a: { b: 1 } }, "42", "0x10", "1.5e3x", [1, 2], { a: { b: { c: { d: 1 } } } }, 1));
  console.log(format(fmt, [1, [2, [3]]], true, -0.5, true, new P(), new P(), 2));
  console.log(format(fmt, null, null, null, null, null, null, null));
  console.log(format(fmt, -0.0, -0.0, -0.0, -0.0, -0.0, -0.0, -0.0));
  console.log(format(fmt, new Map([[1, "a"]]), [], [5], [1, 2], new Set([1]), 2.5));
  console.log(format(fmt, [[1, 2], [3]], [null, 4], ["7", 8], [1.5, "x"], [], [[[[[[1]]]]]], 0));
  console.log(format(fmt, "x", " 12abc", "-0.5", " 3.25e1 ", ["a", "b", "c", "d", "e", "f", "g"], "it's", true));
  console.log(format(fmt, 0.1 + 0.2, 1e21, 1e21, 1e-7, 2.5, 1e300, 1));
  const u: i64 | string = 3;
  const w: i64 | string = "w";
  for (const s of [util.format("%s %d %s %s", u, w, "x"), format(1, "a", { b: "c" }), format("x", "y", 3), format("100%%"), format("%s")]) console.log(s);
  for (const s of [format("%s:%s", "only"), format("%d", 1.5), format("%i", 1e21), format("%s", 0.1 + 0.2), format("a%", 1), format("%%%s%%", "p")]) console.log(s);
  for (const s of [format("%o", "multi\\nline string that is long enough to break across lines when inspected"), format("%s", "€%s"), format("€%sé", 1)]) console.log(s);`;

test("format with a format string read at run time gives what node's gives", () => {
  compare("format", IMPORTS, P, `\n  const fmt: string = "%s|%d|%i|%f|%o|%O|%c|%%|%x|%";${CASES}`);
});

test("format with a literal format gives what node's gives", () => {
  compare("literal", IMPORTS, P, CASES.replaceAll("format(fmt, ", `format("%s|%d|%i|%f|%o|%O|%c|%%|%x|%", `));
});

test("console.log, console.error and print format their first argument as node's console does", () => {
  compare("console", "", P, `
  const fmt: string = "%s-%d";
  const xs = [1, 2, 3];
  console.log("%s has %d items: %o", "xs", xs.length, xs);
  console.log(fmt, "a", 1, "and", { b: [2] });
  console.log("100%%");
  console.log("100%%", "done");
  console.log("%s", "a", "b", { x: "y" });
  console.log("no specifiers", 1, "two", new P());
  console.log(1, "%s", 2);
  console.log("%c%s", "color: red", "styled");
  console.error("%s to stderr %i", "written", 4.7);
  console.log(xs.length);`);
});

test("inspect and isDeepStrictEqual give what node's give", () => {
  compare("inspect", `import { inspect, isDeepStrictEqual } from "node:util";`, P, `
  for (const s of [inspect("a'b"), inspect(1), inspect(-0.0), inspect(true), inspect(null), inspect([1, "a"]), inspect({ a: { b: { c: { d: 1 } } } }), inspect(new P()), inspect(new Map([["k", [1]]])), inspect(new Set(["x"]))]) console.log(s);
  const u: i64 | string = "u";
  console.log(inspect(u));
  const a: string = "a";
  console.log(isDeepStrictEqual(1, 1), isDeepStrictEqual(a, "b"), isDeepStrictEqual({ a: [1, 2] }, { a: [1, 2] }), isDeepStrictEqual({ a: [1, 2] }, { a: [1, 3] }));
  console.log(isDeepStrictEqual([[1], [2]], [[1], [2]]), isDeepStrictEqual(u, "u"), isDeepStrictEqual([1, 2], [1, 2, 3]));`);
});
