// expect: 11
type H = { f: (x: i64) => i64 };
function callIt(h: H, x: i64): i64 { return h.f(x) }
function main() {
  const h: H = { f: (x) => x + 10 };
  print(callIt(h, 1));
}
