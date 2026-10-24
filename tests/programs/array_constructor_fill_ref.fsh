// error: 'new Array(n).fill(x)' can't be made from this value: arrays of references are not supported yet
function f(s: Ref<string>): string[] { return new Array(2).fill(s); }
function main() { console.log(f("a" + 1).join()); }
