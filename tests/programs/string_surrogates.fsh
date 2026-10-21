function main() {
  const high: string = "\uD83D";
  const low: string = "\uDE00";
  const pair = high + low;
  console.log(pair, pair === "\u{1F600}", `${high}${low}` === "\u{1F600}");
  console.log(high, "x\uD83D", high < pair, "\uD83D" > pair);
}
// expect: 😀 true true
// expect: � x� true true
