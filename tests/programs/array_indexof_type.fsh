// error: 'indexOf' can never find a 'string' among elements of type 'i64'
function main() { const xs = [1]; console.log(xs.indexOf("1")); }
