// error: 'values' gives clones of the array's elements, and can't clone an 'Atomic', which is changed in place wherever it is shared; make a new one from what it holds
function each<T>(xs: Ref<T[]>): i64 { let n = 0; for (const x of xs.values()) n++; return n; }
function main() {
  const as = [new Atomic(1)];
  console.log(each(as));
}
