type Box = { size: i64 };

interface HasBox {
  box: Box;
}

class C {
  constructor() {}
  get box(): Box {
    return { size: 1 };
  }
}

function size(b: Ref<Box>): i64 {
  return b.size;
}

function show(v: HasBox): i64 {
  return v.box |> size(%) + size(%);
}

function main() {
  console.log(show(new C()));
}
// error: pipes over a field a getter provides are not supported yet
