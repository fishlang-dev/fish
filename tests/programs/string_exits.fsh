function find(n: i64): string throws string {
  for (let i = 0; i < 10; i++) {
    const tag = "item" + i;
    if (i === n) return tag;
    if (i > 5) {
      const why = "too far: " + i;
      throw why;
    }
    if (i % 2 === 0) continue;
    const odd = tag + " odd";
    if (i === n + 3) break;
  }
  return "none" + n;
}

function main() throws string {
  console.log(find(2), find(3));
  outer: for (let i = 0; i < 3; i++) {
    const a = "a" + i;
    for (let j = 0; j < 3; j++) {
      const b = a + j;
      if (j === 1) continue outer;
    }
  }
  try {
    console.log(find(8));
  } catch (e) {
    console.log("caught", e);
  }
  try {
    find(9);
  } catch {
    console.log("dropped");
  }
  try {
    const inner = "in" + 1;
    find(7);
  } catch (e) {
    console.log(e);
  } finally {
    const f = "fin" + 2;
    console.log(f);
  }
  console.log(find(-2));
}
// expect: item2 item3
// expect: caught too far: 6
// expect: dropped
// expect: too far: 6
// expect: fin2
// expect: none-2
