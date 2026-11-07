import { Arenas, type BodyId, type InstanceId, type LocalId } from "./arenas.ts";
import type { Value } from "./comptime.ts";
import type { CompileError, Names } from "./diag.ts";
import type { Kind, Verdict } from "./narrow.ts";
import { Rewrites, NodeMap, NodeSet, type Id, type Ids } from "./nodes.ts";
import type { ClassMember, ClassNode, Declarator, Expr, Func as Declared, Interface, JsName, ObjectProp, Param, Span, Stmt, TypeAlias, TypeNode, TypeParam } from "./parser.ts";
import type { Categories, Free, Hygiene, Quote } from "./quote.ts";
import type { RegexTables } from "./regex.ts";
import type { RustClass, RustName, RustTables } from "./rust.ts";
import type { Locking } from "./program.ts";
import { TypeMap, Typing, type ClassType, type DynType, type LiteralType, type Type } from "./typing.ts";
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
// declaration is, each marked when it is one of std's modules. `rust` holds the Rust names its
// `rust:` modules declare.
// `enumInits` are the computed enum initializers being evaluated, innermost last, as the span and
// member name an error about one points at.
// `fileNames`: for the program `flatten` linked, each file's top-level names by its base offset:
// the name each declaration it reaches takes in the program, to the name the file writes for it.
// Checking that program reads them; checking macros, linked from copies, doesn't.
// `generated`: the nodes a macro made, which no warning points into: their author can't change them.
// `rewrites`: the nodes lowering replaced, by id, until each body's rebuild puts them in place.
// `looked`: every source file loading read or looked for, as an absolute path, missing ones included.
export type Compilation = {
  session: Session; ids: Ids; rewrites: Rewrites; names: Names; regex: RegexTables; typing: Typing; arenas: Arenas; counts: Counts; upcasts: Set<string>; files: { base: usize; file: string; src: string; std: boolean }[]; rust: RustTables;
  enumInits: [usize, usize, string][]; fileNames?: Map<usize, Map<string, string>>; generated: NodeSet<Id>; looked: string[];
};

// What a compilation numbers as it goes, from 0, so the same program is numbered the same way
// whatever was compiled before it: its enums, which tells enums of one name apart, the generic
// functions lifted out of bodies, destructuring assignments, macro expansions, and the constants
// macros give values.
export type Counts = { enums: usize; lifts: usize; destructures: usize; expansions: usize; constants: usize };

// What lasts as long as whoever compiles: a CLI run, a language server, a test. Its options, and
// the caches that spare later compilations the work earlier ones did. The caches only building
// objects reads are on `mathlib.ts`'s `BuildSession`, out of the checker's reach.
// `locking`: whether the lockfile may be rewritten, and which dependencies `fishc update` moves.
// `engineHook`: whether programs may import `fish:engine`, which only the compiler's own tests do.
// `std`: std's statements when `cached`, each read a fresh copy, without which each compilation
// parses std's source; and how many times std was parsed rather than loaded.
// `timings`: each build stage's time, kept only when `--timings` asks.

export type Session = {
  locking: Locking;
  engineHook: boolean;
  std: { tree: Stmt[]; cached: boolean; parses: usize };
  timings?: Timings;
};

export function newSession(): Session {
  return { locking: { locked: false }, engineHook: false, std: { tree: [], cached: false, parses: 0 } };
}

export function newCompilation(session: Session): Compilation {
  return { session, ids: { last: 0 }, rewrites: new Rewrites(), names: { local: new Set(), madeUp: new Map() }, regex: { properties: new Map(), folds: new Map() }, typing: new Typing(), arenas: new Arenas(), counts: { enums: 0, lifts: 0, destructures: 0, expansions: 0, constants: 0 }, upcasts: new Set(), files: [], rust: { names: new NodeMap<Declared | ClassMember, RustName>(), classNodes: new NodeMap<ClassNode, RustClass>() }, enumInits: [], generated: new NodeSet<Id>(), looked: [] };
}

