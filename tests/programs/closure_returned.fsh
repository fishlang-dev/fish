// A closure is returned through a declared function type, which boxes it.
function make() {
  return () => 1
}
function main() { make() }
// error: functions returned without a function return type are not supported yet
