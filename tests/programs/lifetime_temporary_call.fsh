class Inner {
  v = 42
}

class Holder {
  inner = new Inner()
  pick(): Ref<Inner> {
    return this.inner
  }
}

function bad(r: Ref<i64>): Ref<Inner> {
  return new Holder().pick()
}

function main() {}
// error: can't return a reference to a temporary or a copy
