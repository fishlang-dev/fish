// expect: 5 7
// An enum's payload may use a utility type over a class with an inferred field or a base.
class Counter { count = 0; }
class Base { id: i64 = 1; }
class Acct extends Base { owner: string = "o"; }
enum Msg { Got(Pick<Counter, "count">), Kept(Omit<Acct, "owner">), Empty }
function read(m: Msg): i64 {
  return match (m) { case Msg.Got(c) => c.count, case Msg.Kept(k) => k.id, case Msg.Empty => 0 };
}
function main() { console.log(read(Msg.Got({ count: 5 })), read(Msg.Kept({ id: 7 }))); }
