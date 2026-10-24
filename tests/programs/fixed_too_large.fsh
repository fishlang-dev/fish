// error: a FixedArray holds at most 65,536 elements inline, nested ones counted; use an array, 'T[]', for more
function main() {
  const a: FixedArray<FixedArray<i64, 1000000>, 1000000> = FixedArray.filled(FixedArray.filled(0));
  console.log(a.length);
}
