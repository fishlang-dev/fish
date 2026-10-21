// 'as' converts only between numbers so far.
function main() {
  const x = 1.5
  print(x as boolean)
}
// error: 'as' conversions other than between numbers are not supported yet
