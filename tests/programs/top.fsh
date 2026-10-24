// case: top_level_let
// error: a top-level 'let' would be a global that changes
// A top-level let is refused: a global that changes is a const holding an Atomic or a Lock.
let counter = 0;
function main() {}
// case: top_level_statement
console.log("hi")  // error: move this into main()
