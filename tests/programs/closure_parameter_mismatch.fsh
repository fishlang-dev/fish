// A closure must take the parameter types a function type passes.
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v) }
function main() {
  print(apply((x: boolean) => 1, 2))
}
// error: argument of type '(x: boolean) => i64' is not assignable to parameter of type '(x: i64) => i64'
