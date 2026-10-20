interface Named {
  name: i64
}

class Secret {
  constructor(private name: i64) {}
}

function main() {
  const n: Named = new Secret(1)
}
// error: type 'Secret' is not assignable to type 'Named': property 'name' is missing in type 'Secret' but required in type 'Named'
