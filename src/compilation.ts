import type { Names } from "./diag.ts";
import type { Ids } from "./nodes.ts";
import type { RegexTables } from "./regex.ts";

// What a compilation hands the front end, which keeps no state of its own: the counter node ids
// come from, the names its messages show as written, and the tables regexes are compiled with.
export type Compilation = { ids: Ids; names: Names; regex: RegexTables };

// The one compilation state the whole process shares, given to the front end by whatever starts a
// compilation. It is one because the checker keeps tables keyed by node across programs, which
// need ids unique in the process, and std's tree is numbered from the same counter when loaded.
export const shared: Compilation = { ids: { last: 0 }, names: { local: new Set(), madeUp: new Map() }, regex: { properties: new Map(), folds: new Map() } };

// A fresh node id, for code past the parser that makes nodes.
export const freshId = (): number => ++shared.ids.last;
