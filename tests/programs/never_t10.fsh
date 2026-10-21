// A never value is never read: code after a throw expression doesn't run.
function f(): void throws i64 { return throw 5 }
function main() throws i64 { f() }
// fails: Error: 5
