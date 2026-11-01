// case: ref_arguments
function f(r: Ref): i64 {
  return 1
}

function main() {}
// error: type 'Ref' takes the type it borrows, and optionally a lifetime
// case: ref_call_through_ref_field
class C {
  n = 1
  bump(this: Mut<this>) {
    this.n = this.n + 1
  }
}

type RC = { r: Ref<C> }

function main() {
  let c = new C()
  let h: RC = { r: c }
  h.r.bump()
}
// error: cannot call 'bump' on 'h.r' because it is a shared reference ('Ref'), which only reads
// case: ref_class_lifetimes
// A class may name its lifetime, and a function's result typed with it borrows only the
// arguments with that lifetime.
class P {
  x = 1
}

class Parser<A extends Lifetime> {
  src: Ref<P, A>
  constructor(src: Ref<P, A>) {
    this.src = src
  }
}

function parse<A extends Lifetime>(src: Ref<P, A>, other: Ref<P>): Parser<A> {
  return new Parser(src)
}

function main() {
  let a = new P()
  let b = new P()
  const parser = parse(a, b)
  b.x = 5
  print(parser.src.x, b.x)
}
// expect: 1 5
// case: ref_clone_holder
class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  const v: View = { r: p }
  const w = v.clone()
  p.x = 5
  print(w.r.x)
}
// error: cannot change 'p.x' while 'w' borrows 'p' and is used later
// case: ref_clone_mut
class P {
  x = 1
}

type View = { m: Mut<P> }

function main() {
  let p = new P()
  const v: View = { m: p }
  const w = v.clone()
}
// error: can't clone a value holding a mutable reference ('Mut')
// case: ref_field
// An object type can hold a reference.
type Holder = { r: Ref<i64> }

function main() {
  const n = 4
  const h: Holder = { r: n }
  print(h.r + 1)
}
// expect: 5
// case: ref_getter_holder
class P {
  x = 1
}

type View = { r: Ref<P> }

class Owner {
  p = new P()
  get view(): View {
    return { r: this.p }
  }
}

function main() {
  let o = new Owner()
  const v = o.view
  o.p.x = 42
  print(v.r.x)
}
// error: cannot change 'o.p.x' while 'v' borrows 'o' and is used later
// case: ref_keep_through_mut
class P {
  x = 1
}
type View = { r: Ref<P> }
class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
  set(this: Mut<this>, r: Ref<P>) {
    this.src = r
  }
}
function main() {
  const a = new P()
  let b = new P()
  let pp = new Parser(a)
  let m: Mut<Parser> = pp
  m.set(b)
  b.x = 9
  print(pp.src.x)
}
// error: keeping references through the reference 'm' is not supported yet
// case: ref_keep_through_this_mut
class P {
  x = 1
}
class Big {
  a = 9001
  b = 9002
  c = 9003
  d = 9004
  e = 9005
  f = 9006
  sum(): i64 {
    return this.a + this.b + this.c + this.d + this.e + this.f
  }
}
function clobber(): i64 {
  const big = new Big()
  const big2 = new Big()
  return big.sum() + big2.sum()
}
type View = { r: Ref<P> }
class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
  set(this: Mut<this>, r: Ref<P>) {
    this.src = r
  }
}
class Q {
  m: Mut<Parser>
  constructor(m: Mut<Parser>) {
    this.m = m
  }
  attach(this: Mut<this>, r: Ref<P>) {
    this.m.set(r)
  }
}
function g(pp: Mut<Parser>) {
  let local = new P()
  local.x = 42
  let q = new Q(pp)
  q.attach(local)
}
function main() {
  const a = new P()
  let pp = new Parser(a)
  g(pp)
  clobber()
  print(pp.src.x)
}
// error: keeping references through the reference 'this.m' is not supported yet
// case: ref_method_keeps
class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
  set(this: Mut<this>, r: Ref<P>) {
    this.src = r
  }
}

function main() {
  let a = new P()
  let b = new P()
  let q = new Parser(a)
  q.set(b)
  b.x = 9
  print(q.src.x)
}
// error: cannot change 'b.x' while 'q' borrows 'b' and is used later
// case: ref_own_clone_generic
class P {
  x = 1
}
class Big {
  a = 9001
  b = 9002
  c = 9003
  d = 9004
  e = 9005
  f = 9006
  sum(): i64 {
    return this.a + this.b + this.c + this.d + this.e + this.f
  }
}
function clobber(): i64 {
  const big = new Big()
  const big2 = new Big()
  return big.sum() + big2.sum()
}
type View = { r: Ref<P> }
class Own {
  p: P
  r: Ref<P>
  constructor(p: P, r: Ref<P>) {
    this.p = p
    this.r = r
  }
  clone(): Own {
    let q = new P()
    q.x = this.p.x
    return new Own(q, this.p)
  }
}
function dup<T>(t: T): T {
  return t.clone()
}
function make(a: Ref<P>): Own {
  let p = new P()
  p.x = 42
  return dup(new Own(p, a))
}
function main() {
  const a = new P()
  const o = make(a)
  clobber()
  print(o.r.x)
}
// error: can't return a reference to 't', which belongs to this function
// case: ref_ref
function f(r: Ref<Ref<i64>>): i64 {
  return 1
}

