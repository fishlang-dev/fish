// expect: 3 4
// expect: none none x
// expect: 1 1
// expect: 1 a1
// Defaults typed by an expected literal, a null default on an Option, an instance default, and
// defaults in a generator and an async function.
class P { n: i64 = 1; }
function f(xs: string[] = [], n: u8 = 3): usize { return xs.length + (n as usize); }
function g(a: string | null = null): string { return a ?? "none"; }
function h(p: P = new P()): i64 { return p.n; }
function* count(n: i64 = 2): Generator<i64> { for (let i = 0; i < n; i++) yield i; }
async function later(s: string = "a" + 1): Promise<string> { return s; }
async function main() {
  console.log(f(), f(["a"]));
  console.log(g(), g(null), g("x"));
  console.log(h(), h(new P()));
  let t = 0;
  for (const x of count()) t += x;
  const s = await later();
  console.log(t, s);
}
