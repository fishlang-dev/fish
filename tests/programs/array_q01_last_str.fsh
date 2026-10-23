// expect: 1
// Searching an array of Options compares each element by value.
function main() { const os: (string | null)[] = [null, "a" + 1, null]; console.log(os.lastIndexOf("a" + 1)); }
