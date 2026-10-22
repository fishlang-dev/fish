// expect: built 3 2
type Config = { name: string; size: i64 };

class Button {
  label: string;
  onClick: (n: i64) => i64;
  constructor(label: string, onClick: (n: i64) => i64) {
    this.label = label;
    this.onClick = onClick;
  }
}

function main() {
  const prefix = "item" + "";
  const config: Config = { name: "c" + "", size: 3 };
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push((n) => n + 1);
  handlers.push((n) => n + (prefix.length as i64));
  handlers.push((n) => n * config.size);
  let current: (n: i64) => i64 = (n) => n;
  const step = 2;
  current = (n) => n * step;
  const b = new Button("ok" + "", (n) => n - 1);
  const list: ((n: i64) => i64)[] = [(n) => n, (n) => -n];
  console.log("built", handlers.length, list.length);
}
