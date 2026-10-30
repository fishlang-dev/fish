// case: closures_throw_direct
// An arrow declares what it throws after its return type; a call of it raises that error.
class ParseError {
  constructor(public text: string) {}
}
function main() {
  const parse = (s: string): i64 throws ParseError => {
    if (s === "one") return 1
    throw new ParseError(s)
  }
  try {
    print(parse("one"))
    print(parse("two"))
  } catch (e) {
    print("bad", e.text)
  }
}
// expect: 1
// expect: bad two
// case: closures_throw_inferred
// With no function type to take it from, an arrow's error is inferred from its body.
function main() {
  const check = (n: i64) => {
    if (n < 0) throw "negative"
    return n * 2
  }
  try {
    print(check(4))
    print(check(-1))
  } catch (e) {
    print("caught", e)
  }
}
// expect: 8
// expect: caught negative
// case: closures_throw_propagate
// A throwing closure's call propagates out of a function that throws the same type.
function run(n: i64): i64 throws string {
  const f = (x: i64) => x > 0 ? x : throw "not positive"
  return f(n) + 1
}
function main() {
  try {
    print(run(2))
    print(run(0))
  } catch (e) {
    print(e)
  }
}
// expect: 3
// expect: not positive
// case: closures_throw_captures
// A closure capturing variables throws, and what it captures is still dropped.
function main() {
  const limit = 3
  const label = "too big: "
  const f = (n: i64): i64 throws string => {
    if (n > limit) throw label + String(n)
    return n
  }
  try {
    print(f(2))
    print(f(9))
  } catch (e) {
    print(e)
  }
}
// expect: 2
// expect: too big: 9
// case: closures_throw_parameter
// A function type's throws clause: the callback given takes it, and the call raises it.
function apply(f: (x: i64) => i64 throws string, x: i64): i64 throws string {
  return f(x) * 10
}
function main() {
  try {
    print(apply((x) => x + 1, 1))
    print(apply((x) => x > 5 ? x : throw "small", 2))
  } catch (e) {
    print("caught", e)
  }
}
// expect: 20
// expect: caught small
// case: closures_throw_parameter_quiet
// A closure that throws nothing fits a throwing function type.
function apply(f: (x: i64) => i64 throws string, x: i64): i64 throws string {
  return f(x)
}
function main() {
  const double = (x: i64) => x * 2
  try {
    print(apply(double, 21))
  } catch (e) {
    print(e)
  }
}
// expect: 42
// case: closures_throw_from
// A callable's error is wrapped by the caller's error class through From, as a named function's is.
class DbError {
  constructor(public code: i64) {}
}
class ApiError implements From<DbError> {
  constructor(public status: i64) {}
  static from(e: DbError): ApiError {
    return new ApiError(500 + e.code)
  }
}
function handle(query: (n: i64) => i64 throws DbError, n: i64): i64 throws ApiError {
  return query(n)
}
function main() {
  const query = (n: i64): i64 throws DbError => n < 0 ? throw new DbError(4) : n
  try {
    print(handle(query, 7))
    print(handle(query, -1))
  } catch (e) {
    print("api", e.status)
  }
}
// expect: 7
// expect: api 504
// case: closures_throw_field
// A stored callable in a field throws through its call.
class Job {
  run: (n: i64) => i64 throws string
  constructor(run: (n: i64) => i64 throws string) {
    this.run = run
  }
}
function main() {
  const job = new Job((n) => n === 0 ? throw "zero" : 100 / n)
  try {
    print(job.run(4))
    print(job.run(0))
  } catch (e) {
    print("caught", e)
  }
}
// expect: 25
// expect: caught zero
// case: closures_throw_array
// Stored callables in an array, one throwing and one not, through the same function type.
function main() {
  const steps: ((n: i64) => i64 throws string)[] = [(n) => n + 1, (n) => n > 2 ? throw "too far" : n * 2]
  let n = 1
  try {
    for (const step of steps) {
      n = step(n)
      print(n)
    }
    for (const step of steps) {
      n = step(n)
      print(n)
    }
  } catch (e) {
    print("stopped", e)
  }
}
// expect: 2
// expect: 4
// expect: 5
// expect: stopped too far
// case: closures_throw_stored_quiet
// A closure that throws nothing stored as a throwing callable is adapted to its result.
function main() {
  const f: (s: string) => string throws i64 = (s) => s + "!"
  try {
    print(f("hi"))
  } catch (e) {
    print(e)
  }
}
// expect: hi!
// case: closures_throw_stored_widen
// A stored callable's error widens to the union its function type throws.
function main() {
  const f: () => i64 throws string | boolean = (): i64 throws string => throw "no"
  try {
    print(f())
  } catch (e) {
    if (typeof e === "string") print("string", e)
  }
}
// expect: string no
// case: closures_throw_unhandled
// A call of a throwing closure needs a catch or a throws clause.
function main() {
  const f = (): i64 throws string => throw "x"
  print(f())
}
// error: 'main' must declare 'throws string' after its return type since 'f' can throw 'string', or catch it with try/catch
// case: closures_throw_context_quiet
// An arrow given as a function type that throws nothing can't throw.
function apply(f: (x: i64) => i64, x: i64): i64 {
  return f(x)
}
function main() {
  print(apply((x) => x > 0 ? x : throw "no", 1))
}
// error: this closure throws 'string', but the closure is given as '(x: i64) => i64', which throws nothing; catch it inside the closure with try/catch
// case: closures_throw_mismatch
// A closure throwing what a function type doesn't throw doesn't fit it.
function main() {
  const f = (): i64 throws string => throw "x"
  const g: () => i64 = f
}
// error: is not assignable
// case: closures_throw_written_context
// A written throws clause the function type it is given as doesn't take is refused there.
function apply(f: (x: i64) => i64 throws boolean, x: i64): i64 throws boolean {
  return f(x)
}
function main() {
  try {
    print(apply((x: i64): i64 throws string => throw "no", 1))
  } catch (e) {}
}
// error: this closure throws 'string', but it is given as '(x: i64) => i64 throws boolean', which throws 'boolean'; catch it inside the closure with try/catch
// case: closures_throw_callback
// A built-in method's callback is given as a function type that throws nothing.
function f(x: i64): i64 throws string {
  return x > 0 ? x : throw "no"
}
function main() {
  print([1, 2].map((x) => f(x)))
}
// error: 'f' can throw 'string', but the closure is given as '(value: i64, index: i64) => void', which throws nothing
// case: closures_throw_wrong_type
// A closure's written error type takes only what fits it.
function main() {
  const f = (): i64 throws string => throw true
}
// error: this 'throw' throws 'boolean', which isn't the 'string' that this closure throws; convert it to 'string'
// case: closures_throw_nested
// A nested function declares what it throws, as a top-level one does.
function main() {
  function half(n: i64): i64 throws string {
    if (n % 2 !== 0) throw "odd"
    return n / 2
  }
  try {
    print(half(8))
    print(half(3))
  } catch (e) {
    print(e)
  }
}
// expect: 4
// expect: odd
// case: closures_throw_nested_undeclared
// A nested function doesn't infer what it throws.
function main() {
  function half(n: i64): i64 {
    if (n % 2 !== 0) throw n
    return n / 2
  }
}
// error: 'half' must declare 'throws i64' after its return type to throw here
// case: closures_throw_generic
// A generic function's error type parameter is decided by the closure it is given.
function attempt<E>(f: () => i64 throws E): i64 throws E {
  return f() + 1
}
function main() {
  try {
    print(attempt<string>(() => 1))
    print(attempt((): i64 throws string => throw "failed"))
  } catch (e) {
    print(e)
  }
}
// expect: 2
// expect: failed
// case: closures_throw_async
// An async arrow's inferred error comes with its future, at the await.
async function main() {
  const f = async (n: i64) => {
    if (n < 0) throw "negative"
    return n
  }
  try {
    const a = await f(1)
    print(a)
    const b = await f(-1)
    print(b)
  } catch (e) {
    print(e)
  }
}
// expect: 1
// expect: negative
// case: closures_throw_generic_family
// A generic function type can't throw yet.
function g(f: <T>(x: T) => T throws string) {}
function main() {}
// error: generic function types that throw are not supported yet
// case: closures_throw_promise
// A function type giving a Promise throws at the await, not at the call.
function g(f: () => Promise<i64> throws string) {}
function main() {}
// error: function types giving a Promise that throw are not supported yet
// case: closures_throw_forward
// A throwing callable passes on to a function type that throws more, and a stored one to a parameter.
function inner(f: (x: i64) => i64 throws string | boolean, x: i64): i64 throws string | boolean { return f(x) }
function outer(f: (x: i64) => i64 throws string, x: i64): i64 throws string | boolean { return inner(f, x) }
function viaStored(g: (x: i64) => i64 throws string, x: i64): i64 throws string { return g(x) }
function main() {
  const s: (x: i64) => i64 throws string = (x) => x < 0 ? throw "stored" : x
  const t = s
  try {
    print(viaStored(t.clone(), 5))
    print(viaStored(t, -5))
  } catch (e) { print(e) }
  try {
    print(outer((x) => x === 0 ? throw "zero" : x, 3))
    print(outer((x) => x === 0 ? throw "zero" : x, 0))
  } catch (e) {
    if (typeof e === "string") print("s", e)
  }
}
// expect: 5
// expect: stored
// expect: 3
// expect: s zero
// case: closures_throw_nested_recursive
// A nested function that throws can call itself, the error raised at each call.
function main() {
  function fact(n: i64): i64 throws string {
    if (n < 0) throw "negative"
    return n === 0 ? 1 : n * fact(n - 1)
  }
  function walk(n: i64): i64 throws string {
    if (n < 0) throw "neg"
    if (n === 0) return 0
    try {
      return walk(n - 1) + 1
    } catch (e) {
      return -100
    }
  }
  try {
    print(fact(5))
    print(walk(3))
    print(fact(-1))
  } catch (e) {
    print(e)
  }
}
// expect: 120
// expect: 3
// expect: negative
// case: closures_throw_object_literal
// An object literal with no type stores a throwing closure as a callable that throws.
function main() {
  const f = (n: i64): i64 throws string => n > 0 ? throw "positive" : n
  const o = { run: f, check: (n: i64) => n === 0 ? throw "zero" : n }
  try {
    print(o.run(-2))
    print(o.check(5))
    print(o.check(0))
  } catch (e) {
    print("caught", e)
  }
}
// expect: -2
// expect: 5
// expect: caught zero
// case: closures_throw_object_literal_quiet
// A throwing callable in an object doesn't fit an object type whose callable throws nothing.
function g(o: { run: (n: i64) => i64 }): i64 {
  return o.run(1)
}
function main() {
  const f = (n: i64) => n > 0 ? throw "x" : n
  print(g({ run: f }))
}
// error: argument of type '{ run: (n: i64) => i64 throws string }' is not assignable to parameter of type '{ run: (n: i64) => i64 }'
// case: closures_throw_stored_relay
// A stored callable becomes a stored one that throws, or throws more, through an adapter.
class Box {
  f: () => i64 throws string | boolean
  constructor(f: () => i64 throws string | boolean) {
    this.f = f
  }
}
function keep(f: () => i64 throws string): () => i64 throws string {
  const k: () => i64 throws string = f
  return k
}
function main() {
  const g: () => i64 = () => 41
  const h: () => i64 throws string = g.clone()
  const fail: () => i64 throws string = () => throw "failed"
  const box = new Box(fail.clone())
  const kept = keep(g.clone())
  let fs: ((n: i64) => i64 throws string)[] = [(n) => n > 1 ? throw "big" : n]
  const triple: (n: i64) => i64 = (n) => n * 3
  fs.push(triple)
  try {
    print(h() + 1)
    print(kept())
    print(fs[1](5))
    print(h.clone()())
    print(box.f())
  } catch (e) {
    if (typeof e === "string") print("caught", e)
  }
}
// expect: 42
// expect: 41
// expect: 15
// expect: 41
// expect: caught failed
// case: closures_throw_async_context
// An async arrow that throws can't be given as a function type whose Promise throws nothing.
async function main() {
  setTimeout(async () => { throw "boom" }, 1)
}
// error: this async closure throws 'string', but it is given as '() => Promise<void>', whose Promise throws nothing; catch it inside the closure with try/catch
// case: closures_throw_relay_borrowed
function make(s: string): () => string {
  return move () => s + "!";
}
function main() {
  const fs: (() => string)[] = [make("a")];
  for (const f of fs) {
    const t: () => string throws string = f;
    try {
      console.log(t());
    } catch (e) {
      console.log(e);
    }
  }
}
// error: can't move a value out of a reference to it into a Dyn, since the reference only borrows it; use '.clone()' to hand over a copy
// case: closures_throw_relay_cloned
function make(s: string): () => string {
  return move () => s + "!";
}
function main() {
  const fs: (() => string)[] = [make("a")];
  for (const f of fs) {
    const t: () => string throws string = f.clone();
    try {
      console.log(t());
    } catch (e) {
      console.log(e);
    }
  }
}
// expect: a!
