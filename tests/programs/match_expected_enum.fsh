enum Res<T, E> {
  Ok(T),
  Err(E),
}

function f(n: i64): Res<i64, string> {
  return match (n) {
    case 0 => Res.Ok(1),
    case _ => Res.Err("x" + n),
  };
}

function show(r: Res<i64, string>): string {
  return match (r) {
    case Ok(v) => "ok " + v,
    case Err(e) => "err " + e,
  };
}

function main() {
  const n = 3;
  const r: Res<i64, string> = n |> Res.Ok(%);
  console.log(show(f(0)), show(f(2)), show(r));
}
// expect: ok 1 err x2 ok 3
