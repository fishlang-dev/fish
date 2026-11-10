import { CompileError } from "./diag.ts";
import type { AssignOp, BinaryOp, Span } from "./parser.ts";
import { isFloat, isInteger, isNumeric, type Type, type Typing } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// Which operators have a meaning so far, and the types they take and give.

// The binary operators that have a meaning so far.
export const SUPPORTED_OPERATORS = new Set<BinaryOp>([
  "||", "&&", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", ">>>",
]);

// TypeScript rejects these on booleans, suggesting the logical operator meant instead.
const BITWISE_ON_BOOLEANS = new Map<BinaryOp, string>([
  ["&", "&&"],
  ["|", "||"],
  ["^", "!=="],
]);

// The assignment operators that have a meaning so far, and the operator each applies.
export const ASSIGNMENTS: Partial<Record<AssignOp, BinaryOp | "=">> = {
  "=": "=", "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%", "&=": "&", "|=": "|", "^=": "^",
  "<<=": "<<", ">>=": ">>", ">>>=": ">>>", "&&=": "&&", "||=": "||", "**=": "**",
};

// The result of a binary operator, or an error when its operands don't suit it.
/** @throws {CompileError} */
export function binaryType(typing: Mut<Typing>, op: BinaryOp, left: Type, right: Type, at: Span): Type {
  // A value of no type is in code an instance never reaches, where anything goes.
  if (left === "never" || right === "never") return ["===", "!==", "<", "<=", ">", ">=", "&&", "||"].includes(op) ? "boolean" : "never";
  const branded = brandedType(typing, op, left, right, { start: at.start, end: at.end });
  if (branded !== undefined) return branded;
  // Value equality comes through Eq, which objects don't have yet. A literal's value is known.
  const comparable = (t: Type) => typeof t === "string" || ["literal", "pattern", "pointer"].includes(typing.rec(t).kind);
  if ((op === "===" || op === "!==") && (!comparable(left) || !comparable(right))) {
    throw unsupported("comparisons of objects", at);
  }
  if (op === "===" || op === "!==") {
    if (left === right) return "boolean";
    // Two pointers to one type compare by address, whichever may write through it.
    if (typeof left !== "string" && typeof right !== "string") {
      const l = typing.rec(left), r = typing.rec(right);
      if (l.kind === "pointer" && r.kind === "pointer" && l.to === r.to) return "boolean";
    }
    throw new CompileError("E0112", `this comparison appears to be unintentional because the types '${typing.show(left)}' and '${typing.show(right)}' have no overlap`, at.start, at.end);
  }
  const logical = BITWISE_ON_BOOLEANS.get(op);
  if (logical !== undefined && left === "boolean" && right === "boolean") {
    throw new CompileError("E0103", `operator '${op}' can't be applied to booleans; use '${logical}'`, at.start, at.end);
  }
  // Only booleans, so `&&` and `||` always produce a boolean rather than one of their operands.
  if (op === "&&" || op === "||") {
    if (left !== "boolean" || right !== "boolean") throw new CompileError("E0103", `operator '${op}' cannot be applied to types '${typing.show(left)}' and '${typing.show(right)}'`, at.start, at.end);
    return "boolean";
  }
  // An Option has to be checked before its value is used.
  const option = [left, right].find((t) => typing.isOption(t));
  if (option !== undefined) throw new CompileError("E0108", `operator '${op}' can't use the Option '${typing.show(option)}' until it is checked; check it with '!== null' first, or give a default with '??'`, at.start, at.end);
  // A bigint mixes with no number, as TypeScript refuses; it has no unsigned shift.
  if (left === "bigint" || right === "bigint") {
    const other = left === "bigint" ? right : left;
    if (isNumeric(other)) throw new CompileError("E0111", `operator '${op}' can't mix 'bigint' and '${typing.show(other)}'; convert the number with 'BigInt(x)', or the bigint with 'as ${typing.show(other)}'`, at.start, at.end);
    if (left === right && op === ">>>") throw new CompileError("E0103", "operator '>>>' cannot be applied to type 'bigint'; a bigint has no unsigned right shift, so use '>>'", at.start, at.end);
    if (left === right) return op === "<" || op === "<=" || op === ">" || op === ">=" ? "boolean" : left;
  }
  // Numbers of different types never mix, as in Rust: one side is converted with `as`.
  if (isNumeric(left) && isNumeric(right) && left !== right) {
    throw new CompileError("E0111", `operator '${op}' can't mix '${typing.show(left)}' and '${typing.show(right)}'; convert one side with 'as', like 'x as ${typing.show(left)}'`, at.start, at.end);
  }
  // Strings compare by their UTF-8 bytes, which is code point order.
  if (left === "string" && right === "string" && (op === "<" || op === "<=" || op === ">" || op === ">=")) return "boolean";
  const integers = BITWISE.has(op);
  if (integers && left === right && isFloat(left)) {
    throw new CompileError("E0103", `operator '${op}' works on integers, and '${typing.show(left)}' is a float; convert it with 'as i64' first`, at.start, at.end);
  }
  if (left !== right || !(integers ? isInteger(left) : isNumeric(left))) {
    throw new CompileError("E0103", `operator '${op}' cannot be applied to types '${typing.show(left)}' and '${typing.show(right)}'`, at.start, at.end);
  }
  return op === "<" || op === "<=" || op === ">" || op === ">=" ? "boolean" : left;
}

