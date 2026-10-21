function greet(name: string): string {
  return "hi " + name;
}

function main() {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += i;
    s = s + ",";
  }
  console.log(s);
  console.log(greet("ann"));
  console.log("x" + 1 + 2, 1 + 2 + "x", "t" + true, (3 as u8) + "u", "f" + 0.1, "g" + (2.5 as f32));
  console.log("a" + "b" === "ab");
}
// expect: 0,1,2,3,4,
// expect: hi ann
// expect: x12 3x ttrue 3u f0.1 g2.5
// expect: true
