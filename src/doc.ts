// Prettier's document model and its layout, so the formatter breaks lines where Prettier would:
// a group is printed flat when it fits in what is left of the line, and broken otherwise.

export type Doc =
  | string
  | Doc[]
  | { kind: "group"; contents: Doc; break: boolean; id: string | undefined; expandedStates: Doc[] | undefined }
  | { kind: "indent"; contents: Doc }
  | { kind: "align"; n: number; contents: Doc }
  | { kind: "line"; soft: boolean; hard: boolean; literal: boolean }
  | { kind: "ifBreak"; breakContents: Doc; flatContents: Doc; groupId: string | undefined }
  | { kind: "indentIfBreak"; contents: Doc; groupId: string; negate: boolean }
  | { kind: "fill"; parts: Doc[] }
  | { kind: "breakParent" }
  | { kind: "lineSuffix"; contents: Doc }
  | { kind: "lineSuffixBoundary" }
  | { kind: "label"; label: string; contents: Doc }
  | { kind: "trim" };

export const line: Doc = { kind: "line", soft: false, hard: false, literal: false };
export const softline: Doc = { kind: "line", soft: true, hard: false, literal: false };
export const breakParent: Doc = { kind: "breakParent" };
export const hardline: Doc = [{ kind: "line", soft: false, hard: true, literal: false }, breakParent];
export const literalline: Doc = [{ kind: "line", soft: false, hard: true, literal: true }, breakParent];
export const lineSuffixBoundary: Doc = { kind: "lineSuffixBoundary" };
export const trim: Doc = { kind: "trim" };

export function group(contents: Doc, options: { shouldBreak?: boolean; id?: string; expandedStates?: Doc[] } = {}): Doc {
  return { kind: "group", contents, break: options.shouldBreak === true, id: options.id, expandedStates: options.expandedStates };
}

// The first state that fits is printed flat; when none does, the last is printed broken.
export function conditionalGroup(states: Doc[], options: { shouldBreak?: boolean } = {}): Doc {
  return group(states[0]!, { ...options, expandedStates: states });
}

export const indent = (contents: Doc): Doc => ({ kind: "indent", contents });
// An `n` of -Infinity goes back to the left margin, as Prettier's dedentToRoot does.
export const align = (n: number, contents: Doc): Doc => ({ kind: "align", n, contents });
export const fill = (parts: Doc[]): Doc => ({ kind: "fill", parts });
export const lineSuffix = (contents: Doc): Doc => ({ kind: "lineSuffix", contents });
export const label = (name: string, contents: Doc): Doc => ({ kind: "label", label: name, contents });

export function ifBreak(breakContents: Doc, flatContents: Doc = "", options: { groupId?: string } = {}): Doc {
  return { kind: "ifBreak", breakContents, flatContents, groupId: options.groupId };
}

export function indentIfBreak(contents: Doc, options: { groupId: string; negate?: boolean }): Doc {
  return { kind: "indentIfBreak", contents, groupId: options.groupId, negate: options.negate === true };
}

export function join(separator: Doc, docs: Doc[]): Doc[] {
  const parts: Doc[] = [];
  docs.forEach((d, i) => {
    if (i > 0) parts.push(separator);
    parts.push(d);
  });
  return parts;
}

let groupIds = 0;
// A name for a group, so an `ifBreak` elsewhere can ask how it was printed.
export function groupId(name: string): string {
  return `${name}#${++groupIds}`;
}

type Mode = "break" | "flat";
type Indentation = { value: string; length: number };
type Command = { ind: Indentation; mode: Mode; doc: Doc };

const root: Indentation = { value: "", length: 0 };
const deeper = (ind: Indentation, by: string): Indentation => ({ value: ind.value + by, length: ind.length + by.length });

// ponytail: width counts code points, not East Asian wide characters as two; Prettier's
// getStringWidth does, so a line of wide characters may break later than Prettier's.
const width = (s: string) => [...s].length;

