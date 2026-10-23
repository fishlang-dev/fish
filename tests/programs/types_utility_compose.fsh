// expect: 7 none bob
// expect: 1 set
// expect: 0 2 3
// A nullable field stays nullable under Required<Partial<T>>, Partial<T> & Pick<T, K> requires
// the picked keys, `{ a?: T }` and `{ a: T | null }` are interchangeable, and a single-key Record
// and an Omit of every key are object types.
type User = { id: i64; nick: string | null; name: string };
type Back = Required<Partial<User>>;
type Patch = Partial<User> & Pick<User, "id">;
type One = Record<"only", i64>;
type Empty = Omit<User, "id" | "nick" | "name">;
type A = { a?: i64 };
type B = { a: i64 | null };
function patch(p: Patch): i64 { return p.id; }
function count(xs: A[]): i64 { return xs.length as i64; }
function same<T>(x: T, y: T): T { return y; }
function main() {
  const b: Back = { id: 1, nick: null, name: "bob" };
  console.log(patch({ id: 7 }), b.nick ?? "none", b.name);
  const one: One = { only: 1 };
  const bs: B[] = [{ a: 2 }];
  const e: Empty = {};
  console.log(one.only, count(bs) === 1 ? "set" : "unset");
  const either: A | B = { a: 2 };
  const x: A = { a: 9 };
  const y: B = { a: 3 };
  console.log(count([]), either.a ?? 0, same(x, y).a ?? 0);
}
