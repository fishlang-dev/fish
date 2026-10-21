function size(s: Ref<string>): usize {
  return s.length;
}

function grow(s: Mut<string>): u16 {
  s += "!";
  return s.charCodeAt(s.length - 1);
}

function main() {
  let t = "ab" + 1;
  const o: string | null = "opt";
  const none: string | null = null;
  console.log("abc".length, (t + "x").length, "é".charCodeAt(0), size(t), grow(t), t);
  console.log(o?.length, none?.length, o?.charCodeAt(0));
}
// expect: 3 4 233 3 33 ab1!
// expect: 3 null 111
