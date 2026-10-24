// error: 'Array.from' takes no type argument; its element type is what the source holds, or what the map function gives
function main() { const xs = Array.from<i64>(["a"]); }
