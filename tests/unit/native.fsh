// The runtime's own behaviour, checked from C: the leak report, string blocks and case mapping.
// JavaScript's case mapping, the reference, is Bun's as recorded.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASEMAP, CASEMAP_UNICODE } from "../../src/casemap.fsh";
import { NATIVE } from "../../src/native.fsh";
import { caseScript, type Tables } from "../../scripts/casetables.fsh";
import { ranFor, reference, removed, same, scratch, text } from "./support.fsh";

type Ran = { stdout: string; stderr: string };

// Compiles `body` as C's main after the runtime and runs it, with FISH_LEAKS set when `leaks`.
function run(body: string, leaks: boolean): Ran {
  const tmp = scratch("fish-native-");
  const file = join(tmp, "test.c");
  try {
    writeFileSync(file, `${NATIVE}\nint main(void) {\n${body}\nreturn 0;\n}\n`);
  } catch (e) {
    assert(false, `can't write ${file}: ${e.message}`);
  }
  const out = join(tmp, "test");
  const clang = spawnSync("clang", [file, "-o", out, "-lm"]);
  assert(clang.status === 0, `clang failed:\n${text(clang.stderr)}`);
  const result = spawnSync("env", [`FISH_LEAKS=${leaks ? "1" : "0"}`, out]);
  removed(tmp);
  return { stdout: text(result.stdout), stderr: text(result.stderr) };
}

test("an allocation never freed is reported", () => {
  const got = run("fsh_rt_alloc(8);", true);
  assert(got.stderr.includes("fish: leaked 1 allocations"), `stderr: ${got.stderr}`);
});

test("nothing is reported without the check", () => {
  same(run("fsh_rt_alloc(8);", false).stderr, "", "stderr");
});

test("strings join, compare and free", () => {
  const got = run(
    `
    fsh_str *a = fsh_rt_str_from_i64(-12), *b = fsh_rt_str_from_f64(0.5);
    fsh_str *c = fsh_rt_str_concat(a, b);
    fsh_rt_str_retain(c);
    fsh_rt_str_print(1, c);
    printf(" %d %d\\n", fsh_rt_str_compare(a, c), fsh_rt_str_compare(c, c));
    fsh_rt_str_release(a); fsh_rt_str_release(b); fsh_rt_str_release(c); fsh_rt_str_release(c);`,
    true,
  );
  same(got.stdout, "-120.5 -1 0\n", "stdout");
  same(got.stderr, "", "stderr");
});

test("the halves of a surrogate pair join into one character", () => {
  const got = run(
    `
    fsh_str *high = fsh_str_of("\\xED\\xA0\\xBD", 3), *low = fsh_str_of("\\xED\\xB8\\x80", 3);
    fsh_str *pair = fsh_rt_str_concat(high, low);
    fsh_str *emoji = fsh_str_of("\\xF0\\x9F\\x98\\x80", 4);
    printf("%lld %lld %d\\n", (long long)fsh_len(pair), (long long)fsh_rt_str_units(pair), fsh_rt_str_compare(pair, emoji));
    fsh_rt_str_print(1, high);
    printf("\\n");
    fsh_rt_str_release(high); fsh_rt_str_release(low); fsh_rt_str_release(pair); fsh_rt_str_release(emoji);`,
    true,
  );
  same(got.stdout, "4 2 0\n�\n", "stdout");
  same(got.stderr, "", "stderr");
});

// A case table of src/casemap.fsh, by its C name: each row's first code point and what it maps to.
function table(name: string): Map<i64, i64[]> {
  let rows = new Map<i64, i64[]>();
  const head = `${name}[][`;
  const at = CASEMAP.indexOf(head);
  assert(at >= 0, `no table ${name}`);
  const open = CASEMAP.indexOf("{", at);
  const close = CASEMAP.indexOf("};", open);
  const body = CASEMAP.slice(open + 1, close);
  const pieces = body.split("}");
  for (const piece of pieces) {
    const row = piece.replaceAll("{", "").replaceAll("\n", "").trim();
    const cells = row.split(",").map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length === 0) continue;
    let codes: i64[] = [];
    for (const c of cells) {
      const n = parseInt(c.startsWith("0x") ? c.slice(2) : c, 16);
      assert(n !== null, `${name}: not a number: ${c}`);
      codes.push(n!);
    }
    rows.set(codes[0], codes.slice(1).filter((c) => c !== 0));
  }
  return rows;
}

function fromTables(cp: i64, special: Ref<Map<i64, i64[]>>, simple: Ref<Map<i64, i64[]>>): string {
  const mapped = special.get(cp) ?? simple.get(cp) ?? [cp];
  let s = "";
  for (const c of mapped) s += String.fromCodePoint(c as u32);
  return s;
}

function hex(cp: i64): string {
  const digits = "0123456789ABCDEF";
  let s = "";
  let n = cp;
  while (n > 0) {
    s = digits[(n % 16) as usize] + s;
    n = n / 16;
  }
  return s.padStart(4, "0");
}

