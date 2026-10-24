// case: as_non_number
// 'as' converts only between numbers so far.
function main() {
  const x = 1.5
  print(x as boolean)
}
// error: 'as' conversions other than between numbers are not supported yet
// case: as_numbers
// 'as' converts between numbers as Rust's does: truncating or extending integers, rounding
// floats toward zero and saturating, and turning booleans and enum members into numbers.
enum Color { Red = 2, Green = 7 }
function main() {
  const big = 300
  print(300 as u8, big as u8, -1 as u32, -1 as u64, 200 as i8)
  const f = 2.9
  const nan: number = 0 / 0
  print(f as i32, -2.9 as i32, 1e20 as i32, -1e20 as i32, nan as i32, -5.5 as u8)
  print(true as i64, false as u8, Color.Green as i64, Color.Red as number)
  const small: u8 = 250
  print(small as i64 + 10, small as f32 / 3, (7 as number) / 2, 3.75 as f32)
  const q: f32 = 0.1
  print(q as number, 1 as i64 as number)
}
// expect: 44 44 4294967295 18446744073709551615 -56
// expect: 2 -2 2147483647 -2147483648 0 0
// expect: 1 0 7 2
// expect: 260 83.333336 3.5 3.75
// expect: 0.10000000149011612 1
