declare function strlen(s: Ptr<u8>): usize;

function main() {
  const n: i64 = 3;
  const p = match (n) {
    case 1 => cString("one"),
    case _ => cString("other" + n),
  };
  console.log(unsafe { strlen(p) });
  const m = ("x" + 12) |> cString(%) |> unsafe { strlen(%) };
  console.log(m);
  const q = n > 2 ? cString("yes!") : cString("no");
  console.log(unsafe { strlen(q) });
}
// expect: 6
// expect: 3
// expect: 4
