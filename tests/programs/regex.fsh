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
