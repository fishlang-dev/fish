class P {
  x = 0
}

function first(x: Ref<P, A>): Ref<P, A> {
  return x
}

function main() {}
// error: cannot find lifetime 'A'; declare it as '<A extends Lifetime>'
