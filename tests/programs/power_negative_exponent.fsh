// Without a float to become, a negative exponent is an error.
function main() {
  const z = 2 ** -1
}
// error: the exponent of '**' on an integer is a 'u32', which can't hold this
