enum M { T(string[]), N(i64) }
function main() {
  let m = M.T(["hello" + 1]);
  const r: Ref<M> = m;
  const n = match (r) {
    case T(s) => { m = M.N(3); return s[0].length; },
    case N(_) => 0 as usize,
  };
  console.log(n);
}
// error: cannot change 'm' while 's' borrows 'm'
