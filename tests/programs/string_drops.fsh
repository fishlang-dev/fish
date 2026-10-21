function twice(s: string): string {
  const t = s + s;
  return t;
}

function label(n: i64): string {
  switch ("k" + n) {
    case "k1": {
      const one = "one" + n;
      return one;
    }
    case "k2":
      return "two";
    default:
      return "many";
  }
}

function main() {
  let t = twice("bo");
  t = twice(t);
  console.log(t);
  twice("dropped");
  let k = 0;
  while (twice("k") + k !== "kk3") k++;
  console.log(k);
  const chosen = k > 1 ? twice("big") : "small";
  console.log(chosen, label(1), label(2), label(3));
}
// expect: bobobobo
// expect: 3
// expect: bigbig one1 two many
