import type { Instance, Local } from "./check.ts";
import type { Body } from "./classes.ts";
import type { Names } from "./diag.ts";
import type { Kind } from "./narrow.ts";
import { WeakNodeMap, WeakNodeSet, type Ids } from "./nodes.ts";
import type { ClassNode, Declarator, Expr, Func as Declared, Interface, JsName, Param, Stmt, TypeNode } from "./parser.ts";
import type { Category, Quote } from "./quote.ts";
import type { RegexTables } from "./regex.ts";
import type { ClassType, Type } from "./typing.ts";
import type { DynTable } from "./values.ts";

// What a compilation hands the front end, which keeps no state of its own: the counter node ids
// come from, the names its messages show as written, and the tables regexes are compiled with.
export type Compilation = { ids: Ids; names: Names; regex: RegexTables };

// The one compilation state the whole process shares, given to the front end by whatever starts a
// compilation. It is one because some tables keyed by node still outlive a program, the Rust
// bindings' and the formatter's, which need ids unique in the process, and std's tree is
// numbered from the same counter when loaded.
export const shared: Compilation = { ids: { last: 0 }, names: { local: new Set(), madeUp: new Map() }, regex: { properties: new Map(), folds: new Map() } };

// A fresh node id, for code past the parser that makes nodes.
export const freshId = (): number => ++shared.ids.last;

