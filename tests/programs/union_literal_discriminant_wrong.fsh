type Flag = { on: true }

function main() {
  const f: Flag = { on: false }
}
// error: type '{ on: boolean }' is not assignable to type '{ on: true }'
