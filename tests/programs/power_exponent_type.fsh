// An integer's exponent is a u32.
function main() {
  const x = 2
  const y = 3
  print(x ** y)
}
// error: the exponent of '**' on an integer is a 'u32', as in Rust's 'pow', not 'i64'; convert it with 'as u32'
