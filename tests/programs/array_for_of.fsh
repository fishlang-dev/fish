type P = { name: string; tags: string[] };

function names(people: Ref<P[]>): string {
  let out = "";
  for (const p of people) {
    out += p.name + ":";
    for (const t of p.tags) {
      if (t === "skip") continue;
      if (t === "stop") break;
      out += t + ",";
    }
    out += ";";
  }
  return out;
}

function find(xs: Ref<string[]>, want: string): i64 {
  let i = 0;
  for (const x of xs) {
    const seen = x + "!";
    if (x === want) return i;
    i++;
  }
  return -1;
}

function make(): string[] {
  return ["m" + 1, "m" + 2];
}

function check(xs: Ref<i64[]>): i64 throws string {
  let t = 0;
  for (const x of xs) {
    const label = "x" + x;
    if (x > 2) throw "too big " + label;
    t += x;
  }
  return t;
}

function main() {
  const nums = [1, 2, 3];
  let sum = 0;
  for (const n of nums) sum += n;
  const people: P[] = [{ name: "ann" + 1, tags: ["a", "skip", "b", "stop", "c"] }, { name: "bo", tags: [] }];
  console.log(sum, names(people), find(make(), "m2"), find(make(), "zz"));
  for (const w of make()) console.log(w);
  try {
    console.log(check([1, 2]), check(nums));
  } catch (e) {
    console.log(e);
  }
  let words = ["x" + 1, "y"];
  for (let w of words) {
    console.log(w.length);
  }
  words.push("z");
  console.log(words.length);
}
// expect: 6 ann1:a,b,;bo:; 1 -1
// expect: m1
// expect: m2
// expect: too big x3
// expect: 2
// expect: 1
// expect: 3
