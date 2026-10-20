enum Mode {
  Off,
  On,
}

function main() {
  const m = Mode.On
  let o = { m }
  o.m = Mode.Off
  const u: i64 | boolean = 5
  if (typeof u === "number") {
    const w = { u }
    print(o.m, w.u + 1)
  }
}
// expect: 0 6
