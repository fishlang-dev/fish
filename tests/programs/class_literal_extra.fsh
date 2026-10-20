class User {
  constructor(public id: i64) {}
}

function main() {
  const u: User = { id: 1, name: 2 }
}
// error: object literal may only specify known properties, and 'name' does not exist in type 'User'
