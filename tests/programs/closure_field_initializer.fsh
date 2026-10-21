// Storing a closure in a field needs the heap, which isn't built yet.
class H {
  f = () => 1
}
function main() {}
// error: functions stored in fields are not supported yet
