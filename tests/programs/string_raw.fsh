// case: string_raw_text
// expect: a\nb\u0041 \` \${x} \\ end
// expect: C:\dir\file 11
// expect: \x \u{zz} \1 \u{110000}
// expect: line\
// expect: next
// expect: third
// The text as written: escapes stay as typed, invalid ones included, and a line ends as LF.
function main() {
  console.log(String.raw`a\nb\u0041 \` \${x} \\ end`);
  const path = String.raw`C:\dir\file`;
  console.log(`${path} ${path.length}`);
  console.log(String.raw`\x \u{zz} \1 \u{110000}`);
  console.log(String.raw`line\
next
third`);
}
// case: string_raw_values
// expect: hi w1\t3 true lit\n
// expect: n=42\x
// expect: \d+ !
// Values are converted to text and spliced in; literal ones are folded while compiling, so a
// template of literals is a constant with a literal type.
function main() {
  const who = "w" + 1;
  console.log(String.raw`hi ${who}\t${3} ${true} ${"lit"}\n`);
  const n: i64 = 41 + 1;
  console.log(String.raw`n=${n}\x`);
  const digits: "\\d+ !" = String.raw`\d+ ${"!"}`;
  console.log(digits);
}
// case: string_raw_call
// expect: av1b2c
// expect: av1bc
// expect: a\n
// expect: []
// Called with an object of the strings, as a tag is: missing values are empty.
function main() {
  const x = "v" + 1;
  console.log(String.raw({ raw: ["a", "b", "c"] }, x, 2));
  console.log(String.raw({ raw: ["a", "b", "c"] }, x));
  console.log(String.raw({ raw: ["a\\n"] }));
  console.log(`[${String.raw({ raw: [] })}]`);
}
// case: string_raw_invalid_escape
// error: invalid escape '\x'
// Only String.raw reads a template as written, so other templates keep escapes valid.
function main() { console.log(`a\x`); }
// case: string_raw_invalid_escape_tag
// error: invalid escape '\u'
function t(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(t`a\u{zz}`); }
