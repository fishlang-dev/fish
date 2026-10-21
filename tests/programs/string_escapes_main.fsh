function main() throws string {
  const why = "bad " + 1;
  throw why;
}
// fails: Error: bad 1
