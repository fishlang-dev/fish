// Prettier's document model and its layout, so the formatter breaks lines where Prettier would:
// a group is printed flat when it fits in what is left of the line, and broken otherwise.

export type Doc =
  | string
  | Doc[]
  // `propagated` marks a group whose breaks are already propagated, so a group shared by several
  // parents is walked once.
  | { kind: "group"; contents: Doc; break: boolean; id: string | undefined; expandedStates: Doc[] | undefined; propagated: boolean }
  | { kind: "indent"; contents: Doc }
  | { kind: "align"; n: f64; contents: Doc }
  | { kind: "line"; soft: boolean; hard: boolean; literal: boolean }
  | { kind: "ifBreak"; breakContents: Doc; flatContents: Doc; groupId: string | undefined }
  | { kind: "indentIfBreak"; contents: Doc; groupId: string; negate: boolean }
  // `printed` counts the parts already laid out, so a long fill is walked once, not copied.
  | { kind: "fill"; parts: Doc[]; printed: usize }
  | { kind: "breakParent" }
  // `endsLine` marks a suffix, such as a line comment, after which nothing may follow on its line.
  | { kind: "lineSuffix"; contents: Doc; endsLine: boolean }
  | { kind: "lineSuffixBoundary" }
  | { kind: "label"; label: string; contents: Doc }
  | { kind: "trim" };

// Each a fresh document, for code that owns what it builds, as Fish's does; the constants below are
// the same documents for code that shares them.
export function newLine(): Doc {
  return { kind: "line", soft: false, hard: false, literal: false };
}
export function newSoftline(): Doc {
  return { kind: "line", soft: true, hard: false, literal: false };
}
export function newBreakParent(): Doc {
  return { kind: "breakParent" };
}
export function newHardline(): Doc {
  return [{ kind: "line", soft: false, hard: true, literal: false }, { kind: "breakParent" }];
}
export function newLiteralline(): Doc {
  return [{ kind: "line", soft: false, hard: true, literal: true }, { kind: "breakParent" }];
}
export function newLineSuffixBoundary(): Doc {
  return { kind: "lineSuffixBoundary" };
}


export function group(contents: Doc, options: { shouldBreak?: boolean; id?: string; expandedStates?: Doc[] } = {}): Doc {
  return { kind: "group", contents, break: options.shouldBreak === true, id: options.id, expandedStates: options.expandedStates, propagated: false };
}

// The first state that fits is printed flat; when none does, the last is printed broken.
// The group's contents are its first state itself, which propagating breaks reaches through it.
export function conditionalGroup(states: Doc[], options: { shouldBreak?: boolean } = {}): Doc {
  const [first, kept] = dup(states.shift()!);
  states.unshift(kept);
  return group(first, { shouldBreak: options.shouldBreak, expandedStates: states });
}

export const indent = (contents: Doc): Doc => ({ kind: "indent", contents });
// An `n` of -Infinity goes back to the left margin, as Prettier's dedentToRoot does.
export const align = (n: f64, contents: Doc): Doc => ({ kind: "align", n, contents });
export const fill = (parts: Doc[]): Doc => ({ kind: "fill", parts, printed: 0 });
export const lineSuffix = (contents: Doc, endsLine = false): Doc => ({ kind: "lineSuffix", contents, endsLine });
export const label = (name: string, contents: Doc): Doc => ({ kind: "label", label: name, contents });

export function ifBreak(breakContents: Doc, flatContents: Doc = "", options: { groupId?: string } = {}): Doc {
  return { kind: "ifBreak", breakContents, flatContents, groupId: options.groupId };
}

export function indentIfBreak(contents: Doc, options: { groupId: string; negate?: boolean }): Doc {
  return { kind: "indentIfBreak", contents, groupId: options.groupId, negate: options.negate === true };
}

export function join(separator: Doc, docs: Doc[]): Doc[] {
  let parts: Doc[] = [];
  let sep = separator;
  // Taken from a copy, since the caller may still read `docs`.
  let items = docs.slice();
  items.reverse();
  while (items.length > 0) {
    if (parts.length > 0) {
      const [one, rest] = dup(sep);
      parts.push(one);
      sep = rest;
    }
    parts.push(items.pop()!);
  }
  return parts;
}

// Gives two owned handles to `x`: a copy in Fish, and the same object in JS, so a document
// shared by two parents stays one, as Prettier's are.
function dup<T>(x: T): [T, T] {
  let m = new Map<usize, T>();
  m.set(0, x);
  return [m.get(0)!, m.get(0)!];
}

type Mode = "break" | "flat";

