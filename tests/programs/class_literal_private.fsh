class User {
  constructor(public id: i64, private secret: i64) {}
}

function main() {
  const u: User = { id: 1, secret: 2 }
}
// error: an object literal can't build 'User' because 'secret' is private; use 'new'
