// error: a tag's rest parameter comes right after its strings
function tag(comptime strings: TemplateStringsArray, n: i64, ...values: string[]): string { return strings[0]; }
function main() {}
