function f(n: i64) {
  return f(n)  // error: 'f' needs a return type annotation because it calls itself
}

function main() {
}
