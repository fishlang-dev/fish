type Box = { name: string; size: i64 };

function make(name: string): Box {
  console.log("made " + name);
  return { name: name, size: name.length as i64 };
}

function double(n: i64): i64 {
  return n * 2;
}

function add(a: i64, b: i64): i64 {
  return a + b;
}

function describe(b: Ref<Box>): string {
  return b.name + ":" + b.size;
}

function apply(f: () => i64): i64 {
  return f();
}

function take(b: Box): string {
  return "took " + b.name;
}

function main() {
  const n = 3;
  console.log(n |> double(%) |> add(%, %) |> % + 1);
  console.log(make("crate") |> describe(%) + " " + %.name + " " + %.size);
  console.log(make("bin") |> take(%));
  const kept = make("keep") |> %;
  console.log(kept.name, ("a" + "b") |> % + % + %, `x${n}` |> %.length);
  let total = "";
  for (let i = 0; i < 3; i++) {
    total = total + (make("p" + i) |> take(%) |> %.length |> `${%}`);
  }
  console.log(total);
  make("drop") |> console.log(%.name);
  const sized = make("sized") |> match (%) {
    case { size: 5 } => "five",
    case _ => "other",
  };
  console.log(sized, make("closure") |> apply(() => %.size * 10));
}
// expect: 13
// expect: made crate
// expect: crate:5 crate 5
// expect: made bin
// expect: took bin
// expect: made keep
// expect: keep ababab 2
// expect: made p0
// expect: made p1
// expect: made p2
// expect: 777
// expect: made drop
// expect: drop
// expect: made sized
// expect: made closure
// expect: five 70
