function grow(a: Mut<i64[]>): usize {
  for (let k = 0; k < 10; k++) a.push(k);
  return 0;
}
function main() {
  let a: i64[] = [1];
  a[grow(a)] = 7;
  console.log(a[0], a.length);
}
// expect: 7 11
