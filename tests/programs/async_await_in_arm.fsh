async function one(): Promise<i64> {
  return 1;
}

async function main() {
  const n = 1;
  match (n) {
    case 1 => {
      await one();
    },
    case _ => {},
  }
}
// error: 'await' inside match arms are not supported yet
