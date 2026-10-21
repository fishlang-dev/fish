type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  grow(xs, xs[0]);
}
// error: cannot use 'xs[0]' while 'xs' is lent mutably to 'grow' for this call
