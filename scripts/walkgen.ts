// Writes `src/walk.ts`, which visits the child nodes of every node kind, from the parser's own AST
// types in `src/parser.ts`, so the compiler can walk a tree without reading arbitrary objects'
// fields, which Fish can't. Beside it, `src/rebuild.ts` puts the replacements a rewrite table holds
// in place in a tree, updates node ids and spans, and clones AST subtrees by the same fields.
// `tests/walk.test.ts` fails when either file is stale.
import type { TypeNode } from "../src/parser.ts";
import { nodeTypes } from "./dumpgen.ts";

// The walkers, `src/walk.ts`, and the rebuild, `src/rebuild.ts`, from the parser's source.
export function walkerSource(parserSource: string): string {
  return sources(parserSource).walk;
}

export function rebuildSource(parserSource: string): string {
  return sources(parserSource).rebuild;
}

function sources(parserSource: string): { walk: string; rebuild: string } {
  const { aliases, isNode, isWord, membersOf, ref, shapes, formOf, show } = nodeTypes(parserSource);
  const nodes = [...aliases.keys()].filter(isNode);
  const method = (name: string) => name[0]!.toLowerCase() + name.slice(1);
  const owner = (m: TypeNode) => (m.kind === "ref" && m.name === "Extract" && m.args[0]!.kind === "ref" ? m.args[0]!.name : m.kind === "ref" ? m.name : "");

  const unions = new Map<string, { name: string; members: TypeNode[] }>();
  const unionName = (members: TypeNode[]) => {
    const key = members.map(show).join(" | ");
    if (!unions.has(key)) unions.set(key, { name: `visitOneOf${unions.size}`, members });
    return unions.get(key)!.name;
  };

  // Whether a value of one of `members` may hold a node.
  const holdsNodes = (members: TypeNode[]): boolean => members.flatMap(expand).some((m) => {
    if (ref(m, "string")) return false;
    if (ref(m, "Extract")) return true;
    const f = formOf(m);
    switch (f.form) {
      case "json": case "plain": case "bigint": return false;
      case "node": return true;
      case "array": return holdsNodes([f.element]);
      case "option": return holdsNodes([f.inner]);
      case "object": return holdsNodes(f.fields.map((x) => x.type));
      case "union": return holdsNodes(f.members);
    }
  });
  // A union's members, with an alias of a union that isn't a node type, as `PropertyName`, opened.
  const expand = (m: TypeNode): TypeNode[] => (m.kind === "ref" && aliases.has(m.name) && !isNode(m.name) && !isWord(m) ? membersOf(aliases.get(m.name)) : [m]);

  // Statements visiting the nodes `value`, of type `t`, holds; `leaf` emits the action for each child.
  const makeWalker = (leaf: (of: string, val: string) => string[], arrayLeaf?: (of: string, val: string) => string[]) => {
    let depth = 0;
    let nextU = 0;
    const visits = (t: TypeNode, value: string): string[] => {
      const f = formOf(t);
      switch (f.form) {
        case "json":
        case "plain":
        case "bigint":
          return [];
        case "node":
          return leaf(method(f.name), value);
        case "union": {
          if (!holdsNodes(f.members)) return [];
          unionName(f.members);
          return unionVisits(f.members, value);
        }
        case "array": {
          if (ref(f.element, "Stmt")) return leaf("stmts", value);
          const ef = formOf(f.element);
          if (ef.form === "node" && arrayLeaf) return arrayLeaf(method(ef.name), value);
          const x = `x${++depth}`;
          const inner = visits(f.element, x);
          depth--;
          return inner.length ? [`for (const ${x} of ${value}) {`, ...inner.map((l) => `  ${l}`), `}`] : [];
        }
        case "option": {
          const inner = visits(f.inner, `${value}!`);
          return inner.length ? [`if (${value} !== undefined) {`, ...inner.map((l) => `  ${l}`), `}`] : [];
        }
        case "object":
          return fieldVisits(f.fields, value);
      }
    };
    const unionVisits = (members: TypeNode[], u: string): string[] => {
      let rest = members.flatMap(expand).filter((m) => !ref(m, "string"));
      const hasString = members.flatMap(expand).some((m) => ref(m, "string"));
      const array = rest.find((m) => m.kind === "array");
      const inner: string[] = [];
      if (array) {
        rest = rest.filter((m) => m !== array);
        const other = rest[0]!;
        inner.push(
          `if (Array.isArray(${u})) {`,
          ...visits(array, u).map((l) => `  ${l}`),
          `} else {`,
          ...leaf(method(owner(other)), u).map((l) => `  ${l}`),
          `}`,
        );
      } else if (rest.length === 1) {
        inner.push(...leaf(method(owner(rest[0]!)), u));
      } else {
        const seen = new Set<string>();
        inner.push(`switch (${u}.kind) {`);
        for (const m of rest) {
          const kinds = shapes(m).flatMap((s) => (s.kind === undefined || seen.has(s.kind) ? [] : [s.kind]));
          kinds.forEach((k) => seen.add(k));
          for (const k of kinds) inner.push(`  case ${JSON.stringify(k)}:`, ...leaf(method(owner(m)), u).map((l) => `    ${l}`), `    break;`);
        }
        inner.push(`}`);
      }
      return hasString ? [`if (typeof ${u} !== "string") {`, ...inner.map((l) => `  ${l}`), `}`] : inner;
    };
    const fieldVisits = (fields: { name: string; optional: boolean; type: TypeNode }[], value: string): string[] =>
      fields.flatMap((f) => {
        const inner = visits(f.type, `${value}.${f.name}${f.optional ? "!" : ""}`);
        return f.optional && inner.length ? [`if (${value}.${f.name} !== undefined) {`, ...inner.map((l) => `  ${l}`), `}`] : inner;
      });
    const children = (name: string, target: string): string[] => {
      const all = shapes(aliases.get(name)!);
      if (all.length === 1 && all[0]!.kind === undefined) return fieldVisits(all[0]!.fields, target);
      const out: string[] = [];
      const seen = new Set<string>();
      for (const s of all) {
        if (s.kind === undefined || seen.has(s.kind)) continue;
        seen.add(s.kind);
        const body = fieldVisits(s.fields, target);
        if (body.length) out.push(`  case ${JSON.stringify(s.kind)}:`, ...body.map((l) => `    ${l}`), `    break;`);
      }
      return out.length ? [`switch (${target}.kind) {`, ...out, `}`] : [];
    };
    return { children };
  };

  const eachWalker = makeWalker((of, val) => [`v({ of: ${JSON.stringify(of)}, node: ${val} });`]);
  const collectWalker = makeWalker((of, val) => [`collectIdsNode({ of: ${JSON.stringify(of)}, node: ${val} }, seen, order, shared);`]);
  const stepWalker = makeWalker(
    (of, val) => [
      `if (i === k) return visitAt({ of: ${JSON.stringify(of)}, node: ${val} }, steps, d + 1, each);`,
      `i += 1;`,
    ],
    (of, val) => [
      `if (k >= i && k < i + ${val}.length) return visitAt({ of: ${JSON.stringify(of)}, node: ${val}[k - i]! }, steps, d + 1, each);`,
      `i += ${val}.length;`,
    ],
  );

  const hasId = (name: string) => shapes(aliases.get(name)!).every((s) => s.fields.some((f) => f.name === "id"));
  const currentMethod = (name: string) => (name === "Expr" ? "current" : `current${name}`);

  // The rebuild: each node replaced by what the rewrite table holds for it, its children first
  // rebuilt in turn. `get` reads a place holding nodes of type `t`, `set` writes it.
  let rebuildDepth = 0;
  const rebuilds = (t: TypeNode, get: string, set: string): string[] => {
    const f = formOf(t);
    switch (f.form) {
      case "json":
      case "plain":
      case "bigint":
        return [];
      case "node":
        return [`${set} = rebuilt${f.name}(${get}, r);`];
      case "union":
        return holdsNodes(f.members) ? [`${set} = rebuilt${unionName(f.members).slice("visit".length)}(${get}, r);`] : [];
      case "array": {
        if (ref(f.element, "Stmt")) return [`rebuiltStmts(${get}, r);`];
        const i = `i${++rebuildDepth}`;
        const x = `e${rebuildDepth}`;
        const ef = formOf(f.element);
        if (ef.form === "option") {
          const inner = rebuilds(ef.inner, x, x);
          return inner.length
            ? [
                `if (${get}.length > 0) {`,
                `  let ${i} = ${get}.splice(0);`,
                `  ${i}.reverse();`,
                `  while (${i}.length > 0) {`,
                `    const last = ${i}.pop();`,
                `    if (last === undefined) {`,
                `      ${get}.push(undefined);`,
                `    } else {`,
                `      let ${x} = last!;`,
                ...inner.map((l) => `      ${l}`),
                `      ${get}.push(${x});`,
                `    }`,
                `  }`,
                `}`,
              ]
            : [];
        }
        const inner = rebuilds(f.element, x, x);
        return inner.length
          ? [
              `if (${get}.length > 0) {`,
              `  let ${i} = ${get}.splice(0);`,
              `  ${i}.reverse();`,
              `  while (${i}.length > 0) {`,
              `    let ${x} = ${i}.pop()!;`,
              ...inner.map((l) => `    ${l}`),
              `    ${get}.push(${x});`,
              `  }`,
              `}`,
            ]
          : [];
      }
      case "option": {
        const v = `o${++rebuildDepth}`;
        const inner = rebuilds(f.inner, v, v);
        return inner.length ? [`if (${set} !== undefined) {`, `  let ${v} = ${set}!;`, ...inner.map((l) => `  ${l}`), `  ${set} = ${v};`, `}`] : [];
      }
      case "object":
        return fieldRebuilds(f.fields, get);
    }
  };
  const fieldRebuilds = (fields: { name: string; optional: boolean; type: TypeNode }[], value: string): string[] =>
    fields.flatMap((f) => {
      if (f.optional) {
        const v = `v${++rebuildDepth}`;
        const inner = rebuilds(f.type, v, v);
        return inner.length ? [`if (${value}.${f.name} !== undefined) {`, `  let ${v} = ${value}.${f.name}!;`, ...inner.map((l) => `  ${l}`), `  ${value}.${f.name} = ${v};`, `}`] : [];
      }
      return rebuilds(f.type, `${value}.${f.name}`, `${value}.${f.name}`);
    });
  const rebuildChildren = (name: string): string[] => {
    rebuildDepth = 0;
    const all = shapes(aliases.get(name)!);
    if (all.length === 1 && all[0]!.kind === undefined) return fieldRebuilds(all[0]!.fields, "m");
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of all) {
      if (s.kind === undefined || seen.has(s.kind)) continue;
      seen.add(s.kind);
      const body = fieldRebuilds(s.fields, "m");
      if (body.length) out.push(`  case ${JSON.stringify(s.kind)}:`, ...body.map((l) => `    ${l}`), `    break;`);
    }
    return out.length ? [`switch (m.kind) {`, ...out, `}`] : [];
  };

  // Deep-cloning AST subtrees without `structuredClone`.
  let cloneDepth = 0;
  const clonedValue = (t: TypeNode, val: string): string => {
    const f = formOf(t);
    switch (f.form) {
      case "json":
      case "plain":
      case "bigint":
        return val;
      case "node":
        return `clone${f.name}(${val})`;
      case "union":
        return holdsNodes(f.members) ? `clone${unionName(f.members).slice("visit".length)}(${val})` : val;
      case "array": {
        if (ref(f.element, "Stmt")) return `cloneStmts(${val})`;
        const x = `x${++cloneDepth}`;
        const ef = formOf(f.element);
        if (ef.form === "option") {
          const inner = clonedValue(ef.inner, `${x}!`);
          const innerForm = formOf(ef.inner);
          const elemType = innerForm.form === "node" ? `Extract<${innerForm.name}, { kind: "array" }>["elements"][usize]` : show(f.element);
          cloneDepth--;
          return `${val}.map((${x}): ${elemType} => (${x} !== undefined ? ${inner} : undefined))`;
        }
        const inner = clonedValue(f.element, x);
        cloneDepth--;
        return inner === x ? `[...${val}]` : `${val}.map((${x}) => ${inner})`;
      }
      case "option": {
        const inner = clonedValue(f.inner, `${val}!`);
        return inner === `${val}!` ? val : `${val} !== undefined ? ${inner} : undefined`;
      }
      case "object":
        return `{ ${f.fields.map((fld) => `${fld.name}: ${clonedField(fld.type, `${val}.${fld.name}`, fld.optional)}`).join(", ")} }`;
    }
  };
  const clonedField = (t: TypeNode, val: string, optional: boolean): string => {
    if (!optional) return clonedValue(t, val);
    const inner = clonedValue(t, `${val}!`);
    return inner === `${val}!` ? val : `${val} !== undefined ? ${inner} : undefined`;
  };
  const cloneBody = (name: string): string[] => {
    const all = shapes(aliases.get(name)!);
    const shapeExpr = (s: (typeof all)[number]) => {
      const parts = [
        ...(s.kind !== undefined ? [`kind: ${JSON.stringify(s.kind)} as const`] : []),
        ...s.fields.map((f) => `${f.name}: ${clonedField(f.type, `n.${f.name}`, f.optional)}`),
      ];
      return `{ ${parts.join(", ")} }`;
    };
    if (all.length === 1) return [`return ${shapeExpr(all[0]!)};`];
    const out: string[] = [`switch (n.kind) {`];
    const seen = new Set<string>();
    for (const s of all) {
      if (s.kind === undefined || seen.has(s.kind)) continue;
      seen.add(s.kind);
      out.push(`  case ${JSON.stringify(s.kind)}:`, `    return ${shapeExpr(s)};`);
    }
    out.push(`  default:`, `    return clone${name}(n);`, `}`);
    return out;
  };

  const rebuilt: string[] = [
    `// What a rebuild reads each node's replacement through: the node itself when it has none.`,
    `export interface Replacements {`,
    `  isEmpty(): boolean;`,
    ...nodes.filter(hasId).map((name) => `  ${currentMethod(name)}(node: ${name}): ${name};`),
    `}`,
    ``,
  ];
  for (const name of nodes) {
    rebuilt.push(
      `export function rebuilt${name}(n: ${name}, r: Ref<Replacements>): ${name} {`,
      `  let m = ${hasId(name) ? `r.${currentMethod(name)}(n)` : "n"};`,
      ...rebuildChildren(name).map((l) => `  ${l}`),
      `  return m;`,
      `}`,
      ``,
    );
  }
  rebuilt.push(
    `export function rebuiltStmts(n: Mut<Stmt[]>, r: Ref<Replacements>): void {`,
    `  if (r.isEmpty() || n.length === 0) return;`,
    `  let a = n.splice(0);`,
    `  a.reverse();`,
    `  while (a.length > 0) {`,
    `    n.push(rebuiltStmt(a.pop()!, r));`,
    `  }`,
    `}`,
    ``,
  );
  for (let i = 0; i < unions.size; i++) {
    const [, { name, members }] = [...unions][i]!;
    const type = members.map(show).join(" | ");
    const body: string[] = [];
    let rest = members.flatMap(expand).filter((m) => !ref(m, "string"));
    const array = rest.find((m) => m.kind === "array");
    if (array) {
      body.push(`if (Array.isArray(n)) {`, ...rebuilds(array, "n", "n").map((l) => `  ${l}`), `  return n;`, `}`);
      rest = rest.filter((m) => m !== array);
    }
    if (members.flatMap(expand).some((m) => ref(m, "string"))) body.unshift(`if (typeof n === "string") return n;`);
    const rebuildMember = (m: TypeNode, k?: string) => {
      if (k === "block" && m.kind === "ref" && m.name === "Extract") return `rebuiltStmts(n.body, r);\n    return n;`;
      return `return rebuilt${owner(m)}(n, r) as ${type};`;
    };
    if (rest.length === 1) body.push(rebuildMember(rest[0]!));
    else {
      const seen = new Set<string>();
      body.push(`switch (n.kind) {`);
      for (const m of rest) {
        const kinds = shapes(m).flatMap((s) => (s.kind === undefined || seen.has(s.kind) ? [] : [s.kind]));
        kinds.forEach((k) => seen.add(k));
        for (const k of kinds) body.push(`  case ${JSON.stringify(k)}:`, `    ${rebuildMember(m, k)}`);
      }
      body.push(`}`, `return n;`);
    }
    rebuilt.push(`// ${type}`, `export function rebuilt${name.slice("visit".length)}(n: ${type}, r: Ref<Replacements>): ${type} {`, ...body.map((l) => `  ${l}`), `}`, ``);
  }

  for (const name of nodes.filter(hasId)) {
    const all = shapes(aliases.get(name)!);
    const of = method(name);
    if (all.length === 1) {
      const k = all[0]!.kind ?? "";
      rebuilt.push(
        `export function withId${name}(n: ${name}, id: usize, by: usize, at?: [usize, usize]): ${name} {`,
        `  n.id = id;`,
        `  if (at !== undefined) {`,
        `    n.start = at[0];`,
        `    n.end = at[1];`,
        `  } else if (by !== 0) {`,
        `    n.start += by;`,
        `    n.end += by;`,
        `  }`,
        `  return n;`,
        `}`,
        ``,
        `export function idOf${name}(n: Ref<${name}>): usize {`,
        `  return n.id;`,
        `}`,
        ``,
        `export function mark${name}(n: Ref<${name}>): [usize, usize] {`,
        `  return [n.id, n.start * 1048576 + n.end];`,
        `}`,
        ``,
      );
    } else {
      const casesId: string[] = [];
      const casesGetId: string[] = [];
      const casesMark: string[] = [];
      const seen = new Set<string>();
      const uniq = all.filter((s) => s.kind !== undefined && !seen.has(s.kind) && (seen.add(s.kind), true));
      for (let j = 0; j < uniq.length; j++) {
        const s = uniq[j]!;
        casesId.push(
          `    case ${JSON.stringify(s.kind)}:`,
          `      n.id = id;`,
          `      if (at !== undefined) {`,
          `        n.start = at[0];`,
          `        n.end = at[1];`,
          `      } else if (by !== 0) {`,
          `        n.start += by;`,
          `        n.end += by;`,
          `      }`,
          `      return n;`,
        );
        const label = j === uniq.length - 1 ? `    default:` : `    case ${JSON.stringify(s.kind)}:`;
        casesGetId.push(
          label,
          `      return n.id;`,
        );
        casesMark.push(
          label,
          `      return [n.id, n.start * 1048576 + n.end];`,
        );
      }
      casesId.push(`    default:`, `      return n;`);
      rebuilt.push(
        `export function withId${name}(n: ${name}, id: usize, by: usize, at?: [usize, usize]): ${name} {`,
        `  switch (n.kind) {`,
        ...casesId,
        `  }`,
        `}`,
        ``,
        `export function idOf${name}(n: Ref<${name}>): usize {`,
        `  switch (n.kind) {`,
        ...casesGetId,
        `  }`,
        `}`,
        ``,
        `export function mark${name}(n: Ref<${name}>): [usize, usize] {`,
        `  switch (n.kind) {`,
        ...casesMark,
        `  }`,
        `}`,
        ``,
      );
    }
  }

  for (const name of nodes) {
    rebuilt.push(
      `export function clone${name}(n: Ref<${name}>): ${name} {`,
      ...cloneBody(name).map((l) => `  ${l}`),
      `}`,
      ``,
    );
  }
  rebuilt.push(
    `export function cloneStmts(n: Ref<Stmt[]>): Stmt[] {`,
    `  return n.map((s) => cloneStmt(s));`,
    `}`,
    ``,
  );
  for (let i = 0; i < unions.size; i++) {
    const [, { name, members }] = [...unions][i]!;
    const fnName = `clone${name.slice("visit".length)}`;
    const type = members.map(show).join(" | ");
    const body: string[] = [];
    let rest = members.flatMap(expand).filter((m) => !ref(m, "string"));
    const array = rest.find((m) => m.kind === "array");
    if (array) {
      body.push(`if (Array.isArray(n)) return ${clonedValue(array, "n")};`);
      rest = rest.filter((m) => m !== array);
    }
    if (members.flatMap(expand).some((m) => ref(m, "string"))) body.unshift(`if (typeof n === "string") return n;`);
    const shapeExpr = (s: ReturnType<typeof shapes>[number]) => {
      const parts = [
        ...(s.kind !== undefined ? [`kind: ${JSON.stringify(s.kind)} as const`] : []),
        ...s.fields.map((f) => `${f.name}: ${clonedField(f.type, `n.${f.name}`, f.optional)}`),
      ];
      return `{ ${parts.join(", ")} }`;
    };
    if (rest.length === 1) body.push(`return clone${owner(rest[0]!)}(n) as ${type};`);
    else {
      const seen = new Set<string>();
      const allShapes = rest.flatMap((m) => shapes(m).filter((s) => s.kind !== undefined && !seen.has(s.kind) && (seen.add(s.kind), true)));
      body.push(`switch (n.kind) {`);
      for (const s of allShapes) {
        body.push(`  case ${JSON.stringify(s.kind)}:`, `    return ${shapeExpr(s)};`);
      }
      body.push(`  default:`, `    return ${fnName}(n);`, `}`);
    }
    rebuilt.push(`// ${type}`, `export function ${fnName}(n: Ref<${type}>): ${type} {`, ...body.map((l) => `  ${l}`), `}`, ``);
  }

  const tagged = [...nodes.map((name) => [method(name), name] as const), ["stmts", "Stmt[]"] as const];
  const eachCases = tagged.flatMap(([of, type]) => {
    const body = type === "Stmt[]" ? [`for (const x of n.node) {`, `  v({ of: "stmt", node: x });`, `}`] : eachWalker.children(type, "n.node");
    return [`    case ${JSON.stringify(of)}:`, ...body.map((l) => `      ${l}`), `      break;`];
  });
  const collectCases = tagged.flatMap(([of, type]) => {
    const body = type === "Stmt[]" ? [`for (const x of n.node) {`, `  collectIdsNode({ of: "stmt", node: x }, seen, order, shared);`, `}`] : collectWalker.children(type, "n.node");
    return [`    case ${JSON.stringify(of)}:`, ...body.map((l) => `      ${l}`), `      break;`];
  });
  const stepCases = tagged.flatMap(([of, type]) => {
    const body =
      type === "Stmt[]"
        ? [`if (k < n.node.length) return visitAt({ of: "stmt", node: n.node[k]! }, steps, d + 1, each);`, `break;`]
        : [...stepWalker.children(type, "n.node"), `break;`];
    return [`    case ${JSON.stringify(of)}:`, ...body.map((l) => `      ${l}`)];
  });
  const nodeIdCases = tagged.flatMap(([of, type], idx) => {
    const outerLabel = idx === tagged.length - 1 ? `    default:` : `    case ${JSON.stringify(of)}:`;
    if (type === "Stmt[]" || !hasId(type)) return [outerLabel, `      return -1;`];
    const all = shapes(aliases.get(type)!);
    if (all.length === 1) return [outerLabel, `      return n.node.id as i64;`];
    const seen = new Set<string>();
    const uniq = all.filter((s) => s.kind !== undefined && !seen.has(s.kind) && (seen.add(s.kind), true));
    const inner: string[] = [`      switch (n.node.kind) {`];
    for (let j = 0; j < uniq.length; j++) {
      const s = uniq[j]!;
      const label = j === uniq.length - 1 ? `        default:` : `        case ${JSON.stringify(s.kind)}:`;
      inner.push(label, `          return n.node.id as i64;`);
    }
    inner.push(`      }`);
    return [outerLabel, ...inner];
  });
  const spanKeyCases = tagged.flatMap(([of, type], idx) => {
    const outerLabel = idx === tagged.length - 1 ? `    default:` : `    case ${JSON.stringify(of)}:`;
    if (type === "Stmt[]" || !hasId(type)) return [outerLabel, `      return 0;`];
    const all = shapes(aliases.get(type)!);
    if (all.length === 1) return [outerLabel, `      return n.node.start * 1048576 + n.node.end;`];
    const seen = new Set<string>();
    const uniq = all.filter((s) => s.kind !== undefined && !seen.has(s.kind) && (seen.add(s.kind), true));
    const inner: string[] = [`      switch (n.node.kind) {`];
    for (let j = 0; j < uniq.length; j++) {
      const s = uniq[j]!;
      const label = j === uniq.length - 1 ? `        default:` : `        case ${JSON.stringify(s.kind)}:`;
      inner.push(label, `          return n.node.start * 1048576 + n.node.end;`);
    }
    inner.push(`      }`);
    return [outerLabel, ...inner];
  });
  const visitor = [
    `// A node of any of the parser's types, tagged with which it is, since kinds repeat across them,`,
    `// or a list of statements, \`stmts\`, which is a scope of its own.`,
    `export type AnyNode =`,
    ...tagged.map(([of, type], i) => `  | { of: ${JSON.stringify(of)}; node: Ref<${type}> }${i === tagged.length - 1 ? ";" : ""}`),
    ``,
    `// The type of node each tag names.`,
    `export type NodeTypes = {`,
    ...tagged.map(([of, type]) => `  ${of}: ${type};`),
    `};`,
    ``,
    `// Hands each node \`n\` holds to \`v\`, in the order its type lists the fields, with a list of`,
    `// statements given whole.`,
    `export function forEachChild(n: AnyNode, v: (c: AnyNode) => void): void {`,
    `  switch (n.of) {`,
    ...eachCases,
    `  }`,
    `}`,
    ``,
    `// Reborrows \`n\` so a walk can pass a copy of the tagged reference to a callback.`,
    `export function reborrowAnyNode(n: Ref<AnyNode>): AnyNode {`,
    ...tagged.slice(0, -1).map(([of]) => `  if (n.of === ${JSON.stringify(of)}) return { of: ${JSON.stringify(of)}, node: n.node };`),
    `  return { of: "stmts", node: n.node };`,
    `}`,
    ``,
    `// Walks down \`steps\` from \`n\`, calling \`each\` on every first child along the way until a leaf`,
    `// or a node \`each\` skips is reached, or gives -1 when \`steps[d]\` is past the last child at \`d\`.`,
    `export function visitAt(n: AnyNode, steps: Mut<usize[]>, d: usize, each: (n: AnyNode) => boolean): i32 {`,
    `  if (d === steps.length) {`,
    `    if (n.of !== "stmts" && !each(reborrowAnyNode(n))) return 0;`,
    `    steps.push(0);`,
    `  }`,
    `  const k = steps[d]!;`,
    `  let i: usize = 0;`,
    `  switch (n.of) {`,
    ...stepCases,
    `  }`,
    `  if (d + 1 === steps.length && k === 0) {`,
    `    steps.pop();`,
    `    return 0;`,
    `  }`,
    `  return -1;`,
    `}`,
    ``,
    `// The id of \`n\`, or -1 when \`n\` has no id.`,
    `export function nodeIdOf(n: Ref<AnyNode>): i64 {`,
    `  switch (n.of) {`,
    ...nodeIdCases,
    `  }`,
    `}`,
    ``,
    `// A span fingerprint of \`n\` for detecting two distinct nodes sharing an id.`,
    `export function nodeSpanKey(n: Ref<AnyNode>): usize {`,
    `  switch (n.of) {`,
    ...spanKeyCases,
    `  }`,
    `}`,
    ``,
    `// Collects every distinct node id under \`n\` in pre-order, refusing two different nodes that`,
    `// share one id, and noting in \`shared\` any id reached more than once.`,
    `export function collectIdsNode(n: AnyNode, seen: Mut<Map<usize, usize>>, order: Mut<usize[]>, shared: Mut<Set<usize>>): void {`,
    `  const rawId = nodeIdOf(n);`,
    `  if (rawId >= 0) {`,
    `    const id = rawId as usize;`,
    `    const mark = nodeSpanKey(n);`,
    `    const was = seen.get(id);`,
    `    if (was !== undefined) {`,
    `      assert(was === mark, \`internal error: two nodes share id \${id}\`);`,
    `      shared.add(id);`,
    `      return;`,
    `    }`,
    `    seen.set(id, mark);`,
    `    order.push(id);`,
    `  }`,
    `  switch (n.of) {`,
    ...collectCases,
    `  }`,
    `}`,
    ``,
  ];
  const importsOf = (lines: string[]) => [...aliases.keys(), "Span"].filter((name) => lines.some((l) => new RegExp(`\\b${name}\\b`).test(l)));
  const readers = fieldReaders(parserSource);
  const walk = [
    `// Generated from the parser's AST types by \`bun scripts/walkgen.ts\`; a test fails when it is stale.`,
    `// Visits each node a node holds, tagged, in the order its type lists the fields.`,
    `import assert from "node:assert";`,
    `import type { ${importsOf([...visitor, ...readers]).join(", ")} } from "./parser.ts";`,
    ``,
    ...visitor,
    ...readers,
  ];
  const rebuild = [
    `// Generated from the parser's AST types by \`bun scripts/walkgen.ts\`; a test fails when it is stale.`,
    `// Each \`rebuilt\` function gives a node as the rewrite table has it, each node under it put in`,
    `// place the same way, writing the slots that held replaced nodes.`,
    `import type { ${importsOf(rebuilt).join(", ")} } from "./parser.ts";`,
    ``,
    ...rebuilt,
  ];
  const text = (lines: string[]) => lines.join("\n").trimEnd() + "\n";
  return { walk: text(walk), rebuild: text(rebuild) };
}

