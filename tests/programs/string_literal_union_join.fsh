type Dir = "up" | "down";
function main() {
  const k = 1;
  const s = match (k) {
    case 0 => "zero",
    case _ => "many",
  };
  const d: Dir = "down";
  const t = k > 0 ? "yes" : "no";
  console.log(s + "!", "<" + d, `${t}-${d}`, s + d);
}
// expect: many! <down yes-down manydown