function main() {}
// error: references to references are not supported yet
// case: ref_return
// A function can return the reference it was given, elided to its only reference parameter.
function same(r: Ref<i64>): Ref<i64> {
  return r
}

function main() {
  const n = 4
  print(same(n) + 1)
}
// expect: 5
// case: ref_self_rebind
class P {
  x = 1
}

type View = { r: Ref<P> }

function id(v: View): View {
  return v
}

function main() {
  let a = new P()
  let h: View = { r: a }
  h = id(h)
  a.x = 5
  print(h.r.x)
}
// error: cannot change 'a.x' while 'h' borrows 'a' and is used later
// case: ref_setter_hold
class P {
  x = 1
}

class Holder {
  #r: Ref<P>
  constructor(r: Ref<P>) {
    this.#r = r
  }
  get r(): Ref<P> {
    return this.#r
  }
  set r(v: Ref<P>) {
    this.#r = v
  }
}

function main() {
  let a = new P()
  let b = new P()
  let h = new Holder(a)
  h.r = b
  b.x = 9
  print(h.r.x)
}
// error: cannot change 'b.x' while 'h' borrows 'b' and is used later
// case: ref_store_super
class P {
  x = 1
}

class Base {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
}

class Derived extends Base {
  constructor(p: P) {
    super(p)
  }
}

function main() {}
// error: can't store in 'this' a reference to 'p', which belongs to this function
// case: ref_store_this
class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
  reset(this: Mut<this>) {
    let local = new P()
    this.src = local
  }
}

function main() {}
// error: can't store in 'this' a reference to 'local', which belongs to this function
// case: ref_store_this_owned
class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(p: P) {
    this.src = p
  }
}

function main() {}
// error: can't store in 'this' a reference to 'p', which belongs to this function
// case: ref_to_holder
class P {
  x = 1
}

type View = { r: Ref<P>; n: i64 }

function f(p: Ref<P>): Ref<View> {
  const v: View = { r: p, n: 1 }
  const rv: Ref<View> = v
  return rv
}

function main() {}
// error: can't return a reference to 'v', which belongs to this function
// case: ref_to_ref_type_argument
class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  peek(): Ref<T> {
    return this.v
  }
}

function main() {
  const n = 1
  const r: Ref<i64> = n
  const b = new Box(r)
}
// error: references to references are not supported yet
// case: ref_type_arguments
// References as type arguments: a generic box and a generic identity keep their source
// borrowed like the reference itself.
class P {
  x = 3
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  get(): T {
    return this.v.clone()
  }
}

function id<T>(t: T): T {
  return t
}

function main() {
  const p = new P()
  const b = new Box(p.clone())
  const r: Ref<P> = p
  const boxed = new Box(r)
  const same = id(r)
  print(b.get().x, boxed.v.x, same.x)
}
// expect: 3 3 3
// case: ref_type_arguments_borrow
class P {
  x = 3
}

class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
}

function main() {
  let p = new P()
  const r: Ref<P> = p
  const boxed = new Box(r)
  p.x = 4
  print(boxed.v.x)
}
// error: cannot change 'p.x' while 'boxed' borrows 'p' and is used later
// case: ref_type_name
type Ref = { x: i64 }

function main() {}
// error: 'Ref' is a built-in type
// case: ref_types
// `Ref<T>` and `Mut<T>` annotate parameters and locals.
type P = { x: i64 }

function look(r: Ref<P>, m: Mut<P>, n: Ref<i64>): i64 {
  return 1
}

function main() {
  print(2)
}
// expect: 2
// case: ref_union
function f(u: Ref<i64> | boolean): i64 {
  return 1
}

function main() {}
// error: unions holding references are not supported yet
// case: ref_values
// Classes and object literals hold references, read and call through them, and take new ones.
class Source {
  text = 7
  peek(): i64 {
    return this.text
  }
}

class Parser {
  src: Ref<Source>
  pos = 0
  constructor(src: Ref<Source>) {
    this.src = src
  }
  next(this: Mut<this>): i64 {
    this.pos = this.pos + 1
    return this.src.peek() + this.pos
  }
}

function main() {
  const a = new Source()
  let b = new Source()
  b.text = 10
  let p = new Parser(a)
  const first = p.next()
  p.src = b
  const second = p.next()
  const view = { s: a, n: 1 }
  print(first, second, view.s.text + view.n)
}
// expect: 8 12 8
// case: ref_values_copy_holder
class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  const v: View = { r: p }
  const w = v
  p.x = 2
  print(w.r.x)
}
// error: cannot change 'p.x' while 'w' borrows 'p' and is used later
// case: ref_values_field_assign
class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  let q = new P()
  let v: View = { r: q }
  v.r = p
  p.x = 2
  print(v.r.x)
}
// error: cannot change 'p.x' while 'v' borrows 'p' and is used later
// case: ref_values_holder
class P {
  x = 1
}

