// case: index_signatures_entries
// expect: 3 5 null
// expect: true false
// expect: true false
// expect: [ 'ann', 'bo b', 'cy' ] 12
// expect: [ [ 'ann', 3 ], [ 'bo b', 4 ], [ 'cy', 5 ] ]
// expect: 4
// expect: { ann: 3, 'bo b': 4, cy: 5, size: 1 }
// expect: {"ann":3,"bo b":4,"cy":5,"size":1}
// A dictionary's entries read as an Option, written, tested with 'in' and deleted, through 'o[k]'
// or 'o.k', kept in the order they were made, and printed as the object they are.
type Scores = { [name: string]: i64 };
function total(s: Ref<Scores>): i64 {
  let n = 0;
  for (const v of Object.values(s)) n += v;
  return n;
}
function main() {
  let s: Scores = { ann: 3, "bo b": 4 };
  s["cy"] = 5;
  s.dee = 6;
  console.log(s["ann"], s.cy, s["zz"]);
  console.log("ann" in s, "zz" in s);
  console.log(delete s.dee, delete s["dee"]);
  console.log(Object.keys(s), total(s));
  console.log(Object.entries(s));
  const k = "ann";
  const got = s[k];
  if (got !== null) console.log(got + 1);
  s.size = 1;
  console.log(s);
  console.log(JSON.stringify(s));
}
// case: index_signatures_record
// expect: { a: { b: { c: [Object] } } }
// expect: {} 0
// expect: Bag { items: { k: 'v' } } v
// expect: { x: 2, y: 1 } 2
// expect: 7
// expect: { n: 5 }
// expect: a [ 'p' ]
// 'Record<string, V>' is the same dictionary: in fields, behind Mut, inferred through a generic
// parameter, read from JSON, and made from an object literal written where one is expected.
type D = Record<string, i64>;
type Deep = { [k: string]: { [k: string]: { [k: string]: D } } };
class Bag {
  items: Record<string, string> = {};
  add(this: Mut<this>, k: string, v: string) { this.items[k] = v; }
}
function make(): D { return { x: 1 }; }
function bump(d: Mut<D>, k: string) { d[k] = (d[k] ?? 0) + 1; }
function count<T>(d: Ref<Record<string, T>>): usize { return Object.keys(d).length; }
function main(): void throws JsonError {
  const deep: Deep = { a: { b: { c: { d: 1 } } } };
  console.log(deep);
  const e: D = {};
  console.log(e, count(e));
  let b = new Bag();
  b.add("k", "v");
  console.log(b, b.items.k);
  let d = make();
  bump(d, "x");
  bump(d, "y");
  console.log(d, count(d));
  const p = JSON.parse<D>("{\"q\": 7}");
  console.log(p.q);
  const n = 5;
  const short: D = { n };
  console.log(short);
  let lists: { [k: string]: string[] } = { a: ["p"] };
  for (const [key, v] of Object.entries(lists)) console.log(key, v);
}
// case: index_signatures_const
// error: cannot add to 'd' because it is a constant
type D = { [k: string]: i64 };
function main() { const d: D = { a: 1 }; d.b = 2; }
// case: index_signatures_ref
// error: cannot add to 'd' because 'd' is a shared reference ('Ref'), which only reads
type D = { [k: string]: i64 };
function f(d: Ref<D>) { d["x"] = 1; }
function main() {}
// case: index_signatures_update
// error: a dictionary's entry is read as an Option, so it isn't updated in place; read it, then write it back, as in 'd.a = (d.a ?? 0) + 1'
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; d.a += 1; }
// case: index_signatures_increment
// error: a dictionary's entry is read as an Option, so it isn't updated in place
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; d["a"]++; }
// case: index_signatures_write_value
// error: writing a dictionary's entry gives no value to use, so write it as a statement of its own
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; const x = d["a"] = 2; }
// case: index_signatures_loop
// error: a dictionary can't be looped over or spread, as a plain object can't; use 'Object.keys', 'Object.values' or 'Object.entries'
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; for (const [k, v] of d) console.log(k, v); }
// case: index_signatures_spread
// error: a dictionary can't be looped over or spread
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; const xs = [...d]; }
// case: index_signatures_method
// error: a dictionary has no methods, as a plain object has none; its keys are read as properties, like 'd[k]'
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; console.log(d.get("a")); }
// case: index_signatures_not_map
// error: type '{ [key: string]: i64 }' is not assignable to type 'Map<string, i64>'
type D = { [k: string]: i64 };
function main() { let d: D = { a: 1 }; const m: Map<string, i64> = d; }
// case: index_signatures_value_type
// error: type '"x"' is not assignable to type 'i64'
function main() { let d: Record<string, i64> = { a: 1, b: "x" }; }
// case: index_signatures_number_key
// error: an index signature is keyed by 'string' so far; for keys of another type use a 'Map', or an array for consecutive numbers
function main() { let d: { [i: i64]: string } = {}; }
