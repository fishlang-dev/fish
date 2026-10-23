// error: template literal pattern types in promises are not supported yet
type Px = `${number}px`;
async function s(): Promise<Px> { return "1px"; }
async function main() {}
