// Base64 and hex: TC39's toBase64, toHex, u8.fromBase64 and u8.fromHex on bytes, and the HTML
// spec's btoa and atob, checked against RFC 4648's test vectors and Bun's own results.
// case: base64_encode
// expect: [] []
// expect: [Zg==] [66]
// expect: [Zm8=] [666f]
// expect: [Zm9v] [666f6f]
// expect: [Zm9vYg==] [666f6f62]
// expect: [Zm9vYmE=] [666f6f6261]
// expect: [Zm9vYmFy] [666f6f626172]
// expect: +/8= -_8= -_8 +/8
// expect: fbff 00 +/8=
function encoded(bytes: Ref<u8[]>): string { return bytes.toBase64(); }
function main() {
  const e = new TextEncoder();
  for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) console.log(`[${e.encode(s).toBase64()}] [${e.encode(s).toHex()}]`);
  const b: u8[] = [251, 255];
  console.log(b.toBase64(), b.toBase64({ alphabet: "base64url" }), b.toBase64({ alphabet: "base64url", omitPadding: true }), b.toBase64({ omitPadding: true }));
  const zero: u8[] = [0];
  console.log(b.toHex(), zero.toHex(), encoded(b));
}
// case: base64_decode
// expect: [] f fo foo foob fooba foobar
// expect: [ 251, 255 ] [ 251, 255 ] [ 0, 255, 127, 171 ]
// expect: [ 102, 111, 111, 98 ] [ 102, 111, 111, 98, 97, 114 ]
function main(): void throws TypeError {
  const d = new TextDecoder();
  console.log(u8.fromBase64(""), d.decode(u8.fromBase64("Zg==")), d.decode(u8.fromBase64("Zm8=")), d.decode(u8.fromBase64("Zm9v")), d.decode(u8.fromBase64("Zm9vYg==")), d.decode(u8.fromBase64("Zm9vYmE=")), d.decode(u8.fromBase64("Zm9vYmFy")));
  console.log(u8.fromBase64("+/8="), u8.fromBase64("-_8", { alphabet: "base64url" }), u8.fromHex("00ff7FaB"));
  console.log(u8.fromBase64(" Z m\t9\nv\fY\rg = = "), u8.fromBase64("Zm9v YmFy", { lastChunkHandling: "strict" }));
}
// case: base64_last_chunk
// expect: loose [ 102, 111, 111, 98 ]
// expect: strict TypeError
// expect: stop [ 102, 111, 111 ]
// expect: stop padded [ 102, 111, 111 ]
// expect: strict bits TypeError
// expect: loose bits [ 102, 111, 111, 98 ]
function tried(label: string, s: string, handling: "loose" | "strict" | "stop-before-partial") {
  try {
    console.log(label, u8.fromBase64(s, { lastChunkHandling: handling }));
  } catch (e) {
    console.log(label, e.name);
  }
}
function main() {
  tried("loose", "Zm9vYg", "loose");
  tried("strict", "Zm9vYg", "strict");
  tried("stop", "Zm9vYg", "stop-before-partial");
  tried("stop padded", "Zm9vYg=", "stop-before-partial");
  tried("strict bits", "Zm9vYh==", "strict");
  tried("loose bits", "Zm9vYh==", "loose");
}
// case: base64_decode_errors
// expect: base64 input goes on after its padding; '=' only ends it
// expect: base64 input ends in a lone character, which holds no whole byte; check it isn't cut short
// expect: base64 padding '=' goes after the second or third character of a chunk of four
// expect: base64 input holds a character outside A-Z, a-z, 0-9, '+' and '/'; decode base64url with alphabet: "base64url"
// expect: base64 input holds a character outside A-Z, a-z, 0-9, '+' and '/'; decode base64url with alphabet: "base64url"
// expect: base64url input holds a character outside A-Z, a-z, 0-9, '-' and '_'; decode standard base64 without alphabet: "base64url"
// expect: base64 input goes on after its padding; '=' only ends it
// expect: hex input has an odd number of digits; each byte is two
// expect: hex input holds a character outside 0-9, a-f and A-F
function base64(s: string, alphabet: "base64" | "base64url") {
  try {
    console.log(u8.fromBase64(s, { alphabet }));
  } catch (e) {
    console.log(e.message);
  }
}
function hex(s: string) {
  try {
    console.log(u8.fromHex(s));
  } catch (e) {
    console.log(e.message);
  }
}
function main() {
  base64("Zg==Zg==", "base64");
  base64("Z", "base64");
  base64("=", "base64");
  base64("Zm9v!", "base64");
  base64("-_8", "base64");
  base64("+/8", "base64url");
  base64("Zm9=v", "base64");
  hex("abc");
  hex("zz");
}
// case: base64_btoa_atob
// expect: Zm9vYmFy /w== /+lh
// expect: foobar foob foob foo [] ÿé
// expect: TypeError btoa takes characters up to U+00FF; for other text, encode it as UTF-8 first, as in 'new TextEncoder().encode(s).toBase64()'
// expect: Z TypeError
// expect: AB=C TypeError
// expect: -_ TypeError
// expect: Zm9vé TypeError
// expect: Zm9vYg= TypeError
function decoded(s: string) {
  try {
    console.log(atob(s));
  } catch (e) {
    console.log(s, e.name);
  }
}
function main(): void throws TypeError {
  console.log(btoa("foobar"), btoa("ÿ"), btoa("ÿéa"));
  console.log(atob("Zm9vYmFy"), atob("Zm9vYg"), atob("Zm9vYh=="), atob("  Zm 9v\n"), `[${atob("")}]`, atob("/+k="));
  try {
    btoa("Ā");
  } catch (e) {
    console.log(e.name, e.message);
  }
  for (const s of ["Z", "AB=C", "-_", "Zm9vé", "Zm9vYg="]) decoded(s);
}
// case: base64_own_btoa
// A program's own btoa keeps its name, and std's isn't linked in.
// expect: mine x
function btoa(s: string): string { return "mine " + s; }
function main() { console.log(btoa("x")); }
// case: base64_own_atob
// A program's own atob keeps its name, and std's btoa stays.
// expect: mine Zm9v
// expect: Zm9v
function atob(s: string): string { return "mine " + s; }
function main(): void throws TypeError {
  console.log(atob("Zm9v"));
  console.log(btoa("foo"));
}
// case: base64_own_btoa_std_atob
// A partial polyfill the other way round: its own btoa, std's atob.
// expect: mine foo
// expect: foo
function btoa(s: string): string { return "mine " + s; }
function main(): void throws TypeError {
  console.log(btoa("foo"));
  console.log(atob("Zm9v"));
}
// case: base64_url_strict
// expect: [ 251, 255 ]
// expect: TypeError
// expect: TypeError
// expect: TypeError
function tried(s: string) {
  try {
    console.log(u8.fromBase64(s, { alphabet: "base64url", lastChunkHandling: "strict" }));
  } catch (e) {
    console.log(e.name);
  }
}
function main() {
  tried("-_8=");
  tried("-_8");
  tried("-_9=");
  tried("-_8 ");
}
// case: base64_release
// mode: release
// expect: Zm9vYmFy 666f6f626172 foobar foobar
// expect: TypeError
function main(): void throws TypeError {
  const bytes = new TextEncoder().encode("foobar");
  const d = new TextDecoder();
  console.log(bytes.toBase64(), bytes.toHex(), d.decode(u8.fromBase64("Zm9vYmFy")), atob(btoa("foobar")));
  try {
    u8.fromHex("0");
  } catch (e) {
    console.log(e.name);
  }
}
// case: base64_not_bytes
// error: 'toHex' encodes bytes, a 'u8[]', not 'i64[]'
function main() {
  const xs: i64[] = [1];
  console.log(xs.toHex());
}
// case: base64_unknown_static
// error: 'u8' has no static 'fromBase32'; decode text into a 'u8[]' with 'u8.fromBase64' or 'u8.fromHex'
function main() { console.log(u8.fromBase32("x")); }
// case: base64_throws
// error: 'main' must declare 'throws TypeError' after its return type since 'atob' can throw 'TypeError', or catch it with try/catch
function main() { console.log(atob("Zg==")); }
