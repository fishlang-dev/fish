// case: narrowing
type Dir = "up" | "down" | i64

function describe(x: i64 | boolean): i64 {
  if (typeof x === "number") {
    return x * 10
  }
  return x ? 1 : 0
}

function step(d: Dir): i64 {
  if (d === "up") return 1
  if (d === "down") return -1
  // Only the i64 is left.
  return d
}

function both(a: i64 | boolean, b: i64 | boolean): i64 {
  if (typeof a === "number" && typeof b === "number") return a + b
  if (typeof a === "boolean" || typeof b === "boolean") return -1
  return 0
}

function main() {
  print(describe(4), describe(true), describe(false))
  print(step("up"), step("down"), step(7))
  print(both(1, 2), both(true, 2))
  const x: i64 | boolean = 5
  const doubled = typeof x === "number" ? x * 2 : 0
  print(doubled, typeof x !== "boolean" && x > 3)
  let y: i64 | boolean = false
  if (!(typeof y === "number")) {
    print(y)
  }
  const d: Dir = 3
  while (typeof d === "number" && d < 0) {
    print(d)
  }
  print(d === 3, d === "up", d !== 4)
}
// expect: 40 1 0
// expect: 1 -1 7
// expect: 3 -1
// expect: 10 true
// expect: false
// expect: true false true
// case: narrowing_needed
function f(x: i64 | boolean): i64 {
  return x * 2
}

