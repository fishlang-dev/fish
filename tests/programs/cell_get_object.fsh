// error: 'get' copies what a Cell holds, which a '{ x: i64 }' can't be; use 'replace'
function main() {
  const s = new Cell({ x: 1 });
  console.log(s.get().x);
}
