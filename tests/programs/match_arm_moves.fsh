class Box {
  v: i64;
  constructor(v: i64) {
    this.v = v;
  }
}

function main() {
  const b = new Box(1);
  const got = match (b.v) {
    case 1 => {
      return b;
    },
    case _ => new Box(0),
  };
  console.log(got.v, b.v);
}
// error: 'b.v' can't be used here because 'b' was moved
