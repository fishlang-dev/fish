// error: 'Atomic' holds an integer or a boolean, not 'string'; use a 'Lock' for other values
function main() {
  const a = new Atomic("one");
}