// The tables one check of a program fills in, by node and by type, for the rest of that check
// and for the passes after it: moves, comptime and codegen. `check` makes a fresh set, and every
// instance it makes holds it, so nothing one program records reaches another.
export type Tables = {
  // The names a loop's pattern binds, made as declarations of the parts; a generic body checked
  // again for another instance meets them already made.
  loopParts: WeakNodeSet<Declarator>;
  // The arrows nested function declarations became, with their names; they lend what they capture
  // per call.
  nestedFunctions: WeakNodeMap<Expr, string>;
  // The bindings nested function declarations make, and closures' captures of them.
  nestedBindings: WeakSet<Local>;
  // The generic functions written inside bodies, each lifted to a function of its own, by the
  // statement that declared it, or the generic arrow written as a value.
  liftedFunctions: WeakNodeMap<Stmt | Expr, { name: string; fn: Declared & { body: Stmt[] } }>;
  // Every name a class or object literal gives a getter, so a destructuring source reading one
  // runs it once.
  getterNames: Set<string>;
  // The fresh variable a destructuring assignment's literal part goes into, by the target whose
  // type it takes; and the defaults it adds, which an Option's absence takes and anything else
  // never needs.
  destructuredParts: WeakNodeMap<Stmt, Expr>;
  unusedDefaults: WeakNodeSet<Expr>;
  timerMains: WeakNodeSet<Declared>;
  // A nested function's calls of itself, which run with the calling closure's own captures.
  selfCalls: WeakNodeSet<Expr>;

  // The member reads a pipe wrote in for its topic. A generic body is checked once, so whether one
  // is a stored field or a getter's is only known for each instance.
  substituted: WeakNodeSet<Expr>;
  // The element types written on `Array.of<T>(...)` calls, which became array literals.
  ofElements: WeakNodeMap<Expr, TypeNode>;
  // `new Array(n).fill(x)` calls, rewritten into calls of the prelude's `array filled`.
  fills: WeakNodeSet<Expr>;
  filling: WeakNodeSet<Expr>;
  // Calls whose trailing arguments have been packed into their rest parameter's array.
  packed: WeakNodeSet<Expr>;
  // The pairs of a `new Map([[k, v]])` given no types, each a tuple of what it holds.
  pairs: WeakNodeSet<Expr>;
  // The `FixedArray.filled` calls, by the fixed array each makes.
  fixedFills: WeakNodeSet<Expr>;
  // `String.fromCharCode(...)` and `String.fromCodePoint(...)`, by their call, their arguments
  // gathered into one array.
  stringBuilds: WeakNodeMap<Expr, "units" | "points">;
  // The parameters of the closures declared functions named as values became: the function as
  // written, its parameters' names, and which of them take values a caller would have to clone.
  namedParams: WeakNodeMap<Param, { fn: string; names: string[]; clones: boolean[] }>;
  // Their types, resolved where the function is declared.
  presetParams: WeakNodeMap<Param, Type>;
  // The `fill length` checks that panic on a negative length.
  lengthChecks: WeakNodeSet<Expr>;
  // The `fileRead` and `fileWrite` calls of the std's file module.
  fileCalls: WeakNodeSet<Expr>;
  // The blocking calls the std's sync file module is written over, by their name.
  syncFileCalls: WeakNodeMap<Expr, string>;
  // The calls that print: `console.log`, `console.error`, `console.warn` and `print`.
  printCalls: WeakNodeSet<Expr>;
  // node:util's `format` calls.
  formatCalls: WeakNodeSet<Expr>;
  // The timer calls written in a program, rewritten into the std's own, and the async arrows
  // running their callbacks.
  timerSets: WeakNodeSet<Expr>;
  timerWrappers: WeakNodeSet<Expr>;
  // The name each rewritten timer call was written with, for messages about it.
  timerNames: WeakNodeMap<Expr, string>;
  // `Promise.all`, `race`, `allSettled` and `any` calls, each its own combined future.
  combinedCalls: WeakNodeSet<Expr>;
  // The operands of an `await`, while they are checked.
  awaitedNow: WeakNodeSet<Expr>;
  // node:util's `inspect` calls.
  inspectCalls: WeakNodeSet<Expr>;
  // The `isDeepStrictEqual` calls checked as the `===` they were turned into.
  deepEqualities: WeakNodeSet<Expr>;
  // The `parseArgs` calls whose config has been turned into the arguments std's port takes.
  parsedArgs: WeakNodeSet<Expr>;
  // The values printed as Node's util.inspect prints them, whose types as written say how their
  // fields were spelled.
  printed: WeakNodeSet<Expr>;
  // The `Date.now()` and `performance.now()` calls, by which each is.
  clocks: WeakNodeMap<Expr, "Date.now" | "performance.now">;
  // The `JSON.stringify` and `JSON.parse` calls, by which each is.
  jsonCalls: WeakNodeMap<Expr, "stringify" | "parse">;
  // The `parseInt`, `parseFloat` and `Number(s)` calls, by which each is.
  parses: WeakNodeMap<Expr, "parseInt" | "parseFloat" | "Number">;
  // Calls of the global `assert`, which panics where it is called.
  asserts: WeakNodeSet<Expr>;
  regexStringCalls: WeakNodeMap<Expr, string>;
  // The regex method calls, by method.
  regexCalls: WeakNodeMap<Expr, "test" | "exec">;
  // The `new RegExp(...)` expressions, which are regexes known while compiling.
  regexNews: WeakNodeSet<Expr>;
  // The `toFixed` calls.
  fixedPrints: WeakNodeSet<Expr>;
  // The `Math` calls and constants, which codegen lowers itself.
  maths: WeakNodeSet<Expr>;
  // The calls a tagged template became, the only calls yet that fill a rest parameter.
  tagCalls: WeakNodeSet<Expr>;
  // The `equals` each class's `===` calls.
  equalities: WeakMap<ClassType, Instance>;
  // Each quote, by the Ast types it was checked with, for comptime to build its value from.
  quotes: WeakNodeMap<Expr, Record<Category, Type>>;
  // The array literals that became tuples, as objects of fields `0`, `1` and on, which a generic
  // body's next instance checks again as tuples.
  tupleLiterals: WeakNodeSet<Expr>;
  // A rest tuple's array, read as its field `...`, and how many fixed elements come before it.
  restStarts: WeakNodeMap<Expr, number>;
  // Member reads the runtime computes, like `c.signal` and `signal.aborted`, and fields read
  // through a Dyn: values, not places.
  computed: WeakNodeSet<Expr>;
  // For each concrete type boxed into a Dyn, by the keys of the type and the Dyn: the instance
  // each interface method runs, then for each field the getter supplying it, or none when it is
  // a field. And each method call through a Dyn, with the receiver its interface declares.
  dynMembers: Map<string, DynTable>;
  // A rewritten call of a prelude promise helper whose T, in a generic body, may be void in an
  // instance: its name and type arguments for a T that isn't, the void helper taking the rest.
  promiseVariants: WeakNodeMap<Expr, { name: string; typeArgs: TypeNode[] }>;
  // The reads of a package's consts that can't be converted, refused once the program is checked.
  jsUses: Expr[];
  // The calls into a package, whose arguments cross by copy, so nothing moves into them.
  jsCrossings: WeakNodeSet<Expr>;
  // The function each of a package's signatures is checked as, by its declaration.
  jsBodies: WeakNodeMap<Stmt, Body>;
  // A package's classes, by name: what `new` and their statics are checked against.
  jsClasses: Map<string, Interface>;
  // Where each of a package's functions is first called, noted on a refusal of its declaration.
  jsCalledAt: WeakMap<object, Expr>;
  // The std's timer calls, by which one each is.
  timerCalls: WeakNodeMap<Expr, "timerSet" | "timerNext" | "timerClear">;
  // The test hook's `jsEvaluate(source)` calls, each running a JS module.
  jsEvaluations: WeakNodeSet<Expr>;
  // The `v === null` and `v === undefined` tests of a JsValue: what is tested, and for which.
  jsEmptyTests: WeakNodeMap<Expr, [Expr, "null" | "undefined"]>;
  // The reads of a package's consts, by the export each reads.
  jsExports: WeakNodeMap<Expr, JsName>;
  // The calls of a package's functions, by the export each calls, with the signature checked.
  jsCalls: WeakNodeMap<Expr, JsName>;
  // The values given to JS, converted by the call or write that gives them.
  jsGiven: WeakNodeSet<Expr>;
  // A handle's property reads and writes, and its method calls.
  jsMembers: WeakNodeSet<Expr>;
  jsMethods: WeakNodeSet<Expr>;
  // `new` of a package's class, and its static members read or called, by the class's export.
  jsNews: WeakNodeMap<Expr, JsName>;
  jsStatics: WeakNodeMap<Expr, JsName>;
  // Which declared parameters of a handle's method, a constructor or a static method a call takes
  // are optional, written with `?`, which JS may leave out: an empty value is undefined there.
  jsOptionalOf: WeakNodeMap<Expr, boolean[]>;
  // The `get`, `at` and `has` calls on a JsValue.
  jsAccessors: WeakNodeSet<Expr>;
  dynCalls: WeakNodeMap<Expr, { index: number; mutable: boolean; owned: boolean; callable?: Expr }>;

  // Each generic class's statics, declared with its first instance.
  genericStatics: WeakNodeMap<ClassNode, Map<string, Body>>;

  // The `instanceof Map`, `instanceof Set` and `instanceof Array` tests and the `Array.isArray`
  // calls, by the kind each tests a value for.
  kindTests: WeakNodeMap<Expr, Kind>;

  // Each lowered parameter: its name as written, and whether its default is `null`.
  defaulted: WeakNodeMap<Param, { name: string; empty: boolean }>;
  // Each `<it> ?? v` a default became, with the parameter's declared type, which `v` is checked
  // against.
  fallbacks: WeakNodeMap<Expr, TypeNode>;
  // Each lowered parameter's declared type, resolved where the function is written.
  declaredTypes: WeakNodeMap<Param, Type>;
  // Parameters renamed for the body, with the name shown for them in function types.
  renamed: WeakNodeMap<Param, string>;
  // The statements binding defaults and destructured parameters, which come before a derived
  // constructor's `super(...)`.
  prologues: WeakNodeSet<Stmt>;

  // Type nodes the checker makes for a type it already knows, as a rewritten call's type arguments.
  // Made while checking a generic body's definition, they name its placeholders, which each
  // instance swaps for what it binds them to.
  presetTypes: WeakNodeMap<TypeNode, Type>;
  // Each quote parsed, by the quote, so its holes are the same nodes wherever it is read.
  parsedQuotes: WeakNodeMap<Expr, Quote>;
};

