// error: this closure changes 'count', which it captures, but a stored callable can't change what it captures; keep that state in an 'Atomic' or a 'Lock'
function main() {
  let count = 0;
  let handlers: ((n: i64) => i64)[] = [];
  handlers.push((n) => {
    count++;
    return n + count;
  });
}
