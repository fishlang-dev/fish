// A closure that catches its own errors throws nothing.
function t(n: i64): i64 throws i64 { if (n > 0) throw n; return 0 }
function apply(f: (n: i64) => i64): i64 { return f(5) }
function main() {
  print(apply((n) => { try { return t(n) } catch (e) { return e * 2 } }))
}
// expect: 10