export function newTables(): Tables {
  return {
    loopParts: new WeakNodeSet<Declarator>(),
    nestedFunctions: new WeakNodeMap<Expr, string>(),
    nestedBindings: new WeakSet<Local>(),
    liftedFunctions: new WeakNodeMap<Stmt | Expr, { name: string; fn: Declared & { body: Stmt[] } }>(),
    getterNames: new Set<string>(),
    destructuredParts: new WeakNodeMap<Stmt, Expr>(),
    unusedDefaults: new WeakNodeSet<Expr>(),
    timerMains: new WeakNodeSet<Declared>(),
    selfCalls: new WeakNodeSet<Expr>(),
    substituted: new WeakNodeSet<Expr>(),
    ofElements: new WeakNodeMap<Expr, TypeNode>(),
    fills: new WeakNodeSet<Expr>(),
    filling: new WeakNodeSet<Expr>(),
    packed: new WeakNodeSet<Expr>(),
    pairs: new WeakNodeSet<Expr>(),
    fixedFills: new WeakNodeSet<Expr>(),
    stringBuilds: new WeakNodeMap<Expr, "units" | "points">(),
    namedParams: new WeakNodeMap<Param, { fn: string; names: string[]; clones: boolean[] }>(),
    presetParams: new WeakNodeMap<Param, Type>(),
    lengthChecks: new WeakNodeSet<Expr>(),
    fileCalls: new WeakNodeSet<Expr>(),
    syncFileCalls: new WeakNodeMap<Expr, string>(),
    printCalls: new WeakNodeSet<Expr>(),
    formatCalls: new WeakNodeSet<Expr>(),
    timerSets: new WeakNodeSet<Expr>(),
    timerWrappers: new WeakNodeSet<Expr>(),
    timerNames: new WeakNodeMap<Expr, string>(),
    combinedCalls: new WeakNodeSet<Expr>(),
    awaitedNow: new WeakNodeSet<Expr>(),
    inspectCalls: new WeakNodeSet<Expr>(),
    deepEqualities: new WeakNodeSet<Expr>(),
    parsedArgs: new WeakNodeSet<Expr>(),
    printed: new WeakNodeSet<Expr>(),
    clocks: new WeakNodeMap<Expr, "Date.now" | "performance.now">(),
    jsonCalls: new WeakNodeMap<Expr, "stringify" | "parse">(),
    parses: new WeakNodeMap<Expr, "parseInt" | "parseFloat" | "Number">(),
    asserts: new WeakNodeSet<Expr>(),
    regexStringCalls: new WeakNodeMap<Expr, string>(),
    regexCalls: new WeakNodeMap<Expr, "test" | "exec">(),
    regexNews: new WeakNodeSet<Expr>(),
    fixedPrints: new WeakNodeSet<Expr>(),
    maths: new WeakNodeSet<Expr>(),
    tagCalls: new WeakNodeSet<Expr>(),
    equalities: new WeakMap<ClassType, Instance>(),
    quotes: new WeakNodeMap<Expr, Record<Category, Type>>(),
    tupleLiterals: new WeakNodeSet<Expr>(),
    restStarts: new WeakNodeMap<Expr, number>(),
    computed: new WeakNodeSet<Expr>(),
    dynMembers: new Map<string, DynTable>(),
    promiseVariants: new WeakNodeMap<Expr, { name: string; typeArgs: TypeNode[] }>(),
    jsUses: [],
    jsCrossings: new WeakNodeSet<Expr>(),
    jsBodies: new WeakNodeMap<Stmt, Body>(),
    jsClasses: new Map<string, Interface>(),
    jsCalledAt: new WeakMap<object, Expr>(),
    timerCalls: new WeakNodeMap<Expr, "timerSet" | "timerNext" | "timerClear">(),
    jsEvaluations: new WeakNodeSet<Expr>(),
    jsEmptyTests: new WeakNodeMap<Expr, [Expr, "null" | "undefined"]>(),
    jsExports: new WeakNodeMap<Expr, JsName>(),
    jsCalls: new WeakNodeMap<Expr, JsName>(),
    jsGiven: new WeakNodeSet<Expr>(),
    jsMembers: new WeakNodeSet<Expr>(),
    jsMethods: new WeakNodeSet<Expr>(),
    jsNews: new WeakNodeMap<Expr, JsName>(),
    jsStatics: new WeakNodeMap<Expr, JsName>(),
    jsOptionalOf: new WeakNodeMap<Expr, boolean[]>(),
    jsAccessors: new WeakNodeSet<Expr>(),
    dynCalls: new WeakNodeMap<Expr, { index: number; mutable: boolean; owned: boolean; callable?: Expr }>(),
    genericStatics: new WeakNodeMap<ClassNode, Map<string, Body>>(),
    kindTests: new WeakNodeMap<Expr, Kind>(),
    defaulted: new WeakNodeMap<Param, { name: string; empty: boolean }>(),
    fallbacks: new WeakNodeMap<Expr, TypeNode>(),
    declaredTypes: new WeakNodeMap<Param, Type>(),
    renamed: new WeakNodeMap<Param, string>(),
    prologues: new WeakNodeSet<Stmt>(),
    presetTypes: new WeakNodeMap<TypeNode, Type>(),
    parsedQuotes: new WeakNodeMap<Expr, Quote>(),
  };
}
