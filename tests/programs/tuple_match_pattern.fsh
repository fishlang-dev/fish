// error: array patterns over tuples in 'match'
function main() {
  const t: [i64, string] = [1, "m" + 1];
  const r = match (t) {
    case [1, s] => s,
    case _ => "other",
  };
  console.log(r);
}
