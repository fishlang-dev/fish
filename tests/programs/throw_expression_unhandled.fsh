// A throw expression needs a 'throws' clause too.
function f(x: i64 | null): i64 {
  return x ?? throw 1
}
function main() {}
// error: 'f' must declare 'throws i64' after its return type to throw here
