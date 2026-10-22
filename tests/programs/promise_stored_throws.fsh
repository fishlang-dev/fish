// error: a stored 'Promise<i64>' can't throw yet, and this one can throw 'string'
async function risky(): Promise<i64> throws string {
  throw "no";
}

async function main() {
  const p: Promise<i64> = risky();
}
