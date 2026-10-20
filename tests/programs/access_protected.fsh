class Account {
  protected owner = 1
}

function main() {
  let a = new Account()
  a.owner = 2
}
// error: property 'owner' is protected and only accessible within class 'Account' and its subclasses
