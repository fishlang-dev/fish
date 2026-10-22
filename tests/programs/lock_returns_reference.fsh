// error: closures returning references are not supported yet
function main() {
  const items = new Lock<i64[]>([]);
  const inside = items.update((xs) => xs);
}
