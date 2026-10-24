// expect: 1
// expect: 2
// A local may have any name without hiding the array iterators.
function main() {
  const __arrayValues = 5;
  const xs = [1, 2];
  for (const x of xs.values()) console.log(x);
}