// The tables one check of a program fills in, by node and by type, for the rest of that check
// and for the passes after it: moves, comptime and codegen. `check` makes a fresh set, and every
// instance it makes holds it, so nothing one program records reaches another.
export type Tables = {
  // What every check of the program shares: its types, its instances, bodies, locals and classes,
  // the upcasts its macros wrote, the counter for the nodes checking makes, its counts, its regex
  // tables, files and Rust names, the nodes lowering replaced, and the session's timings.
  typing: Typing;
  arenas: Arenas;
  upcasts: Set<string>;
  ids: Ids;
  rewrites: Rewrites;
  counts: Counts;
  regex: RegexTables;
  files: Compilation["files"];
  rust: RustTables;
  generated: Compilation["generated"];
  timings?: Timings;
  // The `let` statements and parameters that declare a name, as the checker meets them; every
  // other node an instance's `locals` holds is a use of one.
  declarations: NodeSet<Expr | Stmt | Param | ObjectProp>;
  // The names a loop's pattern binds, made as declarations of the parts; a generic body checked
  // again for another instance meets them already made.
  loopParts: NodeSet<Declarator>;
  // The name each local const holding a number literal gives as a computed key, which its type,
  // a plain number type, doesn't say; and the names top-level consts and enums give.
  numberKeys: Map<LocalId, string>;
  topKeys?: TopKeys;
  // The arrows nested function declarations became, with their names; they lend what they capture
  // per call.
  nestedFunctions: NodeMap<Expr, string>;
  // The bindings nested function declarations make, and closures' captures of them.
  nestedBindings: Set<LocalId>;
  // The generic functions written inside bodies, each lifted to a function of its own, by the
  // statement that declared it, or the generic arrow written as a value.
  liftedFunctions: NodeMap<Stmt | Expr, { name: string; fn: Declared & { body: Stmt[] } }>;
  // Every name a class or object literal gives a getter, so a destructuring source reading one
  // runs it once.
  getterNames: Set<string>;
  // The fresh variable a destructuring assignment's literal part goes into, by the target whose
  // type it takes; and the defaults it adds, which an Option's absence takes and anything else
  // never needs.
  destructuredParts: NodeMap<Stmt, Expr>;
  // What checking put into a statement list beside a statement, by the statement: the parts a
  // destructuring declaration became after it, and the block a `for` head's declarations moved
  // into around it. A generic class's instances check copies of one body, with its nodes' ids, so
  // a copy checked after the first is given the same statements where the first was edited.
  insertedAfter: NodeMap<Stmt, Stmt[]>;
  wrappedIn: NodeMap<Stmt, Stmt>;
  unusedDefaults: NodeSet<Expr>;
  timerMains: NodeSet<Declared>;
  // A nested function's calls of itself, which run with the calling closure's own captures.
  selfCalls: NodeSet<Expr>;

  // The member reads a pipe wrote in for its topic. A generic body is checked once, so whether one
  // is a stored field or a getter's is only known for each instance.
  substituted: NodeSet<Expr>;
  // The element types written on `Array.of<T>(...)` calls, which became array literals.
  ofElements: NodeMap<Expr, TypeNode>;
  // The array literals `Object.keys`, `values` and `entries` calls became, with which it was and the
  // object it reads, so a generic body's next instance types the literal as the call did.
  objectReads: NodeMap<Expr, { name: "keys" | "values" | "entries"; object: Expr }>;
  // The Map method calls a dictionary's reads, writes, deletes and key tests became, the only
  // method calls a dictionary takes. A generic body's next instance meets them already made.
  dictCalls: NodeSet<Expr>;
  // `new Array(n).fill(x)` calls, rewritten into calls of the prelude's `array filled`.
  fills: NodeSet<Expr>;
  filling: NodeSet<Expr>;
  // Calls whose trailing arguments have been packed into their rest parameter's array.
  packed: NodeSet<Expr>;
  // The pairs of a `new Map([[k, v]])` given no types, each a tuple of what it holds.
  pairs: NodeSet<Expr>;
  // The `FixedArray.filled` calls, by the fixed array each makes.
  fixedFills: NodeSet<Expr>;
  // `String.fromCharCode(...)` and `String.fromCodePoint(...)`, by their call, their arguments
  // gathered into one array.
  stringBuilds: NodeMap<Expr, "units" | "points">;
  // The parameters of the closures declared functions named as values became: the function as
  // written, its parameters' names, and which of them take values a caller would have to clone.
  namedParams: NodeMap<Param, { fn: string; names: string[]; clones: boolean[] }>;
  // Their types, resolved where the function is declared.
  presetParams: NodeMap<Param, Type>;
  // The arrows the checker writes around a function given as a value or a timer's callback, which
  // keep no frame in a backtrace, since nobody wrote them.
  madeArrows: NodeSet<Expr>;
  // The `fill length` checks that panic on a negative length.
  lengthChecks: NodeSet<Expr>;
  // The `fileRead` and `fileWrite` calls of the std's file module.
  fileCalls: NodeSet<Expr>;
  // The blocking calls the std's sync file module is written over, by their name.
  syncFileCalls: NodeMap<Expr, string>;
  // The calls that print: `console.log`, `console.error`, `console.warn` and `print`.
  printCalls: NodeSet<Expr>;
  // `handle.join()` calls, which take the handle over and give it back awaitable as a TaskPanic.
  joinCalls: NodeSet<Expr>;
  // node:util's `format` calls.
  formatCalls: NodeSet<Expr>;
  // The timer calls written in a program, rewritten into the std's own, and the async arrows
  // running their callbacks.
  timerSets: NodeSet<Expr>;
  timerWrappers: NodeSet<Expr>;
  // The name each rewritten timer call was written with, for messages about it.
  timerNames: NodeMap<Expr, string>;
  // `Promise.all`, `race`, `allSettled` and `any` calls, each its own combined future.
  combinedCalls: NodeSet<Expr>;
  // The operands of an `await`, while they are checked.
  awaitedNow: NodeSet<Expr>;
  // node:util's `inspect` calls.
  inspectCalls: NodeSet<Expr>;
  // The `isDeepStrictEqual` calls checked as the `===` they were turned into.
  deepEqualities: NodeSet<Expr>;
  // The calls `spawnBlocking` makes of a function it was given other than as an arrow.
  blockingRuns: NodeSet<Expr>;
  // The `parseArgs` calls whose config has been turned into the arguments std's port takes.
  parsedArgs: NodeSet<Expr>;
  // The values printed as Node's util.inspect prints them, whose types as written say how their
  // fields were spelled.
  printed: NodeSet<Expr>;
  // The `Date.now()`, `performance.now()` and `Math.random()` calls, by which each is: each reads
  // the world outside the program, so none has a value while compiling.
  clocks: NodeMap<Expr, "Date.now" | "performance.now" | "Math.random">;
  // The `JSON.stringify` and `JSON.parse` calls, by which each is.
  jsonCalls: NodeMap<Expr, "stringify" | "parse">;
  // The `parseInt`, `parseFloat` and `Number(s)` calls, by which each is.
  parses: NodeMap<Expr, "parseInt" | "parseFloat" | "Number">;
  // Calls of the global `assert`, which panics where it is called, each with its condition as written.
  asserts: NodeMap<Expr, string>;
  regexStringCalls: NodeMap<Expr, string>;
  // The regex method calls, by method.
  regexCalls: NodeMap<Expr, "test" | "exec">;
  // The `new RegExp(...)` expressions, which are regexes known while compiling.
  regexNews: NodeSet<Expr>;
  // The `toFixed` calls.
  fixedPrints: NodeSet<Expr>;
  // The `Math` calls and constants, which codegen lowers itself.
  maths: NodeSet<Expr>;
  // The calls of the integer methods named for how they overflow, as `checkedAdd`.
  integerCalls: NodeSet<Expr>;
  // The calls a tagged template became, the only calls yet that fill a rest parameter.
  tagCalls: NodeSet<Expr>;
  // The `equals` each class's `===` calls.
  equalities: TypeMap<ClassType, InstanceId>;
  // Each quote, by the Ast types it was checked with, for comptime to build its value from.
  quotes: NodeMap<Expr, Categories>;
  // The array literals that became tuples, as objects of fields `0`, `1` and on, which a generic
  // body's next instance checks again as tuples.
  tupleLiterals: NodeSet<Expr>;
  // A rest tuple's array, read as its field `...`, and how many fixed elements come before it.
  restStarts: NodeMap<Expr, usize>;
  // Member reads the runtime computes, like `c.signal` and `signal.aborted`, and fields read
  // through a Dyn: values, not places.
  computed: NodeSet<Expr>;
  // For each concrete type boxed into a Dyn, by the keys of the type and the Dyn: the instance
  // each interface method runs, then for each field the getter supplying it, or none when it is
  // a field. And each method call through a Dyn, with the receiver its interface declares.
  dynMembers: Map<string, DynTable>;
  // A value boxed into a union's one Dyn member on its way into the union: the Dyn it becomes first.
  boxedMembers: NodeMap<Expr, DynType>;
  // A rewritten call of a prelude promise helper whose T, in a generic body, may be void in an
  // instance: its name and type arguments for a T that isn't, the void helper taking the rest.
  promiseVariants: NodeMap<Expr, { name: string; typeArgs: TypeNode[] }>;
  // The reads of a package's consts that can't be converted, refused once the program is checked.
  jsUses: Expr[];
  // The values given to `JSON.stringify` holding an `unknown`, checked once its members are known.
  unknownJson: Span[];
  // The calls into a package, whose arguments cross by copy, so nothing moves into them.
  jsCrossings: NodeSet<Expr>;
  // The function each of a package's signatures is checked as, by its declaration.
  jsBodies: NodeMap<Stmt, BodyId>;
  // A package's classes, by name: what `new` and their statics are checked against.
  jsClasses: Map<string, Interface>;
  // Where each of a package's functions is first called, noted on a refusal of its declaration.
  jsCalledAt: Map<BodyId, Expr>;
  // The std's timer calls, by which one each is.
  timerCalls: NodeMap<Expr, "timerSet" | "timerNext" | "timerClear">;
  // The test hook's `jsEvaluate(source)` calls, each running a JS module.
  jsEvaluations: NodeSet<Expr>;
  // The `v === null` and `v === undefined` tests of a JsValue: what is tested, and for which.
  jsEmptyTests: NodeMap<Expr, [Expr, "null" | "undefined"]>;
  // The reads of a package's consts, by the export each reads.
  jsExports: NodeMap<Expr, JsName>;
  // The calls of a package's functions, by the export each calls, with the signature checked.
  jsCalls: NodeMap<Expr, JsName>;
  // The values given to JS, converted by the call or write that gives them.
  jsGiven: NodeSet<Expr>;
  // A handle's property reads and writes, and its method calls.
  jsMembers: NodeSet<Expr>;
  jsMethods: NodeSet<Expr>;
  // `new` of a package's class, and its static members read or called, by the class's export.
  jsNews: NodeMap<Expr, JsName>;
  jsStatics: NodeMap<Expr, JsName>;
  // Which declared parameters of a handle's method, a constructor or a static method a call takes
  // are optional, written with `?`, which JS may leave out: an empty value is undefined there.
  jsOptionalOf: NodeMap<Expr, boolean[]>;
  // The `get`, `at` and `has` calls on a JsValue.
  jsAccessors: NodeSet<Expr>;
  dynCalls: NodeMap<Expr, { index: usize; mutable: boolean; owned: boolean; callable?: Expr }>;
  // The `h.m?.()` calls of an interface's optional methods.
  optionalCalls: NodeSet<Expr>;
  // Each test of whether an optional method is there, `h.m !== undefined` or
  // `typeof h.m === "function"`: the receiver, the method, and what the test gives when it is.
  presenceTests: NodeMap<Expr, { object: Expr; name: string; when: boolean }>;

  // Each generic class's statics, declared with its first instance.
  genericStatics: NodeMap<ClassNode, Map<string, BodyId>>;
  // A generic class's placeholders, by its first type parameter, shared by its definition
  // check and its members.
  classScopes: NodeMap<TypeParam, Map<string, Type>>;
  // The aliases being looked through by inference, so one that holds itself is looked into once.
  expanding: Set<string>;

  // The `instanceof Map`, `instanceof Set` and `instanceof Array` tests and the `Array.isArray`
  // calls, by the kind each tests a value for.
  kindTests: NodeMap<Expr, Kind>;
  // Each `"x" in v` test, with whether each member type `v` was seen holding has key `x`.
  keyTests: NodeMap<Expr, TypeMap<Type, Verdict>>;

  // Each lowered parameter: its name as written, and whether its default is `null`.
  defaulted: NodeMap<Param, { name: string; empty: boolean }>;
  // Each `<it> ?? v` a default became, with the parameter's declared type, which `v` is checked
  // against.
  fallbacks: NodeMap<Expr, TypeNode>;
  // Each lowered parameter's declared type, resolved where the function is written.
  declaredTypes: NodeMap<Param, Type>;
  // Parameters renamed for the body, with the name shown for them in function types.
  renamed: NodeMap<Param, string>;
  // The statements binding defaults and destructured parameters, which come before a derived
  // constructor's `super(...)`.
  prologues: NodeSet<Stmt>;

  // Type nodes the checker makes for a type it already knows, as a rewritten call's type arguments.
  // Made while checking a generic body's definition, they name its placeholders, which each
  // instance swaps for what it binds them to.
  presetTypes: NodeMap<TypeNode, Type>;
  // Each quote parsed, by the quote, so its holes are the same nodes wherever it is read.
  parsedQuotes: NodeMap<Expr, Quote>;
  // While a macro runs, the hygiene its quotes are built with, last, after any of the macros
  // whose run it is in.
  hygienes: Hygiene[];
  // The bindings each quote made while a macro runs, for a quote it is spliced into; the names it
  // left free, for that quote to bind; and the spans of the quotes its nodes came from, the only
  // nodes those names are renamed in, never the program's own, spliced in as input. Each is kept
  // by the number its value holds as `quote`, which `quoteValues` gives.
  quoteScopes: Map<usize, Map<string, string>>;
  quoteFrees: Map<usize, Free>;
  quotedSpans: Map<usize, Set<string>>;
  quoteValues: Ids;
  // A comptime string array's binding: a literal type standing for exactly that array, so equal
  // arrays share an instance, with the array it stands for.
  stringArrays: TypeMap<LiteralType, string[]>;
  // Each top-level const's value, once computed, and those being computed, which a const reading
  // itself would meet.
  constants: Map<InstanceId, Value>;
  computing: Set<InstanceId>;
};

