// expect: 2
class Box2<T> {
  v: Lock<T[]>;
  constructor(v: T) { this.v = new Lock([v]); }
  put(this: Ref<this>, x: T) { this.v.update((xs) => xs.push(x)); }
}
function main() {
  const c = new Box2("a" + "");
  c.put("z" + "");
  console.log(c.v.update((s) => s.length));
}
