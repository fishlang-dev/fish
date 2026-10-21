interface Named {
  name: string;
}

class C {
  constructor() {}
  get name(): string {
    return "c";
  }
}

function both(a: Ref<string>, b: Ref<string>): string {
  return a + b;
}

function show(v: Named): string {
  return v.name |> both(%, %);
}

function main() {
  console.log(show(new C()));
}
// error: pipes over a field a getter provides are not supported yet
