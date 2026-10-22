function* words(n: i64): Generator<string> {
  for (let i = 0; i < n; i++) yield "w" + i;
}
function main() {
  let a = words(3);
  a.next();
  const c = a.clone();
  let d = c;
  const r = d.next();
  if (r.done === false) console.log(r.value);
  const q = a.next();
  if (q.done === false) console.log(q.value);
}
// error: generators have no method 'clone' yet
