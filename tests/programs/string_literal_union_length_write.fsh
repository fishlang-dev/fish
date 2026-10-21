function main() {
  let e: "a" | "bc" = "bc";
  e.length = 1;
}
// error: a string's 'length' can't be changed; strings can't be changed, so build a new one instead
