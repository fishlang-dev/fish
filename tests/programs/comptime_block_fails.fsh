// error: this comptime code threw an error it didn't catch: IoError: SIZE must be at least 4
// A top-level comptime block that throws is a compile error.
const SIZE = 3;
comptime {
  if (SIZE < 4) throw new IoError("SIZE must be at least 4");
}
function main() { console.log(SIZE); }
