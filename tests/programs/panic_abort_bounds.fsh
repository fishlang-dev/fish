// mode: abort
function main() {
  const s: string = "ab";
  const i: usize = 5;
  console.log(s.charCodeAt(i));
}
// panic: index out of bounds: the len is 2 but the index is 5
