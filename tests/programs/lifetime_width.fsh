// A reference returned from a reference parameter to an object type points at what that
// parameter borrows, whatever wider object it is.
function same(p: Ref<{ x: i64 }>): Ref<{ x: i64 }> {
  return p
}

function main() {
  const wide = { x: 3, y: 4 }
  const narrow = { x: 5 }
  print(same(wide).x, same(narrow).x, wide.y)
}
// expect: 3 5 4
