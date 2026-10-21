function main() {
  const o = { a: 1 };
  console.log(String(o));
}
// error: 'String' works with strings, numbers and booleans, not '{ a: i64 }'