/** @throws {CompileError} */
export type TopKeys = (e: Expr) => string;

/** @throws {CompileError} */
/** @throws {CompileError} */
export type Timed<T> = () => T;

export function newTables({ session, typing, arenas, upcasts, ids, rewrites, counts, regex, files, rust, generated }: Compilation): Tables {
  return {
    timings: session.timings,
    typing,
    arenas,
    upcasts,
    ids,
    rewrites,
    counts,
    regex,
    files,
    rust,
    generated,
    declarations: new NodeSet<Expr | Stmt | Param | ObjectProp>(),
    loopParts: new NodeSet<Declarator>(),
    numberKeys: new Map<LocalId, string>(),
    nestedFunctions: new NodeMap<Expr, string>(),
    nestedBindings: new Set<LocalId>(),
    liftedFunctions: new NodeMap<Stmt | Expr, { name: string; fn: Declared & { body: Stmt[] } }>(),
    getterNames: new Set<string>(),
    destructuredParts: new NodeMap<Stmt, Expr>(),
    insertedAfter: new NodeMap<Stmt, Stmt[]>(),
    wrappedIn: new NodeMap<Stmt, Stmt>(),
    unusedDefaults: new NodeSet<Expr>(),
    timerMains: new NodeSet<Declared>(),
    selfCalls: new NodeSet<Expr>(),
    substituted: new NodeSet<Expr>(),
    ofElements: new NodeMap<Expr, TypeNode>(),
    objectReads: new NodeMap<Expr, { name: "keys" | "values" | "entries"; object: Expr }>(),
    dictCalls: new NodeSet<Expr>(),
    fills: new NodeSet<Expr>(),
    filling: new NodeSet<Expr>(),
    packed: new NodeSet<Expr>(),
    pairs: new NodeSet<Expr>(),
    fixedFills: new NodeSet<Expr>(),
    stringBuilds: new NodeMap<Expr, "units" | "points">(),
    namedParams: new NodeMap<Param, { fn: string; names: string[]; clones: boolean[] }>(),
    presetParams: new NodeMap<Param, Type>(),
    madeArrows: new NodeSet<Expr>(),
    lengthChecks: new NodeSet<Expr>(),
    fileCalls: new NodeSet<Expr>(),
    syncFileCalls: new NodeMap<Expr, string>(),
    printCalls: new NodeSet<Expr>(),
    joinCalls: new NodeSet<Expr>(),
    formatCalls: new NodeSet<Expr>(),
    timerSets: new NodeSet<Expr>(),
    timerWrappers: new NodeSet<Expr>(),
    timerNames: new NodeMap<Expr, string>(),
    combinedCalls: new NodeSet<Expr>(),
    awaitedNow: new NodeSet<Expr>(),
    inspectCalls: new NodeSet<Expr>(),
    deepEqualities: new NodeSet<Expr>(),
    blockingRuns: new NodeSet<Expr>(),
    parsedArgs: new NodeSet<Expr>(),
    printed: new NodeSet<Expr>(),
    clocks: new NodeMap<Expr, "Date.now" | "performance.now" | "Math.random">(),
    jsonCalls: new NodeMap<Expr, "stringify" | "parse">(),
    parses: new NodeMap<Expr, "parseInt" | "parseFloat" | "Number">(),
    asserts: new NodeMap<Expr, string>(),
    regexStringCalls: new NodeMap<Expr, string>(),
    regexCalls: new NodeMap<Expr, "test" | "exec">(),
    regexNews: new NodeSet<Expr>(),
    fixedPrints: new NodeSet<Expr>(),
    maths: new NodeSet<Expr>(),
    integerCalls: new NodeSet<Expr>(),
    tagCalls: new NodeSet<Expr>(),
    equalities: new TypeMap<ClassType, InstanceId>(),
    quotes: new NodeMap<Expr, Categories>(),
    tupleLiterals: new NodeSet<Expr>(),
    restStarts: new NodeMap<Expr, usize>(),
    computed: new NodeSet<Expr>(),
    dynMembers: new Map<string, DynTable>(),
    boxedMembers: new NodeMap<Expr, DynType>(),
    promiseVariants: new NodeMap<Expr, { name: string; typeArgs: TypeNode[] }>(),
    jsUses: [],
    unknownJson: [],
    jsCrossings: new NodeSet<Expr>(),
    jsBodies: new NodeMap<Stmt, BodyId>(),
    jsClasses: new Map<string, Interface>(),
    jsCalledAt: new Map<BodyId, Expr>(),
    timerCalls: new NodeMap<Expr, "timerSet" | "timerNext" | "timerClear">(),
    jsEvaluations: new NodeSet<Expr>(),
    jsEmptyTests: new NodeMap<Expr, [Expr, "null" | "undefined"]>(),
    jsExports: new NodeMap<Expr, JsName>(),
    jsCalls: new NodeMap<Expr, JsName>(),
    jsGiven: new NodeSet<Expr>(),
    jsMembers: new NodeSet<Expr>(),
    jsMethods: new NodeSet<Expr>(),
    jsNews: new NodeMap<Expr, JsName>(),
    jsStatics: new NodeMap<Expr, JsName>(),
    jsOptionalOf: new NodeMap<Expr, boolean[]>(),
    jsAccessors: new NodeSet<Expr>(),
    dynCalls: new NodeMap<Expr, { index: usize; mutable: boolean; owned: boolean; callable?: Expr }>(),
    optionalCalls: new NodeSet<Expr>(),
    presenceTests: new NodeMap<Expr, { object: Expr; name: string; when: boolean }>(),
    genericStatics: new NodeMap<ClassNode, Map<string, BodyId>>(),
    classScopes: new NodeMap<TypeParam, Map<string, Type>>(),
    expanding: new Set<string>(),
    kindTests: new NodeMap<Expr, Kind>(),
    keyTests: new NodeMap<Expr, TypeMap<Type, Verdict>>(),
    defaulted: new NodeMap<Param, { name: string; empty: boolean }>(),
    fallbacks: new NodeMap<Expr, TypeNode>(),
    declaredTypes: new NodeMap<Param, Type>(),
    renamed: new NodeMap<Param, string>(),
    prologues: new NodeSet<Stmt>(),
    presetTypes: new NodeMap<TypeNode, Type>(),
    parsedQuotes: new NodeMap<Expr, Quote>(),
    hygienes: [],
    quoteScopes: new Map<usize, Map<string, string>>(),
    quoteFrees: new Map<usize, Free>(),
    quotedSpans: new Map<usize, Set<string>>(),
    quoteValues: { last: 0 },
    stringArrays: new TypeMap<LiteralType, string[]>(),
    constants: new Map<InstanceId, Value>(),
    computing: new Set<InstanceId>(),
  };
}

