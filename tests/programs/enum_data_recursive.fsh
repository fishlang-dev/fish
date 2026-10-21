enum List {
  Cons(i64, List),
  Nil,
}

function main() {}
// error: enum 'List' holds itself, which would make it infinitely large; this isn't supported yet
