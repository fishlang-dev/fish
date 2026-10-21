// 'throw' needs a 'throws' clause.
function f() {
  throw 1
}
function main() {}
// error: 'f' must declare 'throws i64' after its return type to throw here
