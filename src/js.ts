import { CompileError } from "./diag.ts";
import type { Func, Span, Stmt } from "./parser.ts";
import type { Declared } from "./typings.ts";

// What a JS declaration names: the package it is imported from, and its export there.
export type JsName = { module: string; name: string };

// Types a declaration file writes that Fish has under another name: TypeScript's one number
// type is an f64, and a value it leaves untyped is an opaque JS handle.
const LOWERED: Record<string, string> = { number: "f64", any: "JsValue", unknown: "JsValue", object: "JsValue" };

// The declaration an imported name stands for, as a statement of the program: a copy of it
// under the name it is imported by, its types lowered to Fish's and marked as JS. Its spans
// stay those of its own file.
export function jsDeclaration(declared: Declared, name: string, specifier: string, at: Span): Stmt {
  const d = unwrap(structuredClone(declared.at));
  if (d.kind !== "function") {
    throw new CompileError(`'${name}' from '${specifier}' is ${KINDS[d.kind] ?? "a declaration"}, and only functions of a package can be imported so far`, at.start, at.end);
  }
  lowerTypes(d);
  return Object.assign(d, { name, body: undefined, js: { module: specifier, name } }) as Func & { js: JsName };
}

const KINDS: Partial<Record<Stmt["kind"], string>> = { let: "a const", class: "a class", interface: "an interface", typeAlias: "a type", enum: "an enum", namespace: "a namespace" };

function unwrap(s: Stmt): Stmt {
  return s.kind === "declare" || s.kind === "export" ? unwrap(s.body) : s;
}

// Renames the types a declaration names that Fish calls something else. Only type nodes are
// `ref`s, so every one in the declaration is a type it names.
function lowerTypes(node: unknown) {
  if (Array.isArray(node)) return node.forEach(lowerTypes);
  if (typeof node !== "object" || node === null) return;
  const n = node as { kind?: unknown; name?: unknown; args?: unknown };
  if (n.kind === "ref" && typeof n.name === "string" && Array.isArray(n.args) && Object.hasOwn(LOWERED, n.name)) n.name = LOWERED[n.name];
  Object.values(node).forEach(lowerTypes);
}
