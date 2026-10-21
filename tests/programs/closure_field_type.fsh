// Storing a function in a field needs the heap, which isn't built yet.
class H {
  f: () => i64
  constructor() { this.f = () => 1 }
}
function main() {}
// error: functions stored in fields are not supported yet
