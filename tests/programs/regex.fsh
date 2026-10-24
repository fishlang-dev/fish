// Regex literals: their syntax, properties, matching, captures and errors.
// case: regex_properties
// expect: (\d+)-(?<rest>x)? dgimsuy true true true true true false true true
// expect: a\/b  false a\/b\n gv true
// expect: (\d+)-(?<rest>x)? (\d+)-(?<rest>x)?
function main() {
  const re = /(\d+)-(?<rest>x)?/gimsuyd;
  const plain = /a\/b/;
  const made = new RegExp("a/b\n", "vg");
  console.log(re.source, re.flags, re.global, re.ignoreCase, re.multiline, re.dotAll, re.unicode, re.unicodeSets, re.sticky, re.hasIndices);
  console.log(plain.source, plain.flags, plain.global, made.source, made.flags, made.unicodeSets);
  const copy = re;
  console.log(copy.source, re.source);
}
// case: regex_top_level_const
// expect: a+b i
const RE = /a+b/i;
function main() {
  console.log(RE.source, RE.flags);
}
// case: regex_syntax
// error: invalid regular expression: nothing to repeat
function main() {
  const re = /a**/;
}
// case: regex_flags
// error: invalid regular expression: invalid flags supplied to RegExp constructor 'gg'
function main() {
  const re = /a/gg;
}
// case: regex_runtime
// error: a regex is compiled while compiling, so 'new RegExp' takes its pattern and flags as string literals; for a pattern known only when the program runs, Fish has no regex
function main() {
  const p = "a+";
  const re = new RegExp(p);
}
// case: regex_lastindex
// error: a Fish regex keeps no state, so it has no 'lastIndex'; use 'matchAll' to go through every match
function main() {
  const re = /a/g;
  console.log(re.lastIndex);
}
// case: regex_unknown
// error: property 'size' does not exist on type 'RegExp'
function main() {
  const re = /a/;
  console.log(re.size);
}
// case: regex_dupname
// error: invalid regular expression: duplicate group specifier name
function main() {
  const re = /(?<n>a)(?<n>b)/;
}
// case: regex_property
// error: invalid regular expression: invalid property expression
function main() {
  const re = /\p{Nope}/u;
}
// case: regex
// mode: parse
function f() {
  let simple = /ab+c/
  let flags = /^hello$/gimsuy
  let slashInClass = /[/]+/
  let bracketInClass = /[\]a-z]/
  let escaped = /\/\d+\//
  let quote = /'/
  let backtick = /`/
  let hash = /#\s*$/
  let inTemplate = `${/}/.test(x)} done`
  let divides = a / b / c
  let assignDivide = /=+/
  let call = check(/x/, /y/g)
  let parens = (/a/)
}
function noSpaces() {
  f(a,/'/)
  let x = a ? b :/"/
  if (b)/"/.test("x")
  g(a,/`/)
  let shifted = a >>>= 1
  let left = a <<= 1
}
// case: regex_unterminated
function main() {
  let r = /abc
}
// error: unterminated regular expression
// case: regex_test
// expect: true false true true false
// expect: true true false
// expect: false false false
const DIGITS = /^\d+$/;
function digits(s: Ref<string>): boolean {
  return DIGITS.test(s);
}
function main() {
  const re = /colou?r/i;
  console.log(re.test("Color"), re.test("colr"), /a.c/s.test("a\nc"), /^b/m.test("a\nb"), /😀{2}/.test("😀😀"));
  const s = "12" + "3";
  console.log(digits(s), digits("007"), digits(s + "x"));
  const long = "a".repeat(20000);
  console.log(/(a*)*b/.test(long), /(a|aa)+$/.test(long + "!"), /^(\w+\s?)*$/.test(long + "!"));
}
// case: regex_test_global
// error: a Fish regex keeps no 'lastIndex', so 'test' on a regex with the 'g' flag would start at 0 every time
function main() {
  console.log(/a/g.test("a"));
}
// case: regex_unknown_method
// error: 'RegExp' has no method 'compile' in Fish
function main() {
  /a/.compile("b");
}
// case: regex_test_number
// error: 'test' matches a string, not 'i64'
function main() {
  console.log(/1/.test(1));
}
// case: regex_exec
// expect: 3 on 2024-10-24 and 2024-10-24 2024 10 24
// expect: 2024 10 24
// expect: 2024-10-24 2024
// expect: true true
// expect: true
// expect: b - b
// expect: 1 b
function main() {
  const date = /(?<year>\d{4})-(?<month>\d\d)(?:-(?<day>\d\d))?/;
  const m = date.exec("on 2024-10-24 and");
  if (m !== null) {
    console.log(m.index, m.input, m[0], m[1], m[2], m[3] ?? "none");
    console.log(m.groups.year, m.groups.month, m.groups.day ?? "none");
    const [all, year] = m;
    console.log(all, year);
  }
  const n = date.exec("2024-10");
  if (n !== null) console.log(n.groups.day === null, n[3] === null);
  console.log(date.exec("nothing") === null);
  const alt = /(?<x>a)|(?<x>b)/.exec("b");
  if (alt !== null) console.log(alt.groups.x ?? "none", alt[1] ?? "-", alt[2] ?? "-");
  const s = "a😀b";
  const u = /😀(.)/u.exec(s);
  if (u !== null) console.log(u.index, u[1]);
}
// case: regex_as_parameter_field_and_local
// expect: 42@3 X@1 a+/i b/
// expect: true false
// expect: true true
// expect: e
function firstNumber(re: RegExp, s: string): string {
  const m = re.exec(s);
  return m === null ? "none" : m[0] + "@" + m.index;
}
function describe(re: RegExp): string {
  return re.source + "/" + re.flags;
}
class Rule {
  pattern: RegExp;
  constructor(pattern: RegExp) { this.pattern = pattern; }
  check(s: string): boolean { return this.pattern.test(s); }
}
function main() {
  console.log(firstNumber(/\d+/, "ab 42 c"), firstNumber(/x(y)?/i, "aXb"), describe(/a+/i), describe(/b/));
  const rules = [new Rule(/^a/), new Rule(/z$/)];
  for (const r of rules) console.log(r.check("abz"), r.check("bz"));
  const kept: RegExp = /k(e)pt/;
  const m = kept.exec("kept");
  if (m !== null) console.log(m[1]);
}
// case: regex_exec_global
// error: use 'matchAll' to go through every match, or drop the flag
function main() {
  console.log(/a/g.exec("a") === null);
}
// case: regex_exec_optional_capture
// error: type 'null | string' is not assignable to type 'string'
function main() {
  const m = /a(b)?/.exec("a");
  if (m !== null) {
    const s: string = m[1];
  }
}
// case: regex_source_unknown
// error: 'source' is known from a regex's pattern, which isn't known for a 'RegExp' kept here
class Holder {
  re: RegExp;
  constructor(re: RegExp) { this.re = re; }
  show(): string { return this.re.source; }
}
function main() {
  console.log(new Holder(/a/).show());
}
