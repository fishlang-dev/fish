type Point = { x: i64; y: i64 }

function main() {
  const p: Point = { x: 1, y: 2, z: 3 }
}
// error: object literal may only specify known properties, and 'z' does not exist in type '{ x: i64; y: i64 }'
// error:   const p: Point = { x: 1, y: 2, z: 3 }
// error:                                  ^^^^
