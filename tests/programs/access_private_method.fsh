class Account {
  private audit(): i64 {
    return 1
  }
}

function main() {
  print(new Account().audit())
}
// error: property 'audit' is private and only accessible within class 'Account'
