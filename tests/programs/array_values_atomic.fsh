// error: 'entries' gives clones of the array's elements, and can't clone an 'Atomic', which is changed in place wherever it is shared; make a new one from what it holds
function main() {
  const as = [new Atomic(1), new Atomic(2)];
  for (const [i, a] of as.entries()) console.log(i, a.load());
}
