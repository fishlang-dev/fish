// expect: a
// expect: strings ["a"]
function t(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function show(comptime s: string): string { return s; }
function main() {
  console.log(t`a`);
  console.log(show('strings ["a"]'));
}
