// panic: array_constructor_negative.fsh:5:23:
// panic: invalid array length
function main() {
  const n = -1;
  const a = new Array(n).fill("x" + 1);
  console.log(a.length);
}
