function f(): void {
  return 1  // error: type 'i64' is not assignable to return type 'void'
}

function main() {
  f()
}
