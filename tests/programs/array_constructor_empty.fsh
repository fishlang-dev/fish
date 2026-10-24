// error: 'new Array()' is an empty array; write '[]', with its type where it can't be inferred, as in 'const xs: string[] = []'
function main() { const xs = new Array<string>(); }
