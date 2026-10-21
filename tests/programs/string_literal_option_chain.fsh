function main() {
  const o: "a" | "bc" | null = "bc";
  console.log(o?.slice(1));
}
// error: optional chains on string literal types are not supported yet
