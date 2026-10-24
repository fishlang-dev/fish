// error: 'forEach' passes its callback an 'i64' here, not an 'i32'
function main() { [1, 2, 3].forEach((x, i: i32) => console.log(i)); }
