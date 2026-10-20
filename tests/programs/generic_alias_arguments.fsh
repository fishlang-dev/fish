type Pair<T> = { first: T; second: T }

function main() {
  const p: Pair = { first: 1, second: 2 }
}
// error: type 'Pair' expects 1 type argument, but got 0
