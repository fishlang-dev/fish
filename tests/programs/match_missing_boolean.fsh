function f(b: boolean): i64 {
  return match (b) {
    case true => 1,
  };
}

function main() {}
// error: this match doesn't cover false; add 'case false =>', or 'case _ =>' for the rest