class Parser {
  src: Ref<P>
  constructor(src: Ref<P>) {
    this.src = src
  }
}

function main() {
  let p = new P()
  const parser = new Parser(p)
  p.x = 2
  print(parser.src.x)
}
// error: cannot change 'p.x' while 'parser' borrows 'p' and is used later
// case: ref_values_holder_ok
// A value holding a reference keeps it borrowed only until its last use, and copies of it
// and values it is moved into keep it borrowed in turn.
class P {
  x = 1
}

type View = { r: Ref<P> }

function main() {
  let p = new P()
  const v: View = { r: p }
  const w = v
  print(w.r.x)
  p.x = 2
  let q = new P()
  let h: View = { r: q }
  print(h.r.x, p.x)
}
// expect: 1
// expect: 1 2
// case: ref_values_more
// Nested holder-building calls, shorthands lent to reference fields, references read out of
// holder parameters, object literals passed to holder parameters, and class lifetimes used
// by methods.
class P {
  x = 1
}

type View = { r: Ref<P> }
type Wrap = { v: View }

function view(p: Ref<P>): View {
  return { r: p }
}

function wrap(v: View): Wrap {
  return { v }
}

function make(p: Ref<P>): Wrap {
  return wrap(view(p))
}

function get(v: View): Ref<P> {
  return v.r
}

function look(v: View): i64 {
  return v.r.x
}

class Parser<A extends Lifetime> {
  src: Ref<P, A>
  constructor(src: Ref<P, A>) {
    this.src = src
  }
  source(): Ref<P, A> {
    return this.src
  }
  again(): Parser<A> {
    return new Parser(this.src)
  }
}

function main() {
  const a = new P()
  const w = make(a)
  const b = new P()
  const s: View = { r: a }
  const shorthand: { b: Ref<P> } = { b }
  const parser = new Parser(a)
  print(w.v.r.x, get(s).x, look({ r: a }), parser.again().source().x, shorthand.b.x)
}
// expect: 1 1 1 1 1
// case: ref_values_move_out
class Inner {
  v = 0
}

class P {
  inner = new Inner()
}

type Holder = { r: Ref<P> }

function take(i: Inner): i64 {
  return i.v
}

function main() {
  const p = new P()
  const h: Holder = { r: p }
  print(take(h.r.inner))
}
// error: 'h.r.inner' can't be moved out of 'h.r', which only borrows it
// case: ref_values_return
// A function can return a value holding references into its parameters; the caller keeps
// them borrowed while the value is used.
class P {
  x = 1
}

type View = { r: Ref<P>; n: i64 }

function view(p: Ref<P>, n: i64): View {
  return { r: p, n }
}

function main() {
  const p = new P()
  const v = view(p, 3)
  print(v.r.x + v.n)
}
// expect: 4
// case: ref_values_return_caller
class P {
  x = 1
}

type View = { r: Ref<P> }

function view(p: Ref<P>): View {
  return { r: p }
}

function main() {
  let p = new P()
  const v = view(p)
  p.x = 2
  print(v.r.x)
}
// error: cannot change 'p.x' while 'v' borrows 'p' and is used later
// case: ref_values_return_local
class P {
  x = 1
}

type View = { r: Ref<P> }

function view(p: Ref<P>): View {
  const local = new P()
  return { r: local }
}

function main() {}
// error: can't return a reference to 'local', which belongs to this function
// case: ref_values_union
function f(u: Ref<i64> | boolean): i64 {
  return 1
}

function main() {}
// error: unions holding references are not supported yet
// case: ref_values_write_through
class P {
  x = 0
}

type Holder = { r: Ref<P> }

function main() {
  let p = new P()
  let h: Holder = { r: p }
  h.r.x = 2
}
// error: cannot assign to 'h.r.x' because 'h.r' is a shared reference ('Ref'), which only reads
// case: ref_void
function f(r: Ref<void>): i64 {
  return 1
}

function main() {}
// error: there is no 'void' value to borrow
// case: ref_lent_to_method_of_holder_without_refs
// A method that changes its object keeps nothing lent to it when the object holds no references.
type Token = { start: usize; text: string }
class Lexer {
  scanned = 0
  again(this: Mut<this>, from: Ref<Token>): Token {
    this.scanned++
    return { start: from.start + 1, text: from.text }
  }
}
class Cursor {
  lex = new Lexer()
  tokens: Token[] = []
  rescan(this: Mut<this>) {
    const slash: Token = { start: 1, text: "/" }
    this.tokens.push(this.lex.again(slash))
  }
}
function main() {
  let c = new Cursor()
  c.rescan()
  print(c.tokens.length, c.tokens[0]!.start, c.lex.scanned)
}
// expect: 1 2 1
