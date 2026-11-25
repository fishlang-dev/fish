// Array growth and sorting with a comparator: two million numbers from a Lehmer generator.
function main() {
  let xs: i64[] = [];
  let seed = 42;
  for (let i = 0; i < 2000000; i++) {
    seed = (seed * 48271) % 2147483647;
    xs.push(seed);
  }
  xs.sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < xs.length; i += 1000) sum += xs[i] % 1000;
  console.log(xs[0], xs[1000000], xs[1999999], sum);
}
