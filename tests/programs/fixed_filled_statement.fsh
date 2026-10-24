// expect: done
// FixedArray.filled as a statement makes and drops its array.
function mk(): string { return "m" + 1; }
function main() {
  FixedArray.filled<string, 3>(mk());
  console.log("done");
}
