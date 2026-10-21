function main() {
  let e: "a" | "bc" = "bc";
  console.log(e.length, e[1], e.slice(1), e.charCodeAt(0));
  e = "a";
  console.log(e.length);
}
// expect: 2 c c 98
// expect: 1
