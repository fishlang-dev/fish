// error: rest parameters on arrow functions are not supported yet
function main() { const f = (...xs: i64[]) => xs.length; }
