function main() {
  const n = 5;
  for (const x of n) console.log(x);
}
// error: 'for...of' needs an array, a Map, a Set, a string or a generator, not 'i64'
