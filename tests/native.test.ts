import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASEMAP, CASEMAP_UNICODE } from "../src/casemap.ts";
import { NATIVE } from "../src/native.ts";

// The runtime's own behaviour, checked from C: the leak report and string blocks.
const tmp = mkdtempSync(join(tmpdir(), "fish-native-"));

function run(body: string, leaks = true): { stdout: string; stderr: string } {
  const file = join(tmp, "test.c");
  writeFileSync(file, `${NATIVE}\nint main(void) {\n${body}\nreturn 0;\n}\n`);
  const out = join(tmp, "test");
  const clang = Bun.spawnSync(["clang", file, "-o", out, "-lm"]);
  if (clang.exitCode !== 0) throw new Error(clang.stderr.toString());
  const result = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: leaks ? "1" : "0" } });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

test("an allocation never freed is reported", () => {
  expect(run("fsh_rt_alloc(8);").stderr).toContain("fish: leaked 1 allocations");
});

test("nothing is reported without the check", () => {
  expect(run("fsh_rt_alloc(8);", false).stderr).toBe("");
});

test("strings join, compare and free", () => {
  const { stdout, stderr } = run(`
    fsh_str *a = fsh_rt_str_from_i64(-12), *b = fsh_rt_str_from_f64(0.5);
    fsh_str *c = fsh_rt_str_concat(a, b);
    fsh_rt_str_retain(c);
    fsh_rt_str_print(1, c);
    printf(" %d %d\\n", fsh_rt_str_compare(a, c), fsh_rt_str_compare(c, c));
    fsh_rt_str_release(a); fsh_rt_str_release(b); fsh_rt_str_release(c); fsh_rt_str_release(c);`);
  expect(stdout).toBe("-120.5 -1 0\n");
  expect(stderr).toBe("");
});

test("the halves of a surrogate pair join into one character", () => {
  const { stdout, stderr } = run(`
    fsh_str *high = fsh_str_of("\\xED\\xA0\\xBD", 3), *low = fsh_str_of("\\xED\\xB8\\x80", 3);
    high->units = 1; low->units = 1;
    fsh_str *pair = fsh_rt_str_concat(high, low);
    fsh_str *emoji = fsh_str_of("\\xF0\\x9F\\x98\\x80", 4);
    printf("%lld %lld %d\\n", (long long)pair->length, (long long)pair->units, fsh_rt_str_compare(pair, emoji));
    fsh_rt_str_print(1, high);
    printf("\\n");
    fsh_rt_str_release(high); fsh_rt_str_release(low); fsh_rt_str_release(pair); fsh_rt_str_release(emoji);`);
  expect(stdout).toBe("4 2 0\n�\n");
  expect(stderr).toBe("");
});

// A case table of src/casemap.ts, by its C name: each row's first code point and what it maps to.
function table(name: string): Map<number, number[]> {
  const body = new RegExp(`${name}\\[\\]\\[\\d\\] = \\{([^;]*)\\};`).exec(CASEMAP)![1]!;
  const rows = [...body.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!.split(",").map(Number));
  return new Map(rows.map(([from, ...to]) => [from!, to.filter((c) => c !== 0)]));
}

// Every code point's upper and lower case, one at a time, against JavaScript's. Surrogates map
// to themselves and are left out, as is the line feed, which separates the runtime's output.
//
// An engine on an older Unicode version than the tables were made from, as Bun is on macOS,
// where its case mapping comes from the system's ICU, lacks the newer case pairs: it leaves
// code points as they are that the tables map. Unicode never changes an existing pair, so when
// every difference is of that kind the tables themselves are the reference. Any other
// difference means the tables are stale.
test("case mapping matches JavaScript for every code point", () => {
  const { stdout, stderr } = run(`
    for (uint32_t cp = 0; cp <= 0x10FFFF; cp++) {
      if ((cp >= 0xD800 && cp < 0xE000) || cp == 0x0A) continue;
      char bytes[4];
      fsh_str *s = fsh_str_of(bytes, fsh_put_cp(bytes, cp) - bytes);
      for (int upper = 1; upper >= 0; upper--) {
        fsh_str *mapped = fsh_rt_str_case(s, upper);
        fwrite(mapped->bytes, 1, mapped->length, stdout);
        fputc('\\n', stdout);
        fsh_rt_str_release(mapped);
      }
      fsh_rt_str_release(s);
    }`);
  const [upper, lower, upperSpecial, lowerSpecial] = ["fsh_upper", "fsh_lower", "fsh_upper_special", "fsh_lower_special"].map(table) as Map<number, number[]>[];
  const fromTables = (cp: number, special: Map<number, number[]>, simple: Map<number, number[]>) => String.fromCodePoint(...(special.get(cp) ?? simple.get(cp) ?? [cp]));
  const engine: string[] = [];
  const tables: string[] = [];
  const points: string[] = [];
  const cps: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if ((cp >= 0xd800 && cp < 0xe000) || cp === 0x0a) continue;
    const c = String.fromCodePoint(cp);
    const at = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    engine.push(c.toUpperCase(), c.toLowerCase());
    tables.push(fromTables(cp, upperSpecial!, upper!), fromTables(cp, lowerSpecial!, lower!));
    points.push(`${at} upper`, `${at} lower`);
    cps.push(cp, cp);
  }
  const differing = engine.flatMap((mapped, i) => (mapped === tables[i] ? [] : [i]));
  const older = differing.length > 0 && differing.every((i) => engine[i] === String.fromCodePoint(cps[i]!));
  const shown = (indices: number[], got: string[], want: string[]) => indices.slice(0, 5).map((i) => `${points[i]}: ${JSON.stringify(got[i])} for ${JSON.stringify(want[i])}`).join("; ");
  if (differing.length > 0 && !older) {
    throw new Error(`the case tables differ from this Bun's case mapping (Unicode ${process.versions.unicode}, tables ${CASEMAP_UNICODE}); regenerate them with \`bun scripts/casemap.ts\`. Bun gives ${shown(differing, engine, tables)}`);
  }
  const lines = stdout.split("\n").slice(0, -1);
  const wrong = tables.flatMap((mapped, i) => (mapped === lines[i] ? [] : [i]));
  if (wrong.length > 0) throw new Error(`the runtime's case mapping differs from its tables: it gives ${shown(wrong, lines, tables)}`);
  expect(stderr).toBe("");
});
