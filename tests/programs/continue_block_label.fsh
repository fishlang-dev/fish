function main() {
  while (false) {
    here: {
      continue here
    }
  }
}
// error: 'continue' can only jump to a label on a loop
