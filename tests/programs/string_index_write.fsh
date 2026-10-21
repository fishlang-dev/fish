function main() {
  let s = "abc";
  s[0] = "x";
}
// error: strings can't be changed; build a new one instead, joining parts with '+'
