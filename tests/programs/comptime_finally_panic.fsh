// error: this comptime code panicked: index out of bounds
// A panic skips finally, at comptime as at run time, so it is a compile error.
function grab(): i64 {
  const a: i64[] = [1, 2];
  try {
    return a[5];
  } finally {
    return 7;
  }
}
function main() { console.log(comptime grab()); }
