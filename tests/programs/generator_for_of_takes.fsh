function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}
function main() {
  let g = count(3);
  for (const x of g) console.log(x);
  const r = g.next();
  console.log(r.done);
}
// error: 'g' was moved, so it can't be used here
