function main() {
  const d: "a" | "b" = "a"
  switch (d) {
    case "z":
      print(1)
  }
}
// error: type '"z"' is not comparable to type '"a" | "b"'
