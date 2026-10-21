function main() {
  const texts: string[] = ["hello world", "héllo wörld", "a😀b😀c", "", "aaa"];
  const needles: string[] = ["o", "wor", "ö", "😀", "\uD83D", "\uDE00", "", "zz", "a", "b😀"];
  const positions: i64[] = [-5, 0, 1, 2, 4, 100];
  let out: string[] = [];
  for (const t of texts) for (const n of needles) {
    let line = `${t.indexOf(n)} ${t.includes(n)} ${t.startsWith(n)} ${t.endsWith(n)}`;
    for (const p of positions) line += ` ${t.indexOf(n, p)}${t.includes(n, p) ? "y" : "n"}${t.startsWith(n, p) ? "y" : "n"}${t.endsWith(n, p) ? "y" : "n"}`;
    out.push(line);
  }
  out.push(`${String(42)} ${String(-1.5)} ${String(true)} ${String("s")} ${String(255)}`);
  for (const l of out) console.log(l);
}
// expect: 4 true false false 4ynn 4ynn 4ynn 4ynn 4yyn -1nnn
// expect: 6 true false false 6ynn 6ynn 6ynn 6ynn 6ynn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 4yyy 11yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 4 true false false 4ynn 4ynn 4ynn 4ynn 4yyn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 7 true false false 7ynn 7ynn 7ynn 7ynn 7ynn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 4yyy 11yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 1 true false false 1ynn 1ynn 1yyn 4ynn 4yyn -1nnn
// expect: 1 true false false 1ynn 1ynn 1yyn 4yny 4yyn -1nnn
// expect: 2 true false false 2ynn 2ynn 2ynn 2yyn 5ynn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 4yyy 7yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true false 0yyn 0yyn -1nny -1nnn -1nnn -1nnn
// expect: 3 true false false 3ynn 3ynn 3ynn 3ynn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 0yyy 0yyy 0yyy 0yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyy 0yyy 1yyy 2yyy 3yyy 3yyy
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 0 true true true 0yyn 0yyn 1yyy 2yyy -1nny -1nny
// expect: -1 false false false -1nnn -1nnn -1nnn -1nnn -1nnn -1nnn
// expect: 42 -1.5 true s 255
