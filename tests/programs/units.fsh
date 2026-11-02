// case: units_arithmetic
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">
type Speed = Unit<f64, "m/s">
type Area = Unit<f64, "m^2">

function speed(d: Meters, t: Seconds): Speed {
  return d / t
}

function area(w: Meters, h: Meters): Area {
  return w * h
}

function main() {
  const d = 100 as Meters
  const t = 9.58 as Seconds
  const v = speed(d, t)
  const a: Unit<f64, "m*m"> = area(d, 2 as Meters)
  const twice = d * 2
  const total: Meters = d + twice
  const ratio: f64 = d / twice
  const back: Meters = v * t
  console.log(v, a, twice, total, ratio, back, -d, d > twice)
  const accel: Unit<f64, "kg*m/s^2"> = (3 as Unit<f64, "kg">) * (v / t)
  console.log(accel)
  const steps = 5 as Unit<i64, "step">
  console.log(steps * 2 + steps, steps % (2 as Unit<i64, "step">))
}
// expect: 10.438413361169102 200 200 300 0.5 100 -100 false
// expect: 3.2688142049590088
// expect: 15 1
// case: units_add_other
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">

function main() {
  const d = 1 as Meters
  const t = 2 as Seconds
  console.log(d + t)
}
// error: operator '+' can't mix 'Unit<number, "m">' and 'Unit<number, "s">'; a unit meets only the same unit, except that '*' and '/' combine them
// case: units_add_plain
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">

function main() {
  const d = 1 as Meters
  const t = 2 as Seconds
  console.log(d + 2)
}
// error: operator '+' can't mix 'Unit<number, "m">' and 'number'
// case: units_compare_other
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">

function main() {
  const d = 1 as Meters
  const t = 2 as Seconds
  console.log(d < t)
}
// error: operator '<' can't mix 'Unit<number, "m">' and 'Unit<number, "s">'
// case: units_wrong_result
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">

function main() {
  const d = 1 as Meters
  const t = 2 as Seconds
  const s: Unit<f64, "m/s"> = d * t
}
// error: type 'Unit<number, "m*s">' is not assignable to type 'Unit<number, "m/s">'
// case: units_malformed
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">

function main() {
  const d = 1 as Meters
  const t = 2 as Seconds
  const x: Unit<f64, "m/s/s"> = d
}
// error: 'Unit' takes a number type and its unit, like 'Unit<f64, "m/s">', the unit names with powers over at most one '/'
// case: units_bitwise
type Meters = Unit<f64, "m">
type Seconds = Unit<f64, "s">

function main() {
  const d = 1 as Meters
  const t = 2 as Seconds
  const n = 3 as Unit<i64, "n">
  console.log(n << 1, d, t)
}
// error: operator '<<' can't be applied to 'Unit<i64, "n">', a unit
