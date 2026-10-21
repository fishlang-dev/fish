function main() {
  const high: string = "\uD83D";
  const low: string = "\uDE00";
  const pair = high + low;
  console.log(pair, pair === "\u{1F600}", `${high}${low}` === "\u{1F600}");
  console.log(high, "x\uD83D", high < pair, "\uD83D\uE000" > pair);
  console.log("\uDE00" < "\uE000", "\uE000" > "\u{1F600}", "a\uDC00" < "a\u{10000}");
}
// expect: 😀 true true
// expect: � x� true true
// expect: true true false
