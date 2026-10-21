function apply(f: () => i64): i64 {
  return f();
}

function main() {
  const n = 1;
  const h = match (n) {
    case 1 => move () => n + 1,
    case _ => move () => n + 20,
  };
  console.log(apply(h));
}
// error: unions holding functions are not supported yet
