function reset(p: { n: i64 }) {
  p.n = 0
}

function main() {}
// error: assigning to a parameter is not supported yet; copy it into a 'let'
