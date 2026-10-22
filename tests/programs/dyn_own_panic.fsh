// panic: attempt to divide by zero
interface Door { close(this: Own<this>, by: i64): string; }
class Gate {
  name: string;
  constructor(name: string) { this.name = name; }
  close(this: Own<this>, by: i64): string { const z = 10 / by; return "closed " + this.name + z; }
}
class Port {
  name: string;
  constructor(name: string) { this.name = name; }
  close(by: i64): string { const z = 10 / by; return "shut " + this.name + z; }
}
function main() {
  const p: Dyn<Door> = new Port("p" + "");
  const s = "keep" + "";
  console.log(p.close(0));
}
