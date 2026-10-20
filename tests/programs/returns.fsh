function answer(): i64 {
  return 42
}

// Return type inferred from the return statements.
function doubled() {
  return answer() * 2
}

function log() {
  print("logged")
  return
}

function main() {
  log()                           // expect: logged
  print(answer(), doubled() + 1)  // expect: 42 85
  answer()
}
