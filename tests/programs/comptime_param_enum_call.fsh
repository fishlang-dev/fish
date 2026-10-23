// expect: LOUD
// A comptime call giving an enum member is a comptime argument.
enum Mode { Plain, Loud }
const L2 = Mode.Loud;
function pick(): Mode { return Mode.Loud; }
function shout(comptime mode: Mode): string { return mode === Mode.Loud ? "LOUD" : "plain"; }
function outer(comptime m: Mode): string { return shout(m); }
function main() { console.log(shout(comptime pick())); }
