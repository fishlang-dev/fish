// panic: a semaphore's number of slots can't be negative
function main() {
  const n = -3;
  const sem = new Semaphore(n);
}
