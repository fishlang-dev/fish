// error: type '"a"' is not assignable to type '"b" | "c"'
// Exclude removes the members that fit, so the one it removed is refused.
type NotA = Exclude<"a" | "b" | "c", "a">;
function main() { const x: NotA = "a"; }
