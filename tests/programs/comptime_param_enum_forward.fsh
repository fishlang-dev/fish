// expect: LOUD LOUD LOUD
// An enum member passed on from a comptime parameter is the same argument.
enum Mode { Plain, Loud }
function shout(comptime mode: Mode): string { return mode === Mode.Loud ? "LOUD" : "plain"; }
function outer(comptime m: Mode): string { return shout(m); }
function main() { console.log(shout(Mode.Loud), outer(Mode.Loud), shout(comptime Mode.Loud)); }
