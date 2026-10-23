// error: 'infer U' declares a type only inside a conditional type's 'extends' clause
// `infer` only means something where a conditional type matches a pattern.
type U2 = (infer U)[];
function main() {}
