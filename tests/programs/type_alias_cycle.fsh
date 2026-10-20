type A = B
type B = A

function main() {}
// error: type 'A' refers to itself, so it would have infinite size
