// case: suggest_local
function main() {
  const count = 1;
  console.log(cont);  // error: cannot find name 'cont'; did you mean 'count'?
}
// case: suggest_parameter
function twice(total: i64): i64 {
  return totl * 2;  // error: cannot find name 'totl'; did you mean 'total'?
}
function main() {}
// case: suggest_outer_in_closure
function main() {
  const limit = 3;
  const f = () => limt + 1;  // error: cannot find name 'limt'; did you mean 'limit'?
}
// case: suggest_function
function helper(): i64 { return 1; }
function main() {
  console.log(helpr());  // error: unknown function 'helpr'; did you mean 'helper'?
}
// case: suggest_const
const LIMIT = 3;
function main() {
  console.log(LIMT);  // error: cannot find name 'LIMT'; did you mean 'LIMIT'?
}
// case: suggest_shorthand
function main() {
  const count = 1;
  const o = { cont };  // error: cannot find name 'cont'; did you mean 'count'?
}
// case: suggest_case_only
function main() {
  const myValues = 2;
  const myValue = 1;
  console.log(myvalue);  // error: cannot find name 'myvalue'; did you mean 'myValue'?
}
// case: suggest_out_of_scope
function main() {
  {
    const inner = 1;
  }
  console.log(iner);  // error: cannot find name 'iner'
}
// case: suggest_interface_type
interface Shape { area(): i64; }
function f(s: Shap): i64 { return 1; }  // error: cannot find type 'Shap'; did you mean 'Shape'?
function main() {}
// case: suggest_builtin_type
function main() {
  const s: strng = "a";  // error: cannot find type 'strng'; did you mean 'string'?
}
// case: suggest_type_parameter
function first<Item>(xs: Itm[]): i64 { return 1; }  // error: cannot find type 'Itm'; did you mean 'Item'?
function main() {}
// case: suggest_new
class Point { x: i64 = 0; }
function main() {
  const p = new Pont();  // error: only a class can be constructed with 'new'; did you mean 'Point'?
}
// case: suggest_extends
class Base {}
class Derived extends Bse {}  // error: cannot find class 'Bse'; did you mean 'Base'?
function main() {}
// case: suggest_field
class Order { total: i64 = 0; }
function main() {
  const o = new Order();
  console.log(o.totl);  // error: property 'totl' does not exist on type 'Order'; did you mean 'total'?
}
// case: suggest_object_field
function main() {
  const p = { name: "a" };
  console.log(p.nme);  // error: property 'nme' does not exist on type '{ name: string }'; did you mean 'name'?
}
// case: suggest_method
class Square { side: i64 = 2; area(): i64 { return this.side * this.side; } }
function main() {
  const s = new Square();
  console.log(s.ara());  // error: 'Square' has no method 'ara'; did you mean 'area'?
}
// case: suggest_getter
class Cart { get total(): i64 { return 1; } }
function main() {
  const c = new Cart();
  console.log(c.totl);  // error: property 'totl' does not exist on type 'Cart'; did you mean 'total'?
}
// case: suggest_inherited
class Base { width: i64 = 1; }
class Wide extends Base {}
function main() {
  const w = new Wide();
  console.log(w.widht);  // error: property 'widht' does not exist on type 'Wide'; did you mean 'width'?
}
// case: suggest_private_inside
class Vault {
  private secret: i64 = 1;
  peek(): i64 { return this.secrt; }  // error: property 'secrt' does not exist on type 'Vault'; did you mean 'secret'?
}
function main() {}
// case: suggest_static
class Maker { static make(): i64 { return 1; } }
function main() {
  console.log(Maker.mak());  // error: property 'mak' does not exist on type 'typeof Maker'; did you mean 'make'?
}
// case: suggest_bound_method
interface Shape { area(): i64; }
function measure<T extends Shape>(s: T): i64 { return s.are(); }  // error: property 'are' does not exist on type 'T'; did you mean 'area'?
function main() {}
// case: suggest_dyn_method
interface Shape { area(): i64; }
class Circle implements Shape { area(): i64 { return 3; } }
function main() {
  const d: Dyn<Shape> = new Circle();
  d.are();  // error: property 'are' does not exist on type 'Dyn<Shape>'; did you mean 'area'?
}
// case: suggest_enum_member
enum Color { Red, Green }
function main() {
  console.log(Color.Gren);  // error: property 'Gren' does not exist on enum 'Color'; did you mean 'Green'?
}
// case: suggest_array_method
function main() {
  const xs = [1];
  xs.pussh(2);  // error: arrays have no method 'pussh' yet; did you mean 'push'?
}
// case: suggest_array_length
function main() {
  const xs = [1];
  console.log(xs.lenght);  // error: property 'lenght' does not exist on type 'i64[]'; did you mean 'length'?
}
// case: suggest_string_method
function main() {
  const s = "a";
  console.log(s.toUpperCse());  // error: strings have no method 'toUpperCse' yet; did you mean 'toUpperCase'?
}
// case: suggest_map_method
function main() {
  const m = new Map<string, i64>();
  m.gett("a");  // error: 'Map' has no method 'gett' yet; did you mean 'get'?
}
// case: suggest_std_public_class
function main() {
  const e = new Eror("x");  // error: only a class can be constructed with 'new'; did you mean 'Error'?
}
// case: suggest_public_static_field
class Counter { static readonly limit: i64 = 3; static make(): i64 { return 1; } }
function main() {
  console.log(Counter.limt());  // error: property 'limt' does not exist on type 'typeof Counter'; did you mean 'limit'?
}
