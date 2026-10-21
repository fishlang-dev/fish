import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Every code point's upper and lower case, one at a time, against the JavaScript engine the
// case tables were made from. Surrogates map to themselves and are left out of the comparison.
test("case mapping matches JavaScript for every code point", () => {
  const { stdout, stderr } = run(`
    for (uint32_t cp = 0; cp <= 0x10FFFF; cp++) {
      if (cp >= 0xD800 && cp < 0xE000) continue;
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
  const expected: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp < 0xe000) continue;
    const c = String.fromCodePoint(cp);
    expected.push(c.toUpperCase(), c.toLowerCase());
  }
  // A Bun on a newer Unicode version differs until the tables are made again from it.
  if (stdout !== `${expected.join("\n")}\n`) throw new Error("the case tables differ from this Bun's case mapping; regenerate them with `bun scripts/casemap.ts`");
  expect(stderr).toBe("");
});
