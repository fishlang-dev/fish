import { Arenas } from "./arenas.ts";
import type { Instance, Local } from "./check.ts";
import type { Value } from "./comptime.ts";
import type { Body } from "./classes.ts";
import type { Names } from "./diag.ts";
import type { Kind } from "./narrow.ts";
import { NodeSet, WeakNodeMap, WeakNodeSet, type Id, type Ids } from "./nodes.ts";
import type { ClassNode, Declarator, Expr, Func as Declared, Interface, JsName, ObjectProp, Param, Stmt, TypeAlias, TypeNode, TypeParam } from "./parser.ts";
import type { Category, Free, Hygiene, Quote } from "./quote.ts";
import type { RegexTables } from "./regex.ts";
import type { RustTables } from "./rust.ts";
import type { Locking } from "./dependencies.ts";
import type { Unit } from "./mathlib.ts";
import { TypeMap, newTyping, type ClassType, type DynType, type LiteralType, type Type, type Typing } from "./typing.ts";
import type { DynTable } from "./values.ts";

// One compilation of a program. Its front end, which keeps no state of its own, is handed the
// counter node ids come from, the names its messages show as written, and the tables regexes are
// compiled with; every check of the program shares its types, interned in `typing`, its instances,
// bodies, locals and classes, kept in `arenas`, and `counts`.
// Whatever starts a compilation makes one, so nothing one program makes reaches another; what
// outlives it, the caches of a CLI run or a language server, is its `session`.
// `upcasts` are the spans of the `equals` methods `@derive(Eq)` wrote over a base class. Their
// `super.equals(other)` lends `other` to the base's `equals`, which reads the embedded base a
// reference to the class points at, though Fish code can't upcast it itself. A span outlives the
// copies macros make.
// `files` are the program's files once loaded, by the offset each starts at, for naming where a
// declaration is. `rust` holds the Rust names its `rust:` modules declare.
// `enumInits` are the computed enum initializers being evaluated, innermost last, as the span and
// member name an error about one points at.
// `fileNames`: for a linked program, each file's top-level names by its base offset: the name each
// declaration it reaches takes in the program, to the name the file writes for it.
// `generated`: the nodes a macro made, which no warning points into: their author can't change them.
export type Compilation = {
  session: Session; ids: Ids; names: Names; regex: RegexTables; typing: Typing; arenas: Arenas; counts: Counts; upcasts: Set<string>; files: { base: usize; file: string; src: string }[]; rust: RustTables;
  enumInits: [usize, usize, string][]; fileNames: WeakMap<Stmt[], Map<usize, Map<string, string>>>; generated: WeakNodeSet<Id>;
};

// What a compilation numbers as it goes, from 0, so the same program is numbered the same way
// whatever was compiled before it: its enums, which tells enums of one name apart, the generic
// functions lifted out of bodies, destructuring assignments, macro expansions, and the constants
// macros give values.
export type Counts = { enums: usize; lifts: usize; destructures: usize; expansions: usize; constants: usize };

// What lasts as long as whoever compiles: a CLI run, a language server, a test. Its options, and
// the caches that spare later compilations the work earlier ones did.
// `locking`: whether the lockfile may be rewritten, and which dependencies `fishc update` moves.
// `engineHook`: whether programs may import `fish:engine`, which only the compiler's own tests do.
// `clang`: `clang --version`, which names the target as well as the compiler.
// `digests`: each source a cached object depends on, hashed, by path, size and modification time.
// `compiling`: the objects being compiled without blocking, so each is compiled once.
// `mathUnits`: the Math runtime's objects to compile.
// `std`: std's parsed tree, serialized, by the path it is cached at; the key naming it, null when
// no compiler source can be read; and how many times std was parsed rather than loaded.
export type Session = {
  locking: Locking;
  engineHook: boolean;
  clang?: string;
  digests: Map<string, string>;
  compiling: Map<string, Promise<string>>;
  mathUnits?: Unit[];
  std: { key?: string | null; tree?: { path: string | null; bytes: Uint8Array }; parses: usize };
};

export function newSession(): Session {
  return { locking: { locked: false }, engineHook: false, digests: new Map(), compiling: new Map(), std: { parses: 0 } };
}

export function newCompilation(session: Session): Compilation {
  return { session, ids: { last: 0 }, names: { local: new Set(), madeUp: new Map() }, regex: { properties: new Map(), folds: new Map() }, typing: newTyping(), arenas: new Arenas(), counts: { enums: 0, lifts: 0, destructures: 0, expansions: 0, constants: 0 }, upcasts: new Set(), files: [], rust: { names: new WeakNodeMap(), classNodes: new WeakNodeMap() }, enumInits: [], fileNames: new WeakMap(), generated: new WeakNodeSet() };
}

