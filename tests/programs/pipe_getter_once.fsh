interface Named {
  name: string;
}

class C {
  constructor() {}
  get name(): string {
    console.log("getter ran");
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
// expect: getter ran
// expect: cc
