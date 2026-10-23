// expect: 1,1,1,2,
// A lone surrogate is a code point of its own, and a pair is one character.
function main() {
  const s = "a\uD800b😀" + "";
  let lengths = "";
  for (const ch of s) lengths += `${ch.length},`;
  console.log(lengths);
}
