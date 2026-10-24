// case: switch
function name(n: i64): i64 {
  switch (n) {
    case 1:
      print("one")
    case 2:
      print("one or two")
      break
    default:
      print("other")
    case 3:
      print("three or other")
  }
  return n
}

function sign(n: i64): i64 {
  switch (n > 0) {
    case true:
      return 1
    default:
      return 0
  }
}

function main() {
  name(1)
  name(2)
  name(3)
  name(4)
  let seen = 0
  for (let i = 0; i < 3; i++) {
    switch (i) {
      case 1:
        break
      default:
        seen++
    }
  }
  print("seen", seen)
  // The discriminant runs once, though two cases test it.
  switch (name(7)) {
    case 5:
    case 6:
      print("no")
  }
  switch (2) {}
  print(sign(5), sign(-5))
  switch (1) {
    case 1:
      const inner = 10
    case 2:
      print("shared scope")
  }
}
// expect: one
// expect: one or two
// expect: one or two
// expect: three or other
// expect: other
// expect: three or other
// expect: seen 2
// expect: other
// expect: three or other
// expect: 1 0
// expect: shared scope
// case: switch_case_scope
function f(n: i64): i64 {
  switch (n) {
    case 1:
      const inner = 10
    case 2:
      return inner + 1
  }
  return 0
}

function main() {
  print(f(2))
}
// error: 'inner' is declared in another case of this switch, which jumping straight here skips; declare it before the switch
// case: switch_case_scope_own
function f(n: i64): i64 {
  switch (n) {
    case 1:
      const inner = 10
      return inner + 1
    case 2: {
      const inner = 20
      return inner
    }
  }
  return 0
}

function main() {
  print(f(1), f(2), f(3))
}
// expect: 11 20 0
// case: switch_case_scope_shorthand
function f(n: i64): i64 {
  switch (n) {
    case 1:
      let x = 1
      return x
    case 2:
      const o = { x }
      return o.x
  }
  return 0
}

function main() {
  print(f(2))
}
// error: 'x' is declared in another case of this switch, which jumping straight here skips; declare it before the switch
// case: switch_case_type
function main() {
  switch (1) {
    case true:
      print("no")
  }
}
// error: type 'boolean' is not comparable to type 'i64'
// case: switch_default_twice
function main() {
  switch (1) {
    default:
    default:
  }
}
// error: a 'switch' can have only one 'default'
// case: switch_literal_discriminant
function main() {
  const lim: u8 = 1;
  const big: u16 = 1;
  switch (1) { case big: console.log("big"); break; case lim: console.log("lim"); break; default: console.log("none"); }
}
// error: type 'u16' is not comparable to type 'i64'
// case: switch_return
function f(n: i64): i64 {
  switch (n) {
    case 1:
      return 1
  }
}

function main() {
  print(f(1))
}
// error: not all code paths return a value
// case: switch_union_case
function main() {
  const d: "a" | "b" = "a"
  switch (d) {
    case "z":
      print(1)
  }
}
// error: type '"z"' is not comparable to type '"a" | "b"'
