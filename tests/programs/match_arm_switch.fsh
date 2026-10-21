function label(n: i64): string {
  const s: string = match (n) {
    case 0 => "zero",
    case _ => {
      switch (n % 2) {
        case 0: return "even";
      }
      return "odd";
    },
  };
  return s;
}
function show(a: string, b: string): string { return a + b; }
function main() {
  for (let i = 0; i < 3; i++) {
    console.log(show("n=" + i, match (i) {
      case 0 => "zero",
      case _ => {
        switch (i % 2) {
          case 0: return " even";
        }
        return " odd";
      },
    }));
  }
}
// expect: n=0zero
// expect: n=1 odd
// expect: n=2 even
