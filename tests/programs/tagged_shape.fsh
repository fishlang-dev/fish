// error: a function with comptime parameters can't take a rest parameter yet, unless it is a tag
function tag(comptime strings: TemplateStringsArray, n: i64, ...values: string[]): string { return strings[0]; }
function main() {}
