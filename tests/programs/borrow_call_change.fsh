function f(a: Ref<i64>, b: i64): i64 {
  return a * 100 + b
}

function main() {
  let n = 1
  print(f(n, n++))
}
// error: cannot change 'n' while 'n' is lent to 'f' for this call
