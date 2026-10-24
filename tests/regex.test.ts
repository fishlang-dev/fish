import { expect, test } from "bun:test";
import { parsePattern, RegexSyntaxError } from "../src/regex.ts";

// The pattern parser accepts exactly what the engine running the compiler accepts, over
// patterns put together from pieces that exercise the grammar's corners, with a fixed seed.
const PIECES: string[] = ["a", "b", "\\", "(", ")", "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>", "(?<m>", "\\k<n>", "\\k", "[", "]", "[^", "-", "^", "$", ".", "*", "+", "?", "{", "}", "{2}", "{1,3}", "{3,1}", "{2,}", "|", "\\d", "\\W", "\\b", "\\B", "\\1", "\\2", "\\0", "\\01", "\\8", "\\x4", "\\x41", "\\u0041", "\\u{41}", "\\uD83D\\uDE00", "\\c", "\\cA", "\\c1", "\\p{L}", "\\P{Lu}", "\\p{Foo}", "\\q{ab|c}", "&&", "--", "\\-", "\\/", "/", "😀", "\\n", "\\z", "(?i:", "(?-i:", "(?m-s:", "(?ii:", "[a-z]", "[z-a]", "[\\d-z]", "\\s", "_", "&", "!", "\\&", "[[a]--b]", "[\\q{}]", "[a&&&b]", "[a--b--c]", "[a&&b--c]", "[^\\q{ab}]", "(?<n>a)|(?<n>b)", "(?<\\u0061>"];
const FLAGS = ["", "u", "v", "i", "iu", "gm", "s", "y", "uv", "gg", "d"];

// Where the engine is more lenient than the standard, Fish follows the standard: under \`u\` or
// \`v\`, an escaped character outside ASCII, and a class under \`v\` mixing a union with \`--\`.
const LENIENT = (p: string, f: string) => (/[uv]/.test(f) && /\\[^\x00-\x7f]/.test(p)) || (f.includes("v") && /\[[^\]]*[^\[\]]\[[^\]]*\]--/.test(p));

test("regex syntax is accepted and refused as JavaScript does", () => {
  let seed = 12345;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const wrong: string[] = [];
  for (let i = 0; i < 20000; i++) {
    let p = "";
    for (let k = random(8) + 1; k > 0; k--) p += PIECES[random(PIECES.length)];
    const f = FLAGS[random(FLAGS.length)]!;
    let js = true;
    try {
      new RegExp(p, f);
    } catch {
      js = false;
    }
    let fish = true;
    try {
      parsePattern(p, f);
    } catch (e) {
      if (!(e instanceof RegexSyntaxError)) throw e;
      fish = false;
    }
    if (js !== fish && !LENIENT(p, f)) wrong.push(`/${p}/${f}: JavaScript ${js ? "accepts" : "refuses"} it`);
  }
  expect(wrong).toEqual([]);
});