// The tables one check of a program fills in, by node and by type, for the rest of that check
// and for the passes after it: moves, comptime and codegen. `check` makes a fresh set, and every
// instance it makes holds it, so nothing one program records reaches another.
export type Tables = {
  // What every check of the program shares: its types, its instances, bodies, locals and classes,
  // the upcasts its macros wrote, the counter for the nodes checking makes, its counts, its regex
  // tables, files and Rust names.
  typing: Typing;
  arenas: Arenas;
  upcasts: Set<string>;
  ids: Ids;
  counts: Counts;
  regex: RegexTables;
  files: Compilation["files"];
  rust: RustTables;
  generated: Compilation["generated"];
  // The `let` statements and parameters that declare a name, as the checker meets them; every
  // other node an instance's `locals` holds is a use of one.
  declarations: WeakNodeSet<Expr | Stmt | Param | ObjectProp>;
  // The names a loop's pattern binds, made as declarations of the parts; a generic body checked
  // again for another instance meets them already made.
  loopParts: WeakNodeSet<Declarator>;
  // The arrows nested function declarations became, with their names; they lend what they capture
  // per call.
  nestedFunctions: WeakNodeMap<Expr, string>;
  // The bindings nested function declarations make, and closures' captures of them.
  nestedBindings: WeakNodeSet<Local>;
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
  // The arrows the checker writes around a function given as a value or a timer's callback, which
  // keep no frame in a backtrace, since nobody wrote them.
  madeArrows: WeakNodeSet<Expr>;
  // The `fill length` checks that panic on a negative length.
  lengthChecks: WeakNodeSet<Expr>;
  // The `fileRead` and `fileWrite` calls of the std's file module.
  fileCalls: WeakNodeSet<Expr>;
  // The blocking calls the std's sync file module is written over, by their name.
  syncFileCalls: WeakNodeMap<Expr, string>;
  // The calls that print: `console.log`, `console.error`, `console.warn` and `print`.
  printCalls: WeakNodeSet<Expr>;
  // `handle.join()` calls, which take the handle over and give it back awaitable as a TaskPanic.
  joinCalls: WeakNodeSet<Expr>;
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
  // The `Date.now()`, `performance.now()` and `Math.random()` calls, by which each is: each reads
  // the world outside the program, so none has a value while compiling.
  clocks: WeakNodeMap<Expr, "Date.now" | "performance.now" | "Math.random">;
  // The `JSON.stringify` and `JSON.parse` calls, by which each is.
  jsonCalls: WeakNodeMap<Expr, "stringify" | "parse">;
  // The `parseInt`, `parseFloat` and `Number(s)` calls, by which each is.
  parses: WeakNodeMap<Expr, "parseInt" | "parseFloat" | "Number">;
  // Calls of the global `assert`, which panics where it is called, each with its condition as written.
  asserts: WeakNodeMap<Expr, string>;
  regexStringCalls: WeakNodeMap<Expr, string>;
  // The regex method calls, by method.
  regexCalls: WeakNodeMap<Expr, "test" | "exec">;
  // The `new RegExp(...)` expressions, which are regexes known while compiling.
  regexNews: WeakNodeSet<Expr>;
  // The `toFixed` calls.
  fixedPrints: WeakNodeSet<Expr>;
  // The `Math` calls and constants, which codegen lowers itself.
  maths: WeakNodeSet<Expr>;
  // The calls of the integer methods named for how they overflow, as `checkedAdd`.
  integerCalls: WeakNodeSet<Expr>;
  // The calls a tagged template became, the only calls yet that fill a rest parameter.
  tagCalls: WeakNodeSet<Expr>;
  // The `equals` each class's `===` calls.
  equalities: TypeMap<ClassType, Instance>;
  // Each quote, by the Ast types it was checked with, for comptime to build its value from.
  quotes: WeakNodeMap<Expr, Record<Category, Type>>;
  // The array literals that became tuples, as objects of fields `0`, `1` and on, which a generic
  // body's next instance checks again as tuples.
  tupleLiterals: WeakNodeSet<Expr>;
  // A rest tuple's array, read as its field `...`, and how many fixed elements come before it.
  restStarts: WeakNodeMap<Expr, usize>;
  // Member reads the runtime computes, like `c.signal` and `signal.aborted`, and fields read
  // through a Dyn: values, not places.
  computed: WeakNodeSet<Expr>;
  // For each concrete type boxed into a Dyn, by the keys of the type and the Dyn: the instance
  // each interface method runs, then for each field the getter supplying it, or none when it is
  // a field. And each method call through a Dyn, with the receiver its interface declares.
  dynMembers: Map<string, DynTable>;
  // A value boxed into a union's one Dyn member on its way into the union: the Dyn it becomes first.
  boxedMembers: WeakNodeMap<Expr, DynType>;
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
  dynCalls: WeakNodeMap<Expr, { index: usize; mutable: boolean; owned: boolean; callable?: Expr }>;

  // Each generic class's statics, declared with its first instance.
  genericStatics: WeakNodeMap<ClassNode, Map<string, Body>>;
  // A generic class's placeholders, by its first type parameter, shared by its definition
  // check and its members.
  classScopes: WeakNodeMap<TypeParam, Map<string, Type>>;
  // The program's type aliases, which inference looks through, and those being looked through,
  // so one that holds itself is looked into once.
  aliases: Map<string, TypeAlias>;
  expanding: Set<string>;

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
  // While a macro runs, the hygiene its quotes are built with.
  hygiene: Hygiene | undefined;
  // The bindings each quote made while a macro runs, for a quote it is spliced into; the names it
  // left free, for that quote to bind; and the spans of the quotes its nodes came from, the only
  // nodes those names are renamed in, never the program's own, spliced in as input. Each is kept
  // by the quote's value.
  quoteScopes: WeakMap<object, Map<string, string>>;
  quoteFrees: WeakMap<object, Free>;
  quotedSpans: WeakMap<object, Set<string>>;
  // A comptime string array's binding: a literal type standing for exactly that array, so equal
  // arrays share an instance, with the array it stands for.
  stringArrays: TypeMap<LiteralType, string[]>;
  // Makes sure an instance is checked before comptime runs it, as a comptime argument may call a
  // function the checker hasn't reached yet.
  ensureChecked: (instance: Instance) => boolean;
  // Each top-level const's value, once computed, and those being computed, which a const reading
  // itself would meet.
  constants: WeakNodeMap<Instance, Value>;
  computing: NodeSet<Instance>;
};

