function main() {
  const t = "a" + "-long";
  const s = match (t.length) {
    case 0 => "",
    case _ => t + "!",
  };
  const xs = [1, 2];
  console.log(s, match (xs.length) { case 2 => "two", case _ => "other" });
}
// expect: a-long! two
