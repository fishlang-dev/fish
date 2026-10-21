type W = { a: i64; c: string };

function g(w: W): string {
  return match (w) {
    case { a: 1, c } => "one " + c,
    case _ => "other",
  };
}

function h(w: Ref<W>): string {
  return match (w) {
    case { a: 2 } => "two",
    case { c } => c,
  };
}

function main() {
  const w: W = { a: 1, c: "cc" };
  const v = { a: 2, c: "dd", extra: true };
  console.log(h(w), h(v), g(w), g(v));
}
// expect: cc two one cc other
