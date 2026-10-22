async function one(): Promise<i64> {
  return 1;
}

async function main() {
  try {
    await one();
  } finally {
    console.log("done");
  }
}
// error: 'await' statements in a 'try' with a 'finally' are not supported yet
