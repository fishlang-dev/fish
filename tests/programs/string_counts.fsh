function main() {
  const n: usize = 10000000000;
  const big: usize = 4294967297;
  console.log("".repeat(n).length, "ab".repeat(0).length, "x".padStart(0, "ab"), "a,b,c".split(",", big).length, "a,b,c".split(",", 4294967296).length);
  console.log("\uDE00\uD83D".repeat(3).length, "\u00e9,".repeat(1000).split(",").length);
}
// expect: 0 0 x 1 0
// expect: 6 1001