function main() {}
// error: operator '*' cannot be applied to types 'boolean | i64' and 'i64'
// case: narrowing_reassigned
// A check narrows a reassigned variable until its next assignment.
function main() {
  let x: i64 | boolean = 1
  if (typeof x === "number") {
    print(x + 1)
  }
  x = true
}
// expect: 2
// case: narrowing_kind_among_literals
// A member whose discriminant is one of several literals is left out by a test for another.
type T = { kind: "ref"; name: string } | { kind: "union" | "intersection"; n: i64 };
function show(t: T): string {
  switch (t.kind) {
    case "ref": return t.name;
    case "union": return `union ${t.n}`;
  }
  if (t.kind === "intersection") return `intersection ${t.n}`;
  return "none";
}
function main() {
  print(show({ kind: "ref", name: "a" }), show({ kind: "union", n: 1 }), show({ kind: "intersection", n: 2 }))
}
// expect: a union 1 intersection 2
// case: narrowing_reassigned_assignments
// An assignment narrows a variable to the members its value can be, a parameter included, and
// branches that both reach their end join.
type E = { kind: "member"; object: E; name: string } | { kind: "ident"; name: string }
function root(e: E): string {
  while (e.kind === "member") e = e.object
  return e.name
}
function unfold(t: string | i64): string | i64 { return t }
function show(to: string | i64): string {
  to = unfold(to)
  if (typeof to === "string") return to
  return `${to + 1}`
}
function pick(i: i64): string | i64 { return i % 2 === 0 ? `s${i}` : i }
function main() {
  let x: string | i64 | null = null
  x = "abc"
  console.log(x.length)
  x = 4
  console.log(x + 1)
  let y: string | i64 = 1
  if (x > 2) y = "a"
  else y = "b"
  console.log(y.length)
  let w: string | null = null
  if (w === null) w = "filled"
  console.log(w.length)
  console.log(root({ kind: "member", object: { kind: "ident", name: "r" }, name: "m" }), show("s"), show(4))
  let total = 0
  for (let i = 0; i < 4; i++) {
    let v: string | i64 = 0
    v = pick(i)
    if (typeof v === "string") v = v.length as i64
    total += v
  }
  console.log(total)
  let a: string | i64 = "a"
  let b: string | i64 = 2;
  [a, b] = [b, a]
  if (typeof a === "number") console.log(a + 1)
}
// expect: 3
// expect: 5
// expect: 1
// expect: 6
// expect: r s 5
// expect: 8
// expect: 3
// case: narrowing_reassigned_one_branch
// A branch that may not run joins with the type before it.
function main() {
  let x: string | i64 = 1
  x = "a"
  if (1 > 2) x = 5
  console.log(x.length)
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_reassigned_in_loop
// A loop that assigns a variable reads it as declared, since a later iteration could see the new member.
function main() {
  let x: string | i64 = "a"
  x = "b"
  for (let i = 0; i < 2; i++) {
    console.log(x.length)
    x = 3
  }
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_reassigned_check_outside_loop
function main() {
  let x: string | i64 = "a"
  let n = 0
  if (typeof x === "string") {
    while (n < 2) {
      console.log(x.length)
      x = 5
      n++
    }
  }
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_reassigned_closure
// A closure doesn't trust a check on a variable its function reassigns.
function main() {
  let x: string | i64 = "a"
  if (typeof x === "string") {
    const f = () => x.length
    console.log(f())
  }
  x = 5
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_assigned_by_closure
// A variable a closure assigns never narrows outside it, since a call could change it.
function main() {
  let x: string | i64 = "a"
  const f = () => { x = 5 }
  if (typeof x === "string") {
    f()
    console.log(x.length)
  }
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_assigned_in_condition
function main() {
  let x: string | i64 = "a"
  if (typeof x === "string" && (x = 5) === 5) console.log(x.length)
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_assigned_falling_through
function main() {
  let x: string | i64 = "a"
  const k: i64 = 1
  if (typeof x === "string") {
    switch (k) {
      case 1: x = 5
      case 2: console.log(x.length)
    }
  }
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_lent_mutably
// Lending a narrowed variable mutably lends it whole, and forgets what it was narrowed to.
function bump(x: Mut<string | i64>) { x = 5 }
function main() {
  let x: string | i64 = 1
  x = "ab"
  bump(x)
  console.log(x)
  x = "cd"
  bump(x)
  console.log(x.length)
}
// error: property 'length' does not exist on type 'i64 | string'
// case: narrowing_lent_mutably_runs
function bump(x: Mut<string | i64>) { x = 5 }
function main() {
  let x: string | i64 = 1
  x = "ab"
  console.log(x.length)
  bump(x)
  console.log(x)
}
// expect: 2
// expect: 5
// case: narrowing_lent_mutably_in_loop
// A loop lending a variable mutably reads it as declared from the lend on.
function inc(p: Mut<i64 | null>) { p = 1 }
function main() {
  let x: i64 | null = 5
  x = null
  let n = 0
  while (n < 2) {
    inc(x)
    n++
  }
  console.log(x)
}
// expect: 1
// case: narrowing_lent_in_do_while_condition
function bump(x: Mut<string | i64>): boolean { x = 5; return true }
function main() {
  let x: string | i64 = "abc"
  let n = 0
  if (typeof x === "string") {
    do {
      console.log(x.length)
      n++
    } while (n < 3 && bump(x))
  }
}
// error: 9:28: error[E0109]: can't lend 'x' mutably here: it was read as narrowed earlier in this loop, by a check before the loop, and the next time round it may hold another member; check it inside the loop
// case: narrowing_lent_in_while_condition
function bump(x: Mut<string | i64>): boolean { x = 5; return true }
function main() {
  let x: string | i64 = "abc"
  let n = 0
  if (typeof x === "string") {
    while (x.length > 0 && n < 3 && bump(x)) {
      n++
    }
  }
}
// error: 6:42: error[E0109]: can't lend 'x' mutably here: it was read as narrowed earlier in this loop
// case: narrowing_lent_by_closure
// A closure lending a variable mutably forgets what was known of it where the closure is made.
function bump(x: Mut<string | i64>) { x = 5 }
function main() {
  let x: string | i64 = 1
  x = "abc"
  const f = () => bump(x)
  f()
  console.log(x.length)
}
// error: 8:15: error[E0502]: property 'length' does not exist on type 'i64 | string'
// case: narrowing_lent_by_nested_function
// A variable a nested function lends mutably never narrows after it, since any call could change it.
function bump(x: Mut<string | i64>) { x = 5 }
function main() {
  let x: string | i64 = 1
  x = "abc"
  function g() { bump(x) }
  g()
  console.log(x.length)
}
// error: 8:15: error[E0502]: property 'length' does not exist on type 'i64 | string'
// case: narrowing_redundant_null_check
// A narrowed variable compared with null or a literal it can't be is compared as declared.
function main() {
  let c: i64 | null = null
  c = 7
  if (c === null) console.log("none")
  let s: string | i64 = "a"
  s = 4
  if (typeof s === "string") console.log("str")
  let k: "a" | "b" = "a"
  k = "b"
  if (k === "a") console.log("a")
  console.log(c, s, k)
}
// expect: 7 4 b
// case: narrowing_reassigned_comptime
function len(i: i64): i64 {
  let x: string | i64 = i
  if (i > 1) x = "abc"
  else x = "z"
  let n = x.length as i64
  x = n
  return x + 1
}
const K = comptime len(3)
function main() {
  console.log(K, len(0))
}
// expect: 4 2
