interface Named {
  name: i64
}

function main() {
  const n: Named = { name: 1, extra: 2 }
}
// error: object literal may only specify known properties, and 'extra' does not exist in type 'Named'
