// case: finally_break_swallows
// A finally that breaks swallows an error, and what the error's path moved stays moved.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function g(c: boolean): void throws i64 {
  const o = new O(1)
  while (true) {
    try { if (c) { take(o); throw 1 } } finally { break }
  }
  print(o.n)
}
function main() throws i64 { g(true) }
// error: 'o.n' can't be used here because 'o' was moved
// case: finally_inner_exit_p1
// A way out that doesn't leave the try doesn't reach its finally.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  let o = new O(1)
  try {
    try { take(o); f(1); o = new O(3) } catch (e) { o = new O(2) }
  } finally {
    print(o.n)
  }
}
// expect: 2
// case: finally_inner_exit_p2
// A way out that doesn't leave the try doesn't reach its finally.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function main() {
  let o = new O(1)
  try {
    for (let i = 0; i < 1; i++) { take(o); break }
    o = new O(2)
  } finally {
    print(o.n)
  }
}
// expect: 2
// case: finally_labeled_valid
// A labeled break through a catch, its finally and an outer finally, after which the variable is usable.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  const o = new O(1)
  outer: for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      try {
        try { f(0); if (j === 1) break outer } catch (e) {} finally { print("b") }
      } finally { print("c") }
    }
  }
  print("ok", o.n)
}
// expect: b
// expect: c
// expect: b
// expect: c
// expect: ok 1
// case: finally_move_break
// Or where a break through it lands.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took", o.n) }
function main() {
  const o = new O(5)
  while (true) {
    try {
      break
    } finally {
      take(o)
    }
  }
  print("after loop", o.n)
}
// error: 'o.n' can't be used here because 'o' was moved
// case: finally_move_raise
// What a finally moves is gone where an error it passes on is caught.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took", o.n) }
function fail(): void throws i64 { throw 1 }
function main() {
  const o = new O(5)
  try {
    try {
      fail()
    } finally {
      take(o)
    }
  } catch (e) {
    print("catch uses", o.n)
  }
}
// error: 'o.n' can't be used here because 'o' was moved
// case: finally_move_return
// Or in a finally a return passes through next.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took", o.n) }
function f(): i64 {
  const o = new O(5)
  try {
    try {
      return 1
    } finally {
      take(o)
    }
  } finally {
    print("outer finally", o.n)
  }
}
function main() { print(f()) }
// error: 'o.n' can't be used here because 'o' was moved
// case: finally_return_nested
// A finally that returns carries what its way in moved into the next finally.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function g(c: boolean): i64 throws i64 {
  const o = new O(1)
  try {
    try { if (c) { take(o); f(1) } } finally { return 1 }
  } finally { print(o.n) }
}
function main() throws i64 { print(g(true)) }
// error: 'o.n' can't be used here because 'o' was moved
// case: finally_revives_q1
// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  let o = new O(1)
  try {
    try { take(o); f(1) } finally { o = new O(2) }
  } catch (e) { print(o.n) }
}
// expect: 2
// case: finally_revives_q2
// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function main() {
  let o = new O(1)
  while (true) {
    try { take(o); break } finally { o = new O(2) }
  }
  print(o.n)
}
// expect: 2
// case: finally_revives_q3
// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function g(c: boolean): void throws i64 {
  const o = new O(1)
  while (true) {
    try { if (c) { take(o); throw 1 } break } finally { print("fin") }
  }
  print(o.n)
}
function main() throws i64 { g(false) }
// expect: fin
// expect: 1
// case: finally_revives_q7
// A finally that gives a moved variable a new value makes it usable where its way out lands.
class O { constructor(public n: i64) {} }
function take(o: O) {}
function f(): i64 {
  let o = new O(1)
  try {
    try { take(o); return 1 } finally { o = new O(2) }
  } finally { print(o.n) }
}
function main() { print(f()) }
// expect: 2
// expect: 1
// case: finally_three_raise
// A raise through two finallies reaches the catch with what both moved.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function main() {
  const o = new O(1)
  try {
    try { try { if (o.n > 0) { take(o); f(1) } } finally { print("a") } } finally { print("b") }
  } catch (e) { print(o.n) }
}
// error: 'o.n' can't be used here because 'o' was moved
// case: finally_three_return
// A return through three levels carries their moves to the outermost finally.
class O { constructor(public n: i64) {} }
function take(o: O) { print("took") }
function f(n: i64): void throws i64 { if (n > 0) throw n }
function g(): i64 {
  const o = new O(1)
  try {
    try { try { f(0); if (o.n > 0) { take(o); return 1 } } finally { print("a") } } catch (e) {} finally { print("b") }
  } finally { print("c", o.n) }
  return 0
}
function main() {}
// error: 'o.n' can't be used here because 'o' was moved
