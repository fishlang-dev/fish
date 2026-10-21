function main() {
  const s = "a😀é";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += `[${c}:${c.length}:${c.charCodeAt(0)}]`;
  }
  console.log(out);
  console.log(s[1] + s[2], s[1] + s[2] === "😀", s[0] === "a", "xyz"[2]);
}
// expect: [a:1:97][�:1:55357][�:1:56832][é:1:233]
// expect: 😀 true true z
