// error: 'tag' can't be a tag: its first parameter has to be 'comptime strings: TemplateStringsArray'
function tag(strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(tag`a`); }
