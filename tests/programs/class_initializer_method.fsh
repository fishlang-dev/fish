class A {
  a: i64 = this.get()
  b = 1

  get(): i64 {
    return this.b
  }
}

function main() {}
// error: 'this' can't be used until every field is assigned
