// error: a 'Map' is keyed by strings or integers, or unions of their literals, not 'P'; objects as keys aren't supported yet
class P {} function main() { const m = new Map<P, i64>(); }
