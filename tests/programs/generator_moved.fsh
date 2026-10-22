function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}
function main() {
  let a = count(2);
  let b = a;
  const r = a.next();
  console.log(r.done);
}
// error: 'a' was moved, so it can't be used here
