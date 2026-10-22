// expect: 1 13
// An arrow in an object literal is stored as a callable owning what it captures.
function main() {
  const base = 10;
  const o = { f: () => 1, g: (n: i64) => n + base };
  console.log(o.f(), o.g(3));
}
