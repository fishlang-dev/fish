// error: cannot change 'd' while 'r' borrows 'd'
interface Named { get(): Ref<string>; }
class Impl {
  name: string;
  constructor(name: string) { this.name = name; }
  get(): Ref<string> { return this.name; }
}
function main() {
  let d: Dyn<Named> = new Impl("hello" + " world");
  const r = d.get();
  d = new Impl("other" + "");
  console.log(r);
}
