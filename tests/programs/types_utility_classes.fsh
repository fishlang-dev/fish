// expect: ann 5 3 none
// expect: kim 1
// Utility types over a derived class see the base's fields, over an inferred field see its type,
// and over a class's own `?:` fields know `?` made them nullable.
class Owned {
  owner: string;
  constructor(owner: string) { this.owner = owner; }
}
class Acct extends Owned {
  balance: i64;
  count = 0;
  nick?: string;
  constructor(owner: string, balance: i64) { super(owner); this.balance = balance; }
}
type Summary = Omit<Acct, "count" | "nick">;
type Counted = Pick<Acct, "count">;
type Filled = Required<Pick<Acct, "owner" | "nick">>;
type Loose = Partial<Acct>;
function main() {
  const s: Summary = { owner: "ann", balance: 5 };
  const c: Counted = { count: 3 };
  const l: Loose = { owner: "kim" };
  const f: Filled = { owner: "kim", nick: "k" };
  console.log(s.owner, s.balance, c.count, l.nick ?? "none");
  console.log(f.owner, f.nick.length);
}
