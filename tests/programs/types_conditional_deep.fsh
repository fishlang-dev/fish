// error: is still being computed 64 aliases deep; a type that uses itself must reach a branch that stops
// A conditional type that keeps growing its argument never reaches a stopping branch.
type Grow<T> = T extends string ? Grow<T[]> : Grow<T[]>;
type G = Grow<string>;
function main() {}
