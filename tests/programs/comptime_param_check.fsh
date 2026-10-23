// error: this comptime code threw an error it didn't catch: IoError: repeat needs at least one
// A comptime block in a function checks each value its comptime parameter is given.
function repeat(comptime n: i64, s: string): string {
  comptime {
    if (n < 1) throw new IoError("repeat needs at least one");
  }
  return s;
}
function main() { console.log(repeat(0, "x")); }
