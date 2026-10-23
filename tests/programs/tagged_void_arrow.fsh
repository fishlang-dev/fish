// expect: vt arrow
// expect: vt g
function vt(comptime strings: TemplateStringsArray, ...values: string[]): void { console.log("vt", strings[0]); }
function run(f: () => void) { f(); }
function main() {
  run(() => vt`arrow`);
  const g = () => vt`g`;
  g();
}
