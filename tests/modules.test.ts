import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, walk, walkWhile, type AnyNode } from "../src/nodes.ts";
import { parse, type Expr, type Pattern, type Stmt, type TypeNode } from "../src/parser.ts";

// The checker's files, read as Fish reads them: with the compiler's own parser.
const CHECKER = ["check", "values", "typing", "resolve", "registry", "generics", "typefns", "comptime", "classes", "interfaces", "narrow", "unions", "match", "moves", "operators", "enums", "flow"];
const parsed = CHECKER.map((name) => {
  const text = readFileSync(join(import.meta.dir, "..", "src", `${name}.ts`), "utf8");
  return { name, text, program: parse(text, { last: 0 }) };
});
const lineOf = (text: string, at: number) => text.slice(0, at).split("\n").length;
const declared = (s: Stmt): Stmt => (s.kind === "export" ? s.body : s);
// A class declaration is a statement; a class expression is a class node.
type Member = { kind: string; name?: unknown; type?: TypeNode; init?: Expr; start: number };
const classAt = ({ of, node }: { of: string; node: unknown }) => (of === "classNode" || (of === "stmt" && (node as Stmt).kind === "class") ? (node as { name: string | undefined }) : undefined);

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
      walkWhile({ of: "stmts", node: top.body }, ({ of, node }) => {
        if ((of === "stmt" && (node as Stmt).kind === "function") || (of === "expr" && ["arrow", "function"].includes((node as Expr).kind))) return false;
        if (of !== "stmt") return true;
        const s = node as Stmt;
        if (s.kind !== "return" || s.value?.kind !== "object") return true;
        const handed = s.value.props.flatMap((p) => (p.kind === "shorthand" ? [p.name] : p.kind === "property" && p.value.kind === "ident" ? [p.value.name] : []));
        if (handed.some((n) => inner.has(n))) offenders.push(`${name}.ts:${lineOf(text, s.start)}: ${top.name}`);
        return true;
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
  // What each method returns, when it names a class: a view is reached as `this.registry()`.
  const returns = new Map<string, string>();
  const typeName = (t: TypeNode | undefined) => (t?.kind === "ref" ? t.name : undefined);
  for (const { program } of parsed) {
    // A host interface or object type a module is handed is held to the same rule.
    for (const s of program.map(declared)) {
      const members = s.kind === "interface" ? s.members : s.kind === "typeAlias" && s.type.kind === "object" ? s.type.members : [];
      const own = new Set(members.flatMap((m) => (m.kind === "method" && typeof m.name === "string" ? [m.name] : [])));
      if (own.size > 0) methods.set((s as { name: string }).name, own);
    }
    walk({ of: "stmts", node: program }, (n) => {
      const c = classAt(n) as { name: string | undefined; members: { kind: string; name?: unknown; type?: TypeNode; returnType?: TypeNode }[] } | undefined;
      if (!c) return;
      if (!c.name) return;
      const own = new Set<string>();
      for (const m of c.members) {
        if (m.kind === "method" && typeof m.name === "string") own.add(m.name);
        if (m.kind === "method" && typeof m.name === "string" && typeName(m.returnType)) returns.set(m.name, typeName(m.returnType)!);
        if (m.kind === "field" && typeof m.name === "string" && typeName(m.type)) fieldTypes.set(m.name, typeName(m.type)!);
      }
      methods.set(c.name, own);
    });
  }
  // What a name or field holding a module's instance is typed as: annotations name the class.
  const offenders: string[] = [];
  for (const { name, text, program } of parsed) {
    const typed = new Map<string, string>();
    walk({ of: "stmts", node: program }, ({ of, node }) => {
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
      if (e?.kind === "call" && e.callee.kind === "member") return returns.get(e.callee.name);
      return undefined;
    };
    const check = (pattern: Pattern, of: string | undefined, at: number) => {
      const own = of === undefined ? undefined : methods.get(of);
      if (pattern.kind !== "object" || !own) return;
      const taken = pattern.props.flatMap((p) => (typeof p.key === "string" && own.has(p.key) ? [p.key] : []));
      if (taken.length > 0) offenders.push(`${name}.ts:${lineOf(text, at)}: ${taken.join(", ")} of ${of}`);
    };
    walk({ of: "stmts", node: program }, ({ of, node }) => {
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

// The checker's classes that call back into a host: one with a field typed as an interface with
// methods, or lending a class mutably.
function hostedModules() {
  const classes = new Map<string, Member[]>();
  const callable = new Set<string>();
  for (const { program } of parsed) {
    for (const s of program.map(declared)) {
      const members = s.kind === "interface" ? s.members : s.kind === "typeAlias" && s.type.kind === "object" ? s.type.members : [];
      if (members.some((m) => m.kind === "method")) callable.add((s as { name: string }).name);
    }
    walk({ of: "stmts", node: program }, (n) => {
      const c = classAt(n) as { name: string | undefined; members: Member[] } | undefined;
      if (!c) return;
      if (c.name) classes.set(c.name, c.members);
    });
  }
  const unwrapped = (t: TypeNode | undefined): TypeNode | undefined => (t?.kind === "ref" && (t.name === "Mut" || t.name === "Ref") ? t.args[0] : t);
  // A host is a field typed as an interface with methods, or lent mutably as a class.
  const hosted = new Set([...classes].flatMap(([name, members]) => (members.some((m) => {
    if (m.kind !== "field") return false;
    const t = unwrapped(m.type);
    return t?.kind === "ref" && (callable.has(t.name) || (t !== m.type && classes.has(t.name)));
  }) ? [name] : [])));
  return { hosted, unwrapped };
}

// A module that calls back into its host is made where it is used, over that host, and keeps
// its lasting state in data the host owns. Owned as a field, its methods would run on the
// field while the host is lent to them, which Fish refuses.
test("no class in the checker holds, as a field, a module that calls back into its host", () => {
  const { hosted, unwrapped } = hostedModules();
  const offenders: string[] = [];
  for (const { name, text, program } of parsed) {
    walk({ of: "stmts", node: program }, (n) => {
      const c = classAt(n) as { name: string | undefined; members: Member[] } | undefined;
      if (!c) return;
      for (const m of c.members) {
        if (m.kind !== "field") continue;
        // Lent as `Mut<Host>`, it is the host a view is made over, not owned.
        const types = m.type?.kind === "union" ? m.type.types : m.type ? [m.type] : [];
        const held = [...types.flatMap((t) => (t.kind === "ref" && t === unwrapped(t) ? [t.name] : [])), ...(m.init?.kind === "new" && m.init.callee.kind === "ident" ? [m.init.callee.name] : [])];
        for (const h of held) if (hosted.has(h)) offenders.push(`${name}.ts:${lineOf(text, m.start)}: ${c.name}.${String(m.name)} holds ${h}`);
      }
    });
  }
  expect(hosted.size).toBeGreaterThan(0);
  expect(offenders).toEqual([]);
});

// A view is made anew at each use, so state of its own would silently start over each time; what
// has to last lives in the data its host owns.
test("no module that calls back into its host keeps state of its own", () => {
  const { hosted } = hostedModules();
  const offenders: string[] = [];
  for (const { name, text, program } of parsed) {
    walk({ of: "stmts", node: program }, (n) => {
      const c = classAt(n) as { name: string | undefined; members: Member[] } | undefined;
      if (!c?.name || !hosted.has(c.name)) return;
      for (const m of c.members) if (m.kind === "field" && m.init) offenders.push(`${name}.ts:${lineOf(text, m.start)}: ${c.name}.${String(m.name)}`);
    });
  }
  expect(offenders).toEqual([]);
});

// Fish checks a file with everything it imports, so a checker file reaching the CLI, the package
// manager or codegen fails on their imports before its own code. A module joining this list is a
// choice: it is checked with the checker from then on.
const CHECKER_REACHES = [
  "arenas", "ast", "check", "classes", "compilation", "comptime", "declarations", "defaults", "diag", "enums", "expressions", "flow", "generics", "ids",
  "interfaces", "keys", "lexer", "locals", "match", "moves", "narrow", "nodes", "operators", "overloads", "parseargs", "parser", "patterns", "program",
  "quote", "rebuild", "regex", "registry", "resolve", "rust", "sizes", "std", "suggest", "typefns", "types", "typing", "unions", "unsupported", "values",
  "walk", "warnings",
];
test("the checker's files reach only the modules meant to be checked with them", () => {
  const reached = new Set<string>();
  const visit = (name: string) => {
    if (reached.has(name)) return;
    reached.add(name);
    const text = readFileSync(join(import.meta.dir, "..", "src", `${name}.ts`), "utf8");
    // `from "./m.ts"`, a side-effect `import "./m.ts"`, and `import("./m.ts")`, dynamic or in a type.
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']\.\/([\w.-]+)\.ts["']/g)) visit(m[1]!);
  };
  CHECKER.forEach(visit);
  expect([...reached].sort()).toEqual(CHECKER_REACHES);
});

// Every fallible function, method, constructor, top-level arrow, nested function and interface
// method in the checker and its helper modules declares what it throws via `@throws` or `throws`.
test("every fallible function, method, constructor and interface method in the checker declares throws", () => {
  type Item = {
    file: string;
    kind: "function" | "method" | "constructor" | "arrow" | "nestedFunction" | "interfaceMethod" | "get" | "set";
    className?: string;
    name: string;
    start: number;
    end: number;
    body: Stmt[] | Expr | undefined;
    throwsNode: TypeNode | undefined;
    throwsSet: Set<string>;
    throwingParams: Set<string>;
  };

  const items: Item[] = [];
  const fileTexts = new Map<string, string>();
  const fileProgs = new Map<string, Stmt[]>();
  const fileImports = new Map<string, Map<string, { fromFile: string; exportedName: string }>>();
  const throwingTypeAliases = new Set<string>();

  const typeNames = (t: TypeNode | undefined): string[] => {
    if (!t) return [];
    if (t.kind === "ref") return [t.name];
    if (t.kind === "union") return t.types.flatMap(typeNames);
    return [];
  };

  const extractThrowingParams = (params: { pattern: { kind: string; name?: string }; type?: TypeNode }[]): Set<string> => {
    const res = new Set<string>();
    for (const p of params) {
      if (p.pattern.kind === "ident" && p.pattern.name && p.type) {
        if (p.type.kind === "function" && p.type.throws) res.add(p.pattern.name);
        if (p.type.kind === "ref" && throwingTypeAliases.has(p.type.name)) res.add(p.pattern.name);
      }
    }
    return res;
  };

  for (const file of CHECKER_REACHES) {
    const text = readFileSync(join(import.meta.dir, "..", "src", `${file}.ts`), "utf8");
    const prog = parse(text, { last: 0 });
    fileTexts.set(file, text);
    fileProgs.set(file, prog);
    for (const raw of prog) {
      const s = declared(raw);
      if (s.kind === "typeAlias" && s.type.kind === "function" && s.type.throws) throwingTypeAliases.add(s.name);
    }
  }

  for (const file of CHECKER_REACHES) {
    const prog = fileProgs.get(file)!;
    const imports = new Map<string, { fromFile: string; exportedName: string }>();
    fileImports.set(file, imports);
    for (const raw of prog) {
      if (raw.kind === "import" && raw.module.startsWith("./") && raw.module.endsWith(".ts")) {
        const fromFile = raw.module.slice(2, -3);
        for (const spec of raw.named ?? []) imports.set(spec.alias ?? spec.name, { fromFile, exportedName: spec.name });
      }
      const s = declared(raw);
      if (s.kind === "function" && s.body) {
        items.push({ file, kind: "function", name: s.name, start: s.start, end: s.end, body: s.body, throwsNode: s.throws, throwsSet: new Set(typeNames(s.throws)), throwingParams: extractThrowingParams(s.params) });
      } else if (s.kind === "let") {
        for (const d of s.declarations) {
          if (d.target.kind === "ident" && d.init?.kind === "arrow") {
            items.push({ file, kind: "arrow", name: d.target.name, start: d.init.start, end: d.init.end, body: d.init.body, throwsNode: d.init.throws, throwsSet: new Set(typeNames(d.init.throws)), throwingParams: extractThrowingParams(d.init.params) });
          }
        }
      } else if (s.kind === "interface" || (s.kind === "typeAlias" && s.type.kind === "object")) {
        const members = s.kind === "interface" ? s.members : (s.type as Extract<TypeNode, { kind: "object" }>).members;
        for (const m of members) {
          if (m.kind === "method" && typeof m.name === "string") {
            items.push({ file, kind: "interfaceMethod", className: s.name, name: m.name, start: m.start, end: m.end, body: undefined, throwsNode: m.throws, throwsSet: new Set(typeNames(m.throws)), throwingParams: extractThrowingParams(m.params) });
          }
        }
      } else if (s.kind === "class") {
        for (const m of s.members) {
          if ((m.kind === "method" || m.kind === "get" || m.kind === "set") && typeof m.name === "string" && m.body) {
            items.push({ file, kind: m.kind, className: s.name, name: m.name, start: m.start, end: m.end, body: m.body, throwsNode: m.kind === "method" ? m.throws : undefined, throwsSet: new Set(m.kind === "method" ? typeNames(m.throws) : []), throwingParams: extractThrowingParams(m.params) });
          } else if (m.kind === "constructor" && m.body && s.name) {
            items.push({ file, kind: "constructor", className: s.name, name: "constructor", start: m.start, end: m.end, body: m.body, throwsNode: m.throws, throwsSet: new Set(typeNames(m.throws)), throwingParams: extractThrowingParams(m.params) });
          }
        }
      }
    }
    walk({ of: "stmts", node: prog }, ({ of, node }) => {
      if (of === "stmt" && (node as Stmt).kind === "function") {
        const fn = node as Extract<Stmt, { kind: "function" }>;
        if (!fn.body || items.some((i) => i.file === file && i.start === fn.start)) return;
        items.push({ file, kind: "nestedFunction", name: fn.name, start: fn.start, end: fn.end, body: fn.body, throwsNode: fn.throws, throwsSet: new Set(typeNames(fn.throws)), throwingParams: extractThrowingParams(fn.params) });
      }
    });
  }

  const INTERFACE_IMPLS: Record<string, string[]> = {
    ResolverHost: ["Checker"], TypeFunctionsHost: ["Resolver"], RegistryHost: ["Checker"],
    GenericClassesHost: ["Checker"], InstancingHost: ["Checker"], Context: ["BodyChecker"],
    Members: ["ClassMembers"], Union: ["Expressions"], RecursiveMaker: ["Resolver"],
    InstanceMaker: ["Checker"],
  };
  const FIELD_RECEIVERS: Record<string, string> = {
    cx: "Checker", ctx: "Context", typing: "Typing", arenas: "Arenas", rewrites: "Rewrites",
    resolver: "Resolver", registry: "Registry", genericClasses: "GenericClasses",
    instancing: "Instancing", typeFunctions: "TypeFunctions", exprs: "Expressions",
    tokens: "Lexer", c: "Cursor", recursiveMaker: "RecursiveMaker", instanceMaker: "InstanceMaker",
  };
  const HOST_OF_CLASS: Record<string, string> = {
    Resolver: "ResolverHost", TypeFunctions: "TypeFunctionsHost", Registry: "RegistryHost",
    GenericClasses: "GenericClassesHost", Instancing: "InstancingHost", ClassMembers: "Checker",
  };
  const PARAM_RECEIVERS: Record<string, string> = {
    c: "Cursor", typing: "Typing", arenas: "Arenas", rewrites: "Rewrites",
    members: "Members", run: "Interpreter", tokens: "Lexer",
  };

  const findClassItem = (className: string, methodName: string): Item[] => {
    const direct = items.filter((i) => i.className === className && i.name === methodName);
    if (direct.length > 0) return direct;
    const impls = INTERFACE_IMPLS[className];
    return impls ? impls.flatMap((c) => findClassItem(c, methodName)) : [];
  };

  const receiverOf = (e: Expr, current: Item): string | undefined => {
    if (e.kind === "this") return current.className;
    if (e.kind === "ident") {
      if (e.name === "host" && current.className && HOST_OF_CLASS[current.className]) return HOST_OF_CLASS[current.className];
      if (e.name === "members") return "Members";
      if (e.name === "host" && current.file === "unions") return "Union";
      if (e.name === "host" && (current.file === "classes" || current.file === "interfaces")) return "Members";
      if (e.name === "b" && current.file === "quote") return "Builder";
      if (e.name === "unsettled" && current.file === "enums") return "Unsettled";
      return PARAM_RECEIVERS[e.name];
    }
    if (e.kind === "member") {
      if (e.object.kind === "this" && e.name === "host" && current.className && HOST_OF_CLASS[current.className]) return HOST_OF_CLASS[current.className];
      if (FIELD_RECEIVERS[e.name]) return FIELD_RECEIVERS[e.name];
    }
    if (e.kind === "call") {
      if (e.callee.kind === "member" && FIELD_RECEIVERS[e.callee.name]) return FIELD_RECEIVERS[e.callee.name];
      if (e.callee.kind === "ident" && e.callee.name === "lexer") return "Lexer";
    }
    if (e.kind === "new" && e.callee.kind === "ident") return e.callee.name;
    return undefined;
  };

  const classifyThrow = (v: Expr, current: Item): string[] => {
    if (v.kind === "new" && v.callee.kind === "ident") {
      const name = v.callee.name;
      if (name === "Open" || name === "Stop" || name === "Return" || name === "Jump" || name === "Thrown" || name === "RegexSyntaxError") return [name];
      return ["CompileError"];
    }
    if (current.file === "comptime" && v.kind === "ident") {
      if (v.name === "left") return ["Return", "Thrown"];
      if (v.name === "r") return ["Return"];
    }
    return ["CompileError"];
  };

  const filterCatch = (current: Item, s: Extract<Stmt, { kind: "try" }>, blockThrows: Set<string>, handlerThrows: Set<string>): Set<string> => {
    const text = fileTexts.get(current.file)!.slice(s.start, s.end);
    const res = new Set<string>();
    if (current.file === "resolve" && current.name === "conditional") {
      for (const err of blockThrows) if (err !== "Open") res.add(err);
      return res;
    }
    if (current.file === "resolve" && current.name === "interfaceMembers") return res;
    if (current.file === "comptime") {
      if (current.name === "guarded") return new Set(["CompileError"]);
      if (current.name === "expr") {
        for (const err of blockThrows) res.add(err);
        for (const err of handlerThrows) res.add(err);
        return res;
      }
      if (current.name === "call" || current.name === "match") {
        for (const err of blockThrows) if (err !== "Return") res.add(err);
        return res;
      }
      if (current.name === "statement") {
        if (text.includes("instanceof Jump")) return new Set(blockThrows);
        if (text.includes("instanceof Thrown")) {
          for (const err of blockThrows) if (err !== "Thrown") res.add(err);
          for (const err of handlerThrows) res.add(err);
          return res;
        }
      }
    }
    if (current.file === "values") {
      if (current.name === "regexLiteral") return new Set(["CompileError"]);
      if (text.includes("if (err instanceof CompileError) return undefined;") || text.includes("catch {")) return res;
    }
    if (current.file === "check") {
      if (current.name === "partType") return res;
      if (current.name === "check") return new Set(["CompileError"]);
      if (text.includes("this.recover(e)") && !text.includes("throw new CompileError") && !text.includes("if (!f.js")) return res;
    }
    if (current.file === "classes" && text.includes("catch { return []; }")) return res;
    if (current.file === "registry" && text.includes("catch { return undefined; }")) return res;
    if (current.file === "quote" && text.includes("catch {")) return res;
    if (current.file === "regex" && text.includes("catch { return fail(")) return new Set(["RegexSyntaxError"]);
    for (const err of handlerThrows) res.add(err);
    return res;
  };

  const classifyCall = (e: Extract<Expr, { kind: "call" }>, current: Item, localFns: Map<string, Item>): Set<string> => {
    const res = new Set<string>();
    const { callee } = e;
    if (callee.kind === "ident") {
      if (current.throwingParams.has(callee.name)) return new Set(["CompileError"]);
      const local = localFns.get(callee.name);
      if (local) return new Set(local.throwsSet);
      const sameFile = items.filter((i) => i.file === current.file && (i.kind === "function" || i.kind === "arrow") && i.name === callee.name);
      if (sameFile.length > 0) {
        for (const t of sameFile) for (const err of t.throwsSet) res.add(err);
        return res;
      }
      const imp = fileImports.get(current.file)?.get(callee.name);
      if (imp) {
        for (const t of items.filter((i) => i.file === imp.fromFile && (i.kind === "function" || i.kind === "arrow") && i.name === imp.exportedName)) {
          for (const err of t.throwsSet) res.add(err);
        }
      }
      return res;
    }
    if (callee.kind === "member") {
      if (callee.name === "ensureChecked" || callee.name === "topKeys") return new Set(["CompileError"]);
      const recv = receiverOf(callee.object, current);
      if (recv) for (const t of findClassItem(recv, callee.name)) for (const err of t.throwsSet) res.add(err);
    }
    return res;
  };

  const analyzeNode = (n: AnyNode, current: Item, localFns: Map<string, Item>): Set<string> => {
    const out = new Set<string>();
    const visit = (node: AnyNode): void => {
      if (node.of === "stmt" && (node.node as Stmt).kind === "function" && (node.node as Stmt).start !== current.start) return;
      if (node.of === "stmt") {
        const s = node.node as Stmt;
        if (s.kind === "throw") {
          for (const err of classifyThrow(s.value, current)) out.add(err);
          forEachChild(node, visit);
          return;
        }
        if (s.kind === "try") {
          const blockThrows = new Set<string>();
          for (const b of s.block) for (const err of analyzeNode({ of: "stmt", node: b }, current, localFns)) blockThrows.add(err);
          if (!s.handler) {
            for (const err of blockThrows) out.add(err);
          } else {
            const handlerThrows = new Set<string>();
            for (const h of s.handler) for (const err of analyzeNode({ of: "stmt", node: h }, current, localFns)) handlerThrows.add(err);
            for (const err of filterCatch(current, s, blockThrows, handlerThrows)) out.add(err);
          }
          for (const f of s.finalizer ?? []) for (const err of analyzeNode({ of: "stmt", node: f }, current, localFns)) out.add(err);
          return;
        }
      }
      if (node.of === "expr") {
        const e = node.node as Expr;
        if (e.kind === "throw") for (const err of classifyThrow(e.value, current)) out.add(err);
        else if (e.kind === "call") {
          if (current.file === "comptime" && e.callee.kind === "ident" && e.callee.name === "guarded") {
            out.add("CompileError");
            return;
          }
          for (const err of classifyCall(e, current, localFns)) out.add(err);
        } else if (e.kind === "new" && e.callee.kind === "ident") {
          for (const c of items.filter((i) => i.kind === "constructor" && i.className === (e.callee as Extract<Expr, { kind: "ident" }>).name)) {
            for (const err of c.throwsSet) out.add(err);
          }
        }
      }
      forEachChild(node, visit);
    };
    visit(n);
    return out;
  };

  const offenders: string[] = [];
  for (const [iface, impls] of Object.entries(INTERFACE_IMPLS)) {
    for (const im of items.filter((i) => i.kind === "interfaceMethod" && i.className === iface)) {
      const missing: string[] = [];
      for (const impl of impls) {
        for (const cm of findClassItem(impl, im.name)) {
          for (const err of cm.throwsSet) {
            if (!im.throwsSet.has(err)) {
              missing.push(err);
              im.throwsSet.add(err);
            }
          }
        }
      }
      if (missing.length > 0) {
        offenders.push(`${im.file}.ts:${lineOf(fileTexts.get(im.file)!, im.start)}: ${im.className}.${im.name} missing @throws {${missing.join(" | ")}}`);
      }
    }
  }
  for (const im of items.filter((i) => i.kind === "interfaceMethod" && i.className === "Builder" && i.name === "name")) {
    if (!im.throwsSet.has("CompileError")) {
      im.throwsSet.add("CompileError");
      offenders.push(`${im.file}.ts:${lineOf(fileTexts.get(im.file)!, im.start)}: Builder.name missing @throws {CompileError}`);
    }
  }

  for (const item of items) {
    if (!item.body) continue;
    const localFns = new Map<string, Item>();
    for (const other of items) {
      if (other.file === item.file && other.kind === "nestedFunction" && other.start > item.start && other.end <= item.end) localFns.set(other.name, other);
    }
    const found = Array.isArray(item.body)
      ? item.body.reduce((acc, s) => {
          for (const err of analyzeNode({ of: "stmt", node: s }, item, localFns)) acc.add(err);
          return acc;
        }, new Set<string>())
      : analyzeNode({ of: "expr", node: item.body }, item, localFns);
    const missing = [...found].filter((err) => !item.throwsSet.has(err));
    if (missing.length > 0) {
      const label = item.className ? `${item.className}.${item.name}` : item.name;
      offenders.push(`${item.file}.ts:${lineOf(fileTexts.get(item.file)!, item.start)}: ${label} missing @throws {${missing.join(" | ")}}`);
    }
  }
  expect(offenders).toEqual([]);
});
