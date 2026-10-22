function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function* words(prefix: string) {
  yield prefix + "a";
  const middle = prefix + "-mid";
  yield middle;
  yield prefix + "b";
}

function* names(list: string[]): Generator<string> {
  for (const n of list) {
    const shout = n + "!";
    yield shout;
  }
}

function main() {
  let g = count(3);
  const a = g.next();
  if (a.done === false) console.log("first", a.value);
  const b = g.next();
  if (b.done === false) console.log("second", b.value);
  for (const k of count(4)) console.log(k);
  for (const w of words("x")) console.log(w);
  let early = words("y" + 1);
  early.next();
  const r = early.next();
  if (r.done === false) console.log("early", r.value);
  let done = count(0);
  const d = done.next();
  const again = done.next();
  console.log(d.done, again.done);
  for (const n of names(["ann" + 1, "bo"])) console.log(n);
  let partway = names(["p" + 1, "q" + 2, "r"]);
  partway.next();
  for (const w of words("z")) {
    if (w === "z-mid") break;
    console.log(w);
  }
}
// expect: first 0
// expect: second 1
// expect: 0
// expect: 1
// expect: 2
// expect: 3
// expect: xa
// expect: x-mid
// expect: xb
// expect: early y1-mid
// expect: true true
// expect: ann1!
// expect: bo!
// expect: za
