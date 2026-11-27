// Reference-count pairs a function's IR does without. A string, bigint or task handle copied out of
// a local's slot, where nothing reads the slot again before the local is dropped, is the local
// moved: the copy can take over the slot's reference, so the retain making the copy and the
// release dropping the local cancel. Only a slot no other instruction can reach qualifies, one
// whose address is only loaded from and stored to, and only within one block holding no invoke,
// whose unwind path would drop the local too.

// Each retain and the release that cancels it.
const RELEASES = new Map<string, string>([["fsh_rt_str_retain", "fsh_rt_str_release"], ["fsh_rt_big_retain", "fsh_rt_big_release"], ["fsh_rt_handle_retain", "fsh_rt_handle_drop"]]);

const RETAIN = /^\s*call void @(fsh_rt_(?:str|big|handle)_retain)\(ptr (%(?:"[^"]*"|[\w.$-]+))\)(?:, !dbg !\d+)?$/;
const CALL = /^\s*call void @(fsh_rt_\w+)\(ptr (%(?:"[^"]*"|[\w.$-]+))\)(?:, !dbg !\d+)?$/;

// Whether `line` starts a block: a label, unindented, unlike every instruction.
function label(line: string): boolean {
  return line.length > 0 && !line.startsWith(" ") && !line.startsWith(";");
}

// An operand up to the line's end, or to the ", !dbg" after it.
function operand(text: string): string {
  const cut = text.indexOf(", !");
  return cut < 0 ? text : text.slice(0, cut);
}

// The value and the slot of a `%v = load ptr, ptr %slot` line, else null. String tests, not
// regexes: they run on every load of every function holding a retain.
function loadOf(line: string): [string, string] | null {
  const at = line.indexOf(" = load ptr, ptr %");
  if (at < 0 || !line.startsWith("  %")) return null;
  return [line.slice(2, at), operand(line.slice(at + 17))];
}

// The value and the slot of a `store ptr <value>, ptr %slot` line, else null.
function storeOf(line: string): [string, string] | null {
  if (!line.startsWith("  store ptr ")) return null;
  const at = line.indexOf(", ptr %", 12);
  if (at < 0) return null;
  return [line.slice(12, at), operand(line.slice(at + 6))];
}

// Whether `line` ends its block.
function ends(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("br ") || t.startsWith("ret ") || t.startsWith("switch ") || t.startsWith("unreachable") || t.startsWith("resume ") || t.startsWith("indirectbr ") || t.startsWith("invoke ") || line.includes(" invoke ");
}

// Whether `line` names the local `name` itself, not one it begins.
function mentions(line: string, name: string): boolean {
  let at = line.indexOf(name);
  while (at >= 0) {
    const next = at + (name.length as i64);
    if (next >= (line.length as i64) || !nameCode(line.charCodeAt(next as usize) as i64)) return true;
    at = line.indexOf(name, next);
  }
  return false;
}

// Whether a character code can be part of a local's name: a letter, digit, '_', '.', '$' or '-'.
function nameCode(c: i64): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 46 || c === 36 || c === 45;
}

// The local names `line` mentions, in one scan of it.
function namesIn(line: string): string[] {
  let found: string[] = [];
  const n = line.length as i64;
  let at = line.indexOf("%");
  while (at >= 0) {
    let end = at + 1;
    if (end < n && line.charCodeAt(end as usize) === 34) {
      const close = line.indexOf("\"", end + 1);
      end = close < 0 ? n : close + 1;
    } else {
      while (end < n && nameCode(line.charCodeAt(end as usize) as i64)) end++;
    }
    found.push(line.slice(at, end));
    at = line.indexOf("%", end);
  }
  return found;
}

// Which of `slots` some instruction other than its alloca, a load from it or a store to it, as
// the address, names: one whose address another instruction or a call could reach.
function escaped(lines: Ref<string[]>, slots: Ref<Set<string>>): Set<string> {
  let out = new Set<string>();
  for (const line of lines) {
    if (!line.includes("%")) continue;
    if (loadOf(line) !== null) continue;
    const s = storeOf(line);
    if (s !== null) {
      if (slots.has(s[0])) out.add(s[0]);
      continue;
    }
    if (line.includes(" = alloca ")) continue;
    for (const name of namesIn(line)) if (slots.has(name)) out.add(name);
  }
  return out;
}

// Whether `value` was loaded from `slot` anywhere before line `before`.
function readFrom(lines: Ref<string[]>, value: string, slot: string, before: usize): boolean {
  const load = `  ${value} = load ptr, ptr ${slot}`;
  for (let i: usize = 0; i < before; i++) {
    const line = lines[i]!;
    if (line.startsWith(load) && (line.length === load.length || line.startsWith(", ", load.length as i64))) return true;
  }
  return false;
}

// The index of the release ending the local `slot` that the retain at `at` copied out of, or -1:
// the slot read again and at once emptied and released, with no other mention of it, no invoke
// and no block's end between. After the first call between, which may take the copy over and
// free it, only releases of values not read from the slot may come: nothing that could read the
// value or a pointer into it.
function droppedAt(lines: Ref<string[]>, at: usize, slot: string, release: string): i64 {
  let called = false;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (label(line) || ends(line)) return -1;
    if (mentions(line, slot)) {
      const again = loadOf(line);
      if (again === null || again[1] !== slot || i + 2 >= lines.length) return -1;
      const emptied = storeOf(lines[i + 1]!);
      if (emptied === null || emptied[1] !== slot || (emptied[0] !== "zeroinitializer" && emptied[0] !== "null")) return -1;
      const dropped = CALL.exec(lines[i + 2]!);
      if (dropped === null || dropped[1] !== release || dropped[2] !== again[0]) return -1;
      return (i + 2) as i64;
    }
    const call = line.includes(" call ") && !line.includes("@llvm.");
    if (called) {
      const other = call ? CALL.exec(line) : null;
      if (other === null || !(other[1]!.endsWith("_release") || other[1]!.endsWith("_drop")) || readFrom(lines, other[2]!, slot, i)) return -1;
    }
    if (call) called = true;
  }
  return -1;
}

// `lines`, one function's, without the retain and release pairs that cancel.
export function elided(lines: string[]): string[] {
  // Each retain of a value loaded from a slot in the retain's own block, the slot holding it
  // still: the retain's index, its function and its slot.
  let retains: [usize, string, string][] = [];
  let blockStart: usize = 0;
  for (let i: usize = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (label(line)) {
      blockStart = i;
      continue;
    }
    if (!line.includes("_retain(ptr %")) continue;
    const r = RETAIN.exec(line);
    if (r === null) continue;
    const load = `  ${r[2]!} = load ptr, ptr %`;
    let slot = "";
    let from: usize = 0;
    for (let j = i; j > blockStart; j--) {
      if (!lines[j - 1]!.startsWith(load)) continue;
      const l = loadOf(lines[j - 1]!);
      if (l !== null && l[0] === r[2]!) {
        slot = l[1];
        from = j - 1;
      }
      break;
    }
    if (slot === "") continue;
    let held = true;
    for (let j = from + 1; j < i; j++) {
      const s = storeOf(lines[j]!);
      if (s !== null && s[1] === slot) held = false;
    }
    if (held) retains.push([i, r[1]!, slot]);
  }
  if (retains.length === 0) return lines;
  // Each retain whose slot is read, emptied and released after it, found before the slot's
  // privacy is checked: that scan reads the whole function, and most functions have no such pair.
  let found: [usize, usize, string][] = [];
  let candidates = new Set<string>();
  for (const [at, retain, slot] of retains) {
    const end = droppedAt(lines, at, slot, RELEASES.get(retain)!);
    if (end < 0) continue;
    found.push([at, end as usize, slot]);
    candidates.add(slot);
  }
  if (found.length === 0) return lines;
  const reached = escaped(lines, candidates);
  let gone = new Set<usize>();
  for (const [at, end, slot] of found) {
    if (reached.has(slot) || gone.has(end)) continue;
    gone.add(at);
    gone.add(end);
  }
  if (gone.size === 0) return lines;
  let out: string[] = [];
  for (let i: usize = 0; i < lines.length; i++) if (!gone.has(i)) out.push(lines[i]!);
  return out;
}
