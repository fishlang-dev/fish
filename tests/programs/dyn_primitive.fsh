// expect: 2
interface Empty {}
function main() {
  const e: Dyn<Empty> = "str" + "ing";
  const f: Dyn<Empty> = 5;
  let arr: Dyn<Empty>[] = [e, f];
  console.log(arr.length);
}
