// Returning a closure needs the heap, which isn't built yet.
function make() {
  return () => 1
}
function main() { make() }
// error: functions returned from functions are not supported yet
