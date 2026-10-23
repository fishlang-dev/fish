// expect: x
function shared(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(shared`x`); }
