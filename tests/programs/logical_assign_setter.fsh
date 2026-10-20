class Flag {
  private stored = false

  get v(): boolean {
    print("get")
    return this.stored
  }

  set v(x: boolean) {
    print("set", x)
    this.stored = x
  }
}

function main() {
  let f = new Flag()
  f.v &&= true
  f.v ||= true
  f.v ||= false
  f.v &&= false
  print(f.v)
}
// expect: get
// expect: get
// expect: set true
// expect: get
// expect: get
// expect: set false
// expect: get
// expect: false
