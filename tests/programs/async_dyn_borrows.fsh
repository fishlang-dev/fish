// error: while 'f' borrows 'h'
interface Handler {
  handle(n: i64): Promise<i64>;
}

class Doubler {
  async handle(n: i64): Promise<i64> {
    return n * 2;
  }
}

class Tripler {
  async handle(n: i64): Promise<i64> {
    return n * 3;
  }
}

async function main() {
  let h: Dyn<Handler> = new Doubler();
  const f = h.handle(4);
  h = new Tripler();
  const got = await f;
}
