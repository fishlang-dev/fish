// expect: LOUD
// An enum held by a top-level const is a comptime argument.
enum Mode { Plain, Loud }
const L: Mode = Mode.Loud;
function shout(comptime mode: Mode): string { return mode === Mode.Loud ? "LOUD" : "plain"; }
function main() { console.log(shout(L)); }