// Trailing spaces and tabs written so far, removed before a newline, giving how many went.
function trimEnd(out: string[]): number {
  let removed = 0;
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

// Marks every group holding a hard line, or a group already marked, as broken, as Prettier does
// before printing; a group with alternative states is left to choose among them.
function propagateBreaks(doc: Doc) {
  const seen = new Set<Doc>();
  const stack: Extract<Doc, { kind: "group" }>[] = [];
  const breakTop = () => {
    const top = stack[stack.length - 1];
    if (top && !top.expandedStates && !top.break) top.break = true;
  };
  const visit = (d: Doc) => {
    if (typeof d === "string") return;
    if (Array.isArray(d)) return d.forEach(visit);
    switch (d.kind) {
      case "breakParent":
        breakTop();
        return;
      case "group": {
        stack.push(d);
        if (!seen.has(d)) {
          seen.add(d);
          if (d.expandedStates) d.expandedStates.forEach(visit);
          else visit(d.contents);
        }
        stack.pop();
        if (d.break) breakTop();
        return;
      }
      case "fill":
        return d.parts.forEach(visit);
      case "ifBreak":
        visit(d.breakContents);
        return visit(d.flatContents);
      case "indent":
      case "align":
      case "indentIfBreak":
      case "lineSuffix":
      case "label":
        return visit(d.contents);
      case "line":
      case "lineSuffixBoundary":
      case "trim":
        return;
    }
  };
  visit(doc);
}

// Whether `next`, and then the commands after it up to the first line break, fit in `room`.
function fits(next: Command, rest: Command[], room: number, hasLineSuffix: boolean, modes: Map<string, Mode>, mustBeFlat = false): boolean {
  let restAt = rest.length;
  const cmds: { mode: Mode; doc: Doc }[] = [next];
  const out: string[] = [];
  while (room >= 0) {
    if (cmds.length === 0) {
      if (restAt === 0) return true;
      cmds.push(rest[--restAt]!);
      continue;
    }
    const { mode, doc } = cmds.pop()!;
    if (typeof doc === "string") {
      out.push(doc);
      room -= width(doc);
      continue;
    }
    if (Array.isArray(doc)) {
      for (let i = doc.length - 1; i >= 0; i--) cmds.push({ mode, doc: doc[i]! });
      continue;
    }
    switch (doc.kind) {
      case "fill":
        for (let i = doc.parts.length - 1; i >= 0; i--) cmds.push({ mode, doc: doc.parts[i]! });
        break;
      case "indent":
      case "align":
      case "indentIfBreak":
      case "label":
        cmds.push({ mode, doc: doc.contents });
        break;
      case "trim":
        room += trimEnd(out);
        break;
      case "group": {
        if (mustBeFlat && doc.break) return false;
        const groupMode: Mode = doc.break ? "break" : mode;
        const contents = doc.expandedStates && groupMode === "break" ? doc.expandedStates[doc.expandedStates.length - 1]! : doc.contents;
        cmds.push({ mode: groupMode, doc: contents });
        break;
      }
      case "ifBreak": {
        const groupMode = doc.groupId ? (modes.get(doc.groupId) ?? "flat") : mode;
        cmds.push({ mode, doc: groupMode === "break" ? doc.breakContents : doc.flatContents });
        break;
      }
      case "line":
        if (mode === "break" || doc.hard) return true;
        if (!doc.soft) {
          out.push(" ");
          room--;
        }
        break;
      case "lineSuffix":
        hasLineSuffix = true;
        break;
      case "lineSuffixBoundary":
        if (hasLineSuffix) return true;
        break;
      case "breakParent":
        break;
    }
  }
  return false;
}

// Lays `doc` out at `printWidth` columns with two-space indentation.
export function print(doc: Doc, printWidth = 80): string {
  propagateBreaks(doc);
  const modes = new Map<string, Mode>();
  const cmds: Command[] = [{ ind: root, mode: "break", doc }];
  const out: string[] = [];
  const suffixes: Command[] = [];
  let pos = 0;
  let remeasure = false;
  while (cmds.length > 0) {
    const { ind, mode, doc } = cmds.pop()!;
    if (typeof doc === "string") {
      out.push(doc);
      if (cmds.length > 0) pos += width(doc);
    } else if (Array.isArray(doc)) {
      for (let i = doc.length - 1; i >= 0; i--) cmds.push({ ind, mode, doc: doc[i]! });
    } else {
      switch (doc.kind) {
        case "indent":
          cmds.push({ ind: deeper(ind, "  "), mode, doc: doc.contents });
          break;
        case "align":
          cmds.push({ ind: doc.n === -Infinity ? root : deeper(ind, " ".repeat(doc.n)), mode, doc: doc.contents });
          break;
        case "trim":
          pos -= trimEnd(out);
          break;
        case "group": {
          if (mode === "flat" && !remeasure) {
            cmds.push({ ind, mode: doc.break ? "break" : "flat", doc: doc.contents });
          } else {
            remeasure = false;
            const next: Command = { ind, mode: "flat", doc: doc.contents };
            const room = printWidth - pos;
            if (!doc.break && fits(next, cmds, room, suffixes.length > 0, modes)) {
              cmds.push(next);
            } else if (doc.expandedStates) {
              const last = doc.expandedStates[doc.expandedStates.length - 1]!;
              if (doc.break) {
                cmds.push({ ind, mode: "break", doc: last });
              } else {
                let chosen: Command = { ind, mode: "break", doc: last };
                for (const state of doc.expandedStates.slice(1)) {
                  const flat: Command = { ind, mode: "flat", doc: state };
                  if (fits(flat, cmds, room, suffixes.length > 0, modes)) {
                    chosen = flat;
                    break;
                  }
                }
                cmds.push(chosen);
              }
            } else {
              cmds.push({ ind, mode: "break", doc: doc.contents });
            }
          }
          if (doc.id) modes.set(doc.id, cmds[cmds.length - 1]!.mode);
          break;
        }
        case "fill": {
          const room = printWidth - pos;
          const [content, whitespace] = doc.parts;
          if (content === undefined) break;
          const contentFlat: Command = { ind, mode: "flat", doc: content };
          const contentBreak: Command = { ind, mode: "break", doc: content };
          const contentFits = fits(contentFlat, [], room, suffixes.length > 0, modes, true);
          if (whitespace === undefined) {
            cmds.push(contentFits ? contentFlat : contentBreak);
            break;
          }
          const whitespaceFlat: Command = { ind, mode: "flat", doc: whitespace };
          const whitespaceBreak: Command = { ind, mode: "break", doc: whitespace };
          if (doc.parts.length === 2) {
            if (contentFits) cmds.push(whitespaceFlat, contentFlat);
            else cmds.push(whitespaceBreak, contentBreak);
            break;
          }
          const remaining: Command = { ind, mode, doc: fill(doc.parts.slice(2)) };
          const pairFits = fits({ ind, mode: "flat", doc: [content, whitespace, doc.parts[2]!] }, [], room, suffixes.length > 0, modes, true);
          if (pairFits) cmds.push(remaining, whitespaceFlat, contentFlat);
          else if (contentFits) cmds.push(remaining, whitespaceBreak, contentFlat);
          else cmds.push(remaining, whitespaceBreak, contentBreak);
          break;
        }
        case "ifBreak":
        case "indentIfBreak": {
          const groupMode = doc.groupId ? (modes.get(doc.groupId) ?? "flat") : mode;
          if (doc.kind === "ifBreak") {
            cmds.push({ ind, mode, doc: groupMode === "break" ? doc.breakContents : doc.flatContents });
          } else {
            const indented = groupMode === "break" ? !doc.negate : doc.negate;
            cmds.push({ ind, mode, doc: indented ? indent(doc.contents) : doc.contents });
          }
          break;
        }
        case "lineSuffix":
          suffixes.push({ ind, mode, doc: doc.contents });
          break;
        case "lineSuffixBoundary":
          if (suffixes.length > 0) cmds.push({ ind, mode, doc: { kind: "line", soft: false, hard: true, literal: false } });
          break;
        case "line": {
          if (mode === "flat" && !doc.hard) {
            if (!doc.soft) {
              out.push(" ");
              pos += 1;
            }
            break;
          }
          if (mode === "flat") remeasure = true;
          if (suffixes.length > 0) {
            cmds.push({ ind, mode, doc }, ...suffixes.reverse());
            suffixes.length = 0;
            break;
          }
          if (doc.literal) {
            out.push("\n");
            pos = 0;
          } else {
            pos -= trimEnd(out);
            out.push("\n" + ind.value);
            pos = ind.length;
          }
          break;
        }
        case "label":
          cmds.push({ ind, mode, doc: doc.contents });
          break;
        case "breakParent":
          break;
      }
    }
    if (cmds.length === 0 && suffixes.length > 0) {
      cmds.push(...suffixes.reverse());
      suffixes.length = 0;
    }
  }
  return out.join("");
}
