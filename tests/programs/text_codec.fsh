// expect: 11 195 169
// expect: héllo 🐟 8
// expect: h�i�
// expect: 5 239 191 189
// expect: �A���������€ 12
// expect: 0 0
// expect: 1 A
// UTF-8 as the web's TextEncoder and TextDecoder convert it, broken bytes included.
function main() {
  const bytes = new TextEncoder().encode("héllo 🐟");
  console.log(bytes.length, bytes[1], bytes[2]);
  const back = new TextDecoder().decode(bytes);
  console.log(back, back.length);
  let bad: u8[] = [104, 255, 105, 0xE2, 0x82];
  console.log(new TextDecoder().decode(bad));
  const lone = new TextEncoder().encode("a\uD800b");
  console.log(lone.length, lone[1], lone[2], lone[3]);
  let mixed: u8[] = [0xF0, 0x9F, 0x41, 0xED, 0xA0, 0x80, 0xC0, 0x80, 0xF4, 0x90, 0x80, 0x80, 0xE2, 0x82, 0xAC];
  const out = new TextDecoder().decode(mixed);
  console.log(out, out.length);
  const empty = new TextEncoder().encode("");
  console.log(empty.length, new TextDecoder().decode(empty).length);
  let bom: u8[] = [0xEF, 0xBB, 0xBF, 0x41];
  const stripped = new TextDecoder().decode(bom);
  console.log(stripped.length, stripped);
}
