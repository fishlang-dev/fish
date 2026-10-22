// error: 'g' was moved, so it can't be used here
interface Door {
  close(this: Own<this>): string;
}

class Gate {
  close(this: Own<this>): string {
    return "closed";
  }
}

function main() {
  const g: Dyn<Door> = new Gate();
  const a = g.close();
  const b = g.close();
}
