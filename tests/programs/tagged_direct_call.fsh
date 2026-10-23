// error: 'sql' takes a rest parameter, which so far only a tag's values fill
function sql(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(sql(["a"], "x")); }
