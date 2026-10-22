// error: its method 'draw' takes an interface or a function, so it has a version per argument type and no one to call through a Dyn
interface Pen {
  ink(): i64;
}

interface Canvas {
  draw(p: Pen): i64;
}

class Sheet {
  draw(p: Pen): i64 {
    return p.ink();
  }
}

function main() {
  const c: Dyn<Canvas> = new Sheet();
}
