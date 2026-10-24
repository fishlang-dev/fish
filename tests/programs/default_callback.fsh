// error: 'map' always passes its callback this argument, so the parameter can't be optional or have a default
function main() { const ys = [1, 2, 3].map((x, i = 0) => x + i); }
