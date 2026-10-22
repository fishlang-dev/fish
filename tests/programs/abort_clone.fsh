// expect: false false
// expect: true true
function main() {
  const c = new AbortController();
  const a = c.signal;
  const b = a.clone();
  const d = c.clone();
  console.log(a.aborted, b.aborted);
  d.abort();
  c.abort();
  console.log(a.aborted, b.aborted);
}
