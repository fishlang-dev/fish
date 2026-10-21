class Box<T> {
  v: T
  constructor(v: T) {
    this.v = v
  }
  peek(): Ref<T> {
    return this.v
  }
}

function main() {
  const n = 1
  const r: Ref<i64> = n
  const b = new Box(r)
}
// error: references to references are not supported yet
