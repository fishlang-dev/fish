import { CompileError } from "./diag.ts";
import type { AssignOp, BinaryOp, Span } from "./parser.ts";
import { isFloat, isInteger, isNumeric, show, type Type } from "./typing.ts";
import { unsupported } from "./unsupported.ts";

// Which operators have a meaning so far, and the types they take and give.

// The binary operators that have a meaning so far.
export const SUPPORTED_OPERATORS = new Set<BinaryOp>([
  "||", "&&", "===", "!==", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", ">>>",
]);

// TypeScript rejects these on booleans, suggesting the logical operator meant instead.
const BITWISE_ON_BOOLEANS: Partial<Record<BinaryOp, string>> = { "&": "&&", "|": "||", "^": "!==" };

// The assignment operators that have a meaning so far, and the operator each applies.
export const ASSIGNMENTS: Partial<Record<AssignOp, BinaryOp | "=">> = {
  "=": "=", "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%", "&=": "&", "|=": "|", "^=": "^",
  "<<=": "<<", ">>=": ">>", ">>>=": ">>>", "&&=": "&&", "||=": "||", "**=": "**",
};

// The result of a binary operator, or an error when its operands don't suit it.
export function binaryType(op: BinaryOp, left: Type, right: Type, at: Span): Type {
  // Value equality comes through Eq, which objects don't have yet. A literal's value is known.
  const comparable = (t: Type) => typeof t === "string" || t.kind === "literal";
  if ((op === "===" || op === "!==") && (!comparable(left) || !comparable(right))) {
    throw unsupported("comparisons of objects", at);
  }
  if (op === "===" || op === "!==") {
    if (left === right) return "boolean";
    throw new CompileError(`this comparison appears to be unintentional because the types '${show(left)}' and '${show(right)}' have no overlap`, at.start, at.end);
  }
  const logical = BITWISE_ON_BOOLEANS[op];
  if (logical && left === "boolean" && right === "boolean") {
    throw new CompileError(`operator '${op}' can't be applied to booleans; use '${logical}'`, at.start, at.end);
  }
  // Only booleans, so `&&` and `||` always produce a boolean rather than one of their operands.
  if (op === "&&" || op === "||") {
    if (left !== "boolean" || right !== "boolean") throw new CompileError(`operator '${op}' cannot be applied to types '${show(left)}' and '${show(right)}'`, at.start, at.end);
    return "boolean";
  }
  // Numbers of different types never mix, as in Rust: one side is converted with `as`.
  if (isNumeric(left) && isNumeric(right) && left !== right) {
    throw new CompileError(`operator '${op}' can't mix '${show(left)}' and '${show(right)}'; convert one side with 'as', like 'x as ${show(left)}'`, at.start, at.end);
  }
  const integers = BITWISE.has(op);
  if (integers && left === right && isFloat(left)) {
    throw new CompileError(`operator '${op}' works on integers, and '${show(left)}' is a float; convert it with 'as i64' first`, at.start, at.end);
  }
  if (left !== right || !(integers ? isInteger(left) : isNumeric(left))) {
    throw new CompileError(`operator '${op}' cannot be applied to types '${show(left)}' and '${show(right)}'`, at.start, at.end);
  }
  return op === "<" || op === "<=" || op === ">" || op === ">=" ? "boolean" : left;
}

// The operators only integers have.
const BITWISE = new Set<BinaryOp>(["&", "|", "^", "<<", ">>", ">>>"]);
