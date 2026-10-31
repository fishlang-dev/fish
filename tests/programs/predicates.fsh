// case: predicates_classes
class Fish {
  fins: i64;
  constructor(fins: i64) { this.fins = fins; }
}
class Bird {
  wings: i64;
  constructor(wings: i64) { this.wings = wings; }
}
function isFish(pet: Ref<Fish | Bird>): pet is Fish {
  return pet instanceof Fish;
}
function describe(pet: Fish | Bird): string {
  if (isFish(pet)) return `fish with ${pet.fins} fins`;
  return `bird with ${pet.wings} wings`;
}
function main(): void {
  console.log(describe(new Fish(4)), describe(new Bird(2)));
  const pet: Fish | Bird = new Bird(3);
  if (!isFish(pet)) console.log(pet.wings);
  console.log(isFish(pet) ? pet.fins : pet.wings);
}
// expect: fish with 4 fins bird with 2 wings
// expect: 3
// expect: 3
// case: predicates_primitives
function isText(x: string | i64 | null): x is string {
  return typeof x === "string";
}
function main(): void {
  const values: (string | i64 | null)[] = ["fin", 7, null];
  for (const v of values) {
    if (isText(v) && v.length > 2) console.log(v.toUpperCase());
    else console.log("not text");
  }
}
// expect: FIN
// expect: not text
// expect: not text
// case: predicates_method
class Shelf {
  isBook(item: string | i64): item is string {
    return typeof item === "string";
  }
}
function main(): void {
  const shelf = new Shelf();
  const item: string | i64 = "dune";
  if (shelf.isBook(item)) console.log(item.length);
}
// expect: 4
// case: predicates_not_a_parameter
function bad(x: string | i64): y is string {
  return true;
}
function main(): void {}
// error: a type predicate names one of the function's parameters, and 'y' isn't one
// case: predicates_unassignable
function bad(x: string | i64): x is boolean {
  return true;
}
function main(): void {}
// error: a type predicate's type must be assignable to its parameter's type, and 'boolean' isn't a 'i64 | string'
// case: predicates_asserts
function check(x: string | i64): asserts x is string {}
function main(): void {}
// error: assertion signatures are not supported yet
// case: predicates_lying_true
class Fish {
  fins: i64;
  constructor(fins: i64) { this.fins = fins; }
}
function isFish(p: Ref<Fish | string>): p is Fish {
  return true;
}
function main(): void {
  const p: Fish | string = "hello there";
  if (isFish(p)) console.log(p.fins);
}
// panic: the type predicate 'isFish' said 'p' is 'Fish', but it holds a 'string'
// case: predicates_lying_false
function isText(x: string | i64): x is string {
  return false;
}
function main(): void {
  const x: string | i64 = "dune";
  if (!isText(x)) console.log(x + 1);
}
// panic: the type predicate 'isText' said 'x' is not 'string', but it holds a 'string'
// case: predicates_lying_null_release
// mode: release
class Item {
  id: i64;
  constructor(id: i64) { this.id = id; }
}
function present(x: Ref<Item> | null): x is Ref<Item> {
  return true;
}
function main(): void {
  const r: Ref<Item> | null = null;
  if (present(r)) console.log(r.id);
}
// panic: the type predicate 'present' said 'r' is 'Ref<Item>', but it holds a 'null'
// case: predicates_lying_number
function isNum(x: i128 | bigint | u128): x is i128 {
  return typeof x === "number";
}
function main(): void {
  const big: u128 = 340282366920938463463374607431768211455;
  const vs: (i128 | bigint | u128)[] = [1n, 5 as i128, big];
  for (const v of vs) {
    if (isNum(v)) console.log("num", v + 1);
  }
}
// expect: num 6
// panic: the type predicate 'isNum' said 'v' is 'i128', but it holds a 'u128'
// case: predicates_honest_both_ways
function isText(x: string | i64 | boolean): x is string {
  return typeof x === "string";
}
function show(x: string | i64 | boolean): void {
  if (!isText(x)) {
    console.log("other", x);
    return;
  }
  console.log("text", x.length);
}
function main(): void {
  show("dune");
  show(3);
  show(true);
  const y: string | i64 | boolean = 7;
  console.log(isText(y) && y.length > 2, isText(y) ? y : "no");
}
// expect: text 4
// expect: other 3
// expect: other true
// expect: false no
// case: predicates_on_fields_and_literals
function isText(x: string | i64): x is string {
  return typeof x === "string";
}
class Holder {
  value: string | i64;
  constructor(value: string | i64) { this.value = value; }
  check(): boolean { return isText(this.value); }
}
function main(): void {
  const h = new Holder("fin");
  if (isText(h.value)) console.log("field");
  if (isText("lit")) console.log("literal");
  console.log(h.check());
}
// expect: field
// expect: literal
// expect: true
