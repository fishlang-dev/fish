// error: this loop would read a part of a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'
function mk(): FixedArray<FixedArray<string, 2>, 2> { return [["a" + 1, "b" + 1], ["c" + 1, "d" + 1]]; }
function main() { for (const x of mk()[1]) console.log(x); }
