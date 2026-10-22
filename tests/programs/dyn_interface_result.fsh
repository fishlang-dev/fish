// error: 'make' returns the interface type 'Shape', which each type implementing 'Factory' gives its own way, so a Dyn can't call it; have it return 'Dyn<Shape>'
interface Shape {
  area(): i64;
}

interface Factory {
  make(): Shape;
}

class Sq {
  area(): i64 {
    return 1;
  }
}

class F {
  make(): Sq {
    return new Sq();
  }
}

function main() {
  const f: Dyn<Factory> = new F();
  const s = f.make();
}