export function newTables({ typing, arenas, upcasts, ids, counts, regex, files, rust, generated }: Compilation): Tables {
  return {
    typing,
    arenas,
    upcasts,
    ids,
    counts,
    regex,
    files,
    rust,
    generated,
    declarations: new WeakNodeSet<Expr | Stmt | Param | ObjectProp>(),
    loopParts: new WeakNodeSet<Declarator>(),
    nestedFunctions: new WeakNodeMap<Expr, string>(),
    nestedBindings: new WeakNodeSet<Local>(),
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
    madeArrows: new WeakNodeSet<Expr>(),
    lengthChecks: new WeakNodeSet<Expr>(),
    fileCalls: new WeakNodeSet<Expr>(),
    syncFileCalls: new WeakNodeMap<Expr, string>(),
    printCalls: new WeakNodeSet<Expr>(),
    joinCalls: new WeakNodeSet<Expr>(),
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
    clocks: new WeakNodeMap<Expr, "Date.now" | "performance.now" | "Math.random">(),
    jsonCalls: new WeakNodeMap<Expr, "stringify" | "parse">(),
    parses: new WeakNodeMap<Expr, "parseInt" | "parseFloat" | "Number">(),
    asserts: new WeakNodeMap<Expr, string>(),
    regexStringCalls: new WeakNodeMap<Expr, string>(),
    regexCalls: new WeakNodeMap<Expr, "test" | "exec">(),
    regexNews: new WeakNodeSet<Expr>(),
    fixedPrints: new WeakNodeSet<Expr>(),
    maths: new WeakNodeSet<Expr>(),
    integerCalls: new WeakNodeSet<Expr>(),
    tagCalls: new WeakNodeSet<Expr>(),
    equalities: new TypeMap<ClassType, Instance>(),
    quotes: new WeakNodeMap<Expr, Record<Category, Type>>(),
    tupleLiterals: new WeakNodeSet<Expr>(),
    restStarts: new WeakNodeMap<Expr, usize>(),
    computed: new WeakNodeSet<Expr>(),
    dynMembers: new Map<string, DynTable>(),
    boxedMembers: new WeakNodeMap<Expr, DynType>(),
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
    dynCalls: new WeakNodeMap<Expr, { index: usize; mutable: boolean; owned: boolean; callable?: Expr }>(),
    genericStatics: new WeakNodeMap<ClassNode, Map<string, Body>>(),
    classScopes: new WeakNodeMap<TypeParam, Map<string, Type>>(),
    aliases: new Map<string, TypeAlias>(),
    expanding: new Set<string>(),
    kindTests: new WeakNodeMap<Expr, Kind>(),
    defaulted: new WeakNodeMap<Param, { name: string; empty: boolean }>(),
    fallbacks: new WeakNodeMap<Expr, TypeNode>(),
    declaredTypes: new WeakNodeMap<Param, Type>(),
    renamed: new WeakNodeMap<Param, string>(),
    prologues: new WeakNodeSet<Stmt>(),
    presetTypes: new WeakNodeMap<TypeNode, Type>(),
    parsedQuotes: new WeakNodeMap<Expr, Quote>(),
    hygiene: undefined,
    quoteScopes: new WeakMap<object, Map<string, string>>(),
    quoteFrees: new WeakMap<object, Free>(),
    quotedSpans: new WeakMap<object, Set<string>>(),
    stringArrays: new TypeMap<LiteralType, string[]>(),
    ensureChecked: () => true,
    constants: new WeakNodeMap<Instance, Value>(),
    computing: new NodeSet<Instance>(),
  };
}
