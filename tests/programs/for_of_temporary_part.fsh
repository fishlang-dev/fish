// error: this loop would read a part of a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'
function mkArr(): string[][] { return [["e" + 1, "f" + 1]]; }
function main() { for (const y of mkArr()[0]) console.log(y); }
