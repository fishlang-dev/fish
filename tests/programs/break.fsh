// case: break_continue
function firstOver(limit: i64): i64 {
  let n = 1
  while (true) {
    if (n > limit) break
    n *= 2
  }
  return n
}

function forever(): i64 {
  outer: while (true) {
    inner: while (true) {
      continue outer
    }
  }
}

function main() {
  print(firstOver(100))
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (j === 1) continue outer
      if (i === 2) break outer
      print(i, j)
    }
  }
  let skipped = 0
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) continue
    skipped += i
  }
  print(skipped)
  let tries = 0
  do {
    tries++
    if (tries < 3) continue
    print("tries", tries)
  } while (tries < 3)
  block: {
    print("before")
    if (tries === 3) break block
    print("not printed")
  }
  print("after")
  a: b: for (let i = 0; i < 2; i++) {
    if (i === 1) continue a
    print("labels", i)
    break b
  }
}
// expect: 128
// expect: 0 0
// expect: 1 0
// expect: 4
// expect: tries 3
// expect: before
// expect: after
// expect: labels 0
// case: break_label_return
function f(early: boolean): i64 {
  done: {
    if (early) break done
    return 1
  }
}

function main() {
  print(f(true))
}
// error: not all code paths return a value
// case: break_outside
function main() {
  break
}
// error: 'break' can only be used inside a loop or 'switch'
// case: break_return
function f(): i64 {
  while (true) {
    break
  }
}

function main() {
  print(f())
}
// error: not all code paths return a value
