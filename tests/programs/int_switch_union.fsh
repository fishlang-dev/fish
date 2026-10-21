// A switch case literal takes a union's one number type.
function main() {
  const i: u8 | boolean = 200
  switch (i) { case 200: print("hit"); break; default: print("miss") }
}
// expect: hit
