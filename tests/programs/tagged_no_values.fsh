// error: 'pair' can't be a tag: a tag takes 'comptime strings: TemplateStringsArray, ...values: T[]'
function pair(comptime strings: TemplateStringsArray): string { return strings[0]; }
function main() { console.log(pair`a`); }
