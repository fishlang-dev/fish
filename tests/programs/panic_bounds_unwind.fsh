function at(s: string, i: usize): string {
  const copy = s + "";
  return copy[i];
}

function main() {
  const s = "ab" + "c";
  const t = { name: s + "!", n: 1 };
  console.log(at(s, 2), t.name);
  console.log(at(s, 3));
}
// expect: c abc!
// panic: index out of bounds: the len is 3 but the index is 3
