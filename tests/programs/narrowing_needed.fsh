function f(x: i64 | boolean): i64 {
  return x * 2
}

function main() {}
// error: operator '*' cannot be applied to types 'boolean | i64' and 'i64'
