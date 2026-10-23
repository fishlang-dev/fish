// error: is nested more than 64 alias instances deep while being computed
// A conditional type that keeps growing its argument never reaches a stopping branch.
type Grow<T> = T extends string ? Grow<T[]> : Grow<T[]>;
type G = Grow<string>;
function main() {}
