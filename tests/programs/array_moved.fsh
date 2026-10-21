type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  const ys = xs;
  console.log(xs.length);
}
// error: 'xs.length' can't be used here because 'xs' was moved
