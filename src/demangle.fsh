// `fishc demangle`: the compiler's symbols in any tool's output rewritten into the Fish names they
// stand for. A symbol is read alone where it can be; what it can't say, a generic instance's type
// arguments and what a helper is for, comes from the `.fshnames` table a build writes beside its
// binary.

const HEADER = "fishc names 1";

// The table's text: a header, then a symbol and its Fish name on each line, each as a JSON string,
// since a type argument's literal text may hold a tab or a newline.
export function namesText(names: Ref<[string, string][]>): string {
  let lines = [HEADER];
  for (const [symbol, fish] of names) lines.push(`${JSON.stringify(symbol)}\t${JSON.stringify(fish)}`);
  return lines.join("\n") + "\n";
}

// A table's entries by symbol; text that isn't one throws.
/** @throws {Error} */
export function namesFrom(text: string): Map<string, string> {
  const lines = text.split("\n");
  if (lines[0] !== HEADER) throw new Error(`it doesn't start with '${HEADER}'`);
  let out = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;
    const tab = line.indexOf("\t");
    let symbol: string | undefined = undefined;
    let fish: string | undefined = undefined;
    try {
      if (tab > 0) {
        symbol = JSON.parse<string>(line.slice(0, tab));
        fish = JSON.parse<string>(line.slice(tab + 1));
      }
    } catch (e) {
      symbol = undefined;
    }
    if (symbol === undefined || fish === undefined)
      throw new Error(`line ${i + 1} isn't a symbol and a name`);
    out.set(symbol!, fish!);
  }
  return out;
}

// A symbol as it reads with no table: without `fsh.`, and without the hash telling a generic
// body's instances apart or the digest telling apart names that read alike. A private member's
// `#` follows a dot or a space and is kept.
export function plainName(symbol: string): string {
  const name = symbol.startsWith("fsh.") ? symbol.slice(4) : symbol;
  return name
    .replace(/([^.\s])#[0-9a-z]{6}(\.[0-9]+)?(?=$|\.)/g, "$1")
    .replace(/~[0-9a-z]{6}(\.[0-9]+)?(?=$|\.)/g, "");
}

// The part of a symbol after `fsh.` that the table's entries are grouped by.
const head = (text: string, from: i64): string =>
  /^[\w$]*/.exec(text.slice(from))![0]!;

// What a tool's output says with each symbol in Fish's words. A symbol starts at `fsh.`, or `_fsh.`
// as Mach-O spells it, after anything that can't be part of a path or a longer name; the table's
// longest entry there is taken, and otherwise the symbol as far as it runs is read alone.
export function demangled(
  text: string,
  names: Ref<Map<string, string>>,
): string {
  // Longest first, so the longest entry at a place is the one found there.
  let symbols = [...names.keys()];
  symbols.sort((a, b) => (b.length as i64) - (a.length as i64));
  let byHead = new Map<string, string[]>();
  for (const symbol of symbols) {
    const h = head(symbol, 4);
    const had = byHead.get(h);
    if (had === undefined) byHead.set(h, [symbol]);
    else {
      let list: string[] = had;
      list.push(symbol);
      byHead.set(h, list);
    }
  }
  let out = "";
  let from = 0;
  for (
    let at = text.indexOf("fsh.");
    at >= 0;
    at = text.indexOf("fsh.", at + 4)
  ) {
    if (at < from) continue;
    let start = at;
    if (start > 0 && text.charCodeAt((start - 1) as usize) === 95) start--;
    if (start > 0 && /[\w.$\/-]/.test(text.charAt(start - 1))) continue;
    const list = byHead.get(head(text, at + 4));
    let matched: string | undefined = undefined;
    if (list !== undefined)
      for (const symbol of list)
        if (
          text.startsWith(symbol, at) &&
          !continues(text, at + (symbol.length as i64))
        ) {
          matched = symbol;
          break;
        }
    let end = at;
    let name = "";
    if (matched !== undefined) {
      end = at + (matched!.length as i64);
      name = names.get(matched!)!;
    } else {
      const run = /^[^\s'"()`+,;]+/
        .exec(text.slice(at))![0]!
        .replace(/[.:]+$/, "");
      end = at + (run.length as i64);
      name = plainName(run);
    }
    out += text.slice(from, start) + name;
    from = end;
  }
  return out + text.slice(from);
}

// Whether a symbol matched up to `at` runs on past it, into a longer name the table doesn't have.
function continues(text: string, at: i64): boolean {
  if (at >= (text.length as i64)) return false;
  const c = text.charAt(at);
  if (/[\w$#~<]/.test(c)) return true;
  return (
    c === "." &&
    at + 1 < (text.length as i64) &&
    /[\w$]/.test(text.charAt(at + 1))
  );
}

// What each family of helpers made for a type does, as its Fish name says it.
const HELPERS = new Map<string, string>([
  ["drop", "drop"],
  ["copy", "copy"],
  ["element.drop", "dropElements"],
  ["eq", "equals"],
  ["json", "toJson"],
  ["json.read", "fromJson"],
  ["text", "toText"],
  ["insp", "inspect"],
  ["sort.order", "sortOrder"],
]);

// A helper's Fish name from its family and the type it was made for, given as `<family> <type>`.
export function helperName(made: string): string {
  const space = made.indexOf(" ");
  const family = made.slice(0, space);
  return `${HELPERS.get(family) ?? family}<${made.slice(space + 1)}>`;
}
