// error: parameter 'b' needs a type: its default isn't a literal that says one, so write it, as in 'b: T = ...'
function f(b = []): i64 { return 1; } function main() {}
