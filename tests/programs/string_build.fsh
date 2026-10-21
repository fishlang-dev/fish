function main() {
  const s: string = "a-b-c";
  const lines: string[] = [
    s.replace("-", "+"), s.replace("x", "+"), s.replace("-", "[$&]"), s.replace("-", "[$`]"), s.replace("-", "[$']"),
    s.replace("-", "$$"), s.replace("-", "$1$"), s.replace("", "<"), "😀x".replace("\uDE00", "!"), s.replace("c", "$"),
    "5".padStart(3, "0"), "5".padEnd(4, "ab"), "abc".padStart(2), "x".padStart(4), "x".padEnd(6, "😀"), "x".padStart(3, ""),
    "ab".repeat(3), "ab".repeat(0), "😀".repeat(2), "\uDE00\uD83D".repeat(2),
  ];
  for (const l of lines) console.log(`[${l}] ${l.length}`);
}
// expect: [a+b-c] 5
// expect: [a-b-c] 5
// expect: [a[-]b-c] 7
// expect: [a[a]b-c] 7
// expect: [a[b-c]b-c] 9
// expect: [a$b-c] 5
// expect: [a$1$b-c] 7
// expect: [<a-b-c] 6
// expect: [�!x] 3
// expect: [a-b-$] 5
// expect: [005] 3
// expect: [5aba] 4
// expect: [abc] 3
// expect: [   x] 4
// expect: [x😀😀�] 6
// expect: [x] 1
// expect: [ababab] 6
// expect: [] 0
// expect: [😀😀] 4
// expect: [�😀�] 4