// The layout works through a stack of commands held as parallel lists: each a document, borrowed
// from the one being printed, laid out in a mode at an indentation and its width, with `at` the
// parts of a fill already laid out. The comments waiting for the line's end are held alike.

const INFINITY: f64 = 1.0 / 0.0;

// ponytail: width counts code points, not East Asian wide characters as two; Prettier's
// getStringWidth does, so a line of wide characters may break later than Prettier's.
function width(s: string): usize {
  return [...s].length;
}

// Trailing spaces and tabs written so far, removed before a newline, giving how many went.
function trimEnd(out: Mut<string[]>): usize {
  let removed: usize = 0;
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const kept = last.replace(/[ \t]*$/, "");
    removed += last.length - kept.length;
    if (kept.length > 0) {
      out[out.length - 1] = kept;
      break;
    }
    out.pop();
  }
  return removed;
}

// Whether a document breaks the group enclosing it, passed down rather than returned so that
// propagating breaks makes no tuple for each document.
type Breaks = { found: boolean };

// Marks every group holding a hard line, or a group already marked, as broken, as Prettier does
// before printing; a group with alternative states is left to choose among them. Gives `doc`
// back, setting `breaks.found` when it breaks the group enclosing it. It changes `doc` in place,
// so a part shared by several parents is one document still.
function propagateBreaks(doc: Doc, breaks: Mut<Breaks>): Doc {
  let d = doc;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return propagateAll(d, breaks);
  if (d.kind === "group") {
    const outer = breaks.found;
    if (!d.propagated) {
      d.propagated = true;
      breaks.found = false;
      if (d.expandedStates !== undefined) {
        const states = propagateAll(d.expandedStates, breaks);
        d.expandedStates = states;
        // The contents are the first state: the same document in JS, already marked, but a copy
        // in Fish, which has to be marked too.
        const found = breaks.found;
        const contents = propagateBreaks(d.contents, breaks);
        d.contents = contents;
        breaks.found = found;
      } else {
        const contents = propagateBreaks(d.contents, breaks);
        d.contents = contents;
      }
      if (breaks.found && d.expandedStates === undefined) d.break = true;
    }
    breaks.found = outer || d.break;
    return d;
  }
  if (d.kind === "breakParent") {
    breaks.found = true;
    return d;
  }
  if (d.kind === "fill") {
    d.parts = propagateAll(d.parts, breaks);
    return d;
  }
  if (d.kind === "ifBreak") {
    d.breakContents = propagateBreaks(d.breakContents, breaks);
    d.flatContents = propagateBreaks(d.flatContents, breaks);
    return d;
  }
  if (d.kind === "indent") {
    d.contents = propagateBreaks(d.contents, breaks);
    return d;
  }
  if (d.kind === "align") {
    d.contents = propagateBreaks(d.contents, breaks);
    return d;
  }
  if (d.kind === "indentIfBreak") {
    d.contents = propagateBreaks(d.contents, breaks);
    return d;
  }
  if (d.kind === "lineSuffix") {
    d.contents = propagateBreaks(d.contents, breaks);
    return d;
  }
  if (d.kind === "label") {
    d.contents = propagateBreaks(d.contents, breaks);
    return d;
  }
  return d;
}

// Each of `docs` with its breaks propagated, kept in the same array.
function propagateAll(docs: Doc[], breaks: Mut<Breaks>): Doc[] {
  let items = docs;
  // A list holding only text, lines and break markers has nothing inside to mark, which is most.
  let flat = true;
  let breakParent = false;
  for (let i: usize = 0; i < items.length && flat; i++) {
    const d: Ref<Doc> = items[i]!;
    if (typeof d === "string") continue;
    if (Array.isArray(d)) flat = false;
    else if (d.kind === "breakParent") breakParent = true;
    else if (d.kind !== "line" && d.kind !== "lineSuffixBoundary" && d.kind !== "trim") flat = false;
  }
  if (flat) {
    if (breakParent) breaks.found = true;
    return items;
  }
  // Taken out from the end and put back from the other, which keeps the order and is cheaper
  // than copying the list.
  let taken: Doc[] = [];
  while (items.length > 0) taken.push(items.pop()!);
  while (taken.length > 0) items.push(propagateBreaks(taken.pop()!, breaks));
  return items;
}

