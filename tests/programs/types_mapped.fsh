// expect: 1 none 2 bob 9
// expect: 4 x 5 7 ann
// User-written mapped types: modifiers with + and -, a homomorphic one keeping optional and
// readonly fields, and 'as' renaming keys or dropping those renamed to never.
type User = { id: i64; name: string; nick?: string; readonly born: i64 };
type MyPartial<T> = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Same<T> = { [K in keyof T]: T[K] };
type Public<T> = { [K in keyof T as K extends "born" ? never : K]: T[K] };
type Renamed<T> = { [K in keyof T as K extends "id" ? "key" : K]: T[K] };
type Flags = { [K in "a" | "b"]: boolean };
type Boxed<T> = { [K in keyof T]: T[K][] };
function main() {
  const p: MyPartial<User> = { id: 1 };
  const r: MyRequired<User> = { id: 2, name: "bob", nick: "b", born: 9 };
  const s: Same<User> = { id: 3, name: "c", born: 1 };
  console.log(p.id ?? 0, p.name ?? "none", r.id, r.name, r.born);
  let m: Mutable<User> = { id: 4, name: "d", born: 0 };
  m.born = 7;
  const pub: Public<User> = { id: 5, name: "ann" };
  const f: Flags = { a: true, b: false };
  const re: Renamed<User> = { key: 5, name: "e", born: 2 };
  const b: Boxed<{ x: i64 }> = { x: [7] };
  console.log(m.id, s.nick ?? "x", re.key, f.a ? b.x[0] : 0, pub.name);
}
