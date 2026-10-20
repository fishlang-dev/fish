class Tracked {
  copies: i64 = 0
  clone(extra: i64): Tracked {
    return new Tracked()
  }
}

function main() {}
// error: a 'clone' method must take no parameters and return 'Tracked', since it replaces the compiler's copy
