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
