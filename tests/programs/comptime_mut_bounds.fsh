// error: this comptime code panicked: index out of bounds: the len is 2 but the index is 5
// Lending an element to a Mut checks its index there, at comptime as at run time.
function nothing(m: Mut<i64>) {}
function all(): string {
  let a = [1, 2];
  nothing(a[5]);
  return "done";
}
function main() { console.log(comptime all()); console.log(all()); }
