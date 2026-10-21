enum E {
  A = 1,
  B(i64),
}

function main() {}
// error: enum 'E' mixes members with values and members holding data; split it into two enums
