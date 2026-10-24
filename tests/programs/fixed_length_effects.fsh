// expect: made
// expect: 2
// panic: index out of bounds: the len is 1 but the index is 5
// A fixed array's length still runs what it is read from, and checks an index into it.
function mk(): FixedArray<string, 2> { console.log("made"); return ["a" + 1, "b" + 2]; }
function main() {
  const n = mk().length;
  console.log(n);
  let i: usize = 0;
  const xs: FixedArray<FixedArray<i64, 2>, 1> = [[1, 2]];
  let j: usize = 5;
  console.log(xs[j].length);
}
