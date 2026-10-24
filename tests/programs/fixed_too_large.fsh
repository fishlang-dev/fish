// error: a FixedArray holds at most 64 KiB inline
function main() {
  const a: FixedArray<FixedArray<i64, 1000000>, 1000000> = FixedArray.filled(FixedArray.filled(0));
  console.log(a.length);
}
