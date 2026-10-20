// mode: parse
macro function derive(input: Ast): Ast {
  return input
}
function repeat(comptime n: i64, s: string): string {
  comptime {
    assert(n > 0)
  }
  return s
}
const table = comptime buildTable(256)
const size = comptime 4 * 1024
let comptime = 1
let viaCall = comptime(2)
let macro = comptime - 1
