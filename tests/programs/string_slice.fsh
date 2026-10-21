function keep(): string {
  const big = "prefix-" + "é😀x" + "-suffix";
  const mid = big.slice(5, 12);
  return mid.substring(2);
}

function main() {
  const s: string = "héllo 😀 wörld";
  console.log(`[${s.slice(1)}][${s.slice(-5)}][${s.slice(2, 5)}][${s.slice(5, 2)}][${s.slice(-100, 3)}][${s.slice(3, 100)}]`);
  console.log(`[${s.substring(1)}][${s.substring(-5)}][${s.substring(2, 5)}][${s.substring(5, 2)}][${s.substring(3, 100)}][${s.substring(4, 4)}]`);
  console.log(`[${s.slice(7, 9)}][${s.slice(7, 8)}][${s.slice(8, 9)}][${s.slice(7, 8).length}][${s.slice(8).charCodeAt(0)}]`);
  console.log(s.slice(6, 8) + s.slice(8, 10) === s.slice(6, 10), s.slice(0, 7) + s.slice(7) === s);
  const t = keep();
  console.log(t, t.length);
  s.slice(1, 2);
  let long = "";
  for (let i = 0; i < 100; i++) long += "é😀";
  console.log(long.slice(129, 133).length, long.slice(129, 133) === "😀é😀".slice(1), long.substring(150, 140).charCodeAt(1));
}
// expect: [éllo 😀 wörld][wörld][llo][][hél][lo 😀 wörld]
// expect: [éllo 😀 wörld][héllo 😀 wörld][llo][llo][lo 😀 wörld][]
// expect: [� ][�][ ][1][32]
// expect: true true
// expect: é😀x- 5
// expect: 4 false 233
