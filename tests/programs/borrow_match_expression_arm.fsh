// error: 'v' doesn't live long enough
function mk(): string[] | null { return ["a" + 1, "x"]; }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  match (mk()) {
    case Some(v) => h = { r: v },
    case _ => h = { r: o },
  };
  let junk: string[] = [];
  for (let j = 0; j < 50; j++) junk.push("junk" + j);
  console.log(h.r.length, h.r[0]);
}
