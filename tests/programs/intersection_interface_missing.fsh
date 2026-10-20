interface Shape {
  area(): i64
}

interface Named {
  id: i64
}

class Blob {
  id = 1
}

function score(s: Shape & Named): i64 {
  return s.id + s.area()
}

function main() {
  print(score(new Blob()))
}
// error: method 'area' is missing in type 'Blob' but required in type 'Shape & Named'
