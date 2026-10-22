// error: can't clone a 'Semaphore' or a 'Permit'
function main() {
  const s = new Semaphore(2);
  const t = s.clone();
}
