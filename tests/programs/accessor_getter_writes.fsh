class Circle {
  constructor(public r: i64) {}

  get grown(): i64 {
    this.r++
    return this.r
  }
}

function main() {}
// error: cannot assign to 'this.r' because 'this' is read-only here; declare 'this: Mut<this>'
