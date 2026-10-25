import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE } from "../src/native.ts";

// The runtime's port of Node's util.inspect layout, given trees in C and checked against what
// `node` prints for the same values.
const tmp = mkdtempSync(join(tmpdir(), "fish-inspect-"));

// C for a value: numbers, strings, arrays, plain objects, Maps and Sets, and `class` objects
// built as an instance of that name.
function tree(v: unknown): string {
  if (typeof v === "number") return Number.isSafeInteger(v) && !Object.is(v, -0) ? `fsh_rt_insp_i64(${v}LL)` : `fsh_rt_insp_f64(${Object.is(v, -0) ? "-0.0" : v}, 0)`;
  if (typeof v === "string") return `text(${bytes(v)}, ${Buffer.byteLength(v)})`;
  if (typeof v === "boolean" || v === null) return `fsh_rt_insp_text("${v}")`;
  const list = (kind: string, size: number, items: string[]) => `({ fsh_insp *l = fsh_rt_insp_list(${kind}, ${size}); ${items.map((i) => `fsh_rt_insp_push(l, ${i});`).join(" ")} l; })`;
  if (Array.isArray(v)) return list("FSH_INSP_ARRAY", v.length, v.map(tree));
  if (v instanceof Map) return list("FSH_INSP_MAP", v.size, [...v].flatMap(([k, x]) => [tree(k), tree(x)]));
  if (v instanceof Set) return list("FSH_INSP_SET", v.size, [...v].map(tree));
  const name = v!.constructor === Object ? "" : v!.constructor.name;
  const fields = Object.entries(v as object).map(([k, x]) => `fsh_rt_insp_field(o, ${bytes(k)}, ${tree(x)});`).join(" ");
  return `({ fsh_insp *o = fsh_rt_insp_object("${name}"); ${fields} o; })`;
}

// A C string literal of a string's UTF-8 bytes, each as an octal escape.
const bytes = (s: string) => `"${[...Buffer.from(s)].map((b) => `\\${b.toString(8).padStart(3, "0")}`).join("")}"`;

function fish(values: unknown[]): string {
  const file = join(tmp, "test.c");
  const body = values.map((v) => `{ fsh_str *s = fsh_rt_insp_done(${tree(v)}); fwrite(s->bytes, 1, s->length, stdout); fputc(10, stdout); fsh_rt_str_release(s); }`).join("\n");
  const text = "static fsh_insp *text(const char *p, int64_t n) { fsh_str *s = fsh_str_of(p, n); fsh_insp *v = fsh_rt_insp_string(s); fsh_rt_str_release(s); return v; }";
  writeFileSync(file, `${NATIVE}\n${text}\nint main(void) {\n${body}\nreturn 0;\n}\n`);
  const out = join(tmp, "test");
  const clang = Bun.spawnSync(["clang", file, "-o", out, "-lm"]);
  if (clang.exitCode !== 0) throw new Error(clang.stderr.toString());
  const run = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  return run.stdout.toString() + run.stderr.toString();
}

const node = (source: string) => Bun.spawnSync(["node", "-e", `class Point { constructor(x, y) { this.x = x; this.y = y; } }\nfor (const v of ${source}) console.log(v);`]).stdout.toString();

const CASES = `[
  { a: 1, b: 'two', c: [1, 2, 3] },
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 100, 1000, 10000],
  ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew', 'kiwi'],
  { deep: { deeper: { deepest: { gone: 1 } } }, list: [[1, [2, [3, [4]]]]] },
  new Map([['a', 1], ['b', { x: 1 }]]),
  new Set([1, 2, 3]),
  new Map(),
  new Set(),
  [],
  {},
  new Point(1, 2),
  { 'needs quotes': 1, ok_name: 2, 'it\\'s': "it's", both: 'say "it\\'s"', tab: 'a\\tb', nl: 'x\\ny', ctl: '\\x01\\x7f' },
  { long: 'a'.repeat(120) + '\\nsecond line that is also fairly long so the whole string wraps over' },
  Array.from({ length: 130 }, (_, i) => i),
  { a: 'x'.repeat(30), b: 'y'.repeat(30), c: 'z'.repeat(30) },
  [{ name: 'one', value: 1 }, { name: 'two', value: 2 }, { name: 'three', value: 3 }],
  -0,
  [1.5, -0, 1e21, 0.1],
  { nested: [new Point(1, 2), new Point(3, 4)], map: new Map([[1, new Set(['a'])]]) },
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  [1, 22, 333, 4444, 55555, 666666, 7777777],
]`;

const EDGES = `[
  { a: { b: { c: {} } }, d: { e: 1 } },
  { a: { b: { c: { d: 1 } } }, e: 2 },
  [[[[1]]], [[2]], [3]],
  'x'.repeat(10010),
  { s: 'y'.repeat(10003) },
  new Map(Array.from({ length: 105 }, (_, i) => ['k' + i, i])),
  new Set(Array.from({ length: 101 }, (_, i) => i)),
  Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['key' + i, i])),
  ['世界', 'abc', '日本語', 'x', 'yy', 'zzz', 'w', 'ünïcödé'],
  Array.from({ length: 120 }, (_, i) => 'item' + i),
  { list: Array.from({ length: 26 }, (_, i) => i * 1000), name: 'nested group' },
  [{ a: [1, 2, { b: [3, 4, { c: 5 }] }] }],
  { emptyArr: [], emptyObj: {}, emptyMap: new Map(), emptySet: new Set() },
  ['a\\nb', "it's", 'say "hi"', 'all \\'"\`', 'tick \`x\`'],
  { 'a-b': 1, '1abc': 2, _ok: 3, $no: 4, 'é': 5 },
  [true, false, null, 1.5, -2, 'mixed'],
  new Map([[{ k: 1 }, [1, 2]], [[1], new Map([['in', 'side']])]]),
  { veryLongPropertyNameNumberOne: 'value one', veryLongPropertyNameNumberTwo: 'value two' },
  [new Point(1, { inner: [1, 2] }), new Point('a', 'b')],
]`;

test("edge cases lay out as Node lays them out", () => {
  const values = new Function("Point", `return ${EDGES}`)(class Point {
    x: unknown;
    y: unknown;
    constructor(x: unknown, y: unknown) {
      this.x = x;
      this.y = y;
    }
  }) as unknown[];
  expect(fish(values)).toBe(node(EDGES));
});

test("trees lay out as Node lays out the same values", () => {
  const values = new Function("Point", `return ${CASES}`)(class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  }) as unknown[];
  expect(fish(values)).toBe(node(CASES));
});
