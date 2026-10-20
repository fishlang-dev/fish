function main() {
  const x: i64 | boolean = 1
  print(typeof x === "integer")
}
// error: 'typeof' can only be compared with "number", "boolean", "string", "object" here
