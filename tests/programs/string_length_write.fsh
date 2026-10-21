function main() {
  let s = "abc" + "d";
  s.length = 3;
}
// error: a string's 'length' can't be changed; strings can't be changed, so build a new one instead
