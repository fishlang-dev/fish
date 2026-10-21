function main() {
  const lim: u8 = 1;
  const big: u16 = 1;
  switch (1) { case big: console.log("big"); break; case lim: console.log("lim"); break; default: console.log("none"); }
}
// error: type 'u16' is not comparable to type 'i64'
