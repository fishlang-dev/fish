async function one(): Promise<i64> {
  return 1;
}

async function main() {
  console.log(1 + (await one()));
}
// error: 'await' inside an expression isn't supported yet; give its value a name first
