// error: this template literal type spells more than 10000 strings, too many for one union
type D = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type Five = `${D}${D}${D}${D}${D}`;
function main() {}
