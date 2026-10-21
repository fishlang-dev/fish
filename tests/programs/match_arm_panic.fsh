function pick(n: i64): string {
  const xs = ["a", "b"];
  return "got " + match (n) {
    case 0 => {
      const local = "x" + n;
      return local + xs[(n + 5) as usize];
    },
    case _ => "none",
  };
}

function main() {
  const s = "outer";
  console.log(s + "!", pick(1), pick(0));
}
// panic: index out of bounds
