// expect: key email a 7 13
// expect: bob none
// expect: c@x d ann 4 zoe balance
// keyof, indexed access, Record and the utility types, computed while compiling into ordinary
// object, union and literal types.
type User = { id: i64; name: string; email?: string; tags: string[] };
type Key = keyof User;
type Name = User["name"];
type IdOrName = User["id" | "name"];
type Tags = User["tags"];
type Tag = Tags[number];
type Scores = Record<"math" | "art", i64>;
type Patch = Partial<User>;
type Full = Required<User>;
type Frozen = Readonly<User>;
type Card = Pick<User, "id" | "name">;
type Public = Omit<User, "email" | "tags">;
class Account {
  owner: string;
  balance: i64;
  private pin: i64 = 0;
  constructor(owner: string, balance: i64) { this.owner = owner; this.balance = balance; }
}
type AccountView = Pick<Account, "owner">;
type AccountKey = keyof Account;

function describe(k: Key): string { return "key " + k; }
function first(t: Ref<Tags>): Tag { return t[0]; }
function merge(u: User, p: Patch): User {
  const name = p.name;
  const email = p.email;
  return { id: u.id, name: name ?? u.name, email: email ?? u.email, tags: u.tags };
}
function card(u: Ref<User>): Card { return { id: u.id, name: u.name }; }
function main() {
  const n: Name = "ann";
  const both: IdOrName = 7;
  const s: Scores = { math: 9, art: 4 };
  const u: User = { id: 1, name: n, tags: ["a", "b"] };
  const changed = merge(u.clone(), { name: "bob" });
  console.log(describe("email"), first(u.tags), both, s.math + s.art);
  console.log(changed.name, changed.email ?? "none");
  const full: Full = { id: 2, name: "c", email: "c@x", tags: [] };
  const frozen: Frozen = { id: 3, name: "d", tags: [] };
  const c = card(u);
  const p: Public = { id: 4, name: "e" };
  const v: AccountView = { owner: "zoe" };
  const k: AccountKey = "balance";
  console.log(full.email, frozen.name, c.name, p.id, v.owner, k);
}
