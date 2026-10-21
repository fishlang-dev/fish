function show(u: string | i64) {
  if (typeof u === "string") console.log("text", u);
  else console.log("number", u + 1);
}

function main() {
  show("seven");
  show(7);
}
// expect: text seven
// expect: number 8
