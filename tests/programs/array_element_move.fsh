type Q = { n: i64 };
function take(q: Q) {}
function grow(xs: Mut<Q[]>, q: Ref<Q>) {
  xs.push({ n: q.n });
}

function main() {
  let xs = [{ n: 1 }];
  take(xs[0]);
}
// error: 'xs[0]' can't be moved out of its array; use 'xs[0].clone()' to take a copy, or 'pop()' to take the last element out
