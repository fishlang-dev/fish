// error: an array pattern reads each element as 'xs[i]', and a 'P' would be moved out of the array, leaving a hole
class P { n: i64 = 1; } function main() { const ps = [new P()]; const [p] = ps; }
