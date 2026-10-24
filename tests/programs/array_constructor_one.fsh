// error: 'new Array(x)' of one value that isn't a length makes '[x]'; write 'Array.of(x)' or '[x]'
function main() { const xs = new Array("a"); }
