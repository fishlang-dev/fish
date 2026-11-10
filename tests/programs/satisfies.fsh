// case: satisfies_keeps_type
type Config = { name: string; port: i64 | null };
function main(): void {
  const c = { name: "api", port: 8080 } satisfies Config;
  console.log(c.port + 1, c.name);
  const names = ["a", "b"] satisfies string[];
  console.log(names.length);
}
// expect: 8081 api
// expect: 2
// case: satisfies_refuses
type Config = { name: string; port: i64 };
function main(): void {
  const c = { name: "api" } satisfies Config;
}
// error: does not satisfy the expected type
// case: as_widens
class Fish {
  name: string;
  constructor(name: string) { this.name = name; }
}
function main(): void {
  const f = new Fish("nemo");
  const maybe = f as Fish | null;
  console.log(maybe === null, maybe?.name);
  const n = 5 as i64 | string;
  console.log(n);
  const words = ["a", "b"];
  const kept = words as string[] | null;
  console.log(kept);
}
// expect: false nemo
// expect: 5
// expect: [ 'a', 'b' ]
// case: as_refuses_downcast
function main(): void {
  const v: { name: string } = { name: "x" };
  const s = v as { name: string; age: i64 };
}
// error: 'as' can't narrow '{ name: string }' to '{ age: i64; name: string }', since nothing would check it while the program runs
// case: as_refuses_union_member_downcast
function main(): void {
  const v: string | i64 = "hello";
  const s = v as "hello";
}
// error: 'as' can't narrow 'i64 | string' to '"hello"', since nothing would check it while the program runs
// case: as_narrows_union
const c = (42 as i64 | string) as i64;
function main(): void {
  const v: string | i64 | boolean = "hello";
  const s = v as string;
  const sub = v as string | i64;
  console.log(s, sub, c);
}
// expect: hello hello 42
// case: as_narrows_union_panics
function main(): void {
  const v: string | i64 = 7;
  const s = v as string;
  console.log(s);
}
// panic: 'as string' failed: union held another member
// case: as_refuses_unrelated
function main(): void {
  const s = "x" as boolean;
}
// error: '"x"' can't be converted to 'boolean' with 'as', since neither fits the other
// case: as_refuses_copy_out_of_reference
class Item {
  name: string;
  constructor(name: string) { this.name = name; }
}
function main(): void {
  const items = [new Item("a")];
  const r: Ref<Item> = items[0];
  const it = r as Item;
}
// error: 'as' can't take the value out of 'Ref<Item>', which only borrows it; use '.clone()' for a copy
// case: as_function_type
class Box<T> {
  value: T;
  constructor(v: T) { this.value = v; }
}
function dbl(x: i64): i64 {
  return x * 2;
}
function main(): void {
  const f = (() => 5) as () => i64;
  const named = (x: i64) => x + 1;
  const g = named as (x: i64) => i64;
  const h = dbl as (x: i64) => i64;
  const b = new Box((() => 6) as () => i64);
  console.log(f(), g(4), h(4), b.value());
}
// expect: 5 5 8 6
// case: as_function_type_refuses
function main(): void {
  const f = (() => "s") as () => i64;
}
// error: type '"s"' is not assignable to return type 'i64'
