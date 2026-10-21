// Returning a function needs the heap, which isn't built yet.
function make(): (x: i64) => i64 {
  return (x) => x
}
function main() {}
// error: functions returned from functions are not supported yet
