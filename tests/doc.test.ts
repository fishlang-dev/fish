import { expect, test } from "bun:test";
import { builders as b, printer } from "prettier/doc";
import { breakParent, conditionalGroup, fill, group, hardline, ifBreak, indent, indentIfBreak, join, line, print, softline, type Doc } from "../src/doc.ts";

// The same document in Prettier's own model, so its printer is the oracle for ours.
function theirs(d: Doc, ids: Map<string, symbol>): unknown {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => theirs(x, ids));
  const id = (name: string) => (ids.has(name) ? ids.get(name)! : ids.set(name, Symbol(name)).get(name)!);
  switch (d.kind) {
    case "group":
      return d.expandedStates
        ? b.conditionalGroup(d.expandedStates.map((s) => theirs(s, ids)) as never, { shouldBreak: d.break })
        : b.group(theirs(d.contents, ids) as never, { shouldBreak: d.break, id: d.id ? id(d.id) : undefined });
    case "indent":
      return b.indent(theirs(d.contents, ids) as never);
    case "align":
      return b.align(d.n, theirs(d.contents, ids) as never);
    case "line":
      return d.hard ? (d.literal ? b.literallineWithoutBreakParent : b.hardlineWithoutBreakParent) : d.soft ? b.softline : b.line;
    case "ifBreak":
      return b.ifBreak(theirs(d.breakContents, ids) as never, theirs(d.flatContents, ids) as never, { groupId: d.groupId ? id(d.groupId) : undefined });
    case "indentIfBreak":
      return b.indentIfBreak(theirs(d.contents, ids) as never, { groupId: id(d.groupId), negate: d.negate });
    case "fill":
      return b.fill(d.parts.map((p) => theirs(p, ids)) as never);
    case "breakParent":
      return b.breakParent;
    case "lineSuffix":
      return b.lineSuffix(theirs(d.contents, ids) as never);
    case "lineSuffixBoundary":
      return b.lineSuffixBoundary;
    case "label":
      return b.label(d.label, theirs(d.contents, ids) as never);
    case "trim":
      return b.trim;
  }
}

const same = (name: string, make: () => Doc, width = 80) => {
  const ours = print(make(), width);
  const expected = printer.printDocToString(theirs(make(), new Map()) as never, { printWidth: width, tabWidth: 2, useTabs: false } as never).formatted;
  expect([name, ours]).toEqual([name, expected]);
};

const call = (name: string, args: Doc[]) => group([name, "(", indent([softline, join([",", line], args)]), ifBreak(","), softline, ")"]);

test("a group is flat when it fits and broken when it doesn't, exactly as Prettier lays it out", () => {
  same("fits", () => call("f", ["a", "b", "c"]));
  same("too long", () => call("f", ["a".repeat(40), "b".repeat(40)]));
  same("exactly 80", () => call("f", ["a".repeat(36), "b".repeat(37)]));
  same("81", () => call("f", ["a".repeat(36), "b".repeat(38)]));
  same("nested, inner broken", () => call("outer", [call("inner", ["x".repeat(50), "y".repeat(30)]), "z"]));
  same("rest of line counts", () => [call("f", ["a".repeat(30), "b".repeat(30)]), " + ", "c".repeat(20)]);
  same("narrow width", () => call("f", ["a", "b"]), 5);
});

test("a hard line or breakParent breaks every enclosing group", () => {
  same("hardline", () => group(["{", indent([line, "a;", hardline, "b;"]), line, "}"]));
  same("breakParent", () => group(["[", indent([softline, "a", breakParent]), softline, "]"]));
  same("outer too", () => group(["x", group(["(", indent([softline, "y", hardline, "z"]), softline, ")"])]));
});

test("ifBreak, group ids and indentIfBreak follow the group they name", () => {
  same("ifBreak flat", () => group(["a", ifBreak(",", ";")]));
  same("ifBreak broken", () => group(["a".repeat(79), line, "b", ifBreak("!", "?")]));
  same("by id", () => [group(["x".repeat(90), softline], { id: "g" }), ifBreak("broke", "flat", { groupId: "g" })]);
  same("indentIfBreak", () => [group(["let a =", line], { id: "h" }), indentIfBreak(group(["b".repeat(85), line, "c"]), { groupId: "h" })]);
});

test("fill packs as many parts per line as fit, and conditional groups take the first state that fits", () => {
  const words = () => fill(join(line, Array.from({ length: 40 }, (_, i) => `w${i}`)));
  same("fill", words);
  same("fill narrow", words, 20);
  same("conditional first", () => conditionalGroup([["a(", "b", ")"], ["a(", indent([hardline, "b"]), ")"]]));
  same("conditional last", () => conditionalGroup([["a(", "b".repeat(90), ")"], ["a(", indent([line, "b".repeat(90)]), line, ")"]]));
});
