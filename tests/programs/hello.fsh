// Both print spellings, string and i64 literals, and a call to a function declared later.
function main() {
  console.log("hello, world")  // expect: hello, world
  print("answer:", 42);        // expect: answer: 42
  greet()
}

function greet() {
  console.log('100% fish')     // expect: 100% fish
}
