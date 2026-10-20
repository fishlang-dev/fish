interface Shape {
  area(): i64
}

class Point implements Shape {
  constructor(public x: i64) {}
}

function main() {}
// error: class 'Point' incorrectly implements 'Shape': method 'area' is missing in type 'Point' but required in type 'Shape'
