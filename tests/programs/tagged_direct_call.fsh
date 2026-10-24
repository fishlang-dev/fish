// expect: a
// A tag called directly, its strings an array literal known while compiling.
function sql(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(sql(["a"], "x")); }
