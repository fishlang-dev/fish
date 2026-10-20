class Account {
  private balance = 0
}

function main() {
  print(new Account().balance)
}
// error: property 'balance' is private and only accessible within class 'Account'
