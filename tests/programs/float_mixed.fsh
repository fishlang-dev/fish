// Floats of different widths don't mix.
function main() {
  const x = 1.5
  const y: f32 = 2
  print(x + y)
}
// error: operator '+' can't mix 'number' and 'f32'
