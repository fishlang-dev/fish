function f(r: Ref): i64 {
  return 1
}

function main() {}
// error: type 'Ref' takes the type it borrows, and optionally a lifetime
