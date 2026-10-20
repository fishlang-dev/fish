import { CompileError } from "./diag.ts";
import { expression } from "./expressions.ts";
import { RESERVED, type Cursor, type Expr, type Pattern, type PatternProp } from "./parser.ts";
import { propertyName } from "./types.ts";

// Destructuring patterns: binding patterns in declarations and parameters, and assignment
// patterns, which arrive as object or array literals and are converted once an `=` follows.

export function bindingPattern(c: Cursor): Pattern {
  if (c.at("{")) return objectPattern(c);
  if (c.at("[")) return arrayPattern(c);
  const name = c.ident();
  return { kind: "ident", name: name.text, start: name.start, end: name.end };
}

// A pattern inside another, which may carry a default.
function nested(c: Cursor): Pattern {
  const target = bindingPattern(c);
  return c.eat("=") ? withDefault(target, expression(c)) : target;
}

function withDefault(target: Pattern, value: Expr): Pattern {
  return { kind: "default", target, value, start: target.start, end: value.end };
}

function objectPattern(c: Cursor): Pattern {
  const start = c.expect("{").start;
  const props: PatternProp[] = [];
  let rest: Pattern | undefined;
  while (!c.eat("}")) {
    if (c.eat("...")) {
      rest = bindingPattern(c);
    } else {
      const keyStart = c.peek();
      const key = propertyName(c);
      let value: Pattern;
      if (c.eat(":")) {
        value = nested(c);
      } else {
        if (typeof key !== "string" || keyStart.kind !== "ident" || RESERVED.has(key)) throw c.error("expected ':'");
        const name: Pattern = { kind: "ident", name: key, start: keyStart.start, end: keyStart.end };
        value = c.eat("=") ? withDefault(name, expression(c)) : name;
      }
      props.push({ key, value, start: keyStart.start, end: c.end() });
    }
    if (!c.at("}")) c.expect(",");
  }
  return { kind: "object", props, rest, start, end: c.end() };
}

function arrayPattern(c: Cursor): Pattern {
  const start = c.expect("[").start;
  const elements: (Pattern | undefined)[] = [];
  let rest: Pattern | undefined;
  while (!c.eat("]")) {
    if (c.eat(",")) {
      elements.push(undefined);
      continue;
    }
    if (c.eat("...")) rest = bindingPattern(c);
    else elements.push(nested(c));
    if (!c.at("]")) c.expect(",");
  }
  return { kind: "array", elements, rest, start, end: c.end() };
}

// The left side of `[a, b] = [b, a]` parses as an array literal; this reads it as the pattern
// it was. Member expressions are valid targets here, though not in a binding pattern.
export function toPattern(e: Expr): Pattern {
  const span = { start: e.start, end: e.end };
  switch (e.kind) {
    case "ident":
      return { kind: "ident", name: e.name, ...span };
    case "member":
    case "index":
      return { kind: "expr", expr: e, ...span };
    case "assign":
      if (e.op === "=") return withDefault(toPattern(e.target), e.value);
      break;
    case "array": {
      const last = e.elements.at(-1);
      const rest = last?.kind === "spread" ? toPattern(last.value) : undefined;
      const elements = (rest ? e.elements.slice(0, -1) : e.elements).map((x) => x && toPattern(x));
      return { kind: "array", elements, rest, ...span };
    }
    case "object": {
      const props: PatternProp[] = [];
      let rest: Pattern | undefined;
      for (const p of e.props) {
        const at = { start: p.start, end: p.end };
        if (p.kind === "spread") rest = toPattern(p.value);
        else if (p.kind === "property") props.push({ key: p.key, value: toPattern(p.value), ...at });
        else if (p.kind === "shorthand") {
          const name: Pattern = { kind: "ident", name: p.name, start: p.start, end: p.start + p.name.length };
          props.push({ key: p.name, value: p.default ? withDefault(name, p.default) : name, ...at });
        } else throw new CompileError("a method can't be a destructuring target", p.start, p.end);
      }
      return { kind: "object", props, rest, ...span };
    }
  }
  throw new CompileError("invalid destructuring target", e.start, e.end);
}
