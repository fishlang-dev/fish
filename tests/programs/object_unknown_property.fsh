function main() {
  const p = { x: 1 }
  print(p.z)
}
// error: property 'z' does not exist on type '{ x: i64 }'
// error:   print(p.z)
// error:         ^^^
