// error: 'new Array(n).fill(x)' puts a clone of x in every slot, and a generator can't be cloned: it runs once
function* gen(): Generator<string> { yield "a" + 1; }
function main() { const a = new Array(2).fill(gen()); }
