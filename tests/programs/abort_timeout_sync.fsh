// error: 'AbortSignal.timeout' needs the async runtime's timer, which runs when 'main' is an async function
function main() {
  const t = AbortSignal.timeout(1);
  console.log(t.aborted);
}
