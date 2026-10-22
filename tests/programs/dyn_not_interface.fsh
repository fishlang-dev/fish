// error: 'Dyn' takes the interface its values implement, like 'Dyn<Handler>'
function main() {
  const d: Dyn<i64> = 1;
}
