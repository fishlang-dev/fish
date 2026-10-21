function growG(g: Mut<i64[][]>): i64 {
  for (let k = 0; k < 9; k++) g.push([k]);
  return 5;
}
function main() {
  let g: i64[][] = [[1]];
  g[0].push(growG(g));
}
// error: cannot mutably lend 'g' while 'g[...]' is lent to 'push' for this call
