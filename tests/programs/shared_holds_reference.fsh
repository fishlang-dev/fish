// error: so it can't hold a 'Ref<i64>', which borrows from one place, which other threads can't keep alive
type View = { n: Ref<i64> };

function main() {
  const n = 1;
  const v: View = { n: n };
  const s = shared(v);
}
