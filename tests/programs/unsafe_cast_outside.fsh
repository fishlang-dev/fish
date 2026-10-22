function main() {
  const x = 1;
  const p = ptrOf(x);
  console.log(p as usize);
}
// error: 'as' with a raw pointer can only happen inside 'unsafe { }'