// A tree as a value a quote can read without reading an object's fields by name, which Fish
// can't: `quoteTree` copies a node into tagged values, each node its tag and its fields in order,
// an optional field only when it is there.
function fieldReaders(parserSource: string): string[] {
  const { aliases, isNode, isWord, membersOf, ref, shapes, formOf, show } = nodeTypes(parserSource);
  const method = (name: string) => name[0]!.toLowerCase() + name.slice(1);
  const helpers = new Map<string, { name: string; lines: string[] }>();
  // A function `name` taking `type`, written once per distinct type.
  const helper = (prefix: string, type: string, body: () => string[]): string => {
    const key = `${prefix} ${type}`;
    if (!helpers.has(key)) {
      const name = `${prefix}${helpers.size}`;
      helpers.set(key, { name, lines: [] });
      helpers.get(key)!.lines = [`function ${name}(n: Ref<${type}>): QuoteValue {`, ...body().map((l) => `  ${l}`), `}`, ``];
    }
    return helpers.get(key)!.name;
  };
  const plain = (t: TypeNode, v: string): string => {
    if (t.kind === "literal") return typeof (t.value as { value: unknown }).value === "boolean" ? `{ kind: "boolean", value: ${v} }` : `{ kind: "int", value: ${v} as i64 }`;
    if (ref(t, "boolean")) return `{ kind: "boolean", value: ${v} }`;
    if (ref(t, "f64")) return `{ kind: "float", value: ${v} }`;
    return `{ kind: "int", value: ${v} as i64 }`;
  };
  let loops = 0;
  // Statements handing `push` the value of `v`, of type `t`. Lists are read in place, as a helper
  // taking an array of a recursive node type isn't checked yet.
  const value = (t: TypeNode, v: string, push: (value: string) => string): string[] => {
    const f = formOf(t);
    switch (f.form) {
      case "json":
        return [push(`{ kind: "text", value: ${v} }`)];
      case "plain":
        return [push(plain(t, v))];
      case "bigint":
        return [push(`{ kind: "bigint", value: ${v} }`)];
      case "node":
        return [push(`{ kind: "node", of: ${JSON.stringify(method(f.name))}, fields: fieldsOf${f.name}(${v}) }`)];
      case "union":
        return [push(`${helper("oneOf", f.members.map(show).join(" | "), () => union(f.members))}(${v})`)];
      case "object":
        return [push(`${helper("recordOf", show(t), () => ["let out: QuoteField[] = [];", ...fields(f.fields, "n"), "return { kind: \"record\", fields: out };"])}(${v})`)];
      case "array": {
        const n = ++loops;
        const items = `items${n}`;
        const x = `x${n}`;
        const element = formOf(f.element);
        const add = (e: string) => `${items}.push(${e});`;
        const each = element.form === "option" ? optional(element.inner, x, add) : value(f.element, x, add);
        return [`let ${items}: QuoteValue[] = [];`, `for (const ${x} of ${v}) {`, ...each.map((l) => `  ${l}`), `}`, push(`{ kind: "list", items: ${items} }`)];
      }
      case "option":
        return optional(f.inner, v, push);
    }
  };
  // An Option's value, or none.
  const optional = (inner: TypeNode, v: string, push: (value: string) => string): string[] => [
    `if (${v} === undefined) ${push(`{ kind: "none" }`)}`,
    `else {`,
    ...value(inner, v, push).map((l) => `  ${l}`),
    `}`,
  ];
  const fields = (all: { name: string; optional: boolean; type: TypeNode }[], v: string): string[] =>
    all.flatMap((f) => {
      const path = `${v}.${f.name}`;
      const form = formOf(f.type);
      const inner = form.form === "option" ? form.inner : f.type;
      const push = (x: string) => `out.push({ name: ${JSON.stringify(f.name)}, value: ${x} });`;
      if (f.optional) return [`if (${path} !== undefined) {`, ...value(inner, path, push).map((l) => `  ${l}`), `}`];
      return value(f.type, path, push);
    });
  // A node's fields, its kind first when it has one.
  const kinds = new Map<string, string[]>();
  const shapeFields = (s: ReturnType<typeof shapes>[number]): string[] => [
    "let out: QuoteField[] = [];",
    ...(s.kind !== undefined ? [`out.push({ name: "kind", value: { kind: "text", value: n.kind } });`] : []),
    ...fields(s.fields, "n"),
    "return out;",
  ];
  const cases = (all: ReturnType<typeof shapes>, v: string): string[] => {
    if (all.length === 1 && all[0]!.kind === undefined) return shapeFields(all[0]!);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of all) {
      if (s.kind === undefined || seen.has(s.kind)) continue;
      seen.add(s.kind);
      const name = `fieldsOf${s.owner}_${s.kind}`;
      if (!kinds.has(name)) kinds.set(name, [`function ${name}(n: Ref<Extract<${s.owner}, { kind: ${s.kindType} }>>): QuoteField[] {`, ...shapeFields(s).map((l) => `  ${l}`), `}`, ``]);
      out.push(`  case ${JSON.stringify(s.kind)}:`, `    return ${name}(${v});`);
    }
    return [`switch (${v}.kind) {`, ...out, `}`, `return [];`];
  };
  // A union's value: a string, an array, or the node it is, told apart by kind.
  const union = (members: TypeNode[]): string[] => {
    const body: string[] = [];
    let rest = members.flatMap((m) => (m.kind === "ref" && aliases.has(m.name) && !isNode(m.name) && !isWord(m) ? membersOf(aliases.get(m.name)) : [m]));
    if (rest.some((m) => ref(m, "string"))) {
      body.push("if (typeof n === \"string\") return { kind: \"text\", value: `${n}` };");
      rest = rest.filter((m) => !ref(m, "string"));
    }
    const array = rest.find((m) => m.kind === "array");
    if (array) {
      body.push(`if (Array.isArray(n)) {`, ...value(array, "n", (x) => `return ${x};`).map((l) => `  ${l}`), `}`);
      rest = rest.filter((m) => m !== array);
    }
    const owner = (m: TypeNode) => (m.kind === "ref" && m.name === "Extract" && m.args[0]!.kind === "ref" ? m.args[0]!.name : m.kind === "ref" ? m.name : "");
    if (rest.length === 1 && isNode(owner(rest[0]!))) return [...body, `return { kind: "node", of: ${JSON.stringify(method(owner(rest[0]!)))}, fields: fieldsOf${owner(rest[0]!)}(n) };`];
    const seen = new Set<string>();
    body.push("switch (n.kind) {");
    for (const m of rest) {
      if (!isNode(owner(m))) throw new Error(`the field readers can't tell apart a union holding '${show(m)}'`);
      for (const s of shapes(m)) {
        if (s.kind === undefined || seen.has(s.kind)) continue;
        seen.add(s.kind);
        body.push(`  case ${JSON.stringify(s.kind)}:`, `    return { kind: "node", of: ${JSON.stringify(method(owner(m)))}, fields: fieldsOf${owner(m)}(n) };`);
      }
    }
    body.push("}", `return { kind: "none" };`);
    return body;
  };
  const tags: string[] = [];
  const readers: string[] = [];
  for (const [name, t] of aliases) {
    if (!isNode(name)) continue;
    tags.push(`    case ${JSON.stringify(method(name))}:`, `      return { kind: "node", of: ${JSON.stringify(method(name))}, fields: fieldsOf${name}(n.node) };`);
    readers.push(`function fieldsOf${name}(n: Ref<${name}>): QuoteField[] {`, ...cases(shapes(t).map((s) => ({ ...s, owner: s.owner ?? name })), "n").map((l) => `  ${l}`), `}`, ``);
  }
  return [
    `// What a node's field holds, for a quote to read: text, a number, a boolean, a list, a node by`,
    `// its tag and fields, an object of fields that isn't a node, or nothing.`,
    `export type QuoteValue =`,
    `  | { kind: "none" }`,
    `  | { kind: "text"; value: string }`,
    `  | { kind: "boolean"; value: boolean }`,
    `  | { kind: "int"; value: i64 }`,
    `  | { kind: "bigint"; value: bigint }`,
    `  | { kind: "float"; value: f64 }`,
    `  | { kind: "list"; items: QuoteValue[] }`,
    `  | { kind: "node"; of: string; fields: QuoteField[] }`,
    `  | { kind: "record"; fields: QuoteField[] };`,
    `export type QuoteField = { name: string; value: QuoteValue };`,
    ``,
    `export function quoteTree(n: AnyNode): QuoteValue {`,
    `  switch (n.of) {`,
    ...tags,
    `    case "stmts": {`,
    ...value({ kind: "array", element: { kind: "ref", name: "Stmt", args: [], start: 0, end: 0, id: 0 }, start: 0, end: 0, id: 0 } as TypeNode, "n.node", (x) => `return ${x};`).map((l) => `      ${l}`),
    `    }`,
    `  }`,
    `  return { kind: "none" };`,
    `}`,
    ``,
    ...readers,
    ...[...kinds.values()].flat(),
    ...[...helpers.values()].flatMap((h) => h.lines),
  ];
}

export const WALK = new URL("../src/walk.ts", import.meta.url);
export const REBUILD = new URL("../src/rebuild.ts", import.meta.url);

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { walk, rebuild } = sources(readFileSync(new URL("../src/parser.ts", import.meta.url), "utf8"));
  writeFileSync(WALK, walk);
  writeFileSync(REBUILD, rebuild);
}
