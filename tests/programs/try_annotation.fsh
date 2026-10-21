// A catch parameter's type comes from the try.
function f(): i64 throws i64 { return 1 }
function main() {
  try {
    f()
  } catch (e: i64) {}
}
// error: a catch parameter takes no type annotation
