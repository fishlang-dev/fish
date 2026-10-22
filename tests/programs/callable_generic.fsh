// expect: 5
function wrap<T>(v: T): (x: T) => T { return (x) => x }
function main() {
  const a = wrap(1);
  print(a(5));
}
