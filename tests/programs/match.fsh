// mode: parse
function describe(value: Option<i64>, response: Result<User, ApiError>) {
  let n = match (value) {
    case Some(v) => v,
    case None => 0,
  }
  let size = match (n) {
    case 0 => "none",
    case 1 | 2 => "few",
    case x if x > 100 => "many",
    case _ => "some",
  }
  return match (response) {
    case Ok(user) => user.name,
    case Err(ApiError.NotFound) => "missing",
    case Err(e) => {
      log(e)
      return "error"
    },
  }
}
let viaCall = match(pattern)
let shape = match (input) {
  case { kind: "circle", radius } => radius * radius,
  case { kind: "rect", size: [w, h] } | { kind: "square", size: [w, h] } => w * h,
  case [first, , ...rest] => first,
  case Point({ x: 0, y }) => y,
  case _ => 0,
}
