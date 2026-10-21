// A try that can't throw has nothing to catch.
function main() {
  try {
    print(1)
  } catch (e) {
    print(2)
  }
}
// error: nothing in this 'try' can throw, so its 'catch' never runs
