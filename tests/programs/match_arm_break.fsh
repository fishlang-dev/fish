function main() {
  for (let i = 0; i < 3; i++) {
    match (i) {
      case 1 => {
        break;
      },
      case _ => console.log(i),
    }
  }
}
// error: 'break' can't leave a match arm, which is a body of its own like an arrow's