// Whether `next`, laid out in `mode`, and then the commands after it up to the first line break,
// fit in `room`.
function fits(mode: Mode, next: Ref<Doc>[], restDocs: Ref<Ref<Doc>[]>, restModes: Ref<Mode[]>, restAts: Ref<usize[]>, room: i64, hasLineSuffix: boolean, modes: Ref<Map<string, Mode>>, mustBeFlat = false): boolean {
  let left = room;
  let suffix = hasLineSuffix;
  let restAt = restDocs.length;
  let cmdModes: Mode[] = [];
  let cmds: Ref<Doc>[] = [];
  let ats: usize[] = [];
  for (let i = next.length; i > 0; i--) {
    cmdModes.push(mode);
    cmds.push(next[i - 1]!);
    ats.push(0);
  }
  let out: string[] = [];
  // A line's space counts only once something follows it on the line.
  let pendingSpace = false;
  while (left >= 0) {
    if (cmds.length === 0) {
      if (restAt === 0) return true;
      restAt--;
      cmdModes.push(restModes[restAt]!);
      cmds.push(restDocs[restAt]!);
      ats.push(restAts[restAt]!);
      continue;
    }
    const at: Mode = cmdModes.pop()!;
    const doc: Ref<Doc> = cmds.pop()!;
    const from = ats.pop()!;
    if (typeof doc === "string") {
      if (doc.length > 0 && pendingSpace) {
        out.push(" ");
        left--;
        pendingSpace = false;
      }
      out.push(doc);
      left -= width(doc) as i64;
      continue;
    }
    if (Array.isArray(doc)) {
      for (let i = doc.length; i > 0; i--) {
        cmdModes.push(at);
        cmds.push(doc[i - 1]!);
        ats.push(0);
      }
      continue;
    }
    if (doc.kind === "fill") {
      const printed = from > doc.printed ? from : doc.printed;
      for (let i = doc.parts.length; i > printed; i--) {
        cmdModes.push(at);
        cmds.push(doc.parts[i - 1]!);
        ats.push(0);
      }
    } else if (doc.kind === "indent" || doc.kind === "align" || doc.kind === "indentIfBreak" || doc.kind === "label") {
      cmdModes.push(at);
      cmds.push(doc.contents);
      ats.push(0);
    } else if (doc.kind === "trim") {
      left += trimEnd(out) as i64;
    } else if (doc.kind === "group") {
      if (mustBeFlat && doc.break) return false;
      const groupMode: Mode = doc.break ? "break" : at;
      cmdModes.push(groupMode);
      if (doc.expandedStates !== undefined && groupMode === "break") cmds.push(doc.expandedStates[doc.expandedStates.length - 1]!);
      else cmds.push(doc.contents);
      ats.push(0);
    } else if (doc.kind === "ifBreak") {
      const groupMode = doc.groupId !== undefined && doc.groupId !== "" ? (modes.get(doc.groupId) ?? "flat") : at;
      cmdModes.push(at);
      if (groupMode === "break") cmds.push(doc.breakContents);
      else cmds.push(doc.flatContents);
      ats.push(0);
    } else if (doc.kind === "line") {
      if (at === "break" || doc.hard) return true;
      if (!doc.soft) pendingSpace = true;
    } else if (doc.kind === "lineSuffix") {
      suffix = true;
    } else if (doc.kind === "lineSuffixBoundary") {
      // A pending line suffix, such as a trailing comment, would have to print here.
      if (suffix) return false;
    }
  }
  return false;
}

function startsWithHardLine(doc: Ref<Doc>): boolean {
  if (Array.isArray(doc)) return doc.length > 0 && startsWithHardLine(doc[0]!);
  return typeof doc === "object" && doc.kind === "line" && doc.hard;
}

