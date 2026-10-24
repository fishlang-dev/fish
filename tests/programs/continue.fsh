// case: continue_block_label
function main() {
  while (false) {
    here: {
      continue here
    }
  }
}
// error: 'continue' can only jump to a label on a loop
// case: continue_outside
function main() {
  here: {
    continue
  }
}
// error: 'continue' can only be used inside a loop
// case: continue_return
function f(skip: boolean): i64 {
  do {
    if (skip) continue
    return 1
  } while (false)
}

function main() {
  print(f(true))
}
// error: not all code paths return a value
