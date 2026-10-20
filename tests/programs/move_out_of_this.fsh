type Inner = { v: i64 }

class Holder {
  inner: Inner = { v: 1 }
  get(): Inner {
    return this.inner
  }
}

function main() {
  print(new Holder().get().v)
}
// error: 'this.inner' can't be moved out of 'this', since a method only borrows it; use 'this.inner.clone()'
