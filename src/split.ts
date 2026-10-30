// A dev build's IR split into two modules: std's part, whose text is the same whatever the
// program's own code says, so its object can be cached, and the program's part, compiled fresh.
//
// Std's part is every definition its functions reach, stopping at the program's: its own functions,
// and the generated glue that reaches them, such as a Dyn's thunk calling one of its closures,
// whose text changes with the closure's body even when std's generic function holding it doesn't.
// The program's part is everything else: those, what only they reach, and the entry glue (`main`,
// the constants' filler, the constructor list). Private constants are copied into
// each part that uses them, since they can't be referenced across modules. Every other
// definition loses `internal`, so the other part can reach it through a declaration.

// `name` as the IR spells it, and `key` without the quotes it may have, so `@"f"` and `@f` meet.
type Item = { kind: "define" | "declare" | "global"; name: string; key: string; text: string };

const key = (name: string) => name.replace(/^"(.*)"$/, "$1");

const NAME = /@("[^"]*"|[\w.$-]+)/;
const NAMES = /@("[^"]*"|[\w.$-]+)/g;

function items(ir: string): Item[] {
  const found: Item[] = [];
  const lines = ir.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;
    const name = NAME.exec(line)?.[1] ?? "";
    if (line.startsWith("define ")) {
      const end = lines.indexOf("}", i);
      found.push({ kind: "define", name, key: key(name), text: lines.slice(i, end + 1).join("\n") });
      i = end;
    } else if (line.startsWith("declare ")) found.push({ kind: "declare", name, key: key(name), text: line });
    else if (line.startsWith("@")) found.push({ kind: "global", name, key: key(name), text: line });
    else throw new Error(`can't split the IR at '${line}'`);
  }
  return found;
}

// The names an item refers to, its own included. String constants' bytes are left out, since an
// `@` in them names nothing.
const references = (item: Item) => [...item.text.replace(/ x i8\] c"[^"]*"/g, "").matchAll(NAMES)].map((m) => key(m[1]!));

const copied = (item: Item) => item.kind === "global" && / = private unnamed_addr constant /.test(item.text);

// A definition as the other part declares it.
function declaration(item: Item): string {
  if (item.kind === "global") {
    const [, keyword, rest] = / = (?:\w+ )*?(global|constant) (.*)$/.exec(item.text)!;
    return `@${item.name} = external ${keyword} ${typeAt(rest!)}`;
  }
  const header = item.text.slice(0, item.text.indexOf("\n"));
  const at = header.indexOf(`@${item.name}(`);
  const open = at + item.name.length + 1;
  const params = header.slice(open, closing(header, open) + 1).replace(/ %("[^"]*"|[\w.$-]+)/g, "");
  return `declare ${header.slice("define ".length, at).replace(/^internal /, "")}@${item.name}${params}`;
}

// The index of the bracket closing the one at `open`.
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if ("([{<".includes(text[i]!)) depth++;
    else if (")]}>".includes(text[i]!) && --depth === 0) return i;
  }
  throw new Error(`unbalanced IR: '${text}'`);
}

// The type at the start of `text`.
const typeAt = (text: string) => ("{[<".includes(text[0]!) ? text.slice(0, closing(text, 0) + 1) : text.split(" ")[0]!);

const exposed = (item: Item) => (item.kind === "define" ? item.text.replace(/^define internal /, "define ") : item.text.replace(/ = (internal|private) /, " = "));

// The IR split into std's part and the program's. `stdSymbols` names std's functions and
// `ownSymbols` the program's, as the IR spells them.
export function split(ir: string, stdSymbols: string[], ownSymbols: string[]): { std: string; program: string } {
  const keys = (symbols: string[]) => new Set(symbols.map((s) => key(s.slice(1))));
  const [std, own] = [keys(stdSymbols), keys(ownSymbols)];
  const all = items(ir);
  const byName = new Map(all.map((i) => [i.key, i]));
  const glue = (i: Item) => i.kind !== "declare" && !copied(i) && !std.has(i.key) && !own.has(i.key);
  const referrers = new Map<string, Item[]>();
  for (const item of all.filter(glue)) {
    for (const name of references(item)) referrers.set(name, referrers.get(name) ?? []).get(name)!.push(item);
  }
  const program = new Set(all.filter((i) => own.has(i.key)).map((i) => i.key));
  for (const pending = [...program]; pending.length > 0; ) {
    for (const item of referrers.get(pending.pop()!) ?? []) {
      if (program.has(item.key)) continue;
      program.add(item.key);
      pending.push(item.key);
    }
  }
  const reached = new Set<string>();
  const work = all.filter((i) => i.kind === "define" && std.has(i.key)).map((i) => i.key);
  while (work.length > 0) {
    const name = work.pop()!;
    const item = byName.get(name);
    if (reached.has(name) || !item || item.kind === "declare" || copied(item) || program.has(name)) continue;
    reached.add(name);
    work.push(...references(item));
  }
  const part = (owns: (i: Item) => boolean) => {
    const used = new Set<string>();
    const pending = all.filter(owns).map((i) => i.key);
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (used.has(name)) continue;
      used.add(name);
      const item = byName.get(name);
      if (item && (owns(item) || copied(item))) pending.push(...references(item));
    }
    const lines = all.filter((i) => used.has(i.key)).map((i) => (copied(i) || i.kind === "declare" ? i.text : owns(i) ? exposed(i) : declaration(i)));
    return `${lines.join("\n")}\n`;
  };
  const isStd = (i: Item) => reached.has(i.key);
  return { std: part(isStd), program: part((i) => i.kind !== "declare" && !copied(i) && !isStd(i)) };
}
