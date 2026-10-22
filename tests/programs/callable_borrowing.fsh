// error: this closure borrows 'name', but a stored callable owns what it captures
function main() {
  const name = "abc" + "";
  const f = (n: i64) => n + (name.length as i64);
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push(f);
}
