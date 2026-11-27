// case: for_in_object
// expect: age
// expect: name
// expect: 2
// An object type's keys come in the order Fish lays its fields out, as 'Object.keys' gives them.
function main() {
  const o = { name: "ann", age: 3 };
  let n = 0;
  for (const k in o) {
    console.log(k);
    n++;
  }
  console.log(n);
}
// case: for_in_class
// expect: id name
// Bases' fields first, then the class's own in declaration order; private fields are left out.
class Base {
  id: i64 = 7;
}
class User extends Base {
  name: string = "ann";
  private secret: string = "x";
}
function main() {
  const u = new User();
  let keys: string[] = [];
  for (let k in u) keys.push(k);
  console.log(keys.join(" "));
}
// case: for_in_dictionary
// expect: b 1
// expect: a 2
// expect: c
// An index signature's keys come in the order they were made.
type Counts = { [k: string]: i64 };
function main() {
  let d: Counts = { b: 1, a: 2 };
  for (const k in d) console.log(k, d[k]!);
  let r: Record<string, boolean> = {};
  r["x"] = true;
  r["c"] = false;
  for (const k in r) {
    if (k === "x") continue;
    console.log(k);
    break;
  }
}
// case: for_in_outside
// error: 'for...in' loops over a variable declared outside them are not supported yet
function main() {
  const o = { a: 1 };
  let k = "";
  for (k in o) console.log(k);
}
// case: for_in_pattern
// error: a 'for...in' variable can't be a destructuring pattern
function main() {
  const o = { a: 1 };
  for (const [a] in o) console.log(a);
}
// case: for_in_annotation
// error: a 'for...in' variable can't have a type annotation
function main() {
  const o = { a: 1 };
  for (const k: string in o) console.log(k);
}