// How long each stage of a build took, kept only when `--timings` asks. Each stage records its own
// time: a stage timed inside another is taken out of the outer one, so borrow checking inside the
// checker, or the comptime interpreter inside macro expansion, is counted once, under its own name.
// `inner` is the time the stages running inside the current one have taken so far. `objects` names
// the cached objects built, and counts those reused. `now` is the clock, which a test replaces.
// `manual`, when set, is the clock: a test sets it and moves it by hand.
export type Timings = { ms: Map<string, f64>; notes: Map<string, string>; inner: f64; objects: { built: string[]; cached: usize }; manual?: f64 };

export const FRONT_END = ["parse", "macros", "check", "moves", "comptime"];
export const NATIVE_STAGES = ["compile", "runtime", "link"];

export function newTimings(): Timings {
  const made: Timings = { ms: new Map(), notes: new Map(), inner: 0, objects: { built: [], cached: 0 } };
  return made;
}

function now(timings: Ref<Timings>): f64 {
  return timings.manual !== undefined ? timings.manual : performance.now();
}

// The program's type aliases and interfaces, by name, and the lifetimes each class and alias
// declares, which nothing changes once they are declared, so the checker reads them while
// changing its own state.
export type Declarations = { aliases: Map<string, TypeAlias>; interfaces: Map<string, Interface>; slots: Map<string, boolean[]> };

