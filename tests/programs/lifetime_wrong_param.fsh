class P {
  x = 0
}

function first<A extends Lifetime>(x: Ref<P, A>, y: Ref<P>): Ref<P, A> {
  return y
}

function main() {}
// error: the returned reference points into 'y', but its lifetime ties it to 'x'
