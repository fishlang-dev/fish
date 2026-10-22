// error: 'spawn' needs a Promise from an async function's call, not 'Promise<i64>'
interface Handler {
  handle(n: i64): Promise<i64>;
}

class Doubler {
  async handle(n: i64): Promise<i64> {
    return n * 2;
  }
}

async function main() {
  const h: Dyn<Handler> = new Doubler();
  const t = spawn(h.handle(4));
}
