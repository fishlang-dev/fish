// An object literal can't hold a closure yet.
function main() {
  const o = { f: () => 1 }
}
// error: functions stored in objects are not supported yet
