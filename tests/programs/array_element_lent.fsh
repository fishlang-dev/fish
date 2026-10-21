type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  const r: Ref<Q> = xs[0];
  xs.push({ n: 2 });
  console.log(r.n);
}
// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
