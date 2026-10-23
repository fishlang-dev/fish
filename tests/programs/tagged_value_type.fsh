// error: type 'i64' is not assignable to type 'string'
function sql(comptime strings: TemplateStringsArray, ...values: string[]): string { return strings[0]; }
function main() { console.log(sql`a = ${1}`); }
