// error: 't[0]' can't be used here because 't' was moved
class P { xs: string[]; constructor() { this.xs = ["a" + 1, "b" + 2]; } }
function hold(a: Mut<P>, b: Mut<P>): i64 {
  const first: Ref<string> = a.xs[0];
  while (b.xs.length > 0) b.xs.pop();
  for (let i = 0; i < 100; i++) b.xs.push("junk" + i);
  console.log(first);
  return 0;
}
function main() {
  let o = new P();
  let t: [Mut<P>, i64] = [o, 1];
  let u = t;
  hold(t[0], u[0]);
}
