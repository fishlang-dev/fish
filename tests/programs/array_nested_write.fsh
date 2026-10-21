function zero(): usize { return 0; }
function main() {
  let g: i64[][] = [[1, 2], [3]];
  g[zero()][1] = 50;
  g[zero()][0] += 9;
  let w: string[][] = [["a"], ["b"]];
  w[zero()][0] = "z" + 1;
  w[zero()][0] += "!";
  console.log(g[0][1], g[0][0], w[0][0]);
}
// expect: 50 10 z1!
