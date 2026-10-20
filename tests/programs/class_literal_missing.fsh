class User {
  constructor(public id: i64, public admin: boolean) {}
}

function main() {
  const u: User = { id: 1 }
}
// error: property 'admin' is missing in type '{ id: i64 }' but required in type 'User'
