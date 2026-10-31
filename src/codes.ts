// Every diagnostic's code, as 'fishc explain' looks it up. A code names a kind of error, not one
// place that raises it, and keeps its meaning once given: new kinds take new numbers. Numbered
// by area:
//   E00xx syntax, lexing and editions
//   E01xx types: mismatches, inference, generics, unions, numbers and type-level functions
//   E02xx ownership and borrows: moves, borrows, lifetimes, mutability and copies
//   E03xx async and threads: await, lazy promises, Send, shared values, locks and Promise APIs
//   E04xx names and declarations: unknown and duplicate names, the top level, main, parameters
//   E05xx calls and members: argument counts, unknown members, std APIs and callbacks
//   E06xx control flow and errors: returns, throws, jumps, generators and match
//   E07xx classes, interfaces and enums
//   E08xx forms Fish doesn't support yet, and TypeScript forms Fish leaves out
//   E09xx modules, packages, manifests and lockfiles
//   E10xx interop: unsafe, C functions, libraries, Rust crates, JS packages and raw pointers
//   E11xx comptime, macros, decorators, quotes, tests and tags
//   W0xxx warnings
export type Explained = { title: string; explanation?: string; example?: string; fixed?: string };

export const CODES: Record<string, Explained> = {
  E0001: { title: "syntax error" },
  E0002: { title: "malformed token: an unterminated literal or comment, a bad escape, or an unexpected character" },
  E0003: { title: "invalid assignment or destructuring target" },
  E0004: { title: "a form written where it isn't allowed" },
  E0005: { title: "malformed edition directive" },
  E0006: { title: "a file in the TS-compat edition, which Fish doesn't compile" },

  E0101: { title: "mismatched types" },
  E0102: { title: "a condition that isn't a boolean" },
  E0103: { title: "an operator applied to types it doesn't take" },
  E0104: { title: "a type that has to be written, since Fish can't work it out" },
  E0105: { title: "cannot find type" },
  E0106: { title: "wrong number of type arguments" },
  E0107: { title: "a type argument that doesn't satisfy its constraint" },
  E0108: { title: "an Option used without checking it, or checked when it is never empty" },
  E0109: { title: "a union used without narrowing it to one member" },
  E0110: { title: "a number that doesn't fit its type" },
  E0111: { title: "a conversion between number types that has to be written" },
  E0112: { title: "a comparison between types that can't be equal" },
  E0113: { title: "a type or instance that would never end" },
  E0114: { title: "invalid type-level expression" },
  E0115: { title: "an interface or generic function type where a concrete type is needed" },
  E0116: { title: "a built-in type given the wrong type arguments" },
  E0117: { title: "a tuple's length or element index doesn't match" },
  E0118: { title: "a 'void' used as a value" },
  E0119: { title: "a value that can't be looped over or spread" },

  E0201: { title: "use of a moved value" },
  E0202: { title: "cannot move out of a borrowed value" },
  E0203: { title: "conflicting borrows" },
  E0204: { title: "a borrowed value doesn't live long enough" },
  E0205: { title: "a variable used before it is assigned" },
  E0206: { title: "cannot change a value through a shared reference" },
  E0207: { title: "cannot change a constant" },
  E0208: { title: "cannot assign to a read-only property" },
  E0209: { title: "invalid lifetime" },
  E0210: { title: "a closure that captures a value in a way its use can't allow" },
  E0211: { title: "not possible through a Dyn" },
  E0212: { title: "a change that would only reach a temporary copy" },
  E0213: { title: "a value that can't be cloned" },

  E0301: { title: "async-only code outside an async function" },
  E0302: { title: "a Promise that is never awaited" },
  E0303: { title: "a value that can't cross to another thread" },
  E0304: { title: "a shared value or lock used in a way other tasks could see half done" },
  E0305: { title: "invalid use of a Promise, a task or the Promise API" },

  E0401: { title: "cannot find name" },
  E0402: { title: "a name defined twice" },
  E0403: { title: "a name used before its declaration" },
  E0404: { title: "something at the top level that only belongs in a function" },
  E0405: { title: "invalid or missing main()" },
  E0406: { title: "a declaration that needs its value where it is declared" },
  E0407: { title: "a name that is reserved" },
  E0408: { title: "invalid parameter list" },
  E0409: { title: "a local declaration that uses what it can't reach" },
  E0410: { title: "invalid overload signatures" },

  E0501: { title: "wrong number of arguments" },
  E0502: { title: "no such property or method" },
  E0503: { title: "a value called that isn't a function, or a function used without calling it" },
  E0504: { title: "invalid arguments to a built-in function" },
  E0505: { title: "'?.' on something that is always there" },
  E0506: { title: "a callback that doesn't fit what it is given to" },
  E0507: { title: "no overload matches" },
  E0508: { title: "invalid use of a regex" },
  E0509: { title: "a type that can't be read from or written to JSON" },
  E0510: { title: "a value that can't be printed or formatted" },

  E0601: { title: "a path that ends without giving a value" },
  E0602: { title: "an error thrown where it isn't handled or declared" },
  E0603: { title: "a catch that can never run" },
  E0604: { title: "a jump with nowhere to go" },
  E0605: { title: "a return that doesn't fit where it is" },
  E0606: { title: "invalid use of a generator or 'yield'" },
  E0607: { title: "a match that doesn't cover every case, or a pattern that can't match" },
  E0608: { title: "a switch with more than one default" },

  E0701: { title: "invalid use of an abstract class or member" },
  E0702: { title: "a class that doesn't implement what it says it does" },
  E0703: { title: "a constructor that doesn't set up its object first" },
  E0704: { title: "a subclass that conflicts with the class it extends" },
  E0705: { title: "invalid getter or setter" },
  E0706: { title: "invalid static member" },
  E0707: { title: "invalid enum" },
  E0708: { title: "'this' or 'super' where there is none" },
  E0709: { title: "a private or protected member used from outside" },

  E0801: { title: "a form Fish doesn't support yet" },
  E0802: { title: "a TypeScript form Fish leaves out" },

  E0901: { title: "cannot find the file or package an import names" },
  E0902: { title: "an import of a name its module doesn't export" },
  E0903: { title: "an import that crosses a package's boundary" },
  E0904: { title: "a manifest that isn't valid TOML" },
  E0905: { title: "invalid manifest" },
  E0906: { title: "a dependency that can't be resolved or verified" },
  E0907: { title: "an import that clashes with another name in its file" },
  E0908: { title: "a Node built-in Fish doesn't have, or uses differently" },

  E1001: { title: "an operation that needs 'unsafe'" },
  E1002: { title: "invalid C function declaration" },
  E1003: { title: "a function a library can't export to C" },
  E1004: { title: "invalid Rust crate declaration or use" },
  E1005: { title: "a value that can't cross between Fish and JS" },
  E1006: { title: "invalid use of a raw pointer" },

  E1101: { title: "comptime code that failed while compiling" },
  E1102: { title: "invalid comptime parameter or block" },
  E1103: { title: "invalid macro" },
  E1104: { title: "invalid decorator or derive" },
  E1105: { title: "invalid quote" },
  E1106: { title: "invalid test" },
  E1107: { title: "invalid tagged template" },

  W0001: { title: "unused binding" },
  W0002: { title: "unreachable code" },
};
