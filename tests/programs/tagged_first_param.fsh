// error: 't' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray'
function t(comptime n: i64, ...values: string[]): string { return "x"; }
function main() { console.log(t`a`); }
