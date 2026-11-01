// case: macro_keep_and_add
// expect: 1 2 3
macro function keep(input: Ast): Ast {
  return input;
}
macro function withExtra(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("extra")}(): i64 { return 2; }`];
}
@keep function one(): i64 { return 1; }
@withExtra function three(): i64 { return 3; }
function main() {
  console.log(one(), extra(), three());
}
// case: macro_rename
// expect: 7 renamed
macro function rename(input: AstStmt): AstStmt {
  let d = input;
  if (d.kind === "function") d.name = `${d.name}Renamed`;
  return d;
}
@rename function seven(): i64 { return 7; }
@rename export function named(): string { return "renamed"; }
function main() {
  console.log(sevenRenamed(), namedRenamed());
}
// case: macro_on_types_and_classes
// expect: 3 point
macro function described(input: Ast): Ast[] {
  if (input.kind === "class") return [input, quote`function ${ident("describe")}(): string { return "point"; }`];
  return [input];
}
macro function keep(input: Ast): Ast {
  return input;
}
@keep type Id = i64;
@keep interface Named { name: string }
@keep enum Color { Red, Green }
@described @keep class Point { x: i64 = 3; }
function main() {
  const id: Id = new Point().x;
  console.log(id, describe());
}
// case: macro_helpers_and_nested
// expect: 4
function count(): i64 {
  return 4;
}
macro function counted(input: Ast): Ast[] {
  const n = count();
  return n > 0 ? [input, quote`function ${ident("four")}(): i64 { return 4; }`] : [input];
}
macro function addsDecorated(input: Ast): Ast[] {
  return [input, quote`@counted function helper() {}`];
}
@addsDecorated function base() {}
function main() {
  console.log(four());
}
// case: macro_unknown
// error: 'nope' isn't a macro; a decorator applies a 'macro function nope(input: Ast): Ast'
@nope function f() {}
function main() {}
// case: macro_not_a_declaration
// error: the macro 'bad' gave a 'binary', but a macro gives declarations that can stand at the top level
macro function bad(input: Ast): Ast {
  return quote`1 + 2`;
}
@bad function f() {}
function main() {}
// case: macro_panics
// error: this comptime code panicked
macro function fails(input: Ast): Ast {
  const xs: i64[] = [];
  const x = xs[3];
  return input;
}
@fails function f() {}
function main() {}
// case: macro_uses_expansion
// error: the macro 'm' uses 'made', which a macro makes or changes; a macro can't depend on an expansion
macro function keep(input: Ast): Ast {
  return input;
}
@keep function made(): i64 { return 1; }
macro function m(input: Ast): Ast {
  const n = made();
  return input;
}
@m function f() {}
function main() {}
// case: macro_called
// error: 'keep' is a macro, applied to a declaration as '@keep'; it isn't called as a function
macro function keep(input: Ast): Ast {
  return input;
}
function main() {
  keep(quote`1`);
}
// case: macro_shape
// error: the macro 'two' takes 1 argument after what it is applied to, but this gives 0
macro function two(a: Ast, b: Ast): Ast {
  return a;
}
@two function f() {}
function main() {}
// case: macro_nested_declaration
// error: a macro applies to a top-level declaration
macro function keep(input: Ast): Ast {
  return input;
}
function main() {
  @keep function inner() {}
}
// case: macro_hygiene
// expect: 42 1 5
macro function counted(input: AstStmt): Ast[] {
  const name = input.kind === "function" ? `${input.name}Count` : "count";
  return [
    input,
    quote`function helper(): i64 { const total = 40; return total; }`,
    quote`function ${ident(name)}(): i64 { return helper() + 2; }`,
  ];
}
function helper(): i64 { return 1; }
@counted function items() {}
function main() {
  const total = 5;
  console.log(itemsCount(), helper(), total);
}
// case: macro_hygiene_private
// error: unknown function 'secret'
macro function withSecret(input: AstStmt): Ast[] {
  return [input, quote`function secret(): i64 { return 1; }`];
}
@withSecret function f() {}
function main() {
  console.log(secret());
}
// case: macro_hygiene_spliced_ident
// expect: 5
const total: i64 = 99;
macro function m(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const body = input.body.clone();
    if (body !== null) {
      const ret = body[0].clone();
      if (ret.kind === "return") {
        const v = ret.value;
        if (v !== null) return [
          quote`function ${ident("withTotal")}(): i64 { const ${ident("total")}: i64 = 5; return ${v.clone()}; }`,
          quote`function other(): i64 { const total: i64 = 1; return total; }`,
        ];
      }
    }
  }
  return [input];
}
@m function g(): i64 { return total; }
function main() {
  console.log(withTotal());
}
// case: macro_hygiene_match_binding
// expect: 10
const v: i64 = 10;
macro function wrap(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const body = input.body.clone();
    if (body !== null) {
      const ret = body[0].clone();
      if (ret.kind === "return") {
        const e = ret.value;
        if (e !== null) return [quote`function ${ident("w")}(o: i64): i64 { return match (o) { case v => ${e.clone()}, }; }`];
      }
    }
  }
  return [input];
}
@wrap function g(): i64 { return v; }
function main() {
  console.log(w(5));
}
// case: macro_quoted_mut_this
// expect: 2
macro function m(input: AstStmt): Ast[] {
  return [input,
    quote`class ${ident("Counter")} { n: i64 = 1; inc(this: Mut<this>) { this.n = this.n + 1; } }`];
}
@m function f() {}
function main() {
  let c = new Counter();
  c.inc();
  console.log(c.n);
}
// case: macro_quoted_shorthand
// expect: 1 2
type P = { x: i64; y: i64 };
macro function m(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("make")}(): P { const x = 1; return { x, y: 2 }; }`];
}
@m function f() {}
function main() {
  const p = make();
  console.log(p.x, p.y);
}
// case: macro_hygiene_type_parameter
// expect: hello
type T = string;
macro function wrap(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const r = input.returnType.clone();
    if (r !== null) return [input, quote`function ${ident("keepFirst")}<T>(a: ${r.clone()}, b: T): ${r.clone()} { return a; }`];
  }
  return [input];
}
@wrap function g(): T { return "x"; }
function main() {
  console.log(keepFirst("hello", 5));
}
// case: macro_hygiene_helper_quote
// expect: 42 1
function build(): AstStmt {
  return quote`function helper(): i64 { return 41; }`;
}
macro function m(input: AstStmt): Ast[] {
  return [input, build(), quote`function ${ident("answer")}(): i64 { return helper() + 1; }`];
}
function helper(): i64 { return 1; }
@m function f() {}
function main() {
  console.log(answer(), helper());
}
// case: macro_local_type_alias
// expect: 3
macro function m(input: Ast): Ast[] {
  type Name = string;
  const n: Name = "three";
  return [input, quote`function ${ident(n)}(): i64 { return 3; }`];
}
@m function f() {}
function main() {
  console.log(three());
}
// case: macro_adds_const_to_export
// expect: 3
macro function withConst(input: AstStmt): Ast[] {
  return [input, quote`const ${ident("THREE")}: i64 = 3;`];
}
@withConst export function f() {}
function main() { console.log(THREE); }
// case: macro_parameter_type
// error: a macro's parameter takes the declaration it is applied to, so its type is 'Ast' or 'AstStmt'
macro function m(input: AstExpr): Ast {
  return input;
}
@m function f() {}
function main() {}
// case: macro_generic
// error: a macro takes no type parameters
macro function m<T>(input: Ast): Ast {
  return input;
}
function main() {}
// case: macro_result_type
// error: a macro gives the declarations it makes, as an 'Ast' or an 'Ast[]', not 'i64'
macro function m(input: Ast): i64 {
  return 1;
}
@m function f() {}
function main() {}
// case: macro_literal_result_type
// error: a macro gives the declarations it makes, as an 'Ast' or an 'Ast[]', not '"x"'
macro function m(input: Ast): "x" {
  return "x";
}
@m function f() {}
function main() {}
// case: macro_user_ast_name
// expect: num
type AstExpr = { kind: "num" };
function main() {
  const e: AstExpr = { kind: "num" };
  console.log(e.kind);
}
// case: macro_two_quotes_local
// expect: 7 9
const y: i64 = 9;
macro function m(input: AstStmt): Ast[] {
  const decl = quote`const y: i64 = 7;`;
  return [input, quote`function ${ident("seven")}(): i64 { ${decl}; return y; }`];
}
@m function f() {}
function main() {
  console.log(seven(), y);
}
// case: macro_cap_match_binding
// expect: 10
const V: i64 = 10;
macro function wrap(input: AstStmt): Ast[] {
  if (input.kind === "function") {
    const body = input.body.clone();
    if (body !== null) {
      const ret = body[0].clone();
      if (ret.kind === "return") {
        const e = ret.value;
        if (e !== null) return [quote`function ${ident("w")}(o: i64): i64 { return match (o) { case V => ${e.clone()}, }; }`];
      }
    }
  }
  return [input];
}
@wrap function g(): i64 { return V; }
function main() {
  console.log(w(5));
}
// case: macro_same_start
// expect: x x
macro function sufA(input: AstStmt): AstStmt { let d = input; if (d.kind === "function") d.name = `${d.name}A`; return d; }
macro function sufB(input: AstStmt): AstStmt { let d = input; if (d.kind === "function") d.name = `${d.name}B`; return d; }
function make(dec: AstExpr, name: string): AstStmt {
  return quote`@${dec} function ${ident(name)}(): string { return "x"; }`;
}
macro function two(input: AstStmt): Ast[] {
  return [make(ident("sufA"), "a"), make(ident("sufB"), "b")];
}
@two function f() {}
function main() { console.log(aA(), bB()); }
// case: macro_quoted_top_const
// expect: 10
macro function m(input: AstStmt): Ast[] {
  return [input, quote`const LIMIT: i64 = 10;`, quote`function ${ident("limit")}(): i64 { return LIMIT; }`];
}
@m function f() {}
function main() {
  console.log(limit());
}
// case: macro_declare_single
// expect: 3
macro function withAbs(input: AstStmt): Ast[] {
  return [input, quote`declare function labs(x: i64): i64;`, quote`function ${ident("absOf")}(x: i64): i64 { return unsafe { labs(x) }; }`];
}
@withAbs function f() {}
function main() { console.log(absOf(-3)); }
// case: macro_quoted_const_export_single
// expect: 1
macro function m(input: AstStmt): Ast[] {
  return [input, quote`export function base(): i64 { return 1; }`, quote`function ${ident("viaBase")}(): i64 { return base(); }`];
}
@m function f() {}
function main() { console.log(viaBase()); }
// case: macro_other_macro_declares
// expect: 1 user
function helper(): string { return "user"; }
macro function a(input: AstStmt): Ast[] {
  return [input, quote`function helper(): i64 { return 1; }`, quote`function ${ident("viaA")}(): i64 { return helper(); }`];
}
macro function b(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("viaB")}(): string { return helper(); }`];
}
@a function f() {}
@b function g() {}
function main() {
  console.log(viaA(), viaB());
}
// case: macro_main_ref
// expect: ok
macro function m(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("again")}(): i64 { if (false) main(); return 1; }`];
}
@m function f() {}
function main() { console.log("ok"); }
// case: macro_stacked_pins_single
// expect: 1 base
function label(): string { return "base"; }
macro function keep(input: Ast): Ast { return input; }
macro function withLabel(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("described")}(): string { return label(); }`];
}
@keep @withLabel function one(): i64 { return 1; }
function main() { console.log(one(), described()); }
// case: macro_bare_variant
// expect: 7 0
enum Opt { Has(i64), Nothing }
macro function m(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("get")}(o: Opt): i64 { return match (o) { case Nothing => 0, case Has(v) => v, }; }`];
}
@m function f() {}
function main() { console.log(get(Opt.Has(7)), get(Opt.Nothing)); }
// case: macro_cross_quote_scope
// expect: 9
const value: i64 = 3;
macro function m(input: AstStmt): Ast[] {
  return [input,
    quote`function ${ident("sq")}(value: i64): i64 { return value * value; }`,
    quote`function ${ident("show")}(): i64 { return sq(value); }`];
}
@m function f() {}
function main() {
  console.log(show());
}
// case: macro_scope_through_clone
// expect: 7 7 9
const y: i64 = 9;
macro function seven(input: AstStmt): Ast[] {
  const decl = quote`const y = 7;`;
  return [input, quote`function ${ident("sevenA")}(): i64 { ${decl.clone()}; return y; }`, quote`function ${ident("sevenB")}(): i64 { ${decl}; return y; }`];
}
@seven function f() {}
function main() {
  console.log(sevenA(), sevenB(), y);
}
// case: macro_outer_param_in_inner
// expect: 5
macro function m(input: AstStmt): Ast[] {
  const body = quote`return x;`;
  return [input, quote`function ${ident("id")}(x: i64): i64 { ${body}; }`];
}
@m function f() {}
function main() { console.log(id(5)); }
// case: macro_outer_param_inner_pinned
// expect: 5
const x: i64 = 99;
macro function m(input: AstStmt): Ast[] {
  const body = quote`return x;`;
  return [input, quote`function ${ident("id")}(x: i64): i64 { ${body}; }`];
}
@m function f() {}
function main() { console.log(id(5)); }
// case: macro_helper_twice
// expect: 7 8
function decl(): AstStmt { return quote`const total: i64 = 7;`; }
macro function m(input: AstStmt): Ast[] {
  return [input,
    quote`function ${ident("seven")}(): i64 { ${decl()}; return total; }`,
    quote`function ${ident("eight")}(): i64 { ${decl()}; return total + 1; }`];
}
@m function f() {}
function main() { console.log(seven(), eight()); }
// case: macro_nested_two_levels
// expect: 7
macro function m(input: AstStmt): Ast[] {
  const inner = quote`const total: i64 = 7;`;
  const block = quote`if (true) { ${inner}; console.log(total); }`;
  return [input, quote`function ${ident("show")}() { ${block}; }`];
}
@m function f() {}
function main() { show(); }
// case: macro_arguments
// expect: 6 3 b
const BASE = 2;
macro function times(input: AstStmt, factor: i64, label: string, extra: AstExpr): Ast[] {
  const n = ident(label);
  const lit: AstExpr = { kind: "int", value: factor, start: 0, end: 0 };
  return [input, quote`function ${n}(): i64 { return ${extra} * ${lit}; }`];
}
macro function named(input: AstStmt, name: string): Ast[] {
  return [input, quote`function ${ident(name)}(): string { return "b"; }`];
}
@times(BASE + 1, "six", 2) function f() {}
@times(1, "three", 1 + 2) @named("bee") function g() {}
function main() {
  console.log(six(), three(), bee());
}
// case: macro_argument_count
// error: the macro 'named' takes 1 argument after what it is applied to, but this gives 2
macro function named(input: AstStmt, name: string): Ast {
  return input;
}
@named("a", "b") function f() {}
function main() {}
// case: macro_argument_type
// error: this argument is a 'i64', but the macro takes a 'string' here
macro function named(input: AstStmt, name: string): Ast {
  return input;
}
@named(1) function f() {}
function main() {}
// case: macro_members_and_params
// expect: 3 counted
// expect: 10 a.b
// expect: 4
// expect: 0
macro function counted(input: AstStmt, member: i64): Ast[] {
  return [input, quote`function ${ident("countedMember")}(): string { return "counted"; }`];
}
macro function getter(input: AstStmt, member: usize): AstStmt {
  let c = input;
  if (c.kind === "class") {
    const field = c.members[member].clone();
    if (field.kind === "field") {
      const n = field.name;
      if (typeof n === "string") c.members.push(getterOf(n));
    }
  }
  return c;
}
function getterOf(n: string): AstClassMember {
  const k = quote`class X { get ${ident(`${n}Twice`)}(): i64 { return this.${ident(n)} * 2; } }`;
  if (k.kind === "class") return k.members[0].clone();
  return { kind: "staticBlock", modifiers: [], decorators: [], body: [], start: 0, end: 0 };
}
macro function joined(input: AstStmt, sep: string): AstStmt {
  let c = input;
  if (c.kind === "class") {
    const sepNode: AstExpr = { kind: "string", value: sep, start: 0, end: 0 };
    c.members.push(getterNamed("joined", quote`this.a + ${sepNode} + this.b`));
  }
  return c;
}
function getterNamed(name: string, body: AstExpr): AstClassMember {
  const k = quote`class X { get ${ident(name)}(): string { return ${body}; } }`;
  if (k.kind === "class") return k.members[0].clone();
  return { kind: "staticBlock", modifiers: [], decorators: [], body: [], start: 0, end: 0 };
}
macro function nonNegative(input: AstStmt, param: usize): AstStmt {
  let f = input;
  if (f.kind === "function") {
    const p = f.params[param].pattern.clone();
    const body = f.body.clone();
    if (p.kind === "ident" && body !== null) {
      let guarded: AstStmt[] = [quote`if (${ident(p.name)} < 0) return 0;`];
      for (const s of body) guarded.push(s.clone());
      f.body = guarded;
    }
  }
  return f;
}
class Point {
  @getter x: i64 = 5;
  @counted y: i64 = 3;
}
@joined(".") class Pair {
  a: string = "a";
  b: string = "b";
}
function double(@nonNegative n: i64): i64 {
  return n * 2;
}
function main() {
  const p = new Point();
  console.log(p.y, countedMember());
  console.log(p.xTwice, new Pair().joined);
  console.log(double(2));
  console.log(double(-5));
}
// case: macro_member_without_index
// error: a macro on a member takes the class and the member's index
macro function keep(input: AstStmt): Ast {
  return input;
}
class A {
  @keep x: i64 = 1;
}
function main() {}
// case: macro_member_no_class
// error: a macro on a member gives the class back, changed as it likes, but 'drop' gave none
macro function drop(input: AstStmt, member: i64): Ast[] {
  return [];
}
class A {
  @drop x: i64 = 1;
}
function main() {}
// case: macro_method_parameter
// error: decorators on method and constructor parameters aren't supported yet
macro function keep(input: AstStmt, param: i64): Ast {
  return input;
}
class A {
  m(@keep x: i64) {}
}
function main() {}
// case: macro_member_replace_keeps_outer_decorators
// expect: HELLO extra ran
// expect: own ran
// a member macro that replaces its member: the member's outer decorator and the class's own should still apply
macro function loud(input: AstStmt, member: usize): AstStmt {
  let c = input;
  if (c.kind === "class") {
    const k = quote`class X { hello(): string { return "HELLO"; } }`;
    if (k.kind === "class") c.members[member] = k.members[0].clone();
  }
  return c;
}
macro function extra(input: AstStmt, member: i64): Ast[] {
  return [input, quote`function ${ident("extraRan")}(): string { return "extra ran"; }`];
}
macro function own(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("ownRan")}(): string { return "own ran"; }`];
}
macro function rebuild(input: AstStmt, member: i64): AstStmt {
  return quote`class C { hello(): string { return "rebuilt"; } }`;
}
class A {
  @extra @loud hello(): string { return "hello"; }
}
@own class B {
  @rebuild hello(): string { return "hello"; }
}
function main() { console.log(new A().hello(), extraRan()); console.log(ownRan()); }
// case: macro_member_replace_keeps_class_decorator
// expect: own ran
// a member macro that replaces its member: the member's outer decorator and the class's own should still apply
macro function loud(input: AstStmt, member: usize): AstStmt {
  let c = input;
  if (c.kind === "class") {
    const k = quote`class X { hello(): string { return "HELLO"; } }`;
    if (k.kind === "class") c.members[member] = k.members[0].clone();
  }
  return c;
}
macro function extra(input: AstStmt, member: i64): Ast[] {
  return [input, quote`function ${ident("extraRan")}(): string { return "extra ran"; }`];
}
macro function own(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("ownRan")}(): string { return "own ran"; }`];
}
macro function rebuild(input: AstStmt, member: i64): AstStmt {
  return quote`class ${ident("B")} { hello(): string { return "rebuilt"; } }`;
}
class A {
  @extra @loud hello(): string { return "hello"; }
}
@own class B {
  @rebuild hello(): string { return "hello"; }
}
function main() { console.log(ownRan()); }
// case: macro_inner_exports_outer_runs
// expect: 1 outer ran
// the inner macro gives the declaration back as an export; the outer decorator must still run
macro function exp(input: AstStmt): AstStmt {
  return quote`export ${input}`;
}
macro function also(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("ran")}(): string { return "outer ran"; }`];
}
@also @exp function f(): i64 { return 1; }
function main() { console.log(f(), ran()); }
// case: macro_defaulted_parameter
// expect: 1 1
// an optional and a defaulted macro parameter, the argument left out
macro function e(input: AstStmt, label: string = "dflt"): Ast[] {
  return [input, quote`function ${ident(label)}(): i64 { return 1; }`];
}
@e function f() {}
@e("given") function g() {}
function main() { console.log(dflt(), given()); }
// case: macro_u8_parameter_literal
// expect: ok
// u8 parameter given a literal
macro function small(input: AstStmt, v: u8): Ast {
  return input;
}
@small(5) function f() {}
function main() { console.log("ok"); }
// case: macro_many_member_macros
// expect: 64
macro function keep(input: AstStmt, member: i64): Ast { return input; }
@own class C {
  @keep f1: i64 = 1;
  @keep f2: i64 = 2;
  @keep f3: i64 = 3;
  @keep f4: i64 = 4;
  @keep f5: i64 = 5;
  @keep f6: i64 = 6;
  @keep f7: i64 = 7;
  @keep f8: i64 = 8;
  @keep f9: i64 = 9;
  @keep f10: i64 = 10;
  @keep f11: i64 = 11;
  @keep f12: i64 = 12;
  @keep f13: i64 = 13;
  @keep f14: i64 = 14;
  @keep f15: i64 = 15;
  @keep f16: i64 = 16;
  @keep f17: i64 = 17;
  @keep f18: i64 = 18;
  @keep f19: i64 = 19;
  @keep f20: i64 = 20;
  @keep f21: i64 = 21;
  @keep f22: i64 = 22;
  @keep f23: i64 = 23;
  @keep f24: i64 = 24;
  @keep f25: i64 = 25;
  @keep f26: i64 = 26;
  @keep f27: i64 = 27;
  @keep f28: i64 = 28;
  @keep f29: i64 = 29;
  @keep f30: i64 = 30;
  @keep f31: i64 = 31;
  @keep f32: i64 = 32;
  @keep f33: i64 = 33;
  @keep f34: i64 = 34;
  @keep f35: i64 = 35;
  @keep f36: i64 = 36;
  @keep f37: i64 = 37;
  @keep f38: i64 = 38;
  @keep f39: i64 = 39;
  @keep f40: i64 = 40;
  @keep f41: i64 = 41;
  @keep f42: i64 = 42;
  @keep f43: i64 = 43;
  @keep f44: i64 = 44;
  @keep f45: i64 = 45;
  @keep f46: i64 = 46;
  @keep f47: i64 = 47;
  @keep f48: i64 = 48;
  @keep f49: i64 = 49;
  @keep f50: i64 = 50;
  @keep f51: i64 = 51;
  @keep f52: i64 = 52;
  @keep f53: i64 = 53;
  @keep f54: i64 = 54;
  @keep f55: i64 = 55;
  @keep f56: i64 = 56;
  @keep f57: i64 = 57;
  @keep f58: i64 = 58;
  @keep f59: i64 = 59;
  @keep f60: i64 = 60;
  @keep f61: i64 = 61;
  @keep f62: i64 = 62;
  @keep f63: i64 = 63;
  @keep f64: i64 = 64;
}
macro function own(input: AstStmt): Ast { return input; }
function main() { console.log(new C().f64); }
// case: macro_member_outside_top_level
// error: a macro on a member applies in a top-level class
macro function keep(input: AstStmt, member: i64): Ast {
  return input;
}
function main() {
  class Local {
    @keep x: i64 = 1;
  }
}
// case: macro_outer_matches_inner_enum
// expect: light dark
// the inner macro gives an enum; the outer quotes a match on its members by bare name
macro function inner(input: AstStmt): Ast[] {
  return [input, quote`enum ${ident("Shade")} { Light, Dark }`];
}
macro function outer(input: AstStmt): Ast[] {
  return [input, quote`function ${ident("name")}(s: Shade): string { return match (s) { case Dark => "dark", case Light => "light" }; }`];
}
@outer @inner function f() {}
function main() { console.log(name(Shade.Light), name(Shade.Dark)); }
// case: macro_getter_and_setter_decorated
// expect: g1 on get@1
// expect: g2 on get@1
// expect: s1 on set@2
// expect: s2 on set@2
// getter and setter of the same name, each decorated; each macro adds a function named after its label and member kind
function kindAt(c: AstStmt, i: usize): string {
  if (c.kind === "class") {
    const m = c.members[i].clone();
    return m.kind;
  }
  return "?";
}
macro function note(input: AstStmt, member: usize, label: string): Ast[] {
  const lit: AstExpr = { kind: "string", value: `${label} on ${kindAt(input.clone(), member)}@${member}`, start: 0, end: 0 };
  return [input, quote`function ${ident(label)}(): string { return ${lit}; }`];
}
class A {
  n: i64 = 0;
  @note("g2") @note("g1") get v(): i64 { return this.n; }
  @note("s2") @note("s1") set v(x: i64) { this.n = x; }
}
function main() { console.log(g1()); console.log(g2()); console.log(s1()); console.log(s2()); }
// case: macro_member_insert_keeps_constructor_decorator
// expect: outer on constructor@2
// a member macro that inserts a member in front; the constructor's outer decorator must stay on the constructor
function kindAt(c: AstStmt, i: usize): string {
  if (c.kind === "class") {
    const m = c.members[i].clone();
    return m.kind;
  }
  return "?";
}
macro function note(input: AstStmt, member: usize, label: string): Ast[] {
  const lit: AstExpr = { kind: "string", value: `${label} on ${kindAt(input.clone(), member)}@${member}`, start: 0, end: 0 };
  return [input, quote`function ${ident(label)}(): string { return ${lit}; }`];
}
macro function front(input: AstStmt, member: usize): AstStmt {
  let c = input;
  if (c.kind === "class") {
    const k = quote`class X { pad: i64 = 0; }`;
    if (k.kind === "class") {
      let ms: AstClassMember[] = [k.members[0].clone()];
      for (const x of c.members) ms.push(x.clone());
      c.members = ms;
    }
  }
  return c;
}
class A {
  x: i64;
  @note("outer") @front constructor() { this.x = 1; }
  m(): i64 { return 2; }
}
function main() { console.log(outer()); }
// case: macro_syntax_parameter_default
// expect: 10 3
// a syntax parameter whose default is a quote
const LIMIT = 5;
macro function addFn(input: AstStmt, name: string, e: AstExpr = quote`LIMIT * 2`): Ast[] {
  return [input, quote`function ${ident(name)}(): i64 { return ${e}; }`];
}
@addFn("got") function f() {}
@addFn("given", 3) function g() {}
function main() { console.log(got(), given()); }
// case: macro_optional_parameters_left_out
// expect: n=-1 e=none
// an optional value parameter and an optional syntax parameter, left out
macro function opt(input: AstStmt, n?: i64, e?: AstExpr): Ast[] {
  const v = n ?? -1;
  let s = `n=${v}`;
  if (e === null) s = s + " e=none"; else s = s + " e=some";
  const lit: AstExpr = { kind: "string", value: s, start: 0, end: 0 };
  return [input, quote`function ${ident("got")}(): string { return ${lit}; }`];
}
@opt function f() {}
function main() { console.log(got()); }
// case: macro_removes_decorated_member
// error: a macro took away what these decorators were waiting to apply to
function kindAt(c: AstStmt, i: usize): string {
  if (c.kind === "class") {
    const m = c.members[i].clone();
    if (m.kind === "field" || m.kind === "method" || m.kind === "get" || m.kind === "set") {
      const n = m.name;
      if (typeof n === "string") return `${m.kind} ${n}`;
    }
    return m.kind;
  }
  if (c.kind === "function") return `fn ${c.name}`;
  return "?";
}
macro function note(input: AstStmt, member: usize, label: string): Ast[] {
  const lit: AstExpr = { kind: "string", value: `${label} on ${kindAt(input.clone(), member)}@${member}`, start: 0, end: 0 };
  return [input, quote`function ${ident(label)}(): string { return ${lit}; }`];
}
// a member macro that removes its member; the member's outer decorator must not move to another member
macro function del(input: AstStmt, member: usize): AstStmt {
  let c = input;
  if (c.kind === "class") {
    let ms: AstClassMember[] = [];
    for (let i = 0; i < c.members.length; i++) if (i as usize !== member) ms.push(c.members[i as usize].clone());
    c.members = ms;
  }
  return c;
}
class A {
  x: i64 = 1;
  @note("outer") @del y: i64 = 2;
  z(): i64 { return 3; }
}
function main() { console.log(outer()); }
