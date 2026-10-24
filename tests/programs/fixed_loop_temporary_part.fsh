// error: this loop would read from a value made just for it
function mk(): FixedArray<FixedArray<string, 2>, 2> { return [["a" + 1, "b" + 1], ["c" + 1, "d" + 1]]; }
function main() { for (const x of mk()[1]) console.log(x); }
