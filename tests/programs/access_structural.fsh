class Account {
  constructor(private value: i64) {}
}

function read(v: { value: i64 }): i64 {
  return v.value
}

function main() {
  print(read(new Account(1)))
}
// error: argument of type 'Account' is not assignable to parameter of type '{ value: i64 }'
