function main() {
  const a: string = "\uFF61";
  const b: string = "\u{1F600}";
  console.log(a < b, b < a, "\u{1F600}" < "\u{1F601}", "\u{1F601}" > "\u{1F600}", "é" < "z", "ab" < "abc", "\u{10000}" < "\u{1F600}", "a\u{1F600}" === "a\u{1F600}");
}
// expect: false true true true false true true true
