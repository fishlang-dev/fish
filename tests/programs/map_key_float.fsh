// error: a 'Set' holds strings or integers, or unions of their literals, not 'number'
function main() { const s = new Set<number>(); }
