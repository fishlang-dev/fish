interface Visitor {
  visitLeaf(l: Leaf): i64
  visitPair(p: Pair): i64
}

interface Node {
  accept(v: Visitor): i64
}

class Leaf {
  constructor(public n: i64) {}

  accept(v: Visitor): i64 {
    return v.visitLeaf(this)
  }
}

class Pair {
  constructor(public left: Leaf, public right: Leaf) {}

  accept(v: Visitor): i64 {
    return v.visitPair(this)
  }
}

class Sum {
  visitLeaf(l: Leaf): i64 {
    return l.n
  }

  visitPair(p: Pair): i64 {
    return p.left.accept(this) + p.right.accept(this)
  }
}

class Unused {
  accept(v: Visitor): i64 {
    return v.visitLeaf(new Leaf(0))
  }
}

function walk(n: Node): i64 {
  return n.accept(new Sum())
}

function main() {
  print(walk(new Leaf(3)), walk(new Pair(new Leaf(1), new Leaf(5))))
}
// expect: 3 6
