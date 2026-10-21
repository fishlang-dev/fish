// A call that can throw needs a 'throws' clause or a try/catch.
function g(): i64 throws i64 { return 1 }
function main() {
  print(g())
}
// error: 'main' must declare 'throws i64' after its return type since 'g' can throw 'i64'
