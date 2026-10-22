// expect: 2 a b
class Log {
  lines: Lock<string[]> = new Lock<string[]>([]);
  count: Atomic<i64> = new Atomic(0);

  write(line: string) {
    this.count.add(1);
    this.lines.update((ls) => ls.push(line));
  }
}

function main() {
  const log = new Log();
  log.write("a" + "");
  log.write("b");
  const lines = log.lines.update((ls) => ls.clone());
  console.log(log.count.load(), lines[0], lines[1]);
}
