class A {
  a: i64 = this.b + 1
  b: i64 = 41
}

function main() {}
// error: 'this' can't be used until every field is assigned
