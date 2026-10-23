// error: 'filter''s callback has to give a 'boolean', since Fish has no truthiness
function main() { const xs = [1]; console.log(xs.filter((x) => x).length); }
