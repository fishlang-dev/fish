import type { ClassMember, ClassNode, Func } from "./parser.ts";
import type { Type, Typing } from "./typing.ts";
import type { NodeMap } from "./nodes.ts";

// A Rust function: its crate, its path from the crate's root, and the shim's C symbol for it.
export type RustName = { crate: string; path: string; symbol: string };

// A Rust type a class names: its crate and its path from the crate's root. Fish moves its values
// between threads, so it must be Send, which the shim asserts.
export type RustClass = { crate: string; path: string; name: string };

// A compilation's Rust declarations: the Rust function each function, constructor and method a
// Rust module declares names, and the Rust type of each class one declares, by its declaration;
// its type, once the checker has one, holds it too. They are kept off the AST, so a macro, which
// sees and makes AST, can't make a function or class Rust.
export type RustTables = { names: NodeMap<Func | ClassMember, RustName>; classNodes: NodeMap<ClassNode, RustClass> };

// The field a handle's class holds its boxed Rust value in.
export const HANDLE = "#handle";

// The Rust type a type is, when it is one.
export function rustClassOf(typing: Typing, t: Type): RustClass | undefined {
  const r = typeof t === "string" ? undefined : typing.rec(t);
  return r?.kind === "class" ? r.rust : undefined;
}

export const RUST_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A crate's name as Cargo takes it.
export const validCrate = (name: string) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name);

// A Rust function's shim symbol, from its crate and path, each part prefixed by its length so
// that no two functions share one, as `fsh_rust_4demo4util3mul` for `demo::util::mul`.
export const rustSymbol = (crate: string, path: string) => `fsh_rust_${[crate.replace(/-/g, "_"), ...path.split("::")].map((p) => `${p.length}${p}`).join("")}`;

// A Rust name the shim or the IR is about to be written from, checked again there, since the
// tree it came through isn't trusted to hold only what the declarations gave.
export function trusted(name: RustName): RustName {
  const { crate, path, symbol } = name;
  if (!validCrate(crate) || !path.split("::").every((p) => RUST_NAME.test(p)) || symbol !== rustSymbol(crate, path)) {
    throw new Error(`internal error: a Rust function's name isn't one a declaration gives: ${JSON.stringify(name)}`);
  }
  return name;
}

// The symbol of the shim function that drops a Rust type's boxed value. No member's symbol ends
// so, since each of a symbol's parts is spelled after its length.
export const dropSymbol = (c: RustClass) => `${trusted({ crate: c.crate, path: c.path, symbol: rustSymbol(c.crate, c.path) }).symbol}_drop`;

// How a Fish value crosses the Rust boundary: a number or boolean as itself, a Rust type as the
// pointer to its box, owned or lent, a string as a pointer to Fish's string, an Option as one of
// those that may be empty, and an array as its elements, owned or lent.
export type Crossing =
  | { kind: "plain"; type: Type }
  | { kind: "handle"; of: RustClass }
  | { kind: "lent"; of: RustClass; mutable: boolean }
  | { kind: "string" }
  | { kind: "option"; of: Crossing; inner: Type }
  | { kind: "array"; element: Crossing; elementType: Type; lent: boolean };

// How a type crosses as a parameter, or as what a function gives, or why it can't yet.
export function crossingOf(typing: Typing, t: Type, giving: boolean): Crossing | string {
  if (t === "boolean" || (typeof t === "string" && t !== "void" && t !== "string" && t !== "null" && t !== "never")) return { kind: "plain", type: t };
  if (t === "string") return { kind: "string" };
  if (typeof t === "string") return `a '${t}' can't cross the Rust boundary`;
  const rust = rustClassOf(typing, t);
  if (rust) return { kind: "handle", of: rust };
  const r = typing.rec(t);
  if (r.kind === "ref") {
    if (giving) return "a borrow's lifetime can't cross from Rust yet; give the value itself";
    const lent = rustClassOf(typing, r.to);
    if (lent) return { kind: "lent", of: lent, mutable: r.mutable };
    const to = typeof r.to !== "string" ? typing.rec(r.to) : undefined;
    if (to?.kind === "array") {
      if (r.mutable) return "'Mut<T[]>' would be '&mut [T]', which can't cross yet; pass the array, which moves it";
      return arrayCrossing(typing, to.element, true);
    }
    return "only Rust types and arrays can be lent to Rust";
  }
  if (r.kind === "union") {
    const others = r.members.filter((m) => m !== "null");
    if (!r.members.includes("null") || others.length !== 1) return "unions other than 'T | null' can't cross the Rust boundary yet; Rust enums other than Option and Result aren't supported";
    const of = crossingOf(typing, others[0]!, giving);
    if (typeof of === "string") return of;
    if (of.kind === "lent" || of.kind === "option") return "an Option can't hold a borrow or another Option across the Rust boundary yet";
    return { kind: "option", of, inner: others[0]! };
  }
  if (r.kind === "array") return arrayCrossing(typing, r.element, false);
  if (r.kind === "object" && r.tuple) return "tuples can't cross the Rust boundary yet";
  if (r.kind === "map") return "maps can't cross the Rust boundary yet";
  return "it can't cross the Rust boundary yet; Rust functions take and give numbers, booleans, strings, arrays, Options of those and Rust types";
}

function arrayCrossing(typing: Typing, element: Type, lent: boolean): Crossing | string {
  const of = crossingOf(typing, element, false);
  if (typeof of === "string") return of;
  if (of.kind === "array") return "arrays of arrays can't cross the Rust boundary yet";
  if (of.kind !== "plain" && of.kind !== "string" && of.kind !== "handle") return "an array crossing the Rust boundary holds numbers, booleans, strings or Rust types";
  if (lent && of.kind === "handle") return "a slice of Rust values can't be lent, since Fish holds each in its own box; pass the array, which moves them";
  return { kind: "array", element: of, elementType: element, lent };
}

// A crossing the checker allowed, which code generation trusts.
export function crossed(typing: Typing, t: Type, giving = false): Crossing {
  const c = crossingOf(typing, t, giving);
  if (typeof c === "string") throw new Error(`internal error: a '${t}' reached the Rust boundary: ${c}`);
  return c;
}

