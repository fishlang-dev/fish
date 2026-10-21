function append(s: Mut<string>, more: string) {
  s += more;
  s = s + ".";
}

function main() {
  let s = "a";
  append(s, "b" + 1);
  console.log(s);
}
// expect: ab1.
