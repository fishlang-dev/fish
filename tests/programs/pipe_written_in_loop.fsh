type Box = { name: string; size: i64 };

function make(n: i64): Box {
  return { name: "box" + n, size: n };
}

function describe(b: Ref<Box>): string {
  return b.name + ":" + b.size;
}

function main() {
  let box = make(1);
  for (let k = 0; k < 2; k++) {
    console.log(box |> describe(%) + ((box.size = k + 10) + 0));
  }
  let i = 0;
  while (i < 2) {
    const d = box |> match (0) {
      case _ => {
        const d = describe(%);
        box.size = 99;
        return d;
      },
    };
    console.log(d);
    i++;
  }
}
// expect: box1:110
// expect: box1:1011
// expect: box1:11
// expect: box1:99