// What a row of the recorded tables maps its code point to.
function recordedRows(rows: Ref<i64[][]>): Map<i64, i64[]> {
  let out = new Map<i64, i64[]>();
  for (const r of rows) out.set(r[0]!, r.slice(1));
  return out;
}

// The first few code points two tables map differently, or nothing when they are the same.
function tablesDiffer(name: string, ours: Ref<Map<i64, i64[]>>, theirs: Ref<Map<i64, i64[]>>): string {
  let found: string[] = [];
  for (const [cp, to] of theirs) {
    const have = ours.get(cp);
    if (have === undefined || have.join(",") !== to.join(",")) found.push(`U+${hex(cp)} is ${have === undefined ? "missing" : have.join(",")} for ${to.join(",")}`);
  }
  for (const cp of ours.keys()) if (!theirs.has(cp)) found.push(`U+${hex(cp)} is mapped and JavaScript leaves it`);
  return found.length === 0 ? "" : `${name}: ${found.slice(0, 5).join("; ")}${found.length > 5 ? `, and ${found.length - 5} more` : ""}`;
}

// Every code point's upper and lower case, one at a time, against JavaScript's. Surrogates map
// to themselves and are left out, as is the line feed, which separates the runtime's output.
// The tables src/casemap.fsh holds must be the recorded ones, and the runtime must map as they do.
test("case mapping matches JavaScript for every code point", () => {
  const got = run(
    `
    for (uint32_t cp = 0; cp <= 0x10FFFF; cp++) {
      if ((cp >= 0xD800 && cp < 0xE000) || cp == 0x0A) continue;
      char bytes[4];
      fsh_str *s = fsh_str_of(bytes, fsh_put_cp(bytes, cp) - bytes);
      for (int upper = 1; upper >= 0; upper--) {
        fsh_str *mapped = fsh_rt_str_case(s, upper), *shown = mapped;
        FSH_OPEN(shown);
        fwrite(shown->bytes, 1, shown->length, stdout);
        fputc('\\n', stdout);
        fsh_rt_str_release(mapped);
      }
      fsh_rt_str_release(s);
    }`,
    true,
  );
  const upper = table("fsh_upper");
  const lower = table("fsh_lower");
  const upperSpecial = table("fsh_upper_special");
  const lowerSpecial = table("fsh_lower_special");
  const asked = reference("casemap-tables", caseScript(), () => ranFor("bun", ["-e", caseScript()]));
  same(asked.stderr, "", "recording the tables");
  let recorded: Tables = { upper: [], upperSpecial: [], lower: [], lowerSpecial: [], cased: [], ignorable: [], unicode: "" };
  try {
    recorded = JSON.parse<Tables>(asked.stdout);
  } catch (e) {
    assert(false, `the recorded tables don't parse: ${e.message}`);
  }
  same(recorded.unicode, CASEMAP_UNICODE, "the Unicode version the tables were recorded at");
  const stale = [tablesDiffer("fsh_upper", upper, recordedRows(recorded.upper)), tablesDiffer("fsh_lower", lower, recordedRows(recorded.lower)), tablesDiffer("fsh_upper_special", upperSpecial, recordedRows(recorded.upperSpecial)), tablesDiffer("fsh_lower_special", lowerSpecial, recordedRows(recorded.lowerSpecial))].filter((d) => d !== "");
  assert(stale.length === 0, `the case tables differ from the recorded ones; regenerate them with \`fishc run scripts/casemap.fsh\`. ${stale.join(". ")}`);
  let tables: string[] = [];
  let cps: i64[] = [];
  for (let cp: i64 = 0; cp <= 0x10ffff; cp++) {
    if ((cp >= 0xd800 && cp < 0xe000) || cp === 0x0a) continue;
    tables.push(fromTables(cp, upperSpecial, upper));
    tables.push(fromTables(cp, lowerSpecial, lower));
    cps.push(cp);
    cps.push(cp);
  }
  // Each code point's upper case is at an even index, and its lower case after it.
  const point = (i: usize) => `U+${hex(cps[i])} ${i % 2 === 0 ? "upper" : "lower"}`;
  const shown = (indices: Ref<usize[]>, gotten: Ref<string[]>, want: Ref<string[]>) => indices.slice(0, 5).map((i) => `${point(i)}: ${JSON.stringify(gotten[i])} for ${JSON.stringify(want[i])}`).join(", ");
  let lines = got.stdout.split("\n");
  lines.pop();
  assert(lines.length === tables.length, `the runtime gave ${lines.length} mappings for ${tables.length}`);
  let wrong: usize[] = [];
  for (let i: usize = 0; i < tables.length; i++) if (tables[i] !== lines[i]) wrong.push(i);
  assert(wrong.length === 0, `the runtime's case mapping differs from its tables: it gives ${shown(wrong, lines, tables)}`);
  same(got.stderr, "", "stderr");
}, { timeout: 30_000 });
