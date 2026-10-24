// error: a parameter that may be null can have only 'null' as its default so far
function f(a: string | null = "d"): string { return a ?? "none"; } function main() {}
