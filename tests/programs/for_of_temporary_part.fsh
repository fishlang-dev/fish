// error: this loop would read from a value made just for it
function mkArr(): string[][] { return [["e" + 1, "f" + 1]]; }
function main() { for (const y of mkArr()[0]) console.log(y); }
