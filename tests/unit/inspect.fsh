// The runtime's port of Node's util.inspect layout, given trees in C
// and checked against what `node` prints for the same values. The values are JavaScript literals,
// so a Bun child process turns them into the C that builds each tree.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NATIVE } from "../../src/native.fsh";
import { ranFor, reference, removed, same, scratch, text } from "./support.fsh";

// Bun's script printing the C statements that build and print each value of the array literal in
// the file it is given: numbers, strings, arrays, plain objects, Maps and Sets, and `Point` objects
// built as an instance of that name, each string as octal escapes of its UTF-8 bytes.
function generator(): string {
  return "const { readFileSync } = require(\"node:fs\");\nconst source = readFileSync(process.argv[2], \"utf8\");\nclass Point { constructor(x, y) { this.x = x; this.y = y; } }\nconst bytes = (s) => `\"${[...Buffer.from(s)].map((b) => `\\\\${b.toString(8).padStart(3, \"0\")}`).join(\"\")}\"`;\nfunction tree(v) {\n  if (typeof v === \"number\") return Number.isSafeInteger(v) && !Object.is(v, -0) ? `fsh_rt_insp_i64(${v}LL)` : `fsh_rt_insp_f64(${Object.is(v, -0) ? \"-0.0\" : v}, 0)`;\n  if (typeof v === \"string\") return `text(${bytes(v)}, ${Buffer.byteLength(v)})`;\n  if (typeof v === \"boolean\" || v === null) return `fsh_rt_insp_text(\"${v}\")`;\n  const list = (kind, size, items) => `({ fsh_insp *l = fsh_rt_insp_list(${kind}, ${size}); ${items.map((i) => `fsh_rt_insp_push(l, ${i});`).join(\" \")} l; })`;\n  if (Array.isArray(v)) return list(\"FSH_INSP_ARRAY\", v.length, v.map(tree));\n  if (v instanceof Map) return list(\"FSH_INSP_MAP\", v.size, [...v].flatMap(([k, x]) => [tree(k), tree(x)]));\n  if (v instanceof Set) return list(\"FSH_INSP_SET\", v.size, [...v].map(tree));\n  const name = v.constructor === Object ? \"\" : v.constructor.name;\n  const fields = Object.entries(v).map(([k, x]) => `fsh_rt_insp_field(o, ${bytes(k)}, ${tree(x)});`).join(\" \");\n  return `({ fsh_insp *o = fsh_rt_insp_object(\"${name}\"); ${fields} o; })`;\n}\nconst values = new Function(\"Point\", `return ${source}`)(Point);\nprocess.stdout.write(values.map((v) => `{ fsh_str *s = fsh_rt_insp_done(${tree(v)}); fwrite(s->bytes, 1, s->length, stdout); fputc(10, stdout); fsh_rt_str_release(s); }`).join(\"\\n\"));\n";
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// What the runtime prints for the values of `source`, against what node prints.
function compare(name: string, source: string): void {
  const tmp = scratch("fish-inspect-");
  const values = join(tmp, "values.js");
  const script = join(tmp, "tree.js");
  write(values, source);
  write(script, generator());
  const gen = reference(`inspect-${name}-trees`, `${generator()}\n${source}`, () => ranFor("bun", [script, values]));
  same(gen.stderr, "", "building the trees");
  const helper = "static fsh_insp *text(const char *p, int64_t n) { fsh_str *s = fsh_str_of(p, n); fsh_insp *v = fsh_rt_insp_string(s); fsh_rt_str_release(s); return v; }\nstatic void shown(fsh_str *s) { FSH_OPEN(s); fwrite(s->bytes, 1, s->length, stdout); }";
  // The recorded statements read the string's fields directly, which a string short enough to be
  // held in its pointer word has none of, so each is printed through a view.
  const statements = gen.stdout.replaceAll("fwrite(s->bytes, 1, s->length, stdout);", "shown(s);");
  const file = join(tmp, "test.c");
  write(file, `${NATIVE}\n${helper}\nint main(void) {\n${statements}\nreturn 0;\n}\n`);
  const out = join(tmp, "test");
  const clang = spawnSync("clang", [file, "-o", out, "-lm"]);
  assert(clang.status === 0, `clang failed: ${text(clang.stderr)}`);
  const run = spawnSync("env", ["FISH_LEAKS=1", out]);
  const printing = `class Point { constructor(x, y) { this.x = x; this.y = y; } }\nfor (const v of ${source}) console.log(v);`;
  const node = reference(`inspect-${name}-layout`, printing, () => ranFor("node", ["-e", printing]));
  same(text(run.stdout) + text(run.stderr), node.stdout, "the layout");
  removed(tmp);
}

function cases(): string {
  return "[\n  { a: 1, b: 'two', c: [1, 2, 3] },\n  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 100, 1000, 10000],\n  ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew', 'kiwi'],\n  { deep: { deeper: { deepest: { gone: 1 } } }, list: [[1, [2, [3, [4]]]]] },\n  new Map([['a', 1], ['b', { x: 1 }]]),\n  new Set([1, 2, 3]),\n  new Map(),\n  new Set(),\n  [],\n  {},\n  new Point(1, 2),\n  { 'needs quotes': 1, ok_name: 2, 'it\\'s': \"it's\", both: 'say \"it\\'s\"', tab: 'a\\tb', nl: 'x\\ny', ctl: '\\x01\\x7f' },\n  { long: 'a'.repeat(120) + '\\nsecond line that is also fairly long so the whole string wraps over' },\n  Array.from({ length: 130 }, (_, i) => i),\n  { a: 'x'.repeat(30), b: 'y'.repeat(30), c: 'z'.repeat(30) },\n  [{ name: 'one', value: 1 }, { name: 'two', value: 2 }, { name: 'three', value: 3 }],\n  -0,\n  [1.5, -0, 1e21, 0.1],\n  { nested: [new Point(1, 2), new Point(3, 4)], map: new Map([[1, new Set(['a'])]]) },\n  ['a', 'b', 'c', 'd', 'e', 'f', 'g'],\n  [1, 22, 333, 4444, 55555, 666666, 7777777],\n]";
}

function edges(): string {
  return "[\n  { a: { b: { c: {} } }, d: { e: 1 } },\n  { a: { b: { c: { d: 1 } } }, e: 2 },\n  [[[[1]]], [[2]], [3]],\n  'x'.repeat(10010),\n  { s: 'y'.repeat(10003) },\n  new Map(Array.from({ length: 105 }, (_, i) => ['k' + i, i])),\n  new Set(Array.from({ length: 101 }, (_, i) => i)),\n  Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['key' + i, i])),\n  ['\u4e16\u754c', 'abc', '\u65e5\u672c\u8a9e', 'x', 'yy', 'zzz', 'w', '\u00fcn\u00efc\u00f6d\u00e9'],\n  Array.from({ length: 120 }, (_, i) => 'item' + i),\n  { list: Array.from({ length: 26 }, (_, i) => i * 1000), name: 'nested group' },\n  [{ a: [1, 2, { b: [3, 4, { c: 5 }] }] }],\n  { emptyArr: [], emptyObj: {}, emptyMap: new Map(), emptySet: new Set() },\n  ['a\\nb', \"it's\", 'say \"hi\"', 'all \\'\"`', 'tick `x`'],\n  { 'a-b': 1, '1abc': 2, _ok: 3, $no: 4, '\u00e9': 5 },\n  [true, false, null, 1.5, -2, 'mixed'],\n  new Map([[{ k: 1 }, [1, 2]], [[1], new Map([['in', 'side']])]]),\n  { veryLongPropertyNameNumberOne: 'value one', veryLongPropertyNameNumberTwo: 'value two' },\n  [new Point(1, { inner: [1, 2] }), new Point('a', 'b')],\n]";
}

test("edge cases lay out as Node lays them out", () => {
  compare("edges", edges());
});

test("trees lay out as Node lays out the same values", () => {
  compare("cases", cases());
});
