// error: template literal pattern types in class fields are not supported yet
type Px = `${number}px`;
class C { w: Px = "1px"; }
function main() {}
