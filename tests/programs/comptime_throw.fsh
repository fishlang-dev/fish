// error: this comptime code threw an error it didn't catch: IoError: no such table
// An error thrown while compiling and not caught is a compile error at the comptime site.
function load(): i64 throws IoError {
  throw new IoError("no such table");
}
function main() {
  try {
    console.log(comptime load());
  } catch (e) {
    console.log(e.message);
  }
}
