class User {
  constructor(public id: i64) {}
}

function main() {
  const u: User = { id: true }
}
// error: type 'boolean' is not assignable to type 'i64'
