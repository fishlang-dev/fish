import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walk } from "../src/nodes.ts";
import { parse, type Expr, type Pattern, type Stmt, type TypeNode } from "../src/parser.ts";

// The checker's files, read as Fish reads them: with the compiler's own parser.
const CHECKER = ["check", "values", "typing", "resolve", "registry", "generics", "typefns", "comptime", "classes", "interfaces", "narrow", "unions", "match", "moves", "operators", "enums", "flow"];
const parsed = CHECKER.map((name) => {
  const text = readFileSync(join(import.meta.dir, "..", "src", `${name}.ts`), "utf8");
  return { name, text, program: parse(text, { last: 0 }) };
});
const lineOf = (text: string, at: number) => text.slice(0, at).split("\n").length;
const declared = (s: Stmt): Stmt => (s.kind === "export" ? s.body : s);

// A module is a class whose methods take `this`, not a function returning its inner functions,
// since Fish has no methods as values to hand such a bag out with.
test("no top-level function in the checker returns an object of its own inner functions", () => {
  const offenders: string[] = [];
  for (const { name, text, program } of parsed) {
    for (const top of program.map(declared)) {
      if (top.kind !== "function" || !top.body) continue;
      const inner = new Set<string>();
      for (const s of top.body) {
        if (s.kind === "function") inner.add(s.name);
        if (s.kind === "let") for (const d of s.declarations) if (d.target.kind === "ident" && (d.init?.kind === "arrow" || d.init?.kind === "function")) inner.add(d.target.name);
      }
      walk("stmt", top.body, ({ of, node }) => {
        if ((of === "stmt" && (node as Stmt).kind === "function") || (of === "expr" && ["arrow", "function"].includes((node as Expr).kind))) return false;
        if (of !== "stmt") return;
        const s = node as Stmt;
        if (s.kind !== "return" || s.value?.kind !== "object") return;
        const handed = s.value.props.flatMap((p) => (p.kind === "shorthand" ? [p.name] : p.kind === "property" && p.value.kind === "ident" ? [p.value.name] : []));
        if (handed.some((n) => inner.has(n))) offenders.push(`${name}.ts:${lineOf(text, s.start)}: ${top.name}`);
      });
    }
  }
  expect(offenders).toEqual([]);
});

// Destructuring a method takes it off its object, which Fish can't call later, so a module's
// methods are called on the object. Its data fields may still be read out by name.
test("no code in the checker destructures a method out of a module class's instance", () => {
  const methods = new Map<string, Set<string>>();
  const fieldTypes = new Map<string, string>();
  const typeName = (t: TypeNode | undefined) => (t?.kind === "ref" ? t.name : undefined);
  for (const { program } of parsed) {
    // A host interface or object type a module is handed is held to the same rule.
    for (const s of program.map(declared)) {
      const members = s.kind === "interface" ? s.members : s.kind === "typeAlias" && s.type.kind === "object" ? s.type.members : [];
      const own = new Set(members.flatMap((m) => (m.kind === "method" && typeof m.name === "string" ? [m.name] : [])));
      if (own.size > 0) methods.set((s as { name: string }).name, own);
    }
    walk("stmt", program, ({ of, node }) => {
      if (of !== "classNode") return;
      const c = node as { name: string | undefined; members: { kind: string; name?: unknown; type?: TypeNode }[] };
      if (!c.name) return;
      const own = new Set<string>();
      for (const m of c.members) {
        if (m.kind === "method" && typeof m.name === "string") own.add(m.name);
        if (m.kind === "field" && typeof m.name === "string" && typeName(m.type)) fieldTypes.set(m.name, typeName(m.type)!);
      }
      methods.set(c.name, own);
    });
  }
  // What a name or field holding a module's instance is typed as: annotations name the class.
  const offenders: string[] = [];
  for (const { name, text, program } of parsed) {
    const typed = new Map<string, string>();
    walk("stmt", program, ({ of, node }) => {
      if (of === "param") {
        const p = node as { pattern: Pattern; type: TypeNode | undefined };
        if (p.pattern.kind === "ident" && typeName(p.type)) typed.set(p.pattern.name, typeName(p.type)!);
      }
      if (of === "declarator") {
        const d = node as { target: Pattern; type: TypeNode | undefined; init: Expr | undefined };
        if (d.target.kind === "ident" && typeName(d.type)) typed.set(d.target.name, typeName(d.type)!);
        if (d.target.kind === "ident" && d.init?.kind === "new" && d.init.callee.kind === "ident") typed.set(d.target.name, d.init.callee.name);
      }
    });
    const classOf = (e: Expr | undefined): string | undefined => {
      if (e?.kind === "new" && e.callee.kind === "ident") return e.callee.name;
      if (e?.kind === "ident") return typed.get(e.name);
      if (e?.kind === "member") return fieldTypes.get(e.name);
      return undefined;
    };
    const check = (pattern: Pattern, of: string | undefined, at: number) => {
      const own = of === undefined ? undefined : methods.get(of);
      if (pattern.kind !== "object" || !own) return;
      const taken = pattern.props.flatMap((p) => (typeof p.key === "string" && own.has(p.key) ? [p.key] : []));
      if (taken.length > 0) offenders.push(`${name}.ts:${lineOf(text, at)}: ${taken.join(", ")} of ${of}`);
    };
    walk("stmt", program, ({ of, node }) => {
      if (of === "declarator") {
        const d = node as { target: Pattern; init: Expr | undefined; start: number };
        check(d.target, classOf(d.init), d.start);
      }
      if (of === "param") {
        const p = node as { pattern: Pattern; type: TypeNode | undefined; start: number };
        check(p.pattern, typeName(p.type), p.start);
      }
    });
  }
  expect(offenders).toEqual([]);
});
