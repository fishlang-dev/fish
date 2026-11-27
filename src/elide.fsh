// Reference-count pairs a function's IR does without. A string, bigint or task handle copied out of
// a local's slot, where nothing reads the slot again before the local is dropped, is the local
// moved: the copy can take over the slot's reference, so the retain making the copy and the
// release dropping the local cancel. Only a slot no other instruction can reach qualifies, one
// whose address is only loaded from and stored to, and only within one block holding no invoke,
// whose unwind path would drop the local too.

// Each retain and the release that cancels it.
const RELEASES = new Map<string, string>([["fsh_rt_str_retain", "fsh_rt_str_release"], ["fsh_rt_big_retain", "fsh_rt_big_release"], ["fsh_rt_handle_retain", "fsh_rt_handle_drop"]]);

// A local name, as %t3, %message.0 or %"message.arg".
const NAMES = /%(?:"[^"]*"|[\w.$-]+)/g;
const ALLOCA = /^\s*(%(?:"[^"]*"|[\w.$-]+)) = alloca /;
const LOAD = /^\s*(%(?:"[^"]*"|[\w.$-]+)) = load ptr, ptr (%(?:"[^"]*"|[\w.$-]+))(?:, !dbg !\d+)?$/;
const STORE = /^\s*store ptr (\S+), ptr (%(?:"[^"]*"|[\w.$-]+))(?:, !dbg !\d+)?$/;
const RETAIN = /^\s*call void @(fsh_rt_(?:str|big|handle)_retain)\(ptr (%(?:"[^"]*"|[\w.$-]+))\)(?:, !dbg !\d+)?$/;
const CALL = /^\s*call void @(fsh_rt_\w+)\(ptr (%(?:"[^"]*"|[\w.$-]+))\)(?:, !dbg !\d+)?$/;
const ENDS = /^\s*(?:br |ret\b|switch |unreachable|resume |indirectbr )/;
const LABEL = /^[^\s;][^:]*:/;

// The slots, among `lines`' allocas, that only a load or a store names, as its address.
function privateSlots(lines: Ref<string[]>): Set<string> {
  let slots = new Set<string>();
  for (const line of lines) {
    const a = ALLOCA.exec(line);
    if (a !== null) slots.add(a[1]!);
  }
  let escaped = new Set<string>();
  for (const line of lines) {
    if (ALLOCA.test(line)) continue;
    const l = LOAD.exec(line);
    if (l !== null) continue;
    const s = STORE.exec(line);
    if (s !== null) {
      if (slots.has(s[1]!)) escaped.add(s[1]!);
      continue;
    }
    for (const name of tokens(line)) if (slots.has(name)) escaped.add(name);
  }
  let kept = new Set<string>();
  for (const s of slots) if (!escaped.has(s)) kept.add(s);
  return kept;
}

// The local names `line` mentions.
function tokens(line: string): string[] {
  const found = line.match(NAMES);
  if (found === null) {
    const none: string[] = [];
    return none;
  }
  return found;
}

// Whether `line` names `slot`.
function names(line: string, slot: string): boolean {
  for (const name of tokens(line)) if (name === slot) return true;
  return false;
}

// The index of the release ending the local `slot` that the retain at `at` copied out of, or -1:
// the slot read again and at once emptied and released, with no other mention of it, no invoke
// and no block's end between. After the first call between, which may take the copy over and
// free it, only other values' releases may come: nothing that could read a value loaded from the
// slot, `read`, or a pointer into one.
function droppedAt(lines: Ref<string[]>, at: usize, slot: string, release: string, read: Ref<Set<string>>, taken: Ref<Set<usize>>): i64 {
  let called = false;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (ENDS.test(line) || LABEL.test(line) || line.includes(" invoke ") || line.trimStart().startsWith("invoke ")) return -1;
    if (names(line, slot)) {
      const again = LOAD.exec(line);
      if (again === null || again[2] !== slot || i + 2 >= lines.length) return -1;
      const emptied = STORE.exec(lines[i + 1]!);
      if (emptied === null || emptied[2] !== slot || (emptied[1] !== "zeroinitializer" && emptied[1] !== "null")) return -1;
      const dropped = CALL.exec(lines[i + 2]!);
      if (dropped === null || dropped[1] !== release || dropped[2] !== again[1] || taken.has(i + 2)) return -1;
      return (i + 2) as i64;
    }
    if (called) {
      const other = CALL.exec(line);
      if (other === null || !(other[1]!.endsWith("_release") || other[1]!.endsWith("_drop")) || read.has(other[2]!)) return -1;
    }
    if (line.includes(" call ") && !line.includes("@llvm.")) called = true;
  }
  return -1;
}

// `lines`, one function's, without the retain and release pairs that cancel.
export function elided(lines: string[]): string[] {
  if (!lines.some((l) => l.includes("_retain(ptr %"))) return lines;
  const slots = privateSlots(lines);
  if (slots.size === 0) return lines;
  // Every value each private slot is read into.
  let reads = new Map<string, Set<string>>();
  for (const line of lines) {
    const l = LOAD.exec(line);
    if (l === null || !slots.has(l[2]!)) continue;
    let into = reads.get(l[2]!) ?? new Set<string>();
    into.add(l[1]!);
    reads.set(l[2]!, into);
  }
  // Each value loaded from a private slot: its slot and where it was loaded, in this block.
  let loaded = new Map<string, [string, usize]>();
  let gone = new Set<usize>();
  for (let i: usize = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (LABEL.test(line)) {
      loaded.clear();
      continue;
    }
    const l = LOAD.exec(line);
    if (l !== null && slots.has(l[2]!)) {
      loaded.set(l[1]!, [l[2]!, i]);
      continue;
    }
    const s = STORE.exec(line);
    if (s !== null && slots.has(s[2]!)) {
      // A value loaded before the slot changed is no longer what it holds.
      for (const v of [...loaded.keys()]) if (loaded.get(v)![0] === s[2]!) loaded.delete(v);
      continue;
    }
    const r = RETAIN.exec(line);
    if (r === null) continue;
    const from = loaded.get(r[2]!);
    if (from === undefined) continue;
    const release = RELEASES.get(r[1]!)!;
    const end = droppedAt(lines, i, from[0], release, reads.get(from[0])!, gone);
    if (end < 0) continue;
    gone.add(i);
    gone.add(end as usize);
  }
  if (gone.size === 0) return lines;
  let out: string[] = [];
  for (let i: usize = 0; i < lines.length; i++) if (!gone.has(i)) out.push(lines[i]!);
  return out;
}
