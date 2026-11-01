import { CompileError } from "./diag.ts";
import { expression, primary, unary } from "./expressions.ts";
import { isToken } from "./lexer.ts";
import { isReserved, type Cursor, type Expr, type Pattern, type PatternProp } from "./parser.ts";
import { propertyName } from "./types.ts";
import { nextId } from "./ids.ts";

// Destructuring patterns: binding patterns in declarations and parameters, and assignment
// patterns, which arrive as object or array literals and are converted once an `=` follows.

/** @throws {CompileError} */
export function bindingPattern(c: Mut<Cursor>): Pattern {
  if (c.at("{")) return objectPattern(c);
  if (c.at("[")) return arrayPattern(c);
  const name = c.ident();
  return { id: nextId(c.ids), kind: "ident", name: name.text, start: name.start, end: name.end };
}

// A pattern inside another, which may carry a default.
/** @throws {CompileError} */
function nested(c: Mut<Cursor>): Pattern {
  const target = bindingPattern(c);
  if (!c.eat("=")) return target;
  const value = expression(c);
  return withDefault(c, target, value);
}

/** @throws {CompileError} */
function withDefault(c: Mut<Cursor>, target: Pattern, value: Expr): Pattern {
  const targetStart: usize = target.start;
  const valueEnd: usize = value.end;
  return { id: nextId(c.ids), kind: "default", target, value, start: targetStart, end: valueEnd };
}

/** @throws {CompileError} */
function objectPattern(c: Mut<Cursor>): Pattern {
  const start = c.expect("{").start;
  let props: PatternProp[] = [];
  let rest: Pattern | undefined = undefined;
  while (!c.eat("}")) {
    if (c.eat("...")) {
      rest = bindingPattern(c);
    } else {
      const keyStart = c.token();
      const key = propertyName(c);
      let value: Pattern;
      if (c.eat(":")) {
        value = nested(c);
      } else {
        if (typeof key !== "string" || keyStart.kind !== "ident" || isReserved(key)) throw c.error("expected ':'");
        const name: Pattern = { id: nextId(c.ids), kind: "ident", name: key, start: keyStart.start, end: keyStart.end };
        if (c.eat("=")) {
          const fallback = expression(c);
          value = withDefault(c, name, fallback);
        } else {
          value = name;
        }
      }
      props.push({ id: nextId(c.ids), key, value, start: keyStart.start, end: c.end() });
    }
    if (!c.at("}")) c.expect(",");
  }
  return { id: nextId(c.ids), kind: "object", props, rest, start, end: c.end() };
}

/** @throws {CompileError} */
function arrayPattern(c: Mut<Cursor>): Pattern {
  const start = c.expect("[").start;
  let elements: Extract<Pattern, { kind: "array" }>["elements"] = [];
  let rest: Pattern | undefined = undefined;
  while (!c.eat("]")) {
    if (c.eat(",")) {
      elements.push(undefined);
      continue;
    }
    if (c.eat("...")) rest = bindingPattern(c);
    else elements.push(nested(c));
    if (!c.at("]")) c.expect(",");
  }
  return { id: nextId(c.ids), kind: "array", elements, rest, start, end: c.end() };
}

// The left side of `[a, b] = [b, a]` parses as an array literal; this reads it as the pattern
// it was. Member expressions are valid targets here, though not in a binding pattern.
/** @throws {CompileError} */
export function toPattern(c: Mut<Cursor>, e: Expr): Pattern {
  const span = { start: e.start, end: e.end };
  switch (e.kind) {
    case "ident":
      return { id: nextId(c.ids), kind: "ident", name: e.name, ...span };
    case "member":
    case "index":
      return { id: nextId(c.ids), kind: "expr", expr: e, ...span };
    case "assign":
      if (e.op === "=") {
        const target = toPattern(c, e.target);
        return withDefault(c, target, e.value);
      }
      break;
    case "array": {
      // Taken apart from the end, the literal being consumed: a spread last is the rest.
      let items = e.elements;
      let rest: Pattern | undefined = undefined;
      if (items.length > 0) {
        // A hole pops as undefined, the array being known not to be empty.
        const last = items.pop();
        if (last === undefined) items.push(undefined);
        else {
          const x = last!;
          if (x.kind === "spread") rest = toPattern(c, x.value);
          else items.push(x);
        }
      }
      let elements: Extract<Pattern, { kind: "array" }>["elements"] = [];
      items.reverse();
      while (items.length > 0) {
        const x = items.pop();
        if (x === undefined) elements.push(undefined);
        else elements.push(toPattern(c, x!));
      }
      return { id: nextId(c.ids), kind: "array", elements, rest, ...span };
    }
    case "object": {
      let props: PatternProp[] = [];
      let rest: Pattern | undefined = undefined;
      let written = e.props;
      written.reverse();
      while (written.length > 0) {
        const p = written.pop()!;
        const at = { start: p.start, end: p.end };
        if (p.kind === "spread") rest = toPattern(c, p.value);
        else if (p.kind === "property") {
          const id = nextId(c.ids);
          const value = toPattern(c, p.value);
          props.push({ id, key: p.key, value, ...at });
        } else if (p.kind === "shorthand") {
          const name: Pattern = { id: nextId(c.ids), kind: "ident", name: p.name, start: p.start, end: p.start + p.name.length };
          const id = nextId(c.ids);
          const value = p.default === undefined ? name : withDefault(c, name, p.default!);
          props.push({ id, key: p.name, value, ...at });
        } else throw new CompileError("a method can't be a destructuring target", p.start, p.end);
      }
      return { id: nextId(c.ids), kind: "object", props, rest, ...span };
    }
  }
  throw new CompileError("invalid destructuring target", span.start, span.end);
}

