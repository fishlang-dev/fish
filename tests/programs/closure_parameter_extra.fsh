// A closure can't take more parameters than a function type passes.
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v) }
function main() {
  print(apply((a, b) => a, 2))
}
// error: '(x: i64) => i64' passes 1 argument, so this closure can't take 'b'
