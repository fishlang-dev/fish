// error: 'get' takes its object over and frees it, so the reference it gives would point at nothing
interface Named { get(this: Own<this>): Ref<string>; }
class Impl {
  name: string;
  constructor(name: string) { this.name = name; }
  get(): Ref<string> { return this.name; }
}
function main() {
  const d: Dyn<Named> = new Impl("hello" + " world");
  const r = d.get();
  const junk = "zzzzzzzzzzzzzzzz" + "zzzz";
  console.log(r, junk);
}