// Lays `doc` out at `printWidth` columns with two-space indentation.
export function print(doc: Doc, printWidth: f64 = 80): string {
  let breaks: Breaks = { found: false };
  const laid = propagateBreaks(doc, breaks);
  let modes = new Map<string, Mode>();
  // The line breaks the layout adds itself, borrowed as the commands borrow the document's own.
  const hardLine: Doc = { kind: "line", soft: false, hard: true, literal: false };
  const hardlineDoc: Doc = newHardline();
  let cDocs: Ref<Doc>[] = [];
  let cModes: Mode[] = [];
  let cIndents: string[] = [];
  let cWidths: usize[] = [];
  let cAts: usize[] = [];
  cDocs.push(laid);
  cModes.push("break");
  cIndents.push("");
  cWidths.push(0);
  cAts.push(0);
  let out: string[] = [];
  let sDocs: Ref<Doc>[] = [];
  let sModes: Mode[] = [];
  let sIndents: string[] = [];
  let sWidths: usize[] = [];
  let sOwnLine: boolean[] = [];
  let sEndsLine: boolean[] = [];
  let pos: i64 = 0;
  let remeasure = false;
  while (cDocs.length > 0) {
    const doc: Ref<Doc> = cDocs.pop()!;
    const mode = cModes.pop()!;
    const ind = cIndents.pop()!;
    const indWidth = cWidths.pop()!;
    const from = cAts.pop()!;
    if (typeof doc === "string") {
      if (cDocs.length > 0) pos += width(doc) as i64;
      out.push(doc);
    } else if (Array.isArray(doc)) {
      for (let i = doc.length; i > 0; i--) { cDocs.push(doc[i - 1]!); cModes.push(mode); cIndents.push(ind); cWidths.push(indWidth); cAts.push(0); }
    } else if (doc.kind === "indent") {
      cDocs.push(doc.contents);
      cModes.push(mode);
      cIndents.push(ind + "  ");
      cWidths.push(indWidth + 2);
      cAts.push(0);
    } else if (doc.kind === "align") {
      if (doc.n === -INFINITY) { cDocs.push(doc.contents); cModes.push(mode); cIndents.push(""); cWidths.push(0); cAts.push(0); }
      else { cDocs.push(doc.contents); cModes.push(mode); cIndents.push(ind + " ".repeat(doc.n as usize)); cWidths.push(indWidth + (doc.n as usize)); cAts.push(0); }
    } else if (doc.kind === "trim") {
      pos -= trimEnd(out) as i64;
    } else if (doc.kind === "group") {
      let chosen: Mode = "break";
      if (mode === "flat" && !remeasure) {
        chosen = doc.break ? "break" : "flat";
        cDocs.push(doc.contents);
        cModes.push(chosen);
        cIndents.push(ind);
        cWidths.push(indWidth);
        cAts.push(0);
      } else {
        remeasure = false;
        const room = roomLeft(printWidth, pos);
        const contents: Ref<Doc>[] = [doc.contents];
        if (!doc.break && fits("flat", contents, cDocs, cModes, cAts, room, sDocs.length > 0, modes)) {
          chosen = "flat";
          cDocs.push(doc.contents);
          cModes.push("flat");
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
        } else if (doc.expandedStates !== undefined) {
          const states: Ref<Doc[]> = doc.expandedStates;
          const fitting = doc.break ? 0 : firstFitting(states, cDocs, cModes, cAts, room, sDocs.length > 0, modes);
          if (fitting > 0) {
            chosen = "flat";
            cDocs.push(states[fitting]!);
            cModes.push("flat");
            cIndents.push(ind);
            cWidths.push(indWidth);
            cAts.push(0);
          } else { cDocs.push(states[states.length - 1]!); cModes.push("break"); cIndents.push(ind); cWidths.push(indWidth); cAts.push(0); }
        } else {
          cDocs.push(doc.contents);
          cModes.push("break");
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
        }
      }
      if (doc.id !== undefined && doc.id !== "") modes.set(doc.id, chosen);
    } else if (doc.kind === "fill") {
      const room = roomLeft(printWidth, pos);
      const at = from > doc.printed ? from : doc.printed;
      if (at < doc.parts.length) {
        const content: Ref<Doc>[] = [doc.parts[at]!];
        const contentFits = fits("flat", content, [], [], [], room, sDocs.length > 0, modes, true);
        const contentMode: Mode = contentFits ? "flat" : "break";
        if (at + 1 === doc.parts.length) {
          cDocs.push(doc.parts[at]!);
          cModes.push(contentMode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
        } else if (doc.parts.length - at === 2) {
          cDocs.push(doc.parts[at + 1]!);
          cModes.push(contentMode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
          cDocs.push(doc.parts[at]!);
          cModes.push(contentMode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
        } else {
          const pair: Ref<Doc>[] = [doc.parts[at]!, doc.parts[at + 1]!, doc.parts[at + 2]!];
          const pairFits = fits("flat", pair, [], [], [], room, sDocs.length > 0, modes, true);
          const whitespaceMode: Mode = pairFits ? "flat" : "break";
          const partMode: Mode = pairFits || contentFits ? "flat" : "break";
          cDocs.push(doc);
          cModes.push(mode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(at + 2);
          cDocs.push(doc.parts[at + 1]!);
          cModes.push(whitespaceMode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
          cDocs.push(doc.parts[at]!);
          cModes.push(partMode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
        }
      }
    } else if (doc.kind === "ifBreak") {
      const groupMode = doc.groupId !== undefined && doc.groupId !== "" ? (modes.get(doc.groupId) ?? "flat") : mode;
      cDocs.push(groupMode === "break" ? doc.breakContents : doc.flatContents);
      cModes.push(mode);
      cIndents.push(ind);
      cWidths.push(indWidth);
      cAts.push(0);
    } else if (doc.kind === "indentIfBreak") {
      const groupMode = doc.groupId !== "" ? (modes.get(doc.groupId) ?? "flat") : mode;
      const indented = groupMode === "break" ? !doc.negate : doc.negate;
      if (indented) { cDocs.push(doc.contents); cModes.push(mode); cIndents.push(ind + "  "); cWidths.push(indWidth + 2); cAts.push(0); }
      else { cDocs.push(doc.contents); cModes.push(mode); cIndents.push(ind); cWidths.push(indWidth); cAts.push(0); }
    } else if (doc.kind === "lineSuffix") {
      // A suffix after one that ends its line starts a line of its own.
      const afterEnding = sEndsLine.length > 0 && sEndsLine[sEndsLine.length - 1]!;
      sDocs.push(doc.contents);
      sModes.push(mode);
      sIndents.push(ind);
      sWidths.push(indWidth);
      sOwnLine.push(afterEnding && !startsWithHardLine(doc.contents));
      sEndsLine.push(doc.endsLine);
    } else if (doc.kind === "lineSuffixBoundary") {
      if (sDocs.length > 0) { cDocs.push(hardLine); cModes.push(mode); cIndents.push(ind); cWidths.push(indWidth); cAts.push(0); }
    } else if (doc.kind === "line") {
      if (mode === "flat" && !doc.hard) {
        if (!doc.soft) {
          out.push(" ");
          pos += 1;
        }
      } else {
        if (mode === "flat") remeasure = true;
        if (sDocs.length > 0) {
          cDocs.push(doc);
          cModes.push(mode);
          cIndents.push(ind);
          cWidths.push(indWidth);
          cAts.push(0);
          while (sDocs.length > 0) {
            const suffixDoc: Ref<Doc> = sDocs.pop()!;
            const suffixMode = sModes.pop()!;
            const suffixIndent = sIndents.pop()!;
            const suffixWidth = sWidths.pop()!;
            cDocs.push(suffixDoc);
            cModes.push(suffixMode);
            cIndents.push(suffixIndent);
            cWidths.push(suffixWidth);
            cAts.push(0);
            if (sOwnLine.pop()!) { cDocs.push(hardlineDoc); cModes.push(suffixMode); cIndents.push(suffixIndent); cWidths.push(suffixWidth); cAts.push(0); }
          }
          sEndsLine = [];
        } else if (doc.literal) {
          out.push("\n");
          pos = 0;
        } else {
          pos -= trimEnd(out) as i64;
          out.push("\n" + ind);
          pos = indWidth as i64;
        }
      }
    } else if (doc.kind === "label") {
      cDocs.push(doc.contents);
      cModes.push(mode);
      cIndents.push(ind);
      cWidths.push(indWidth);
      cAts.push(0);
    }
    if (cDocs.length === 0 && sDocs.length > 0) {
      while (sDocs.length > 0) {
        const suffixDoc: Ref<Doc> = sDocs.pop()!;
        const suffixMode = sModes.pop()!;
        const suffixIndent = sIndents.pop()!;
        const suffixWidth = sWidths.pop()!;
        cDocs.push(suffixDoc);
        cModes.push(suffixMode);
        cIndents.push(suffixIndent);
        cWidths.push(suffixWidth);
        cAts.push(0);
        if (sOwnLine.pop()!) { cDocs.push(hardlineDoc); cModes.push(suffixMode); cIndents.push(suffixIndent); cWidths.push(suffixWidth); cAts.push(0); }
      }
      sEndsLine = [];
    }
  }
  return out.join("");
}

// The first of `states` after the first that fits flat, or 0 when none does.
function firstFitting(states: Ref<Doc[]>, restDocs: Ref<Ref<Doc>[]>, restModes: Ref<Mode[]>, restAts: Ref<usize[]>, room: i64, hasLineSuffix: boolean, modes: Ref<Map<string, Mode>>): usize {
  for (let i: usize = 1; i < states.length; i++) {
    const state: Ref<Doc>[] = [states[i]!];
    if (fits("flat", state, restDocs, restModes, restAts, room, hasLineSuffix, modes)) return i;
  }
  return 0;
}

// What is left of the line at column `pos`, which a width of Infinity never runs out of.
function roomLeft(printWidth: f64, pos: i64): i64 {
  return printWidth === INFINITY ? 9007199254740991 : (printWidth as i64) - pos;
}
