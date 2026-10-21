function main() {
  let o: string[] | null = [];
  if (o !== null) console.log(o.length);
  const p: i64[] | null = [1, 2];
  if (p !== null) console.log(p[1]);
}
// expect: 0
// expect: 2