// A pattern after `case` in a `match`: alternatives separated by `|`.
/** @throws {CompileError} */
export function matchPattern(c: Mut<Cursor>): Pattern {
  const first = singlePattern(c);
  if (!c.at("|")) return first;
  const start = first.start;
  let patterns = [first];
  while (c.eat("|")) patterns.push(singlePattern(c));
  return { id: nextId(c.ids), kind: "or", patterns, start, end: c.end() };
}

// Object and array patterns here hold match patterns, so `{ status: 200 }` tests a field.
/** @throws {CompileError} */
function singlePattern(c: Mut<Cursor>): Pattern {
  const t = c.token();
  if (c.eat("(")) {
    const inner = matchPattern(c);
    c.expect(")");
    return inner;
  }
  if (c.at("{")) return matchObject(c);
  if (c.at("[")) return matchArray(c);
  const numeric = (kind: string) => ["int", "float", "bigint"].includes(kind);
  if (t.kind === "string" || numeric(t.kind) || c.at("true") || c.at("false") || c.at("null")) {
    return { id: nextId(c.ids), kind: "literal", value: primary(c), start: t.start, end: t.end };
  }
  if (c.at("-") && numeric(c.peek(1).kind)) {
    const value = unary(c);
    const valueStart: usize = value.start;
    const valueEnd: usize = value.end;
    return { id: nextId(c.ids), kind: "literal", value, start: valueStart, end: valueEnd };
  }
  if (c.at("_") && !isToken(c.peek(1), ".") && !isToken(c.peek(1), "(")) {
    return { id: nextId(c.ids), kind: "wildcard", start: t.start, end: c.next().end };
  }
  let name = c.ident().text;
  let dotted = false;
  // Later segments may be reserved words, as in `Status.default`.
  while (c.eat(".")) {
    const segment = c.next();
    if (segment.kind !== "ident") throw c.error("expected a name", segment);
    name += "." + segment.text;
    dotted = true;
  }
  const args = c.eat("(") ? c.list((c) => matchPattern(c), ")") : undefined;
  if (args === undefined && !dotted) return { id: nextId(c.ids), kind: "ident", name, start: t.start, end: c.end() };
  return { id: nextId(c.ids), kind: "variant", name, args, start: t.start, end: c.end() };
}

/** @throws {CompileError} */
function matchObject(c: Mut<Cursor>): Pattern {
  const start = c.expect("{").start;
  let props: PatternProp[] = [];
  let rest: Pattern | undefined = undefined;
  while (!c.eat("}")) {
    if (c.eat("...")) {
      rest = singlePattern(c);
    } else {
      const keyStart = c.token();
      const key = propertyName(c);
      let value: Pattern;
      if (c.eat(":")) {
        value = matchPattern(c);
      } else {
        if (typeof key !== "string" || keyStart.kind !== "ident" || isReserved(key)) throw c.error("expected ':'");
        value = { id: nextId(c.ids), kind: "ident", name: key, start: keyStart.start, end: keyStart.end };
      }
      props.push({ id: nextId(c.ids), key, value, start: keyStart.start, end: c.end() });
    }
    if (!c.at("}")) c.expect(",");
  }
  return { id: nextId(c.ids), kind: "object", props, rest, start, end: c.end() };
}

/** @throws {CompileError} */
function matchArray(c: Mut<Cursor>): Pattern {
  const start = c.expect("[").start;
  let elements: Extract<Pattern, { kind: "array" }>["elements"] = [];
  let rest: Pattern | undefined = undefined;
  while (!c.eat("]")) {
    if (c.eat(",")) {
      elements.push(undefined);
      continue;
    }
    if (c.eat("...")) rest = singlePattern(c);
    else elements.push(matchPattern(c));
    if (!c.at("]")) c.expect(",");
  }
  return { id: nextId(c.ids), kind: "array", elements, rest, start, end: c.end() };
}
