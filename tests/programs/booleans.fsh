function isBig(n: i64): boolean {
  return n > 100
}

function main() {
  const yes = true
  let flag: boolean = false
  print(yes, flag, 1 === 1, 1 !== 1, 2 < 3, 3 <= 3, 4 > 5, 5 >= 6)  // expect: true false true false true true false false
  print(isBig(500), yes === flag)                                  // expect: true false
}
