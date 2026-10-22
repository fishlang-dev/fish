function id(s: Ref<string>): Ref<string> { return s; }
function main() {
  const o: string | null = "o" + 1;
  const r = id(o!);
  console.log(r);
}
// expect: o1
