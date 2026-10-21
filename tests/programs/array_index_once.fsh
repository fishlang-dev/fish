function f(): usize { console.log("f"); return 1; }
function main() {
  let a: i64[] = [10, 20, 30, 40];
  let j: usize = 0;
  a[j++] += 1;
  a[f()] += 5;
  a[j++]++;
  let i: usize = 2;
  a[i++] = i as i64;
  console.log(a[0], a[1], a[2], a[3], j, i);
}
// expect: f
// expect: 11 26 3 40 2 3
