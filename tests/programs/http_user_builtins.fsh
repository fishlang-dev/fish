// expect: 3 4
// expect: 200
// A program's own spawn and sleep don't change what the std HTTP library calls.
function spawn(n: i64): i64 { return n + 1; }
function sleep(n: i64): i64 { return n + 2; }
async function main(): Promise<void> {
  console.log(spawn(2), sleep(2));
  const res = new Response("hi");
  console.log(res.status);
}
