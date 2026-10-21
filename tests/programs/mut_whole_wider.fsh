function reset(m: Mut<{ x: i64 }>) {
  m = { x: 1 }
}

function main() {}
// error: can't assign a whole value through 'm', which may point to a wider value; assign its fields instead
