// error: a comparator's number has to be able to be negative, and 'u8' can't
// An unsigned comparator can never be negative, so 'a' never comes first.
function main() {
  let us: u8[] = [3, 200, 1, 50];
  us.sort((a, b) => a - b);
  console.log(us.join(","));
  let vs: u64[] = [3, 2, 1];
  vs.sort((a, b) => a - b);
  console.log(vs.join(","));
}