export function newDeclarations(): Declarations {
  return { aliases: new Map<string, TypeAlias>(), interfaces: new Map<string, Interface>(), slots: new Map<string, boolean[]>() };
}

// When a timed stage started, and the time stages inside the one around it had taken by then.
export type Started = { outer: f64; start: f64 };

// Starts timing a stage, when timing.
export function timingStart(timings: Mut<Timings> | undefined): Started | undefined {
  if (timings === undefined) return undefined;
  const outer = timings.inner;
  timings.inner = 0;
  return { outer, start: now(timings) };
}

// Adds a stage's own time to stage `name`, leaving out the stages inside it.
export function timingEnd(timings: Mut<Timings> | undefined, name: string, started: Ref<Started> | undefined) {
  if (timings === undefined || started === undefined) return;
  const spent = now(timings) - started.start;
  timings.ms.set(name, (timings.ms.get(name) ?? 0) + spent - timings.inner);
  timings.inner = started.outer + spent;
}

// Runs `run`, adding its own time to stage `name` when timing.
/** @throws {CompileError} */
export function timed<T>(timings: Timings | undefined, name: string, run: Timed<T>): T {
  const started = timingStart(timings);
  try {
    return run();
  } finally {
    timingEnd(timings, name, started);
  }
}

// One line per stage of `stages`, in that order, a stage that never ran as 0.0, then the total.
export function formatTimings(timings: Timings, stages: string[], total: f64): string {
  const line = (name: string, ms: f64, note?: string) => `${name.padEnd(9)}${ms.toFixed(1).padStart(9)} ms${note !== undefined ? ` (${note})` : ""}\n`;
  return stages.map((s) => line(s, timings.ms.get(s) ?? 0, timings.notes.get(s))).join("") + line("total", total);
}

// Which cached objects a build made and how many it reused, as the runtime stage's note.
export function objectsNote({ objects: { built, cached } }: Timings): string {
  const cachedNote = `${cached} cached`;
  return built.length > 0 ? `built ${built.join(", ")}; ${cachedNote}` : cachedNote;
}
