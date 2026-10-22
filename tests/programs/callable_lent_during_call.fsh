// error: cannot move 'f' while 'f' is lent to 'f' for this call
function eat(f: (n: i64) => string): i64 { return 1 }
function main() {
  const s = "orig" + "";
  const f: (n: i64) => string = (n) => s + n;
  print(f(eat(f)));
}
