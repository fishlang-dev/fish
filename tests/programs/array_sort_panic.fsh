// panic: attempt to divide by zero
// A comparator panicking after the first merge pass leaves every element in the array, once.
class P { n: i64; name: string; constructor(n: i64, name: string) { this.n = n; this.name = name; } }
function main() {
  let qs = [new P(3, "c" + 3), new P(1, "a" + 1), new P(2, "b" + 2), new P(4, "d" + 4)];
  qs.sort((a, b) => {
    const bad = (a.n === 4 && b.n === 3) || (a.n === 3 && b.n === 4);
    const z = 10 / (bad ? 0 : 1);
    return a.n - b.n;
  });
  console.log(qs.length);
}
