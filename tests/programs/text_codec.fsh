// case: text_codec_basics
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
// case: text_decoder_fatal
// expect: hi h 1
// expect: TypeError: The encoded data was not valid for encoding utf-8
// expect: TypeError: The encoded data was not valid for encoding utf-8
// expect: TypeError: The encoded data was not valid for encoding utf-8
// expect: � h
// fatal refuses a stray byte, a cut-short sequence and a surrogate's encoding, where the default
// decoder gives U+FFFD; a U+FFFD that is in the input is valid.
function decoded(bytes: u8[]): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}
function main() {
  console.log(decoded([104, 105]), decoded([0xEF, 0xBB, 0xBF, 104]), decoded([0xEF, 0xBF, 0xBD]).length);
  console.log(decoded([0xFF]));
  console.log(decoded([0xF0, 0x9F, 0x98]));
  console.log(decoded([0xED, 0xA0, 0x80]));
  console.log(new TextDecoder().decode([0xFF]), new TextDecoder("utf8", { fatal: false }).decode([104]));
}
// case: text_decoder_fatal_uncaught
// error: 'main' must declare 'throws TypeError'
function main() {
  console.log(new TextDecoder("utf-8", { fatal: true }).decode([104]));
}
// case: text_decoder_fatal_not_literal
// error: 'TextDecoder' takes fatal as a literal, true or false
function main() {
  const fatal = true;
  console.log(new TextDecoder("utf-8", { fatal }).decode([104]));
}
