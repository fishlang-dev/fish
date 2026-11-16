// Ports tests/doc.test.ts. Each document is printed by Fish's layout and, sent as JSON to a Bun
// child process, by Prettier's own printer, the oracle for ours; each test's documents go at once.
import { conditionalGroup, fill, group, ifBreak, indent, indentIfBreak, join, newBreakParent, newHardline, newLine, newSoftline, print, type Doc } from "../compiler/doc.fsh";
import { prettier } from "./support.fsh";

function optional(s: string | undefined): string {
  return s === undefined ? "null" : JSON.stringify(s);
}

function all(docs: Ref<Doc[]>): string {
  let out: string[] = [];
  for (const d of docs) out.push(json(d));
  return `[${out.join(",")}]`;
}

// A document as the oracle reads it, its fields named as Fish's are.
function json(d: Ref<Doc>): string {
  if (typeof d === "string") return JSON.stringify(d);
  if (Array.isArray(d)) return all(d);
  switch (d.kind) {
    case "group": {
      const states = d.expandedStates === undefined ? "null" : all(d.expandedStates);
      return `{"kind":"group","contents":${json(d.contents)},"break":${d.break},"id":${optional(d.id)},"expandedStates":${states}}`;
    }
    case "indent":
      return `{"kind":"indent","contents":${json(d.contents)}}`;
    case "align":
      return `{"kind":"align","n":"${d.n}","contents":${json(d.contents)}}`;
    case "line":
      return `{"kind":"line","soft":${d.soft},"hard":${d.hard},"literal":${d.literal}}`;
    case "ifBreak":
      return `{"kind":"ifBreak","breakContents":${json(d.breakContents)},"flatContents":${json(d.flatContents)},"groupId":${optional(d.groupId)}}`;
    case "indentIfBreak":
      return `{"kind":"indentIfBreak","contents":${json(d.contents)},"groupId":${JSON.stringify(d.groupId)},"negate":${d.negate}}`;
    case "fill":
      return `{"kind":"fill","parts":${all(d.parts)}}`;
    case "lineSuffix":
      return `{"kind":"lineSuffix","contents":${json(d.contents)}}`;
    case "label":
      return `{"kind":"label","label":${JSON.stringify(d.label)},"contents":${json(d.contents)}}`;
    // breakParent, lineSuffixBoundary and trim, which hold nothing.
    default:
      return `{"kind":"${d.kind}"}`;
  }
}

type Row = { name: string; doc: Doc; width: f64 };

function row(name: string, doc: Doc, width: f64 = 80): Row {
  return { name, doc, width };
}

// Each row's document printed by Fish as Prettier prints it, every one that differs reported.
function same(rows: Ref<Row[]>): void {
  let inputs: string[] = [];
  for (const r of rows) inputs.push(`[${r.width},${json(r.doc)}]`);
  const expected = prettier("doc", inputs);
  let failed: string[] = [];
  let i: usize = 0;
  for (const r of rows) {
    const ours = print(r.doc.clone(), r.width);
    const want = i < expected.length ? expected[i]! : "<no answer>";
    if (ours !== want) failed.push(`${r.name}:\n--- expected\n${want}\n--- got\n${ours}`);
    i++;
  }
  assert(failed.length === 0, failed.join("\n\n"));
}

function call(name: string, args: Doc[]): Doc {
  return group([name, "(", indent([newSoftline(), join([",", newLine()], args)]), ifBreak(","), newSoftline(), ")"]);
}

test("a group is flat when it fits and broken when it doesn't, exactly as Prettier lays it out", () => {
  same([
    row("fits", call("f", ["a", "b", "c"])),
    row("too long", call("f", ["a".repeat(40), "b".repeat(40)])),
    row("exactly 80", call("f", ["a".repeat(36), "b".repeat(37)])),
    row("81", call("f", ["a".repeat(36), "b".repeat(38)])),
    row("nested, inner broken", call("outer", [call("inner", ["x".repeat(50), "y".repeat(30)]), "z"])),
    row("rest of line counts", [call("f", ["a".repeat(30), "b".repeat(30)]), " + ", "c".repeat(20)]),
    row("narrow width", call("f", ["a", "b"]), 5),
  ]);
});

test("a hard line or breakParent breaks every enclosing group", () => {
  same([
    row("hardline", group(["{", indent([newLine(), "a;", newHardline(), "b;"]), newLine(), "}"])),
    row("breakParent", group(["[", indent([newSoftline(), "a", newBreakParent()]), newSoftline(), "]"])),
    row("outer too", group(["x", group(["(", indent([newSoftline(), "y", newHardline(), "z"]), newSoftline(), ")"])])),
  ]);
});

test("ifBreak, group ids and indentIfBreak follow the group they name", () => {
  same([
    row("ifBreak flat", group(["a", ifBreak(",", ";")])),
    row("ifBreak broken", group(["a".repeat(79), newLine(), "b", ifBreak("!", "?")])),
    row("by id", [group(["x".repeat(90), newSoftline()], { id: "g" }), ifBreak("broke", "flat", { groupId: "g" })]),
    row("indentIfBreak", [group(["let a =", newLine()], { id: "h" }), indentIfBreak(group(["b".repeat(85), newLine(), "c"]), { groupId: "h" })]),
  ]);
});

function words(): Doc {
  let ws: Doc[] = [];
  for (let i = 0; i < 40; i++) ws.push(`w${i}`);
  return fill(join(newLine(), ws));
}

test("fill packs as many parts per line as fit, and conditional groups take the first state that fits", () => {
  same([
    row("fill", words()),
    row("fill narrow", words(), 20),
    row("conditional first", conditionalGroup([["a(", "b", ")"], ["a(", indent([newHardline(), "b"]), ")"]])),
    row("conditional last", conditionalGroup([["a(", "b".repeat(90), ")"], ["a(", indent([newLine(), "b".repeat(90)]), newLine(), ")"]])),
  ]);
});
