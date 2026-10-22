// expect: closed root
interface Door { close(this: Own<this>): string; }
class Base {
  pad: string;
  constructor() { this.pad = "root" + ""; }
  close(this: Own<this>): string { return "closed " + this.pad; }
}
class Derived extends Base {
  extra: string;
  constructor() { super(); this.extra = "e" + ""; }
}
function main() {
  const d: Dyn<Door> = new Derived();
  console.log(d.close());
}
