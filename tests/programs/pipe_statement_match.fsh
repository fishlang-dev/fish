type Box = { name: string; size: i64 };

function make(n: i64): Box {
  return { name: "box" + n, size: n };
}

function main() {
  const b = make(1);
  b |> match (%.size) {
    case 1 => console.log("one"),
    case _ => console.log(%.name),
  };
  make(2) |> match (%.size) {
    case 1 => console.log("one"),
    case _ => console.log(%.name),
  };
  make(3) |> match (%.size) {
    case 3 => {
      console.log("three");
      return;
    },
    case _ => {},
  };
}
// expect: one
// expect: box2
// expect: three
