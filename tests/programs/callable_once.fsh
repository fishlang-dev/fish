// error: this closure moves 'items' out of what it captures, so it can run only once
function take(xs: i64[]): i64 {
  return 1;
}

function main() {
  const items = [1, 2];
  const f = move (n: i64) => n + take(items);
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push(f);
}
