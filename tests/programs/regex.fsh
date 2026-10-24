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
// case: regex_backreferences_and_lookaround
// expect: true false true
// expect: 42 7
// expect: 7
// expect: true false
// expect: is IS is
// expect: 12 c 5
// expect: true true true
function main() {
  console.log(/(\w)\1/.test("hello"), /(?<q>['"]).*?\k<q>/.test(`say "hi'`), /(a)|\1b/.test("b"));
  const price = /(?<=\$)\d+(?=\.\d\d)/.exec("cost: $42.50");
  if (price !== null) console.log(price[0], price.index);
  const free = /(?<!\$)\b\d+/.exec("$5 or 7");
  if (free !== null) console.log(free[0]);
  console.log(/^(?!.*bad).*$/.test("all good"), /^(?!.*bad).*$/.test("too bad"));
  const word = /\b(\w+)\s+\1\b/i.exec("This is IS a test");
  if (word !== null) console.log(word[0], word[1]);
  const back = /(?<=(\d+)(\w))x/.exec("ab12cx");
  if (back !== null) console.log(back[1], back[2], back.index);
  console.log(/(?<=\1(a))b/.test("aab"), /(ß)\1/iu.test("ßẞ"), /(ſ)\1/iu.test("sS"));
}
// case: regex_unicode
// expect: true true true true true
// expect: 4 false true
// expect: true true true false true 2
// expect: true false true true
function main() {
  const lone = "a\uD83Db";
  console.log(/\uD83D/.test(lone), /^.\uD83D.$/.test(lone), /^...$/u.test(lone), /^.$/u.test("😀"), /^..$/.test("😀"));
  console.log(/\p{Script=Greek}+/u.exec("abc αβγ d")?.index ?? -1, /[\p{L}--[a-z]]/v.test("abc"), /[\p{L}--[a-z]]/v.test("abcÉ"));
  console.log(/σ/iu.test("ς"), /Σ/i.test("ς"), /k/iu.test("K"), /k/i.test("K"), /ß/iu.test("ẞ"), /[\q{abc|d}]/v.exec("xxabc")?.index ?? -1);
  console.log(/\w/iu.test("ſ"), /\w/i.test("ſ"), /\bſ/iu.test("ſ"), /[^\P{Lu}]/u.test("A"));
}
// case: regex_review_repairs
// expect: true ^https?:\/\/ a\/b (?:)
// expect: true true false true true
// expect: true
// expect: true
// expect: true true false false true
// expect: true true true
function pick(b: boolean) {
  if (b) return /a/;
  return /b/;
}
function two(): RegExp {
  return /q(r)/;
}
const T = comptime two();
function main() {
  const url = new RegExp("^https?:\\/\\/");
  console.log(url.test("https://x.dev"), url.source, new RegExp("a/b").source, new RegExp("").source);
  console.log(/(.)\1/iu.test("𐐀𐐨"), /\P{Lu}/iu.test("A"), /\P{Lu}/iv.test("A"), /ΐ/iu.test("ΐ"), /ﬅ/iu.test("ﬆ"));
  /a(b)/.exec("ab");
  const all = [/(a)(b)/, /c/];
  for (const r of all) console.log(r.test("abc"));
  let r = /a/;
  r = /b/;
  console.log(r.test("b"), pick(true).test("a"), pick(false).test("a"), T.test("x"), T.test("qr"));
  console.log(/a{0,60000}b/.test("aab"), /(?:b|){100000}c/.test("c"), /(?:a?){20000}b/.test("aab"));
}
// case: regex_exec_unknown_pattern
// error: 'exec' types its match from the regex's pattern, which isn't known for a 'RegExp' kept here
class Holder {
  re: RegExp;
  constructor(re: RegExp) { this.re = re; }
}
function make(): RegExp { return /(a)(b)(c)(d)(e)(f)/; }
function main() {
  const h = new Holder(/(a)(b)(c)(d)(e)(f)/);
  const m = h.re.exec("abcdef");
  if (m !== null) console.log(m[0], m.index);
  const r = make();
  const m2 = r.exec("xxabcdef");
  if (m2 !== null) console.log(m2[0], m2.index);
}
// case: regex_string_methods
// expect: 1 -1 5
// expect: 1 1 - 1
// expect: 1,22,333 3
// expect: true
// expect: 0 a1 a 1 a
// expect: 2 b22 b 22 b
// expect: 5 c333 c 333 c
// expect: 10 d d  d
// expect: a|b|c| d a|1|b|2||2|c|3||3||3| d 13 a1
// expect: 1 0 a|b|c 3 4
// expect: a#b22c333 d a#b##c### d a[1]b[2][2]c[3][3][3] d a<1>b<22>c<333> d
// expect: a1b22|a1|c333 d|$|$2|221c333 d -a-a-a- .😀.😀. .�.�.
// expect: a1_@1b22@3c33@63_@8 d A1B22C333 D
// expect: a111b22c333 d
function main() {
  const s = "a1b22c333 d";
  console.log(s.search(/\d/), s.search(/z/), s.search(/c/g));
  const m = s.match(/(\d)(\d)?/);
  if (m !== null) console.log(m[0], m[1], m[2] ?? "-", m.index);
  const all = s.match(/\d+/g);
  if (all !== null) console.log(all.join(","), all.length);
  console.log(s.match(/z/g) === null);
  for (const x of s.matchAll(/(?<l>[a-z])(\d*)/g)) console.log(x.index, x[0], x[1], x[2], x.groups.l);
  console.log(s.split(/\d+/).join("|"), s.split(/(\d)/).join("|"), s.split(/(x)?\d/).length, s.split(/b/, 1).join("|"));
  console.log("".split(/,/).length, "".split(/(?:)/).length, "abc".split(/(?:)/).join("|"), "a😀b".split(/(?:)/u).length, "a😀b".split(/(?:)/).length);
  console.log(s.replace(/\d/, "#"), s.replace(/\d/g, "#"), s.replaceAll(/(\d)/g, "[$1]"), s.replace(/(?<n>\d+)/g, "<$<n>>"));
  console.log(s.replace(/b(2+)/, "$&|$`|$'|$$|$2|$11"), "aaa".replace(/a*?/g, "-"), "😀😀".replace(/(?:)/gu, "."), "😀".replace(/(?:)/g, "."));
  console.log(s.replace(/(\d)(\d)?/g, (all, a, b, at) => `${a}${b ?? "_"}@${at}`), s.replace(/[a-z]/g, (c) => c.toUpperCase()));
  console.log(s.replace(/(?<x>\d)/, (m, d, at, str, groups) => groups.x + str.length));
}
// case: regex_string_methods_kept_regex
// expect: -b- -ba a|c 1
class H {
  re: RegExp;
  constructor(re: RegExp) { this.re = re; }
  swap(s: string): string { return s.replace(this.re, "-"); }
  parts(s: string): string { return s.split(this.re).map((x) => x ?? "-").join("|"); }
}
function main() {
  console.log(new H(/a/g).swap("aba"), new H(/a/).swap("aba"), new H(/b/).parts("abc"), "xay".search(new H(/a/).re));
}
// case: regex_method_matchall_g
// error: 'matchAll' needs a regex with the 'g' flag, as JavaScript requires
function main() {
  for (const m of "aa".matchAll(/a/)) console.log(m[0]);
}
// case: regex_method_replaceall_g
// error: 'replaceAll' needs a regex with the 'g' flag, as JavaScript requires
function main() {
  console.log("aa".replaceAll(/a/, "b"));
}
// case: regex_method_replacement
// error: what replaces each match is a string or an arrow function, not 'i64'
function main() {
  console.log("aa".replace(/a/, 1));
}
// case: regex_method_callback_type
// error: 'replace' passes its callback a 'null | string' here, not a 'string'
function main() {
  console.log("a1".replace(/(\d)?/, (m, d: string) => d));
}
// case: regex_method_callback_gives
// error: the replacing function gives the string each match becomes, not 'i64'
function main() {
  console.log("a1".replace(/\d/, (m) => 1));
}
// case: regex_method_match_string
// error: 'match' takes a regex, like 'match(/x/)'; Fish doesn't turn a string into one
function main() {
  console.log("a".match("a"));
}
// case: regex_method_unknown
// error: 'matchAll' types its matches from the regex's pattern, which isn't known for a 'RegExp' kept here; call it where the regex is written, or pass the regex as a parameter
class H {
  re: RegExp;
  constructor(re: RegExp) { this.re = re; }
  all(s: string): i64 { return s.matchAll(this.re).length; }
}
function main() {
  console.log(new H(/a/g).all("aa"));
}
// case: regex_method_split_limit
// error: a limit is an 'i64', not 'number'
function main() {
  console.log("a,b".split(/,/, 1.5));
}
// case: regex_replace_callback_changes_receiver
// error: cannot mutably lend 's' while 's' is lent to 'replace' for this call
function main() {
  let s = "a1b22c333" + "x";
  const r = s.replace(/\d+/g, (m) => { s = "zzzzzzzzzzzzzzzzzzzzzzzz" + m; return "<" + m + ">"; });
  console.log(r, s);
}
// case: regex_methods_as_statements
// expect: 1,2,2
function main() {
  const s = "a1b22";
  let out: string[] = [];
  s.split(/\d/);
  s.matchAll(/(\d)/g);
  s.match(/\d/g);
  s.match(/(\d)/);
  s.search(/b/);
  s.replace(/\d/g, "x");
  s.replace(/\d/g, (m) => {
    out.push(m);
    return m;
  });
  console.log(out.join(","));
}
// case: regex_replace_unknown_name
// error: the regex has no group named 'y' for '$<y>'
function main() {
  console.log("ab".replace(/(?<x>a)/, "[$<y>]"));
}
// case: regex_split_limits
// expect: 0 1 2 3
function main() {
  const n: usize = 3;
  console.log("a,b,c".split(/,/, -4294967296).length, "a,b,c".split(/,/, -4294967295).length, "a,b,c".split(/,/, 2).length, "a,b,c".split(/,/, n).length);
}
// case: regex_replace_callback_panic
// panic: index out of bounds
function main() {
  const xs: i64[] = [];
  console.log("a1b2".replace(/(\d)/g, (m) => m + xs[5]));
}
// case: regex_statements_in_generic_bodies
// expect: ok
function fm(re: RegExp, s: string): void { s.match(re); }
function fs(re: RegExp, s: string): void { s.split(re); }
function main() {
  fm(/(\d)(x)?/, "a1b2");
  fm(/\d/g, "a1b2");
  fm(/(?<n>\d)(?<m>\d)?(?<o>z)?/, "a1");
  fm(/q/g, "zz");
  fs(/(\d)(x)?/, "a1b2");
  fs(/\d/g, "a1b2");
  console.log("ok");
}
// case: regex_replace_escaped_dollar
// expect: $<y>b $ab
function main() {
  console.log("ab".replace(/(?<x>a)/, "$$<y>"), "ab".replace(/(?<x>a)/, "$$$<x>"));
}
