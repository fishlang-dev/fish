function same(a: string | i64, b: string): boolean {
  return a === b;
}

function kind(s: string): i64 {
  switch (s) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}

function main() {
  const a: string = "hello";
  const c = "lit";
  const s: string = c;
  console.log(a === "hello", a !== "hello", s === c);
  console.log("abc" < "abd", "abd" <= "abc", "b" > "abc", "x" >= "x", "ab" < "abc");
  console.log("é" < "z", "z" < "é");
  console.log(same("q", "q"), same(1, "q"), same("q", "r"));
  console.log(kind("a"), kind("b"), kind("zz"));
}
// expect: true false true
// expect: true false true true true
// expect: false true
// expect: true false false
// expect: 1 2 0
