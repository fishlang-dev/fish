// expect: 5 text 6
// 'typeof' names what is in sight where it is written: another function's local, or a block
// that has closed, doesn't hide a top-level const.
const LIMIT: i64 = 5;
function f(x: typeof LIMIT): i64 { return x; }
function main() {
  const LIMIT = "text";
  if (true) { const inner = 1; }
  const y: ReturnType<typeof f> = 6;
  console.log(f(5), LIMIT, y);
}
