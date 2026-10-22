// expect: caught bad 2
// Comptime code may throw and catch errors as values.
function parse(s: string): i64 throws IoError {
  if (s === "bad") throw new IoError("bad");
  return 2;
}
function both(): string {
  let out = "";
  try {
    const n = parse("bad");
    out = "no";
  } catch (e) {
    out = "caught " + e.message;
  }
  try {
    out = out + " " + String(parse("ok"));
  } catch (e) {
    out = "no";
  }
  return out;
}
function main() {
  console.log(comptime both());
}
