class Account {
  #pin = 1
}

function main() {
  print(new Account().#pin)
}
// error: property '#pin' is not accessible outside class 'Account' because it has a private identifier
