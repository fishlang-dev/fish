// expect: a-1 b-2 ANN Bob
// expect: 3 alice getName true
// Finite template literal types spell the union of their strings, and the intrinsics change
// string literals' case, as in getter keys built by a mapped type's 'as'.
type Ids = `${"a" | "b"}-${1 | 2}`;
type Flag = `is${true | false}`;
type Loud = Uppercase<"ann">;
type Name = Capitalize<"bob">;
type Quiet = Lowercase<"ALICE">;
type Small = Uncapitalize<"Name">;
type Getters<T> = { [K in keyof T as `get${Capitalize<K>}`]: () => T[K] };
type Person = { name: string; age: i64 };
function keyOf(k: keyof Getters<Person>): string { return k; }
function main() {
  const a: Ids = "a-1";
  const b: Ids = "b-2";
  const l: Loud = "ANN";
  const n: Name = "Bob";
  const q: Quiet = "alice";
  const s: Small = "name";
  const f: Flag = "istrue";
  console.log(a, b, l, n);
  console.log(3, q, keyOf("getName"), f === "istrue");
}
