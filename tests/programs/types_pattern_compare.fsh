// expect: true false false true
// A union of a pattern and string literals compares as a string.
type Px = `${number}px`;
function auto(l: Px | "auto"): boolean { return l === "auto"; }
function sized(l: Px | "auto"): boolean { return "auto" !== l; }
function main() { console.log(auto("auto"), auto("1px"), sized("auto"), sized("1px")); }
