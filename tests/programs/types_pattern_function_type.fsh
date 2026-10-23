// error: template literal pattern types in function types are not supported yet
type Px = `${number}px`;
type F = (s: Px) => string;
function main() {}