// The operators only integers have.
const BITWISE = new Set<BinaryOp>(["&", "|", "^", "<<", ">>", ">>>"]);

// A brand compares with itself and with its base, and arithmetic on it gives its base, as
// TypeScript's does; two different brands don't mix.
/** @throws {CompileError} */
function brandedType(typing: Mut<Typing>, op: BinaryOp, left: Type, right: Type, at: Span): Type | undefined {
  const l = typing.recOf(left);
  const r = typing.recOf(right);
  // A union of brands of one base works as that base with a plain number.
  const lb = l?.kind === "union" ? typing.unbranded(left) : left;
  const rb = r?.kind === "union" ? typing.unbranded(right) : right;
  // So do two values of one such union, as two of one type parameter's are.
  if ((lb !== left && r?.kind !== "brand" && rb === right) || (rb !== right && l?.kind !== "brand" && lb === left) || (lb !== left && left === right)) return binaryType(typing, op, lb, rb, at);
  if (l?.kind !== "brand" && r?.kind !== "brand") return undefined;
  if ((l?.kind === "brand" && l.unit !== undefined) || (r?.kind === "brand" && r.unit !== undefined)) return unitResult(typing, op, left, right, at);
  if (l?.kind === "brand" && r?.kind === "brand" && left !== right) {
    throw new CompileError("E0111", `operator '${op}' can't mix '${typing.show(left)}' and '${typing.show(right)}'; convert one side with 'as'`, at.start, at.end);
  }
  const ul = typing.unbranded(left);
  const ur = typing.unbranded(right);
  return binaryType(typing, op, ul, ur, at);
}

// Units add, subtract and compare only with the same unit; multiplying and dividing combine
// them, a plain number scaling one.
/** @throws {CompileError} */
function unitResult(typing: Mut<Typing>, op: BinaryOp, left: Type, right: Type, at: Span): Type {
  const l = typing.recOf(left);
  const r = typing.recOf(right);
  const emptyLeft: Record<string, i64> = {};
  const emptyRight: Record<string, i64> = {};
  const lu = l?.kind === "brand" ? l.unit : isNumeric(left) ? emptyLeft : undefined;
  const ru = r?.kind === "brand" ? r.unit : isNumeric(right) ? emptyRight : undefined;
  if (lu === undefined || ru === undefined) throw new CompileError("E0111", `operator '${op}' can't mix '${typing.show(left)}' and '${typing.show(right)}'; a unit meets only the same unit, except that '*' and '/' combine them`, at.start, at.end);
  const ul = typing.unbranded(left);
  const ur = typing.unbranded(right);
  const base = binaryType(typing, op, ul, ur, { start: at.start, end: at.end });
  if (op === "*" || op === "/") {
    let powers: Record<string, i64> = {};
    for (const [n, p] of Object.entries(lu)) powers[n] = p;
    for (const [n, p] of Object.entries(ru)) powers[n] = (powers[n] ?? 0) + (op === "*" ? p : -p);
    return typing.unitType(base, powers);
  }
  if (BITWISE.has(op)) throw new CompileError("E0103", `operator '${op}' can't be applied to '${typing.show(l?.kind === "brand" ? left : right)}', a unit`, at.start, at.end);
  if (left !== right) throw new CompileError("E0111", `operator '${op}' can't mix '${typing.show(left)}' and '${typing.show(right)}'; a unit meets only the same unit, except that '*' and '/' combine them`, at.start, at.end);
  return base === "boolean" ? base : left;
}
